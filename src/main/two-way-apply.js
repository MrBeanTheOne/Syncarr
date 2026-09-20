// Two-way apply orchestration (Phase 3).
//
// Ties together: scan both sides -> reconcile (two-way-plan) -> execute
// (two-way-execute) -> update the two-way state baseline. Real file mutation
// uses fs/promises; scanning and the state store are injected so the
// orchestration can be integration-tested against real temp dirs.
//
// Archiving: before any overwrite or delete, the current file is copied into
// that side's own history folder (<root>/<historyFolderName>/versions/<runId>/),
// so two-way sync is recoverable in BOTH directions, not just on the destination.

'use strict';

// original-fs (via ./real-fs): two-way apply copies/stats/renames USER files
// (incl. before-overwrite archiving), so `.asar` files must be treated as
// regular files, not Electron's virtual directories. See real-fs.js.
const fs = require('./real-fs').promises;
const path = require('path');

const { buildTwoWayPlan } = require('./two-way-plan');
const { applyTwoWayPlan } = require('./two-way-execute');
const { HISTORY_FOLDER_NAME, RUN_STATUS } = require('./job-model');

function createFsFileOps() {
  return {
    async ensureDir(dir) { await fs.mkdir(dir, { recursive: true }); },
    async copyFile(src, dst) { await fs.copyFile(src, dst); },
    async removeFile(p) { await fs.rm(p, { force: false }); },
    async rename(from, to) { await fs.rename(from, to); },
    async stat(p) {
      const st = await fs.stat(p);
      return { size: st.size, mtimeMs: st.mtimeMs };
    }
  };
}

function normRel(relativePath) {
  return String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

// True only when `p` is confirmed absent (ENOENT). A permission/network error
// (EACCES, ENOTDIR, host unreachable) returns false: those are NOT a clean
// "folder doesn't exist", so the caller must abort rather than assume empty.
async function isMissingDirectory(p) {
  try {
    await fs.stat(p);
    return false;
  } catch (error) {
    return Boolean(error && error.code === 'ENOENT');
  }
}

// Map a (possibly prefixed) plan relativePath back to absolute paths + roots.
function makeResolver(groupRoots) {
  const roots = [...groupRoots].sort(
    (a, b) => String(b.relativePrefix || '').length - String(a.relativePrefix || '').length
  );
  return (relativePath) => {
    const rel = normRel(relativePath);
    for (const root of roots) {
      const prefix = normRel(root.relativePrefix);
      if (!prefix) {
        return {
          inner: rel,
          sourceAbs: path.join(root.sourcePath, rel),
          destAbs: path.join(root.destinationPath, rel),
          sourceRoot: root.sourcePath,
          destRoot: root.destinationPath,
          destinationRoot: root.destination && root.destination.path ? root.destination.path : root.destinationPath
        };
      }
      if (rel === prefix || rel.startsWith(`${prefix}/`)) {
        const inner = rel === prefix ? '' : rel.slice(prefix.length + 1);
        return {
          inner,
          sourceAbs: path.join(root.sourcePath, inner),
          destAbs: path.join(root.destinationPath, inner),
          sourceRoot: root.sourcePath,
          destRoot: root.destinationPath,
          destinationRoot: root.destination && root.destination.path ? root.destination.path : root.destinationPath
        };
      }
    }
    const root = roots[0];
    return {
      inner: rel,
      sourceAbs: path.join(root.sourcePath, rel),
      destAbs: path.join(root.destinationPath, rel),
      sourceRoot: root.sourcePath,
      destRoot: root.destinationPath,
      destinationRoot: root.destination && root.destination.path ? root.destination.path : root.destinationPath
    };
  };
}

function makeArchive({ resolver, fileOps, historyFolderName, runId, prepareHistoryRoot }) {
  const folder = historyFolderName || HISTORY_FOLDER_NAME;
  const preparedRoots = new Set();
  return async ({ side, relativePath }) => {
    const resolved = resolver(relativePath);
    const rootDir = side === 'source' ? resolved.sourceRoot : resolved.destinationRoot;
    const liveAbs = side === 'source' ? resolved.sourceAbs : resolved.destAbs;
    const archiveRelativePath = side === 'source' ? resolved.inner : normRel(relativePath);
    let exists = true;
    let previous = null;
    try {
      previous = await fileOps.stat(liveAbs);
    } catch {
      exists = false;
    }
    if (!exists) return false;
    const historyRoot = path.join(rootDir, folder);
    const archivedRelativePath = path.join('versions', String(runId || 'run'), archiveRelativePath);
    const archiveAbs = path.join(historyRoot, archivedRelativePath);
    await fileOps.ensureDir(path.dirname(archiveAbs));
    const historyKey = path.resolve(historyRoot).toLowerCase();
    if (!preparedRoots.has(historyKey) && typeof prepareHistoryRoot === 'function') {
      try { await prepareHistoryRoot(historyRoot); } catch { /* Folder visibility cannot block a safety archive. */ }
      preparedRoots.add(historyKey);
    }
    await fileOps.copyFile(liveAbs, archiveAbs);
    return {
      side,
      historyRoot,
      rootPath: rootDir,
      livePath: liveAbs,
      relativePath: archiveRelativePath,
      archivedPath: archiveAbs,
      archivedRelativePath,
      sourcePath: resolved.sourceAbs,
      sourceRoot: resolved.sourceRoot,
      previous
    };
  };
}

function emptyApplyResult() {
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
    archives: [],
    errors: [],
    destinations: 0
  };
}

