const path = require('path');
// original-fs (via ./real-fs) so `.asar` files in synced app builds are treated
// as regular files, not the virtual directories Electron's default fs presents
// them as (which made stat() see app.asar as a 0-byte directory, breaking the
// snapshot scan, the restore-readiness check, and the restore copy alike). See
// real-fs.js. Falls back to plain fs outside Electron (e.g. the test runner).
const realFs = require('./real-fs');
const fs = realFs.promises;
const fsSync = realFs;
const crypto = require('crypto');
const { sanitizeJobId, clampNumber, normalizeSyncMode, HISTORY_FOLDER_NAME } = require('./job-model');
const { mapWithConcurrency } = require('./async-utils');

const RESTORE_POINTS_FOLDER_NAME = 'restore-points';
const RESTORE_POINT_SCHEMA_VERSION = 2;
const DEFAULT_MAX_RESTORE_POINTS = 50;
const RESTORE_POINT_IDENTITY_MODE = 'metadata';
const RESTORE_POINT_MTIME_TOLERANCE_MS = 2500;

// Resilience for genuine transient filesystem hiccups on slow external/SMB
// drives under AV load: right after a bulk sync, a just-copied file can throw a
// transient lock error (EBUSY/EPERM/...) or briefly stat as a non-regular file.
// Retry a few times before recording a scan error; a file that settles exits
// immediately, so only a genuinely-broken file waits the full budget and the
// common (healthy) case still does exactly one stat with no sleep.
// NOTE: the original "scan issues on app.asar" reports were NOT this — they were
// Electron's asar fs presenting `.asar` as a directory, fixed at the source by
// using original-fs above. This retry is belt-and-suspenders for real flakes.
const RESTORE_POINT_SNAPSHOT_RETRY_ATTEMPTS = 6;
const RESTORE_POINT_SNAPSHOT_RETRY_DELAY_MS = 250;
// Lock/finalization codes a just-copied file can throw transiently; all clear
// on a re-stat moments later. Deliberately NOT including ENOENT: the walker
// only snapshots entries readdir just listed as files, so a stat that then says
// "not found" almost always means a genuine delete (not finalization) — retrying
// it would only delay the (correct) scan error. UNKNOWN covers Windows' catch-all
// for a handle still in flux right after copy.
const TRANSIENT_STAT_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EAGAIN', 'UNKNOWN']);

// Per-directory fs.stat fan-out for the destination scan. The restore-point
// walk was previously fully sequential, so a 50k-file destination over SMB to
// a NAS took several minutes. 16 concurrent stats keeps the SMB share
// responsive while still saturating local disks; raise it only after profiling.
const SCAN_CONCURRENCY = 16;

function getRestorePointsRoot(basePath) {
  return path.join(basePath, RESTORE_POINTS_FOLDER_NAME, 'jobs');
}

function getJobRestorePointDir(basePath, jobId) {
  return path.join(getRestorePointsRoot(basePath), sanitizeJobId(jobId));
}

function normalizeRestorePointSettings(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    enabled: raw.restorePointsEnabled === true,
    maxRestorePoints: Math.max(1, Math.floor(clampNumber(raw.restorePointRetentionMax, 1, 1000, DEFAULT_MAX_RESTORE_POINTS)))
  };
}


function normalizeRestorePointTotalsForMode(totals, syncMode) {
  const cleanTotals = totals && typeof totals === 'object' ? { ...totals } : {};
  const mode = normalizeSyncMode(syncMode);
  const deleted = Number(cleanTotals.deletedFiles || 0);
  const destinationOnly = Number(cleanTotals.destinationOnlyFiles || 0);

  if (mode === 'mirror') {
    cleanTotals.deletedFiles = deleted || destinationOnly;
    cleanTotals.destinationOnlyFiles = 0;
  } else if (mode === 'twoWay') {
    cleanTotals.deletedFiles = deleted || destinationOnly;
    cleanTotals.destinationOnlyFiles = 0;
  } else {
    cleanTotals.destinationOnlyFiles = destinationOnly || deleted;
    cleanTotals.deletedFiles = 0;
  }

  return cleanTotals;
}

