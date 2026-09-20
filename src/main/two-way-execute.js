// Two-way executor (Phase 3).
//
// Applies a reconciliation plan (from two-way-plan.js) to BOTH sides, mutating
// real files. All I/O is injected so the orchestration is fully unit-testable
// with an in-memory filesystem; main.js supplies fs-backed ops, a history
// archive callback, and the two-way state store.
//
// Safety contract:
//   * Every overwrite or delete archives the current file FIRST (via injected
//     archive()). If archiving throws, the file is left untouched and the error
//     is recorded — we never destroy data we failed to back up.
//   * Deletions only ever apply to plan entries, which two-way-plan.js only
//     emits for baseline-known files whose surviving side is unchanged.
//   * Per-file errors are captured, not thrown, so one bad file doesn't abort
//     the whole run; the baseline is updated only for files that fully applied,
//     so an interrupted run is safe to resume.
//
// Conflict (keep-both) resolution is convergent: the source version wins the
// original name on both sides, and the destination version is preserved as a
// "conflicted copy" on both sides — so the next run sees a consistent state
// instead of re-flagging the conflict forever.

'use strict';

const path = require('path');

function makeConflictName(relativePath, tag) {
  const rel = String(relativePath || '');
  const ext = path.posix.extname(rel.replace(/\\/g, '/'));
  const base = rel.slice(0, rel.length - ext.length);
  const cleanTag = String(tag || 'conflict').replace(/[\\/:*?"<>|]/g, '-');
  return `${base} (conflicted copy ${cleanTag})${ext}`;
}

function emptyResult() {
  return {
    ok: true,
    status: 'complete',
    copiedToDest: 0,
    copiedToSource: 0,
    deletedOnDest: 0,
    deletedOnSource: 0,
    keptBoth: 0,
    conflicts: 0,
    archived: 0,
    bytesCopied: 0,
    errors: []
  };
}

async function applyTwoWayPlan(plan, deps = {}) {
  const {
    resolvePaths,                 // (relativePath) => { sourceAbs, destAbs }
    fileOps,                      // { ensureDir, copyFile, removeFile, rename, stat }
    archive,                      // async ({ side, absPath, relativePath }) => boolean
    recordSynced,                 // async ({ relativePath, sourceObs, destObs, action }) => void
    recordRemoved,                // async (relativePath) => void
    conflictTag = 'conflict',
    isCancelled,
    onProgress,
    onOperation,
    operationIdPrefix = 'two-way'
  } = deps;

  const result = emptyResult();
  if (!plan || typeof resolvePaths !== 'function' || !fileOps) return result;

  const cancelled = () => typeof isCancelled === 'function' && isCancelled();
  const noteError = (relativePath, op, err) => {
    result.ok = false;
    result.errors.push({ relativePath, op, message: (err && err.message) ? err.message : String(err) });
  };
  const progress = (info) => { if (typeof onProgress === 'function') onProgress(info); };
  const operation = async (operationId, patch) => {
    if (typeof onOperation === 'function') await onOperation(operationId, patch);
  };
  const operationId = (action, index) => `${operationIdPrefix}-${action}-${index + 1}`;

  const obsOf = async (absPath) => {
    try {
      const st = await fileOps.stat(absPath);
      if (!st) return null;
      return { size: Number(st.size) || 0, mtimeMs: Number(st.mtimeMs) || 0 };
    } catch {
      return null;
    }
  };
  const ensureParent = async (absPath) => fileOps.ensureDir(path.dirname(absPath));
  const doArchive = async (side, absPath, relativePath) => {
    if (typeof archive !== 'function') return false;
    const archived = await archive({ side, absPath, relativePath });
    if (archived) result.archived += 1;
    return archived;
  };
  const synced = async (relativePath, sourceAbs, destAbs, action) => {
    if (typeof recordSynced !== 'function') return;
    await recordSynced({
      relativePath,
      sourceObs: await obsOf(sourceAbs),
      destObs: await obsOf(destAbs),
      action
    });
  };

  // ----- copies -----
  for (const [index, entry] of (plan.copyToDest || []).entries()) {
    if (cancelled()) { result.status = 'cancelled'; return result; }
    const rel = entry.relativePath;
    const { sourceAbs, destAbs } = resolvePaths(rel);
    const id = operationId('copy-to-dest', index);
    try {
      await operation(id, { status: 'started' });
      if (entry.destination) {
        const archived = await doArchive('destination', destAbs, rel);
        if (archived) await operation(id, { status: 'archived', archivePath: archived.archivedPath, before: archived.previous || entry.destination || null });
      }
      await ensureParent(destAbs);
      await fileOps.copyFile(sourceAbs, destAbs);
      const expectedAfter = await obsOf(destAbs);
      await synced(rel, sourceAbs, destAbs, 'synced');
      result.copiedToDest += 1;
      result.bytesCopied += Number(entry.source && entry.source.size || 0);
      if (entry.conflict) result.conflicts += 1;
      await operation(id, { status: 'completed', expectedAfter });
      progress({ phase: 'copy', direction: 'toDest', relativePath: rel });
    } catch (err) {
      await operation(id, { status: 'failed', error: (err && err.message) ? err.message : String(err) });
      noteError(rel, 'copyToDest', err);
    }
  }

  for (const [index, entry] of (plan.copyToSource || []).entries()) {
    if (cancelled()) { result.status = 'cancelled'; return result; }
    const rel = entry.relativePath;
    const { sourceAbs, destAbs } = resolvePaths(rel);
    const id = operationId('copy-to-source', index);
    try {
      await operation(id, { status: 'started' });
      if (entry.source) {
        const archived = await doArchive('source', sourceAbs, rel);
        if (archived) await operation(id, { status: 'archived', archivePath: archived.archivedPath, before: archived.previous || entry.source || null });
      }
      await ensureParent(sourceAbs);
      await fileOps.copyFile(destAbs, sourceAbs);
      const expectedAfter = await obsOf(sourceAbs);
      await synced(rel, sourceAbs, destAbs, 'synced');
      result.copiedToSource += 1;
      result.bytesCopied += Number(entry.destination && entry.destination.size || 0);
      if (entry.conflict) result.conflicts += 1;
      await operation(id, { status: 'completed', expectedAfter });
      progress({ phase: 'copy', direction: 'toSource', relativePath: rel });
    } catch (err) {
      await operation(id, { status: 'failed', error: (err && err.message) ? err.message : String(err) });
      noteError(rel, 'copyToSource', err);
    }
  }

  // ----- deletes (archive first) -----
  for (const [index, entry] of (plan.deleteOnDest || []).entries()) {
    if (cancelled()) { result.status = 'cancelled'; return result; }
    const rel = entry.relativePath;
    const { destAbs } = resolvePaths(rel);
    const id = operationId('delete-on-dest', index);
    try {
      await operation(id, { status: 'started' });
      const archived = await doArchive('destination', destAbs, rel);
      if (archived) await operation(id, { status: 'archived', archivePath: archived.archivedPath, before: archived.previous || entry.destination || null });
      await fileOps.removeFile(destAbs);
      if (typeof recordRemoved === 'function') await recordRemoved(rel);
      result.deletedOnDest += 1;
      if (entry.conflict) result.conflicts += 1;
      await operation(id, { status: 'completed', expectedAfter: null });
      progress({ phase: 'delete', direction: 'deleteDest', relativePath: rel });
    } catch (err) {
      await operation(id, { status: 'failed', error: (err && err.message) ? err.message : String(err) });
      noteError(rel, 'deleteOnDest', err);
    }
  }

  for (const [index, entry] of (plan.deleteOnSource || []).entries()) {
    if (cancelled()) { result.status = 'cancelled'; return result; }
    const rel = entry.relativePath;
    const { sourceAbs } = resolvePaths(rel);
    const id = operationId('delete-on-source', index);
    try {
      await operation(id, { status: 'started' });
      const archived = await doArchive('source', sourceAbs, rel);
      if (archived) await operation(id, { status: 'archived', archivePath: archived.archivedPath, before: archived.previous || entry.source || null });
      await fileOps.removeFile(sourceAbs);
      if (typeof recordRemoved === 'function') await recordRemoved(rel);
      result.deletedOnSource += 1;
      if (entry.conflict) result.conflicts += 1;
      await operation(id, { status: 'completed', expectedAfter: null });
      progress({ phase: 'delete', direction: 'deleteSource', relativePath: rel });
    } catch (err) {
      await operation(id, { status: 'failed', error: (err && err.message) ? err.message : String(err) });
      noteError(rel, 'deleteOnSource', err);
    }
  }

  // ----- keep-both conflicts (convergent) -----
  // Source wins the original name on both sides; the destination's version is
  // preserved as a "conflicted copy" on both sides.
  for (const [index, entry] of (plan.keepBoth || []).entries()) {
    if (cancelled()) { result.status = 'cancelled'; return result; }
    const rel = entry.relativePath;
    const conflictRel = makeConflictName(rel, conflictTag);
    const original = resolvePaths(rel);
    const conflict = resolvePaths(conflictRel);
    const id = operationId('keep-both', index);
    try {
      await operation(id, { status: 'started' });
      if (entry.destination) {
        const archived = await doArchive('destination', original.destAbs, rel);
        if (archived) await operation(id, { status: 'archived', archivePath: archived.archivedPath, before: archived.previous || entry.destination || null });
      }
      // 1) Preserve the destination's current version under the conflict name on
      //    the destination side. COPY, not rename: a rename removes the original
      //    name first, so a crash between here and step 2 would leave the
      //    destination's original filename ABSENT — and the next run would misread
      //    that as a deletion to propagate to the source. A copy keeps the
      //    original name present until step 2 overwrites it in place.
      await ensureParent(conflict.destAbs);
      await fileOps.copyFile(original.destAbs, conflict.destAbs);
      // 2) Destination's original name now takes the source version (overwrite in
      //    place — the name always holds old-dest or new-source, never nothing).
      await ensureParent(original.destAbs);
      await fileOps.copyFile(original.sourceAbs, original.destAbs);
      // 3) Source side gets the destination's preserved version as a conflicted copy.
      await ensureParent(conflict.sourceAbs);
      await fileOps.copyFile(conflict.destAbs, conflict.sourceAbs);

      await synced(rel, original.sourceAbs, original.destAbs, 'conflict-resolved');
      await synced(conflictRel, conflict.sourceAbs, conflict.destAbs, 'conflict-resolved');
      result.keptBoth += 1;
      result.bytesCopied += Number(entry.source && entry.source.size || 0) + Number(entry.destination && entry.destination.size || 0);
      result.conflicts += 1;
      await operation(id, {
        status: 'completed',
        expectedAfter: await obsOf(original.destAbs),
        conflictPaths: { source: conflict.sourceAbs, destination: conflict.destAbs },
        recoverable: false
      });
      progress({ phase: 'conflict', direction: 'keepBoth', relativePath: rel, conflictPath: conflictRel });
    } catch (err) {
      await operation(id, { status: 'failed', error: (err && err.message) ? err.message : String(err), recoverable: false });
      noteError(rel, 'keepBoth', err);
    }
  }

  // ----- seed/refresh baseline for converged & first-run-equal files -----
  // These need no file copy, but the baseline must record them so a later
  // deletion of an identical file propagates instead of being re-copied.
  for (const entry of plan.unchanged || []) {
    if (!entry.baselineUpdate) continue;
    if (cancelled()) { result.status = 'cancelled'; return result; }
    const rel = entry.relativePath;
    const { sourceAbs, destAbs } = resolvePaths(rel);
    try {
      await synced(rel, sourceAbs, destAbs, 'synced');
    } catch (err) {
      noteError(rel, 'seedBaseline', err);
    }
  }

  // ----- forget baselines for paths gone on both sides -----
  for (const rel of plan.dropFromBaseline || []) {
    if (typeof recordRemoved === 'function') {
      try { await recordRemoved(rel); } catch (err) { noteError(rel, 'dropFromBaseline', err); }
    }
  }

  return result;
}

module.exports = {
  applyTwoWayPlan,
  makeConflictName
};