function mergeResult(into, part) {
  for (const k of ['copiedToDest', 'copiedToSource', 'deletedOnDest', 'deletedOnSource', 'keptBoth', 'conflicts', 'archived', 'bytesCopied']) {
    into[k] += Number(part[k] || 0);
  }
  if (Array.isArray(part.errors)) into.errors.push(...part.errors);
  if (Array.isArray(part.archives)) into.archives.push(...part.archives);
  if (!part.ok) into.ok = false;
  if (part.status === RUN_STATUS.CANCELLED) into.status = RUN_STATUS.CANCELLED;
}

function toEntries(files, relativePrefix) {
  const out = [];
  for (const file of Array.isArray(files) ? files : []) {
    if (!file) continue;
    const stats = file.stats || file;
    const size = Number(stats.size);
    const mtimeMs = Number(stats.mtimeMs);
    if (!Number.isFinite(size) || !Number.isFinite(mtimeMs)) continue;
    const rel = normRel(file.relativePath);
    out.push({
      relativePath: relativePrefix ? `${normRel(relativePrefix)}/${rel}` : rel,
      size,
      mtimeMs,
      sha1: file.sha1 || stats.sha1 || null
    });
  }
  return out;
}

function buildJournalOperations(plan, resolver, prefix) {
  const operations = [];
  const add = (items, action, targetSide, expectedKey, recoverable = true) => {
    for (const [index, entry] of (items || []).entries()) {
      const resolved = resolver(entry.relativePath);
      const targetPath = targetSide === 'source' ? resolved.sourceAbs : resolved.destAbs;
      const sourcePath = targetSide === 'source' ? resolved.destAbs : resolved.sourceAbs;
      const before = targetSide === 'source' ? entry.source : entry.destination;
      operations.push({
        id: `${prefix}-${action}-${index + 1}`,
        action,
        relativePath: normRel(entry.relativePath),
        sourcePath,
        targetPath,
        before: before || null,
        expectedAfter: expectedKey ? (entry[expectedKey] || null) : null,
        sourceExpected: expectedKey ? (entry[expectedKey] || null) : null,
        recoverable
      });
    }
  };
  add(plan.copyToDest, 'copy-to-dest', 'destination', 'source');
  add(plan.copyToSource, 'copy-to-source', 'source', 'destination');
  add(plan.deleteOnDest, 'delete-on-dest', 'destination', null);
  add(plan.deleteOnSource, 'delete-on-source', 'source', null);
  add(plan.keepBoth, 'keep-both', 'destination', 'source', false);
  return operations;
}