async function createRestorePointManifest({
  basePath,
  jobId,
  jobName,
  runId,
  syncMode,
  createdAt,
  sourcePaths,
  destinations,
  excludePatterns,
  historyFolderName,
  historySummary,
  robocopySummary,
  status,
  message,
  maxRestorePoints = DEFAULT_MAX_RESTORE_POINTS,
  onProgress
}) {
  const cleanJobId = sanitizeJobId(jobId);
  const restorePointId = String(runId || makeTimestampId(new Date())).replace(/[^a-z0-9_.-]/gi, '-');
  const created = normalizeDate(createdAt);
  const jobDir = getJobRestorePointDir(basePath, cleanJobId);
  const manifestPath = path.join(jobDir, `${restorePointId}.json`);
  const destinationEntries = [];
  const errors = [];
  const cleanMode = normalizeSyncMode(syncMode);
  const destinationOnlyCount = Number(robocopySummary && robocopySummary.files && (robocopySummary.files.extras || robocopySummary.files.deleted) || historySummary && historySummary.destinationOnly || 0);
  const totals = {
    destinations: 0,
    filesTotal: 0,
    bytesTotal: 0,
    scanErrors: 0,
    archivedVersions: Number(historySummary && historySummary.archived || 0),
    deletedFiles: cleanMode === 'mirror' ? destinationOnlyCount : 0,
    destinationOnlyFiles: cleanMode === 'mirror' ? 0 : destinationOnlyCount,
    copiedFiles: Number(robocopySummary && robocopySummary.files && robocopySummary.files.copied || 0)
  };

  for (const destination of Array.isArray(destinations) ? destinations : []) {
    const destinationPath = String(destination && destination.path || '').trim();
    if (!destinationPath) continue;

    try {
      const scan = await scanDestinationManifest({
        rootPath: destinationPath,
        excludePatterns,
        historyFolderName,
        onProgress: typeof onProgress === 'function'
          ? (progress) => onProgress({
              ...progress,
              destinationPath,
              destinationLabel: destination.label || path.basename(path.resolve(destinationPath)) || 'Destination'
            })
          : null
      });

      totals.destinations += 1;
      totals.filesTotal += scan.summary.filesTotal;
      totals.bytesTotal += scan.summary.bytesTotal;
      totals.scanErrors += scan.summary.scanErrors;

      destinationEntries.push({
        path: destinationPath,
        label: destination.label || path.basename(path.resolve(destinationPath)) || 'Destination',
        required: destination.required !== false,
        summary: scan.summary,
        files: scan.files,
        errors: scan.errors
      });
    } catch (error) {
      totals.destinations += 1;
      totals.scanErrors += 1;
      const message = error && error.message ? error.message : String(error);
      errors.push({ destinationPath, message });
      destinationEntries.push({
        path: destinationPath,
        label: destination.label || path.basename(path.resolve(destinationPath)) || 'Destination',
        required: destination.required !== false,
        summary: { filesTotal: 0, bytesTotal: 0, scanErrors: 1 },
        files: [],
        errors: [{ relativePath: '', message }]
      });
    }
  }

  const manifest = {
    schemaVersion: RESTORE_POINT_SCHEMA_VERSION,
    kind: 'syncarr-restore-point',
    restorePointType: 'incremental-manifest',
    id: restorePointId,
    jobId: cleanJobId,
    jobName: String(jobName || '').trim(),
    runId: restorePointId,
    createdAt: created.toISOString(),
    syncMode: String(syncMode || 'oneWay'),
    status: status || 'success',
    message: message || '',
    sourcePaths: Array.isArray(sourcePaths) ? sourcePaths : [],
    historyFolderName: String(historyFolderName || HISTORY_FOLDER_NAME),
    history: historySummary ? {
      archived: Number(historySummary.archived || 0),
      wouldArchive: Number(historySummary.wouldArchive || 0),
      manifestPath: historySummary.manifestPath || null,
      manifestPaths: Array.isArray(historySummary.manifestPaths) ? historySummary.manifestPaths : []
    } : null,
    robocopy: robocopySummary || null,
    totals,
    destinations: destinationEntries,
    errors,
    identityMode: RESTORE_POINT_IDENTITY_MODE,
    note: 'This restore point records lightweight file identity metadata for the full synchronized state. Restore content is resolved from a matching live file or the file-history archive created before a later change.'
  };

  await fs.mkdir(jobDir, { recursive: true });
  await writeJsonAtomic(manifestPath, manifest);
  const prune = await pruneRestorePointsForJob({
    basePath,
    jobId: cleanJobId,
    maxRestorePoints
  });

  return {
    ok: true,
    id: restorePointId,
    path: manifestPath,
    manifestPath,
    type: manifest.restorePointType,
    createdAt: manifest.createdAt,
    totals: normalizeRestorePointTotalsForMode(totals, syncMode),
    pruned: prune.deleted
  };
}

async function scanDestinationManifest({ rootPath, excludePatterns, historyFolderName, onProgress }) {
  const root = String(rootPath || '').trim();
  const files = [];
  const errors = [];
  const shouldExclude = makeExcludeMatcher(excludePatterns, historyFolderName);
  const progressState = { scannedFiles: 0, scannedBytes: 0, currentPath: '' };
  let lastProgressReportMs = 0;

  const reportProgress = (relativePath, size, force = false) => {
    progressState.scannedFiles += 1;
    progressState.scannedBytes += Number(size || 0);
    progressState.currentPath = normalizeRelative(relativePath);
    const now = Date.now();
    if (typeof onProgress === 'function' && (force || now - lastProgressReportMs > 750)) {
      lastProgressReportMs = now;
      onProgress({ ...progressState });
    }
  };

  async function walk(currentPath, relativeDir) {
    let entries = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      errors.push({ relativePath: normalizeRelative(relativeDir), message: error.message || String(error) });
      return;
    }

    // Recurse into subdirectories first. Sequential is intentional: subdirs
    // are typically shallow, and fanning out recursive walks would multiply
    // in-flight readdirs on a slow NAS share.
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      if (shouldExclude(relativePath, entry)) continue;
      await walk(path.join(currentPath, entry.name), relativePath);
    }

    // Collect candidate files first (excluding filtered entries), then stat
    // them in parallel. Per-file fs.stat is the hot path on big folders —
    // sequential awaits here were the dominant cost in profiling.
    const fileEntries = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      if (shouldExclude(relativePath, entry)) continue;
      fileEntries.push({
        entry,
        relativePath,
        fullPath: path.join(currentPath, entry.name)
      });
    }

    await mapWithConcurrency(fileEntries, SCAN_CONCURRENCY, async ({ relativePath, fullPath }) => {
      try {
        const identity = await captureFileIdentity(fullPath);
        files.push({
          relativePath: normalizeRelative(relativePath),
          livePath: fullPath,
          size: identity.size,
          modifiedAt: identity.modifiedAt,
          modifiedMs: identity.modifiedMs,
          contentHash: identity.contentHash,
          hashAlgorithm: identity.hashAlgorithm,
          identityMode: identity.identityMode,
          statusAtRestorePoint: 'present'
        });
        reportProgress(relativePath, identity.size);
      } catch (error) {
        errors.push({ relativePath: normalizeRelative(relativePath), message: error.message || String(error) });
      }
    });
  }

  await walk(root, '');
  if (typeof onProgress === 'function') onProgress({ ...progressState, done: true });
  const bytesTotal = files.reduce((total, file) => total + Number(file.size || 0), 0);
  return {
    summary: {
      filesTotal: files.length,
      bytesTotal,
      scanErrors: errors.length,
      identityMode: RESTORE_POINT_IDENTITY_MODE
    },
    files,
    errors
  };
}

