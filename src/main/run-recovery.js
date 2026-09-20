// Rollback of an interrupted run stats, hashes, copies, and removes the USER's
// target/source/archive files. Those paths can be a synced `app.asar`, which
// Electron's patched fs presents as a 0-byte virtual DIRECTORY — that would make
// classifyOperation see isFile()===false and flag every .asar as 'manual',
// blocking the whole rollback, and would break the restore copyFile/hash.
// Go through ./real-fs (original-fs) so a synced .asar is treated as the
// ordinary file it is. Falls back to plain fs outside Electron (the test runner).
const realFs = require('./real-fs');
const fs = realFs.promises;
const fssync = realFs;
const crypto = require('crypto');
const path = require('path');

const MTIME_TOLERANCE_MS = 2500;

async function statFile(filePath) {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return { exists: true, isFile: false, size: stats.size, mtimeMs: stats.mtimeMs };
    return { exists: true, isFile: true, size: stats.size, mtimeMs: stats.mtimeMs };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { exists: false, isFile: false, size: 0, mtimeMs: 0 };
    throw error;
  }
}

function matchesMetadata(actual, expected) {
  if (!actual || actual.exists !== true || actual.isFile !== true || !expected) return false;
  const expectedSize = Number(expected.size);
  const expectedMtime = Number(expected.mtimeMs);
  if (Number.isFinite(expectedSize) && actual.size !== expectedSize) return false;
  if (Number.isFinite(expectedMtime) && Math.abs(actual.mtimeMs - expectedMtime) > MTIME_TOLERANCE_MS) return false;
  return Number.isFinite(expectedSize) || Number.isFinite(expectedMtime);
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fssync.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function matchesExpectedContent(operation, current) {
  if (!matchesMetadata(current, operation.expectedAfter) || !operation.sourcePath) return false;
  const source = await statFile(operation.sourcePath);
  if (!matchesMetadata(source, operation.sourceExpected || operation.expectedAfter)) return false;
  const [currentHash, sourceHash] = await Promise.all([
    hashFile(operation.targetPath),
    hashFile(operation.sourcePath)
  ]);
  return currentHash === sourceHash;
}

async function matchesArchivedOriginal(operation, current) {
  if (!operation.archivePath || !matchesMetadata(current, operation.before)) return false;
  const archive = await statFile(operation.archivePath);
  if (!matchesMetadata(archive, operation.before)) return false;
  const [currentHash, archiveHash] = await Promise.all([
    hashFile(operation.targetPath),
    hashFile(operation.archivePath)
  ]);
  return currentHash === archiveHash;
}

async function classifyOperation(operation) {
  const targetPath = String(operation && operation.targetPath || '').trim();
  if (!targetPath) return { action: 'manual', reason: 'The journal does not contain a target path.' };
  if (operation.recoverable === false) return { action: 'manual', reason: 'This compound operation requires manual recovery.' };

  const current = await statFile(targetPath);
  if (current.exists && !current.isFile) return { action: 'manual', reason: 'The target path is no longer a file.', current };
  if (!operation.archivePath && operation.status === 'planned' && matchesMetadata(current, operation.before)) {
    return { action: 'none', reason: 'The planned operation never started.', current };
  }

  if (operation.archivePath) {
    const archive = await statFile(operation.archivePath);
    if (!archive.exists || !archive.isFile) return { action: 'manual', reason: 'The safety archive is missing.', current };
    if (await matchesArchivedOriginal(operation, current)) return { action: 'none', reason: 'The archived original is already in place.', current };
    if (!current.exists || await matchesExpectedContent(operation, current)) {
      return { action: 'restore', reason: current.exists ? 'Restore the archived original.' : 'Restore the deleted original.', current };
    }
    return { action: 'manual', reason: 'The live file changed after the interrupted run.', current };
  }

  if (!operation.before) {
    if (!current.exists) return { action: 'none', reason: 'The new file is already absent.', current };
    if (await matchesExpectedContent(operation, current)) return { action: 'remove', reason: 'Remove the file created by the interrupted run.', current };
    return { action: 'manual', reason: 'The new file no longer matches what the run planned.', current };
  }

  return { action: 'manual', reason: 'No safety archive was recorded for the original file.', current };
}

async function previewRunRollback(journal) {
  // A journal with damaged lines may be missing archive records or status
  // patches, so its operation list cannot be trusted for automatic rollback —
  // recovery could "restore" from an incomplete picture (audit M6). Refuse
  // automatic rollback and leave the run to manual review / dismissal.
  // applyRunRollback starts from this preview, so it is refused here too.
  const corruptLines = Number(journal && journal.corruptLines) || 0;
  if (corruptLines > 0) {
    return {
      ok: false,
      ready: false,
      degraded: true,
      message: `This recovery journal contains ${corruptLines} damaged line(s) and may be incomplete. Roll back manually or dismiss this run.`,
      totals: { restore: 0, remove: 0, unchanged: 0, manual: 0 },
      operations: []
    };
  }

  const operations = [];
  for (const operation of [...(journal && journal.operations || [])].reverse()) {
    let decision;
    try {
      decision = await classifyOperation(operation);
    } catch (error) {
      decision = { action: 'manual', reason: error && error.message ? error.message : String(error) };
    }
    operations.push({ ...operation, rollback: decision });
  }
  const totals = {
    restore: operations.filter((item) => item.rollback.action === 'restore').length,
    remove: operations.filter((item) => item.rollback.action === 'remove').length,
    unchanged: operations.filter((item) => item.rollback.action === 'none').length,
    manual: operations.filter((item) => item.rollback.action === 'manual').length
  };
  return {
    ok: totals.manual === 0,
    ready: totals.manual === 0,
    message: totals.manual
      ? `${totals.manual} operation(s) need manual review; no rollback changes were made.`
      : `Rollback is ready: ${totals.restore} restore(s), ${totals.remove} created file(s) to remove.`,
    totals,
    operations
  };
}

async function restoreArchive(operation) {
  await fs.mkdir(path.dirname(operation.targetPath), { recursive: true });
  // Copy into a sibling temp file first, then rename over the target (audit
  // M7). The temp file lives in the SAME directory, so the rename is an
  // atomic same-volume switch on NTFS — a crash mid-restore can no longer
  // leave a half-written live file, and the live target keeps its previous
  // content until the replacement is fully on disk.
  const tempPath = `${operation.targetPath}.syncarr-rollback-tmp`;
  try {
    await fs.copyFile(operation.archivePath, tempPath);
    try {
      const archiveStats = await fs.stat(operation.archivePath);
      await fs.utimes(tempPath, archiveStats.atime, archiveStats.mtime);
    } catch {
      // The content restore remains valid if timestamp preservation is unavailable.
    }
    await fs.rename(tempPath, operation.targetPath);
  } finally {
    // Best-effort cleanup if the copy or rename failed part-way.
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function applyRunRollback(journal, { journalStore, afterApply } = {}) {
  const preview = await previewRunRollback(journal);
  if (!preview.ready) return { ...preview, applied: false };

  const confirmed = [];
  for (const operation of preview.operations) {
    const decision = await classifyOperation(operation);
    if (decision.action === 'manual') {
      return {
        ok: false,
        applied: false,
        message: 'A file changed while rollback was starting. Recovery stopped.',
        preview: await previewRunRollback(journal),
        appliedOperations: []
      };
    }
    confirmed.push({ operation, decision });
  }

  const applied = [];
  for (const { operation, decision } of confirmed) {
    try {
      if (decision.action === 'restore') await restoreArchive(operation);
      if (decision.action === 'remove') await fs.rm(operation.targetPath, { force: false });
    } catch (error) {
      // A mid-list failure used to reject the whole promise, losing the record
      // of what had already been applied (audit M7). Stop cleanly instead and
      // report exactly what happened. The journal is deliberately NOT
      // finalized: it stays interrupted, and a re-attempted rollback is safe —
      // classifyOperation re-verifies content, so already-restored files
      // classify as 'none' and the retry resumes where this one stopped.
      const reason = error && error.message ? error.message : String(error);
      if (journalStore) {
        await journalStore.recordOperation(journal, operation.id, {
          rollbackStatus: 'rollback-failed',
          rollbackAction: decision.action,
          rollbackError: reason
        }).catch(() => {});
      }
      return {
        ok: false,
        applied: applied.length > 0,
        partial: true,
        message: `Rollback stopped at "${operation.relativePath || operation.targetPath}": ${reason} ${applied.length} operation(s) were applied before the failure; run rollback again to continue.`,
        totals: preview.totals,
        appliedOperations: applied,
        failedOperation: { id: operation.id, action: decision.action, error: reason }
      };
    }
    applied.push({ id: operation.id, action: decision.action });
    if (journalStore) {
      await journalStore.recordOperation(journal, operation.id, {
        rollbackStatus: decision.action === 'none' ? 'already-original' : 'rolled-back',
        rollbackAction: decision.action
      }).catch(() => {});
    }
  }

  const result = {
    ok: true,
    applied: true,
    message: `Rollback completed: ${preview.totals.restore} restored, ${preview.totals.remove} removed.`,
    totals: preview.totals,
    appliedOperations: applied
  };
  if (typeof afterApply === 'function') await afterApply(journal, result);
  if (journalStore) await journalStore.finish(journal, 'rolled-back', result);
  return result;
}

module.exports = {
  previewRunRollback,
  applyRunRollback
};