async function runTwoWayApply({
  sourceRoots,
  destinations,
  excludePatterns,
  copySubfolders,
  historyEnabled,
  historyFolderName,
  jobId,
  basePath,
  runId,
  conflictPolicy = 'newer',
  collectFiles,
  openState,
  fileOps = createFsFileOps(),
  isCancelled,
  onProgress,
  prepareHistoryRoot,
  onPlan,
  onOperation
} = {}) {
  const result = emptyApplyResult();
  const roots = Array.isArray(sourceRoots) ? sourceRoots : [];
  const destinationList = Array.isArray(destinations) ? destinations : [];

  const indexOfDestination = (destination) => {
    const idx = destinationList.indexOf(destination);
    if (idx >= 0) return idx;
    if (destination && Number.isInteger(destination.index)) return destination.index;
    return 0;
  };

  const groups = new Map();
  for (const root of roots) {
    const destinationIndex = indexOfDestination(root.destination);
    if (!groups.has(destinationIndex)) groups.set(destinationIndex, []);
    groups.get(destinationIndex).push(root);
  }

  // Scan one side, aborting the whole run on a read error instead of pretending
  // the side is empty. Feeding an empty list to the planner when a scan actually
  // FAILED makes it read every baseline-known file as deleted on this side and
  // propagate that deletion to the OTHER side — a transient NAS blip would then
  // silently wipe the matching files. The only safe empty case is a genuine first
  // sync (no baseline yet) to a folder that doesn't exist: there is nothing to
  // delete, so an empty scan is harmless.
  const scanSide = async (rootPath, side, baselineEmpty) => {
    try {
      return await collectFiles({ sourcePath: rootPath, copySubfolders, excludePatterns });
    } catch (error) {
      if (baselineEmpty && await isMissingDirectory(rootPath)) return [];
      const reason = error && error.message ? error.message : String(error);
      throw new Error(`Two-way sync aborted: the ${side} folder could not be read ("${rootPath}": ${reason}). No files were changed.`);
    }
  };

  for (const [destinationIndex, groupRoots] of groups) {
    if (typeof isCancelled === 'function' && isCancelled()) { result.status = 'cancelled'; break; }

    const state = openState({ userDataPath: basePath, jobId, destinationIndex });
    if (state && state.ready) await state.ready;
    try {
      const baseline = state && typeof state.listRecords === 'function' ? state.listRecords() : [];
      const baselineEmpty = !Array.isArray(baseline) || baseline.length === 0;

      const sourceEntries = [];
      const destEntries = [];
      for (const root of groupRoots) {
        const sourceFiles = await scanSide(root.sourcePath, 'source', baselineEmpty);
        const destFiles = await scanSide(root.destinationPath, 'destination', baselineEmpty);
        sourceEntries.push(...toEntries(sourceFiles, root.relativePrefix));
        destEntries.push(...toEntries(destFiles, root.relativePrefix));
      }

      const plan = buildTwoWayPlan({ sourceFiles: sourceEntries, destFiles: destEntries, baseline, policy: conflictPolicy });

      const resolver = makeResolver(groupRoots);
      const operationIdPrefix = `destination-${destinationIndex + 1}`;
      if (typeof onPlan === 'function') {
        await onPlan({
          destinationIndex,
          operations: buildJournalOperations(plan, resolver, operationIdPrefix)
        });
      }
      const archiveItems = [];
      const baseArchive = historyEnabled === false
        ? null
        : makeArchive({ resolver, fileOps, historyFolderName, runId, prepareHistoryRoot });
      const archive = baseArchive
        ? async (item) => {
            const archived = await baseArchive(item);
            if (archived) archiveItems.push(archived);
            return archived;
          }
        : null;

      const part = await applyTwoWayPlan(plan, {
        resolvePaths: (rel) => {
          const r = resolver(rel);
          return { sourceAbs: r.sourceAbs, destAbs: r.destAbs };
        },
        fileOps,
        archive,
        conflictTag: String(runId || 'conflict'),
        recordSynced: async ({ relativePath, sourceObs, destObs, action }) => {
          if (!state || typeof state.recordFile !== 'function') return;
          await state.recordFile({
            relativePath,
            source: sourceObs,
            destination: destObs,
            runId,
            action: action === 'conflict-resolved' ? 'conflict-resolved' : 'synced'
          });
        },
        recordRemoved: async (relativePath) => {
          if (state && typeof state.removeRecord === 'function') await state.removeRecord(relativePath);
        },
        isCancelled,
        onProgress,
        onOperation,
        operationIdPrefix
      });
      part.archives = archiveItems;

      mergeResult(result, part);
      result.destinations += 1;
    } finally {
      if (state && typeof state.close === 'function') {
        try { await state.close(); } catch { /* best effort */ }
      }
    }
    if (result.status === RUN_STATUS.CANCELLED) break;
  }

  return result;
}

module.exports = {
  runTwoWayApply,
  toEntries
};