async function listRestorePoints({ basePath, jobId, limit = 50 } = {}) {
  const cleanJobId = sanitizeJobId(jobId);
  const jobDir = getJobRestorePointDir(basePath, cleanJobId);
  let entries = [];
  try {
    entries = await fs.readdir(jobDir, { withFileTypes: true });
  } catch {
    return { ok: true, jobId: cleanJobId, points: [] };
  }

  // Read every manifest in parallel. The original implementation awaited one
  // fs.readFile at a time, which over SMB to a NAS made a job with dozens of
  // accumulated restore points take several extra seconds per finalization.
  const manifestPaths = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => path.join(jobDir, entry.name));

  const loaded = await mapWithConcurrency(manifestPaths, SCAN_CONCURRENCY, async (manifestPath) => {
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      return {
        id: manifest.id || path.basename(manifestPath, '.json'),
        runId: manifest.runId || manifest.id || path.basename(manifestPath, '.json'),
        jobId: manifest.jobId || cleanJobId,
        jobName: manifest.jobName || '',
        createdAt: manifest.createdAt || null,
        syncMode: manifest.syncMode || 'oneWay',
        status: manifest.status || 'unknown',
        type: manifest.restorePointType || 'incremental-manifest',
        totals: normalizeRestorePointTotalsForMode(manifest.totals || {}, manifest.syncMode || 'oneWay'),
        manifestPath
      };
    } catch {
      // Ignore malformed restore point manifests. Future cleanup can surface them.
      return null;
    }
  });

  const points = loaded.filter(Boolean);
  points.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { ok: true, jobId: cleanJobId, points: points.slice(0, Math.max(1, Number(limit) || 50)) };
}

async function pruneRestorePointsForJob({ basePath, jobId, maxRestorePoints = DEFAULT_MAX_RESTORE_POINTS } = {}) {
  const cleanJobId = sanitizeJobId(jobId);
  const jobDir = getJobRestorePointDir(basePath, cleanJobId);
  let entries = [];
  try {
    entries = await fs.readdir(jobDir, { withFileTypes: true });
  } catch {
    return { ok: true, deleted: 0 };
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
    const fullPath = path.join(jobDir, entry.name);
    try {
      const stats = await fs.stat(fullPath);
      files.push({ path: fullPath, mtimeMs: stats.mtimeMs });
    } catch {
      // Ignore.
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keep = Math.max(1, Math.floor(Number(maxRestorePoints) || DEFAULT_MAX_RESTORE_POINTS));
  const toDelete = files.slice(keep);
  let deleted = 0;
  for (const file of toDelete) {
    try {
      await fs.unlink(file.path);
      deleted += 1;
    } catch {
      // Ignore individual delete failures.
    }
  }
  return { ok: true, deleted };
}

async function readRestorePointManifest({ basePath, jobId, restorePointId, maxFilesPerDestination = 10000 } = {}) {
  const cleanJobId = sanitizeJobId(jobId);
  let resolved;
  try {
    resolved = resolveRestorePointManifestPath({ basePath, jobId: cleanJobId, restorePointId });
  } catch (error) {
    return { ok: false, message: error.message || String(error), manifest: null };
  }

  try {
    const manifest = await readRestorePointManifestFile(resolved.manifestPath);
    const limit = Math.max(0, Math.min(50000, Math.floor(Number(maxFilesPerDestination) || 10000)));
    return {
      ok: true,
      manifest: shapeRestorePointManifestForRenderer({
        manifest,
        cleanJobId,
        cleanId: resolved.cleanId,
        manifestPath: resolved.manifestPath,
        maxFilesPerDestination: limit
      })
    };
  } catch (error) {
    return {
      ok: false,
      message: error && error.message ? error.message : String(error),
      manifest: null,
      manifestPath: resolved.manifestPath
    };
  }
}

async function previewRestorePointPlan({ basePath, jobId, restorePointId, destinationIndex, relativePath, filePath, restoreFolder } = {}) {
  return buildRestorePointPlan({
    basePath,
    jobId,
    restorePointId,
    destinationIndex,
    relativePath,
    filePath,
    restoreFolder,
    includeResolvedFiles: false
  });
}

async function buildRestorePointPlan({
  basePath,
  jobId,
  restorePointId,
  destinationIndex,
  relativePath,
  filePath,
  restoreFolder,
  includeResolvedFiles = false
} = {}) {
  const cleanJobId = sanitizeJobId(jobId);
  let resolved;
  try {
    resolved = resolveRestorePointManifestPath({ basePath, jobId: cleanJobId, restorePointId });
  } catch (error) {
    return { ok: false, message: error.message || String(error), plan: null };
  }

  try {
    const manifest = await readRestorePointManifestFile(resolved.manifestPath);
    const destinations = Array.isArray(manifest.destinations) ? manifest.destinations : [];
    const parsedDestinationIndex = Number(destinationIndex);
    const hasDestinationScope = Number.isFinite(parsedDestinationIndex) && parsedDestinationIndex >= 0;
    const cleanFolder = normalizeScopeRelative(relativePath, 'restore point folder');
    const cleanFile = normalizeScopeRelative(filePath, 'restore point file');
    const cleanRestoreFolder = String(restoreFolder || '').trim();
    const destinationIndexes = hasDestinationScope ? [parsedDestinationIndex] : destinations.map((_destination, index) => index);
    const destinationPlans = [];
    const missingSample = [];
    const availableSample = [];
    const conflictSample = [];
    const resolvedFiles = [];
    const totals = {
      filesPlanned: 0,
      bytesPlanned: 0,
      availableFromLive: 0,
      availableFromHistory: 0,
      missingFromLive: 0,
      missingContent: 0,
      conflicts: 0,
      scanErrors: 0,
      destinations: 0
    };

    for (const index of destinationIndexes) {
      const destination = destinations[index];
      if (!destination) continue;
      const files = Array.isArray(destination.files) ? destination.files : [];
      const selected = files.filter((file) => restorePointFileMatchesScope(file, cleanFolder, cleanFile));
      const selectedErrors = (Array.isArray(destination.errors) ? destination.errors : [])
        .filter((error) => restorePointErrorMatchesScope(error, cleanFolder, cleanFile));
      const historyIndex = await buildHistoryArchiveIndex({
        destinationPath: destination.path,
        historyFolderName: manifest.historyFolderName || HISTORY_FOLDER_NAME,
        jobId: manifest.jobId || cleanJobId,
        createdAfter: manifest.createdAt
      });
      let availableLive = 0;
      let availableHistory = 0;
      let missing = 0;
      let conflicts = 0;
      let bytes = 0;
      const samples = [];

      // Per-file work fans out: resolveRestorePointFileContent + fileExists on
      // the restore output both hit the disk, and when a restore point has
      // thousands of files this loop used to dominate finalization time over
      // SMB. Run with bounded concurrency, then merge ordered results into
      // the samples / counters / resolvedFiles collections below.
      const fileResults = await mapWithConcurrency(selected, SCAN_CONCURRENCY, async (file) => {
        const size = Number(file && file.size || 0);
        const rel = normalizeRelative(file && file.relativePath);
        const content = await resolveRestorePointFileContent({
          manifest,
          destination,
          file,
          historyIndex
        });
        const outputRelativePath = makeRestoreOutputRelativePath({
          relativePath: rel,
          destination,
          destinationIndex: index,
          destinationCount: destinationIndexes.length
        });
        const outputPath = cleanRestoreFolder
          ? resolveInside(cleanRestoreFolder, outputRelativePath, 'restore output path')
          : '';
        const outputExists = outputPath ? await fileExists(outputPath) : false;
        return { file, size, rel, content, outputRelativePath, outputPath, outputExists };
      });

      for (const { file, size, rel, content, outputRelativePath, outputPath, outputExists } of fileResults) {
        bytes += size;

        if (content.sourceType === 'live') {
          availableLive += 1;
          if (availableSample.length < 8) availableSample.push({ relativePath: rel, destinationIndex: index, sourceType: 'live', sourcePath: content.sourcePath });
        } else if (content.sourceType === 'history') {
          availableHistory += 1;
          if (availableSample.length < 8) availableSample.push({ relativePath: rel, destinationIndex: index, sourceType: 'history', sourcePath: content.sourcePath });
        } else {
          missing += 1;
          if (missingSample.length < 12) missingSample.push({ relativePath: rel, destinationIndex: index, reason: content.reason });
        }
        if (outputExists) {
          conflicts += 1;
          if (conflictSample.length < 12) conflictSample.push({ relativePath: rel, destinationIndex: index, outputPath });
        }
        if (samples.length < 8) samples.push({
          relativePath: rel,
          size,
          sourceType: content.sourceType,
          available: content.available,
          outputPath,
          conflict: outputExists
        });
        if (includeResolvedFiles) {
          resolvedFiles.push({
            destinationIndex: index,
            relativePath: rel,
            outputRelativePath,
            outputPath,
            size,
            modifiedAt: file.modifiedAt || null,
            modifiedMs: Number(file.modifiedMs || 0),
            contentHash: file.contentHash || '',
            sourceType: content.sourceType,
            sourcePath: content.sourcePath || '',
            available: content.available,
            reason: content.reason || '',
            conflict: outputExists
          });
        }
      }

      totals.filesPlanned += selected.length;
      totals.bytesPlanned += bytes;
      totals.availableFromLive += availableLive;
      totals.availableFromHistory += availableHistory;
      totals.missingFromLive += missing;
      totals.missingContent += missing;
      totals.conflicts += conflicts;
      totals.scanErrors += selectedErrors.length;
      totals.destinations += 1;

      destinationPlans.push({
        index,
        label: destination.label || `Destination ${index + 1}`,
        path: destination.path || '',
        filesPlanned: selected.length,
        bytesPlanned: bytes,
        availableFromLive: availableLive,
        availableFromHistory: availableHistory,
        missingFromLive: missing,
        missingContent: missing,
        conflicts,
        scanErrors: selectedErrors.length,
        samples
      });
    }

    const scope = cleanFile ? 'file' : cleanFolder ? 'folder' : hasDestinationScope ? 'destination' : 'restore-point';
    return {
      ok: true,
      plan: {
        restorePointId: manifest.id || resolved.cleanId,
        jobId: manifest.jobId || cleanJobId,
        createdAt: manifest.createdAt || null,
        syncMode: manifest.syncMode || 'oneWay',
        manifestPath: resolved.manifestPath,
        scope,
        destinationIndex: hasDestinationScope ? parsedDestinationIndex : null,
        relativePath: cleanFile || cleanFolder || '',
        totals,
        destinations: destinationPlans,
        missingSample,
        availableSample,
        conflictSample,
        restoreFolder: cleanRestoreFolder,
        schemaSupported: Number(manifest.schemaVersion || 1) >= 2,
        ready: totals.filesPlanned > 0 && totals.missingContent === 0 && totals.conflicts === 0 && totals.scanErrors === 0,
        message: totals.filesPlanned
          ? totals.scanErrors
            ? `${totals.scanErrors} scan issue(s) prevent this scope from being considered complete.`
            : totals.missingContent
            ? `${totals.missingContent} file(s) no longer have verified restore content.`
            : totals.conflicts
              ? `${totals.conflicts} file(s) already exist in the selected restore folder.`
              : 'Restore readiness check passed for the selected scope.'
          : 'No files matched the selected restore point scope.'
      },
      ...(includeResolvedFiles ? { resolvedFiles } : {})
    };
  } catch (error) {
    return { ok: false, message: error && error.message ? error.message : String(error), plan: null };
  }
}

async function buildHistoryArchiveIndex({ destinationPath, historyFolderName, jobId, createdAfter }) {
  const historyRoot = path.join(String(destinationPath || ''), String(historyFolderName || HISTORY_FOLDER_NAME));
  const manifestsRoot = path.join(historyRoot, 'manifests');
  const index = new Map();
  const cutoff = Date.parse(createdAfter || '') || 0;
  let entries = [];

  try {
    entries = await fs.readdir(manifestsRoot, { withFileTypes: true });
  } catch {
    return index;
  }

  // Read each history manifest in parallel. Over SMB this was a noticeable
  // chunk of buildRestorePointPlan time when dozens of history manifests had
  // accumulated for a destination.
  const manifestPaths = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => path.join(manifestsRoot, entry.name));

  const parsedManifests = await mapWithConcurrency(manifestPaths, SCAN_CONCURRENCY, async (manifestPath) => {
    try {
      return JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    } catch {
      return null;
    }
  });

  for (const manifest of parsedManifests) {
    if (!manifest) continue;
    if (jobId && manifest.jobId && sanitizeJobId(manifest.jobId) !== sanitizeJobId(jobId)) continue;
    const createdAtMs = Date.parse(manifest.createdAt || '') || 0;
    if (cutoff && createdAtMs <= cutoff) continue;
    const archivedFiles = Array.isArray(manifest.archivedFiles) ? manifest.archivedFiles : [];
    archivedFiles.forEach((item) => {
      const relativePath = normalizeRelative(item && item.relativePath);
      const archivedRelativePath = normalizeScopeRelative(
        item && item.archivedRelativePath || path.join('versions', manifest.runId || '', relativePath),
        'history archive path'
      );
      if (!relativePath || !archivedRelativePath) return;
      const key = relativePath.toLowerCase();
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({
        createdAtMs,
        archivedRelativePath,
        sourcePath: resolveInside(historyRoot, archivedRelativePath, 'history archive path')
      });
    });
  }

  for (const candidates of index.values()) {
    candidates.sort((a, b) => a.createdAtMs - b.createdAtMs);
  }
  return index;
}

async function resolveRestorePointFileContent({ manifest, destination, file, historyIndex }) {
  const relativePath = normalizeScopeRelative(file && file.relativePath, 'restore point file');
  const expectedHash = String(file && file.contentHash || '').trim().toLowerCase();
  const expectedSize = Number(file && file.size || 0);
  const expectedModifiedMs = Number(file && file.modifiedMs || 0);
  // A schema-v2 entry carries identity even when it describes a legitimately
  // empty file: size 0 is a real size, not "no size recorded". Treat the entry
  // as having identity if it has ANY signal (hash, a positive size, or a
  // recorded mtime). The old `!expectedHash && !expectedSize` test wrongly
  // flagged every zero-byte file (empty logs, .gitkeep) as missing because
  // metadata-mode never hashes and `!0` is true.
  const hasIdentity = Boolean(expectedHash) || expectedSize > 0 || expectedModifiedMs > 0;
  if (Number(manifest && manifest.schemaVersion || 1) < 2 || !hasIdentity) {
    return { available: false, sourceType: 'missing', sourcePath: '', reason: 'legacy-restore-point-has-no-file-identity' };
  }

  const livePath = resolveInside(String(destination && destination.path || ''), relativePath, 'live restore source path');
  if (await fileMatchesSnapshot(livePath, expectedSize, expectedHash, expectedModifiedMs)) {
    return { available: true, sourceType: 'live', sourcePath: livePath, reason: '' };
  }

  const candidates = historyIndex.get(relativePath.toLowerCase()) || [];
  for (const candidate of candidates) {
    if (await fileMatchesSnapshot(candidate.sourcePath, expectedSize, expectedHash, expectedModifiedMs)) {
      return {
        available: true,
        sourceType: 'history',
        sourcePath: candidate.sourcePath,
        archivedRelativePath: candidate.archivedRelativePath,
        reason: ''
      };
    }
  }

  return { available: false, sourceType: 'missing', sourcePath: '', reason: 'verified-content-not-found' };
}

async function fileMatchesSnapshot(filePath, expectedSize, expectedHash, expectedModifiedMs = 0) {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile() || stats.size !== expectedSize) return false;
    if (expectedHash) return (await hashFile(filePath)).toLowerCase() === expectedHash;

    // An empty file has no content to differ: once the sizes match (both 0)
    // the content is identical regardless of mtime. The size+mtime heuristic
    // only guards against same-size/different-content, which is impossible at
    // size 0, so skipping the mtime check here just avoids false "missing" on
    // empty logs whose mtime drifts after the restore point was written.
    if (expectedSize === 0) return true;

    const cleanExpectedModifiedMs = Number(expectedModifiedMs || 0);
    if (!cleanExpectedModifiedMs) return true;
    return Math.abs(Math.round(stats.mtimeMs) - Math.round(cleanExpectedModifiedMs)) <= RESTORE_POINT_MTIME_TOLERANCE_MS;
  } catch {
    return false;
  }
}

function makeRestoreOutputRelativePath({ relativePath, destination, destinationIndex, destinationCount }) {
  const cleanRelativePath = normalizeScopeRelative(relativePath, 'restore output path');
  if (destinationCount <= 1) return cleanRelativePath;
  const label = sanitizeOutputSegment(destination && destination.label || `Destination ${destinationIndex + 1}`);
  const prefix = `${destinationIndex + 1}-${label}`;
  return normalizeRelative(path.join(prefix, cleanRelativePath));
}

function sanitizeOutputSegment(input) {
  const clean = String(input || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  return clean || 'Destination';
}

function normalizeScopeRelative(input, label) {
  const raw = String(input || '');
  const normalized = normalizeRelative(raw).replace(/\/+$/g, '');
  if (!normalized) return '';
  const segments = normalized.split('/').filter(Boolean);
  if (path.isAbsolute(raw) || path.isAbsolute(normalized) || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Invalid ${label}.`);
  }
  return normalized;
}

function resolveInside(rootPath, relativePath, label) {
  const cleanRoot = String(rootPath || '').trim();
  if (!cleanRoot) throw new Error(`Missing ${label} root.`);
  const safeRelative = normalizeScopeRelative(relativePath, label);
  if (!safeRelative) throw new Error(`Invalid ${label}.`);
  const resolvedRoot = path.resolve(cleanRoot);
  const resolvedPath = path.resolve(resolvedRoot, safeRelative);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Invalid ${label}.`);
  return resolvedPath;
}

function resolveRestorePointManifestPath({ basePath, jobId, restorePointId } = {}) {
  const cleanJobId = sanitizeJobId(jobId);
  const rawId = String(restorePointId || '').trim();
  const cleanId = rawId.replace(/[^a-z0-9_.-]/gi, '-');
  if (!cleanId) throw new Error('Restore point ID is required.');

  const jobDir = getJobRestorePointDir(basePath, cleanJobId);
  const manifestPath = path.resolve(jobDir, `${cleanId}.json`);
  const safeRoot = path.resolve(jobDir) + path.sep;
  if (!manifestPath.startsWith(safeRoot)) {
    throw new Error('Restore point path is outside the job restore-point folder.');
  }
  return { cleanJobId, cleanId, jobDir, manifestPath };
}

async function readRestorePointManifestFile(manifestPath) {
  const raw = await fs.readFile(manifestPath, 'utf8');
  return JSON.parse(raw);
}

// Choose which of a destination's files to hand to the renderer's restore-point
// browser when the destination has more files than the browse limit. A plain
// head-slice would drop whole trailing top-level folders, because the scan
// lists files folder-by-folder (depth-first). When a job has several source
// folders they each land under their own top-level folder in the destination,
// so a head-slice that filled up inside the first source folder made every
// later source folder vanish from the navigation. Grouping by the top-level
// path segment and sharing the budget round-robin guarantees every source
// folder stays navigable. Restores read the full on-disk manifest by scope, so
// any files omitted from this browse list are still fully restorable.
function pickRestorePointBrowseFiles(files, limit) {
  if (!Array.isArray(files) || !limit) return [];
  if (files.length <= limit) return files.slice();

  const groups = new Map();
  for (const file of files) {
    const rel = String((file && file.relativePath) || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const slash = rel.indexOf('/');
    const top = slash === -1 ? '' : rel.slice(0, slash);
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push(file);
  }
  if (groups.size <= 1) return files.slice(0, limit);

  const cursors = [...groups.values()].map((groupFiles) => ({ groupFiles, offset: 0 }));
  const picked = [];
  let active = true;
  while (picked.length < limit && active) {
    active = false;
    for (const cursor of cursors) {
      if (cursor.offset < cursor.groupFiles.length) {
        picked.push(cursor.groupFiles[cursor.offset]);
        cursor.offset += 1;
        active = true;
        if (picked.length >= limit) break;
      }
    }
  }
  return picked;
}

function shapeRestorePointManifestForRenderer({ manifest, cleanJobId, cleanId, manifestPath, maxFilesPerDestination }) {
  const limit = Math.max(0, Math.min(50000, Math.floor(Number(maxFilesPerDestination) || 0)));
  const destinations = (Array.isArray(manifest.destinations) ? manifest.destinations : []).map((destination) => {
    const files = Array.isArray(destination.files) ? destination.files : [];
    const browseFiles = limit ? pickRestorePointBrowseFiles(files, limit) : [];
    return {
      path: destination.path || '',
      label: destination.label || '',
      required: destination.required !== false,
      summary: destination.summary || {},
      errors: Array.isArray(destination.errors) ? destination.errors.slice(0, 12) : [],
      filesTotal: files.length,
      filesReturned: browseFiles.length,
      filesTruncated: browseFiles.length < files.length,
      files: browseFiles.map((file) => ({
        relativePath: file.relativePath || '',
        size: Number(file.size || 0),
        modifiedAt: file.modifiedAt || null,
        statusAtRestorePoint: file.statusAtRestorePoint || 'present',
        livePath: file.livePath || '',
        contentHash: file.contentHash || '',
        hashAlgorithm: file.hashAlgorithm || (file.contentHash ? 'sha256' : 'metadata'),
        identityMode: file.identityMode || (file.contentHash ? 'sha256' : 'metadata')
      }))
    };
  });

  return {
    schemaVersion: manifest.schemaVersion || null,
    kind: manifest.kind || '',
    id: manifest.id || cleanId,
    jobId: manifest.jobId || cleanJobId,
    jobName: manifest.jobName || '',
    runId: manifest.runId || manifest.id || cleanId,
    createdAt: manifest.createdAt || null,
    syncMode: manifest.syncMode || 'oneWay',
    status: manifest.status || 'unknown',
    message: manifest.message || '',
    restorePointType: manifest.restorePointType || 'incremental-manifest',
    sourcePaths: Array.isArray(manifest.sourcePaths) ? manifest.sourcePaths : [],
    historyFolderName: manifest.historyFolderName || HISTORY_FOLDER_NAME,
    history: manifest.history || null,
    totals: normalizeRestorePointTotalsForMode(manifest.totals || {}, manifest.syncMode || 'oneWay'),
    destinations,
    errors: Array.isArray(manifest.errors) ? manifest.errors.slice(0, 20) : [],
    identityMode: manifest.identityMode || '',
    note: manifest.note || '',
    manifestPath
  };
}

function restorePointFileMatchesScope(file, folderScope, fileScope) {
  const rel = normalizeRelative(file && file.relativePath);
  if (!rel) return false;
  if (fileScope) return rel.toLowerCase() === fileScope.toLowerCase();
  if (!folderScope) return true;
  const cleanFolder = normalizeRelative(folderScope);
  return rel === cleanFolder || rel.startsWith(`${cleanFolder}/`);
}

function restorePointErrorMatchesScope(error, folderScope, fileScope) {
  const rel = normalizeRelative(error && error.relativePath);
  if (!rel) return true;
  if (fileScope) return rel.toLowerCase() === fileScope.toLowerCase();
  if (!folderScope) return true;
  const cleanFolder = normalizeRelative(folderScope);
  return rel === cleanFolder || rel.startsWith(`${cleanFolder}/`);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function restoreRestorePointToFolder({
  basePath,
  jobId,
  restorePointId,
  destinationIndex,
  relativePath,
  filePath,
  restoreFolder,
  onProgress
} = {}) {
  const cleanRestoreFolder = String(restoreFolder || '').trim();
  if (!cleanRestoreFolder) {
    return { ok: false, status: 'invalid-target', message: 'Choose a restore folder first.' };
  }

  try {
    const stats = await fs.stat(cleanRestoreFolder);
    if (!stats.isDirectory()) throw new Error('Restore target is not a folder.');
  } catch (error) {
    return { ok: false, status: 'invalid-target', message: error.message || String(error) };
  }

  const planned = await buildRestorePointPlan({
    basePath,
    jobId,
    restorePointId,
    destinationIndex,
    relativePath,
    filePath,
    restoreFolder: cleanRestoreFolder,
    includeResolvedFiles: true
  });
  if (!planned.ok) return { ...planned, status: 'plan-error' };
  if (!planned.plan.ready) {
    return { ok: false, status: 'not-ready', message: planned.plan.message, plan: planned.plan };
  }

  const files = planned.resolvedFiles || [];
  let restoredFiles = 0;
  let restoredBytes = 0;
  const restoredSample = [];

  for (const file of files) {
    if (!file.available || !file.sourcePath || !file.outputPath) {
      return { ok: false, status: 'source-missing', message: `Verified restore content is missing for ${file.relativePath}.`, plan: planned.plan };
    }
    if (await fileExists(file.outputPath)) {
      return { ok: false, status: 'conflict', message: `Restore stopped because the target already exists: ${file.outputPath}`, plan: planned.plan };
    }

    await fs.mkdir(path.dirname(file.outputPath), { recursive: true });
    const temporaryPath = path.join(
      path.dirname(file.outputPath),
      `.${path.basename(file.outputPath)}.syncarr-restore-${process.pid}-${crypto.randomBytes(5).toString('hex')}.tmp`
    );

    try {
      await fs.copyFile(file.sourcePath, temporaryPath, fsSync.constants.COPYFILE_EXCL);
      if (!await fileMatchesSnapshot(temporaryPath, file.size, file.contentHash, file.contentHash ? file.modifiedMs : 0)) {
        throw new Error(`Restore copy verification failed for ${file.relativePath}.`);
      }
      const modifiedAt = new Date(file.modifiedAt || file.modifiedMs || Date.now());
      if (!Number.isNaN(modifiedAt.getTime())) {
        try { await fs.utimes(temporaryPath, modifiedAt, modifiedAt); } catch { /* timestamp preservation is best effort */ }
      }
      if (await fileExists(file.outputPath)) {
        throw new Error(`Restore target appeared while the restore was running: ${file.outputPath}`);
      }
      await fs.rename(temporaryPath, file.outputPath);
    } catch (error) {
      try { await fs.unlink(temporaryPath); } catch { /* temporary file may not exist */ }
      throw error;
    }

    restoredFiles += 1;
    restoredBytes += Number(file.size || 0);
    if (restoredSample.length < 20) restoredSample.push({ relativePath: file.relativePath, outputPath: file.outputPath, sourceType: file.sourceType });
    if (typeof onProgress === 'function') {
      onProgress({ restoredFiles, totalFiles: files.length, restoredBytes, currentFile: file.relativePath });
    }
  }

  return {
    ok: true,
    status: 'success',
    message: `Restored ${restoredFiles} file(s) to ${cleanRestoreFolder}.`,
    restorePointId: planned.plan.restorePointId,
    restoreFolder: cleanRestoreFolder,
    restoredFiles,
    restoredBytes,
    restoredSample,
    plan: planned.plan
  };
}

async function collectProtectedArchivePathsForRestorePoints({ basePath, jobId, targetPath, historyFolderName } = {}) {
  const cleanJobId = sanitizeJobId(jobId);
  const listed = await listRestorePoints({ basePath, jobId: cleanJobId, limit: 1000 });
  const historyRoot = path.resolve(String(targetPath || ''), String(historyFolderName || HISTORY_FOLDER_NAME));
  const protectedPaths = new Set();
  const degradedPoints = [];

  // Run buildRestorePointPlan per restore point in parallel. Each call resolves
  // every file in the point against live + history content, which over SMB
  // to a NAS used to take minutes when several points were accumulated.
  const planResults = await mapWithConcurrency(listed.points || [], SCAN_CONCURRENCY, async (point) => {
    const result = await buildRestorePointPlan({
      basePath,
      jobId: cleanJobId,
      restorePointId: point.id,
      includeResolvedFiles: true
    });
    return { point, result };
  });

  for (const { point, result } of planResults) {
    if (!result.ok) {
      degradedPoints.push({ id: point.id, message: result.message || 'Could not resolve restore point.' });
      continue;
    }
    if (result.plan && result.plan.totals && result.plan.totals.missingContent) {
      degradedPoints.push({ id: point.id, message: result.plan.message });
    }
    for (const file of result.resolvedFiles || []) {
      if (file.sourceType !== 'history' || !file.sourcePath) continue;
      const relative = path.relative(historyRoot, path.resolve(file.sourcePath));
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
      protectedPaths.add(normalizeRelative(relative).toLowerCase());
    }
  }

  return { protectedPaths, degradedPoints };
}

async function deleteRestorePointsForJob({ basePath, jobId } = {}) {
  const cleanJobId = sanitizeJobId(jobId);
  const jobDir = getJobRestorePointDir(basePath, cleanJobId);
  let deletedManifests = 0;
  try {
    const entries = await fs.readdir(jobDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        await fs.unlink(path.join(jobDir, entry.name));
        deletedManifests += 1;
      } catch {
        // Keep cleaning other manifests.
      }
    }
    try { await fs.rmdir(jobDir); } catch { /* folder may not be empty */ }
  } catch {
    return { ok: true, deletedManifests: 0 };
  }
  return { ok: true, deletedManifests };
}

function makeExcludeMatcher(patterns, historyFolderName) {
  const cleanPatterns = new Set(
    [...(Array.isArray(patterns) ? patterns : []), historyFolderName]
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  );

  return (relativePath, dirent) => {
    const clean = normalizeRelative(relativePath).toLowerCase();
    const base = path.basename(clean);
    if (!clean || !base) return false;
    if (cleanPatterns.has(base) || cleanPatterns.has(clean)) return true;
    for (const pattern of cleanPatterns) {
      if (!pattern) continue;
      if (pattern.includes('*')) {
        const re = new RegExp(`^${escapeRegExp(pattern).replace(/\*/g, '.*')}$`, 'i');
        if (re.test(base) || re.test(clean)) return true;
      }
    }
    return dirent && dirent.isDirectory && dirent.isDirectory() && cleanPatterns.has(base);
  };
}

function normalizeRelative(input) {
  return String(input || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizeDate(input) {
  const date = input instanceof Date ? input : new Date(input || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function captureFileIdentity(filePath, {
  retryAttempts = RESTORE_POINT_SNAPSHOT_RETRY_ATTEMPTS,
  retryDelayMs = RESTORE_POINT_SNAPSHOT_RETRY_DELAY_MS,
  statFn = fs.stat,
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  // One stat per file in the common case (a TOCTOU double-stat used to run here
  // but was dropped for speed — metadata identity is best-effort anyway). We use
  // original-fs (see top of file) so `.asar` files stat as regular files. The
  // remaining wrinkle is genuine flakiness on slow external/SMB drives: a
  // just-copied file can throw a transient lock error or briefly stat as a
  // non-regular file. Retry those a bounded number of times. A real directory is
  // non-recoverable (and the walker only passes dirent-files anyway), so fail
  // fast on it. The diagnostic suffix records what stat last saw on give-up.
  const attempts = Math.max(0, Math.floor(Number(retryAttempts) || 0));
  let lastObservation = 'snapshot not attempted';
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    if (attempt > 0) await sleepFn(retryDelayMs);
    let stats;
    try {
      stats = await statFn(filePath);
    } catch (error) {
      lastObservation = `stat error ${(error && error.code) || (error && error.message) || error}`;
      if (error && TRANSIENT_STAT_ERROR_CODES.has(error.code)) continue;
      throw error;
    }
    if (stats.isFile()) {
      return {
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        modifiedMs: Math.round(stats.mtimeMs),
        contentHash: '',
        hashAlgorithm: 'metadata',
        identityMode: RESTORE_POINT_IDENTITY_MODE
      };
    }
    // A genuine directory cannot become a file — fail fast, do not burn retries.
    if (stats.isDirectory && stats.isDirectory()) {
      throw new Error(`Cannot snapshot non-file path: ${filePath} (stat reported a directory)`);
    }
    lastObservation = `non-regular file (isSym=${stats.isSymbolicLink && stats.isSymbolicLink()}`
      + `, mode=0o${Number(stats.mode || 0).toString(8)})`;
  }
  throw new Error(`Cannot snapshot non-file path: ${filePath} `
    + `[gave up after ${attempts + 1} stat attempt(s); last saw: ${lastObservation}]`);
}

// Run `worker` over `items` with at most `concurrency` in-flight promises.
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    try { await fs.unlink(temporaryPath); } catch { /* temporary file may not exist */ }
    throw error;
  }
}

function makeTimestampId(date) {
  const value = normalizeDate(date).toISOString();
  return value.replace(/[:.]/g, '-');
}

function escapeRegExp(input) {
  return String(input).replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

module.exports = {
  RESTORE_POINTS_FOLDER_NAME,
  DEFAULT_MAX_RESTORE_POINTS,
  normalizeRestorePointSettings,
  createRestorePointManifest,
  listRestorePoints,
  pruneRestorePointsForJob,
  readRestorePointManifest,
  previewRestorePointPlan,
  restoreRestorePointToFolder,
  collectProtectedArchivePathsForRestorePoints,
  deleteRestorePointsForJob,
  shapeRestorePointManifestForRenderer,
  pickRestorePointBrowseFiles,
  captureFileIdentity
};
