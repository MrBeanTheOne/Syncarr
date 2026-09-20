// History orchestration extracted from src/main.js: file-history retention
// (policy + plan + apply), history-cache deletion, manifest reading, archived
// version listing, and restore-to-folder. Cohesive because retention, listing,
// and restore all read the same .syncarr-history manifests and archives.
//
// A factory because two collaborators stay in the Electron main process: the
// userData path (for restore-point protection lookups) and pathIsDirectory
// (a shared fs probe used widely in main.js). Everything else is imported.

// original-fs (via ./real-fs): history retention/restore reads and copies USER
// files and archives, so `.asar` files must be treated as regular files. The
// internal-manifest reads are unaffected (those paths are never `.asar`).
const fs = require('./real-fs').promises;
const path = require('path');
const {
  assertRelativePath,
  copyFilePreservingTimes,
  fileMetadata,
  isPathInside,
  resolveInside,
  statAnyOrNull,
  statFileOrNull
} = require('./fs-utils');
const { checkStorageForRestore } = require('./storage-check');
const {
  clampNumber,
  normalizeHistoryLocations,
  sanitizeHistoryFolderName,
  sanitizeJobId
} = require('./job-model');
const { collectProtectedArchivePathsForRestorePoints } = require('./restore-points');
const { formatHistoryRunId } = require('./sync-messages');
const { mapWithConcurrency } = require('./async-utils');
const { normalizeRelativeForManifest } = require('./path-utils');

function createHistoryOrchestrator({ getUserDataPath, pathIsDirectory, assertRootAllowed = async () => {} }) {
  const HISTORY_STAT_CONCURRENCY = 16;

  function aggregateRetentionResults(results) {
    const list = Array.isArray(results) ? results : [];
    const summary = emptyRetentionSummary();
    for (const result of list) {
      const child = result && result.summary ? result.summary : {};
      summary.candidateFiles += Number(child.candidateFiles || 0);
      summary.candidateBytes += Number(child.candidateBytes || 0);
      summary.deletedFiles += Number(child.deletedFiles || 0);
      summary.failedFiles += Number(child.failedFiles || 0);
      summary.freedBytes += Number(child.freedBytes || 0);
      summary.manifestsRead += Number(child.manifestsRead || 0);
      summary.filesWithHistory += Number(child.filesWithHistory || 0);
    }
    return {
      ok: list.every((result) => result && result.ok),
      applied: list.some((result) => result && result.applied),
      message: list.length > 1
        ? `Retention checked ${list.length} destination(s). ${summary.deletedFiles ? `Removed ${summary.deletedFiles} archived version(s).` : `${summary.candidateFiles} candidate(s).`}`
        : (list[0] && list[0].message) || 'Retention complete.',
      summary,
      results: list
    };
  }

  async function runRetentionPolicy(request = {}) {
    const destinations = normalizeHistoryLocations(request);
    if (destinations.length <= 1) {
      const destination = destinations[0] || { path: request.targetPath || '', label: '' };
      return runRetentionPolicySingle({ ...request, targetPath: destination.path, destination });
    }

    const results = [];
    const missing = [];
    for (const destination of destinations) {
      const exists = await pathIsDirectory(destination.path);
      if (!exists) {
        if (destination.required) missing.push(destination);
        continue;
      }
      results.push(await runRetentionPolicySingle({ ...request, targetPath: destination.path, destination }));
    }

    if (missing.length && !results.length) {
      return {
        ok: false,
        applied: false,
        message: `Required destination is missing or unreadable: ${missing.map((item) => `${item.label} (${item.path})`).join(', ')}`,
        summary: emptyRetentionSummary()
      };
    }

    return aggregateRetentionResults(results);
  }

  async function runRetentionPolicySingle({ targetPath, historyFolderName, retentionMaxVersions, retentionMaxAgeDays, retentionKeepLatest, retentionPruneEmptyFolders, jobId, apply }) {
    if (!targetPath || !targetPath.trim()) {
      return {
        ok: false,
        applied: false,
        message: 'Target path is required before applying retention.',
        summary: emptyRetentionSummary()
      };
    }

    const cleanTargetPath = targetPath.trim();
    const targetExists = await pathIsDirectory(cleanTargetPath);
    if (!targetExists) {
      return {
        ok: false,
        applied: false,
        message: 'Target folder does not exist or is not readable.',
        summary: emptyRetentionSummary()
      };
    }

    const cleanHistoryFolderName = sanitizeHistoryFolderName(historyFolderName);
    const historyRoot = path.join(cleanTargetPath, cleanHistoryFolderName);
    const retentionPlan = await buildRetentionPlan({
      targetPath: cleanTargetPath,
      historyFolderName: cleanHistoryFolderName,
      retentionMaxVersions,
      retentionMaxAgeDays,
      retentionKeepLatest,
      jobId
    });

    if (!apply) {
      return {
        ok: true,
        applied: false,
        message: retentionPlan.summary.candidateFiles
          ? `Retention would remove ${retentionPlan.summary.candidateFiles} archived version(s).${retentionPlan.summary.protectedFiles ? ` ${retentionPlan.summary.protectedFiles} version(s) are protected by restore points.` : ''}`
          : retentionPlan.summary.protectedFiles
            ? `Retention would not remove any archived versions; ${retentionPlan.summary.protectedFiles} version(s) are protected by restore points.`
            : 'Retention would not remove any archived versions.',
        summary: retentionPlan.summary,
        candidates: retentionPlan.candidates
      };
    }

    const deleted = [];
    const failed = [];
    const deletedKeys = new Set(retentionPlan.candidates.map((candidate) => candidate.key));

    for (const candidate of retentionPlan.candidates) {
      try {
        const archivePath = resolveInside(historyRoot, candidate.archivedRelativePath, 'retention archive path');
        await fs.unlink(archivePath);
        deleted.push(candidate);
        if (retentionPruneEmptyFolders !== false) {
          await removeEmptyParents(path.dirname(archivePath), historyRoot);
        }
      } catch (error) {
        failed.push({
          ...candidate,
          error: error.message || String(error)
        });
      }
    }

    const deletedKeySet = new Set(deleted.map((candidate) => candidate.key));
    for (const manifestInfo of retentionPlan.manifests) {
      const removedFromManifest = manifestInfo.entries.some((entry) => deletedKeySet.has(entry.key));
      if (!removedFromManifest) continue;

      const nextArchivedFiles = manifestInfo.archivedFiles.filter((item, index) => {
        const key = makeHistoryEntryKey(manifestInfo.manifestPath, normalizeRelativeForManifest(item.archivedRelativePath || path.join('versions', manifestInfo.runId, item.relativePath)), index);
        return !deletedKeySet.has(key);
      });

      const nextManifest = {
        ...manifestInfo.manifest,
        archivedFiles: nextArchivedFiles,
        retention: {
          lastAppliedAt: new Date().toISOString(),
          removedArchivedFiles: manifestInfo.archivedFiles.length - nextArchivedFiles.length,
          policy: normalizeRetentionPolicy({ retentionMaxVersions, retentionMaxAgeDays, retentionKeepLatest })
        }
      };

      await fs.writeFile(manifestInfo.manifestPath, JSON.stringify(nextManifest, null, 2), 'utf8');
    }

    return {
      ok: failed.length === 0,
      applied: true,
      message: failed.length
        ? `Retention removed ${deleted.length} archived version(s), with ${failed.length} failure(s).`
        : `Retention removed ${deleted.length} archived version(s).${retentionPlan.summary.protectedFiles ? ` ${retentionPlan.summary.protectedFiles} version(s) remain protected by restore points.` : ''}`,
      summary: {
        ...retentionPlan.summary,
        deletedFiles: deleted.length,
        failedFiles: failed.length,
        freedBytes: deleted.reduce((total, candidate) => total + (candidate.size || 0), 0)
      },
      deleted,
      failed
    };
  }

  async function buildRetentionPlan({ targetPath, historyFolderName, retentionMaxVersions, retentionMaxAgeDays, retentionKeepLatest, jobId }) {
    const policy = normalizeRetentionPolicy({ retentionMaxVersions, retentionMaxAgeDays, retentionKeepLatest });
    // Retention only needs the archived file metadata (size, path, createdAt).
    // It does not need the current destination file's stat — that's used by the
    // history browser UI. Skipping it halves the stat count for the retention
    // walk and, combined with the parallel fan-out inside listHistoryVersions,
    // is what made the "Finalizing sync result…" phase take several minutes on
    // folders with thousands of archived versions.
    const listed = await listHistoryVersions({ targetPath, historyFolderName, jobId, includeCurrentState: false });
    const historyRoot = path.join(targetPath, historyFolderName);
    const manifests = await readHistoryManifests(targetPath, historyFolderName, { jobId });
    const byFile = new Map();

    for (const version of listed.versions || []) {
      if (!version.available) continue;
      const key = version.relativePath.toLowerCase();
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key).push(version);
    }

    const now = Date.now();
    const maxAgeMs = policy.maxAgeDays * 24 * 60 * 60 * 1000;
    const candidateByArchivePath = new Map();

    for (const versions of byFile.values()) {
      versions.sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0));

      versions.forEach((version, index) => {
        const createdAtMs = Date.parse(version.createdAt || '') || 0;
        const reasons = [];

        if (index >= policy.maxVersionsPerFile) reasons.push('too-many-versions');
        if (!(policy.keepLatest && index === 0) && createdAtMs && now - createdAtMs > maxAgeMs) reasons.push('older-than-retention');

        if (!reasons.length) return;

        candidateByArchivePath.set(version.archivedRelativePath.toLowerCase(), {
          runId: version.runId,
          relativePath: version.relativePath,
          archivedRelativePath: version.archivedRelativePath,
          archivedPath: version.archivedPath,
          createdAt: version.createdAt,
          reasons,
          size: version.previous && Number.isFinite(version.previous.size) ? version.previous.size : 0,
          key: null
        });
      });
    }

    const candidates = [];
    for (const manifestInfo of manifests) {
      for (const entry of manifestInfo.entries) {
        const candidate = candidateByArchivePath.get(entry.archivedRelativePath.toLowerCase());
        if (!candidate) continue;

        candidates.push({
          ...candidate,
          key: entry.key,
          manifestPath: manifestInfo.manifestPath,
          size: entry.size || candidate.size
        });
      }
    }

    const uniqueCandidates = dedupeRetentionCandidates(candidates);
    let protectedArchivePaths = new Set();
    let degradedRestorePoints = [];
    if (jobId) {
      try {
        const protection = await collectProtectedArchivePathsForRestorePoints({
          basePath: getUserDataPath(),
          jobId,
          targetPath,
          historyFolderName
        });
        protectedArchivePaths = protection.protectedPaths || new Set();
        degradedRestorePoints = protection.degradedPoints || [];
      } catch {
        // Fail closed: if protection cannot be inspected, do not delete candidates.
        protectedArchivePaths = new Set(uniqueCandidates.map((candidate) => candidate.archivedRelativePath.toLowerCase()));
      }
    }
    const protectedCandidates = uniqueCandidates.filter((candidate) => protectedArchivePaths.has(candidate.archivedRelativePath.toLowerCase()));
    const removableCandidates = uniqueCandidates.filter((candidate) => !protectedArchivePaths.has(candidate.archivedRelativePath.toLowerCase()));

    return {
      policy,
      manifests,
      candidates: removableCandidates,
      summary: {
        policy,
        candidateFiles: removableCandidates.length,
        candidateBytes: removableCandidates.reduce((total, candidate) => total + (candidate.size || 0), 0),
        protectedFiles: protectedCandidates.length,
        protectedBytes: protectedCandidates.reduce((total, candidate) => total + (candidate.size || 0), 0),
        degradedRestorePoints: degradedRestorePoints.length,
        deletedFiles: 0,
        failedFiles: 0,
        freedBytes: 0,
        manifestsRead: manifests.length,
        filesWithHistory: byFile.size
      }
    };
  }

  function emptyJobHistoryDeleteSummary() {
    return {
      manifestsRead: 0,
      manifestsDeleted: 0,
      archivedFilesDeleted: 0,
      archivedFilesMissing: 0,
      failedFiles: 0,
      freedBytes: 0,
      emptyFoldersRemoved: 0
    };
  }

  function aggregateJobHistoryDeleteSummaries(summaries) {
    const total = emptyJobHistoryDeleteSummary();
    for (const summary of summaries || []) {
      const child = summary || {};
      for (const key of Object.keys(total)) total[key] += Number(child[key] || 0);
    }
    return total;
  }

  async function deleteHistoryCacheForJob({ targetPath, historyFolderName, jobId, pruneEmptyFolders, destination }) {
    const cleanTargetPath = String(targetPath || '').trim();
    const cleanHistoryFolderName = sanitizeHistoryFolderName(historyFolderName);
    const historyRoot = path.join(cleanTargetPath, cleanHistoryFolderName);
    const manifests = await readHistoryManifests(cleanTargetPath, cleanHistoryFolderName, { jobId, includeLegacy: false });
    const summary = emptyJobHistoryDeleteSummary();
    summary.manifestsRead = manifests.length;

    for (const manifestInfo of manifests) {
      for (const entry of manifestInfo.entries || []) {
        const archivedRelativePath = entry.archivedRelativePath;
        if (!archivedRelativePath) continue;

        try {
          const archivePath = resolveInside(historyRoot, archivedRelativePath, 'job history archive path');
          const stats = await statFileOrNull(archivePath);
          if (!stats) {
            summary.archivedFilesMissing += 1;
            continue;
          }
          await fs.unlink(archivePath);
          summary.archivedFilesDeleted += 1;
          summary.freedBytes += stats.size || 0;
          if (pruneEmptyFolders !== false) {
            summary.emptyFoldersRemoved += await removeEmptyParents(path.dirname(archivePath), historyRoot);
          }
        } catch {
          summary.failedFiles += 1;
        }
      }

      try {
        await fs.unlink(manifestInfo.manifestPath);
        summary.manifestsDeleted += 1;
        if (pruneEmptyFolders !== false) {
          summary.emptyFoldersRemoved += await removeEmptyParents(path.dirname(manifestInfo.manifestPath), historyRoot);
        }
      } catch {
        summary.failedFiles += 1;
      }
    }

    if (pruneEmptyFolders !== false) {
      try {
        summary.emptyFoldersRemoved += await removeEmptyParents(historyRoot, path.dirname(historyRoot));
      } catch {
        // Best-effort cleanup only.
      }
    }

    return {
      ok: summary.failedFiles === 0,
      destination,
      message: `Removed ${summary.archivedFilesDeleted} archived file(s) and ${summary.manifestsDeleted} manifest(s).`,
      summary
    };
  }


  async function readHistoryManifests(targetPath, historyFolderName, options = {}) {
    const historyRoot = path.join(targetPath, historyFolderName);
    const manifestsRoot = path.join(historyRoot, 'manifests');
    const requestedJobId = options.jobId ? sanitizeJobId(options.jobId) : null;
    const includeLegacyEntries = options.includeLegacy !== false;

    let manifestNames = [];
    try {
      manifestNames = (await fs.readdir(manifestsRoot))
        .filter((name) => name.toLowerCase().endsWith('.json'))
        .sort();
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }

    // Read every history manifest in parallel. Retention runs after every
    // successful sync (when pruneAfterSync is enabled), and on a folder with
    // months of accumulated archives the sequential reads used to dominate the
    // finalization time over SMB.
    const manifestPaths = manifestNames.map((manifestName) => path.join(manifestsRoot, manifestName));
    const loaded = await mapWithConcurrency(manifestPaths, HISTORY_STAT_CONCURRENCY, async (manifestPath) => {
      try {
        return { manifestPath, manifest: JSON.parse(await fs.readFile(manifestPath, 'utf8')) };
      } catch {
        return null;
      }
    });

    const manifests = [];
    for (const entry of loaded) {
      if (!entry) continue;
      const { manifestPath, manifest } = entry;
      const manifestJobId = manifest.jobId ? sanitizeJobId(manifest.jobId) : null;
      if (requestedJobId && manifestJobId && manifestJobId !== requestedJobId) {
        continue;
      }
      if (requestedJobId && !manifestJobId && !includeLegacyEntries) {
        continue;
      }

      const runId = manifest.runId || path.basename(manifestPath, '.json');
      const archivedFiles = Array.isArray(manifest.archivedFiles) ? manifest.archivedFiles : [];
      const entries = archivedFiles.map((item, index) => {
        const archivedRelativePath = normalizeRelativeForManifest(item.archivedRelativePath || path.join('versions', runId, item.relativePath));
        return {
          key: makeHistoryEntryKey(manifestPath, archivedRelativePath, index),
          archivedRelativePath,
          size: item.previous && Number.isFinite(item.previous.size) ? item.previous.size : 0
        };
      });

      manifests.push({
        manifest,
        manifestPath,
        runId,
        archivedFiles,
        entries
      });
    }

    return manifests;
  }

  function dedupeRetentionCandidates(candidates) {
    const seen = new Set();
    const next = [];

    for (const candidate of candidates) {
      const key = candidate.key || `${candidate.manifestPath}:${candidate.archivedRelativePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(candidate);
    }

    return next;
  }

  function makeHistoryEntryKey(manifestPath, archivedRelativePath, index) {
    return `${path.resolve(manifestPath)}::${index}::${normalizeRelativeForManifest(archivedRelativePath).toLowerCase()}`;
  }

  function normalizeRetentionPolicy({ retentionMaxVersions, retentionMaxAgeDays, retentionKeepLatest } = {}) {
    return {
      maxVersionsPerFile: Math.max(1, Math.floor(clampNumber(retentionMaxVersions, 1, 999, 10))),
      maxAgeDays: Math.max(1, Math.floor(clampNumber(retentionMaxAgeDays, 1, 36500, 365))),
      keepLatest: retentionKeepLatest !== false
    };
  }

  function emptyRetentionSummary() {
    return {
      policy: normalizeRetentionPolicy({}),
      candidateFiles: 0,
      candidateBytes: 0,
      protectedFiles: 0,
      protectedBytes: 0,
      degradedRestorePoints: 0,
      deletedFiles: 0,
      failedFiles: 0,
      freedBytes: 0,
      manifestsRead: 0,
      filesWithHistory: 0
    };
  }

  async function removeEmptyParents(startPath, stopPath) {
    const resolvedStop = path.resolve(stopPath);
    let current = path.resolve(startPath);
    let removed = 0;

    while (isPathInside(resolvedStop, current) && current !== resolvedStop) {
      try {
        await fs.rmdir(current);
        removed += 1;
      } catch {
        return removed;
      }

      current = path.dirname(current);
    }

    return removed;
  }

  async function listHistoryVersions(request = {}) {
    const destinations = normalizeHistoryLocations(request);
    if (destinations.length <= 1) {
      const destination = destinations[0] || { path: request.targetPath || '', label: '' };
      return listHistoryVersionsSingle({ ...request, targetPath: destination.path, destination });
    }

    const results = [];
    const missing = [];
    for (const destination of destinations) {
      const exists = await pathIsDirectory(destination.path);
      if (!exists) {
        if (destination.required) missing.push(destination);
        continue;
      }
      results.push(await listHistoryVersionsSingle({ ...request, targetPath: destination.path, destination }));
    }

    if (missing.length && !results.length) {
      return {
        ok: false,
        message: `Required destination is missing or unreadable: ${missing.map((item) => `${item.label} (${item.path})`).join(', ')}`,
        versions: [],
        manifestsRead: 0,
        manifestErrors: 0,
        files: 0
      };
    }

    const versions = [];
    let manifestsRead = 0;
    let manifestErrors = 0;
    for (const result of results) {
      manifestsRead += Number(result.manifestsRead || 0);
      manifestErrors += Number(result.manifestErrors || 0);
      versions.push(...(result.versions || []));
    }

    versions.sort((a, b) => {
      const bTime = Date.parse(b.createdAt || '') || 0;
      const aTime = Date.parse(a.createdAt || '') || 0;
      return bTime - aTime || a.relativePath.localeCompare(b.relativePath);
    });

    const fileKeys = new Set(versions.map((version) => `${version.destinationLabel || ''}:${version.relativePath}`.toLowerCase()));
    return {
      ok: true,
      message: versions.length ? `Loaded ${versions.length} restorable version(s) from ${results.length} destination(s).` : 'No restorable file history found.',
      manifestsRead,
      manifestErrors,
      files: fileKeys.size,
      versions,
      missingDestinations: missing
    };
  }


  function getOriginalSourcePathFromHistoryEntry(item, manifest, relativePath) {
    const direct = String(
      (item && (item.originalSourcePath || item.sourcePath || item.fullSourcePath)) || ''
    ).trim();
    if (direct) return direct;

    const roots = [];
    if (item && item.sourceRoot) {
      roots.push({
        sourcePath: item.sourceRoot,
        label: item.sourceLabel || '',
        relativePrefix: item.sourceLabel || ''
      });
    }

    if (manifest && Array.isArray(manifest.sourceRoots)) {
      for (const root of manifest.sourceRoots) {
        if (!root || !root.sourcePath) continue;
        roots.push({
          sourcePath: root.sourcePath,
          label: root.label || '',
          relativePrefix: root.relativePrefix || root.label || ''
        });
      }
    }

    const cleanRelativePath = normalizeRelativeForManifest(relativePath || '');
    if (!cleanRelativePath || !roots.length) return '';

    for (const root of roots) {
      const cleanRoot = String(root.sourcePath || '').trim();
      if (!cleanRoot) continue;

      let sourceRelativePath = cleanRelativePath;
      const possiblePrefixes = [root.relativePrefix, root.label, item && item.sourceLabel]
        .map((value) => normalizeRelativeForManifest(value || ''))
        .filter(Boolean);

      for (const prefix of possiblePrefixes) {
        const prefixWithSlash = `${prefix}/`.toLowerCase();
        if (sourceRelativePath.toLowerCase().startsWith(prefixWithSlash)) {
          sourceRelativePath = sourceRelativePath.slice(prefix.length + 1);
          break;
        }
      }

      if (!sourceRelativePath) continue;
      return path.join(cleanRoot, ...sourceRelativePath.split('/').filter(Boolean));
    }

    return '';
  }

  async function listHistoryVersionsSingle({ targetPath, historyFolderName, jobId, includeLegacy = true, destination = null, includeCurrentState = true } = {}) {
    if (!targetPath || !targetPath.trim()) {
      return {
        ok: false,
        message: 'Target path is required before loading history.',
        versions: [],
        manifestsRead: 0,
        manifestErrors: 0,
        files: 0
      };
    }

    const cleanTargetPath = targetPath.trim();
    const targetExists = await pathIsDirectory(cleanTargetPath);
    if (!targetExists) {
      return {
        ok: false,
        message: 'Target folder does not exist or is not readable.',
        versions: [],
        manifestsRead: 0,
        manifestErrors: 0,
        files: 0
      };
    }

    const cleanHistoryFolderName = sanitizeHistoryFolderName(historyFolderName);
    const requestedJobId = jobId ? sanitizeJobId(jobId) : null;
    const includeLegacyEntries = includeLegacy !== false;
    const wantCurrentState = includeCurrentState !== false;
    const historyRoot = path.join(cleanTargetPath, cleanHistoryFolderName);
    const manifestsRoot = path.join(historyRoot, 'manifests');

    let manifestNames = [];
    try {
      manifestNames = (await fs.readdir(manifestsRoot))
        .filter((name) => name.toLowerCase().endsWith('.json'))
        .sort()
        .reverse();
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }

    const versions = [];
    let manifestsRead = 0;
    let manifestErrors = 0;

    // Read all manifests first so the per-item work below can be parallelised.
    // Each manifest is parsed once; per-archived-item stats then fan out across
    // up to HISTORY_STAT_CONCURRENCY in-flight fs.stat calls.
    const loadedManifests = [];
    for (const manifestName of manifestNames) {
      const manifestPath = path.join(manifestsRoot, manifestName);
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        const manifestJobId = manifest.jobId ? sanitizeJobId(manifest.jobId) : null;
        if (requestedJobId && manifestJobId && manifestJobId !== requestedJobId) continue;
        if (requestedJobId && !manifestJobId && !includeLegacyEntries) continue;
        loadedManifests.push({ manifestName, manifestPath, manifest });
      } catch {
        manifestErrors += 1;
      }
    }

    for (const { manifestName, manifestPath, manifest } of loadedManifests) {
      const archivedFiles = Array.isArray(manifest.archivedFiles) ? manifest.archivedFiles : [];
      manifestsRead += 1;

      // Build the per-item work list up front, then run the stats in parallel.
      // Each item independently resolves the relative path, the archive path,
      // and the target path before doing fs.stat — those are CPU-only path
      // operations and don't benefit from being concurrent.
      const items = archivedFiles.map((item, index) => {
        const relativePath = assertRelativePath(item.relativePath, 'history file path');
        const archivedRelativePath = assertRelativePath(
          item.archivedRelativePath || path.join('versions', manifest.runId || '', relativePath),
          'archived file path'
        );
        return {
          item,
          index,
          relativePath,
          archivedRelativePath,
          archivedPath: resolveInside(historyRoot, archivedRelativePath, 'archived file path'),
          targetFilePath: resolveInside(cleanTargetPath, relativePath, 'target file path'),
          originalSourcePath: getOriginalSourcePathFromHistoryEntry(item, manifest, relativePath)
        };
      });

      const expanded = await mapWithConcurrency(items, HISTORY_STAT_CONCURRENCY, async (entry) => {
        const archivedStats = await statFileOrNull(entry.archivedPath);
        // If the archive is gone there is no point stat-ing the target file:
        // the version is unavailable either way, and the history browser only
        // renders `current` for selectable versions.
        const currentStats = wantCurrentState && archivedStats
          ? await statFileOrNull(entry.targetFilePath)
          : null;
        return { entry, archivedStats, currentStats };
      });

      for (const { entry, archivedStats, currentStats } of expanded) {
        versions.push({
          id: `${manifest.runId || manifestName}:${entry.index}:${entry.archivedRelativePath}`,
          runId: manifest.runId || manifestName.replace(/\.json$/i, ''),
          operation: manifest.operation || 'sync',
          status: manifest.status || 'unknown',
          createdAt: manifest.createdAt || null,
          completedAt: manifest.completedAt || null,
          jobId: manifest.jobId || null,
          jobName: manifest.jobName || '',
          destinationPath: destination ? destination.path : cleanTargetPath,
          destinationLabel: destination ? destination.label : '',
          destinationRequired: destination ? destination.required !== false : true,
          manifestPath,
          relativePath: entry.relativePath,
          archivedRelativePath: entry.archivedRelativePath,
          archivedPath: entry.archivedPath,
          targetFilePath: entry.targetFilePath,
          reason: entry.item.reason || 'archived',
          available: Boolean(archivedStats),
          previous: entry.item.previous || (archivedStats ? fileMetadata(archivedStats) : null),
          source: entry.item.source || null,
          sourcePath: entry.item.sourcePath || null,
          originalSourcePath: entry.originalSourcePath,
          sourceRoot: entry.item.sourceRoot || null,
          sourceLabel: entry.item.sourceLabel || '',
          current: currentStats ? fileMetadata(currentStats) : null,
          restore: manifest.restore || null
        });
      }
    }

    versions.sort((a, b) => {
      const bTime = Date.parse(b.createdAt || '') || 0;
      const aTime = Date.parse(a.createdAt || '') || 0;
      return bTime - aTime || a.relativePath.localeCompare(b.relativePath);
    });

    const fileKeys = new Set(versions.map((version) => version.relativePath.toLowerCase()));

    return {
      ok: true,
      message: versions.length ? `Loaded ${versions.length} restorable version(s).` : 'No restorable file history found.',
      historyRoot,
      manifestsRoot,
      manifestsRead,
      manifestErrors,
      files: fileKeys.size,
      versions
    };
  }

  async function restoreHistoryVersion({
    targetPath,
    historyFolderName,
    jobId,
    jobName,
    relativePath,
    archivedRelativePath,
    destinationMode,
    restoreFolder,
    backupTargetPath,
    originalSourcePath,
    restoreRunId,
    freeSpaceCheckEnabled,
    minimumFreeGb
  }) {
    if (!targetPath || !targetPath.trim()) {
      throw new Error('Target path is required before restoring history.');
    }

    const cleanTargetPath = targetPath.trim();
    const targetExists = await pathIsDirectory(cleanTargetPath);
    if (!targetExists) {
      throw new Error('Target folder does not exist or is not readable.');
    }

    const cleanHistoryFolderName = sanitizeHistoryFolderName(historyFolderName);
    const cleanRelativePath = assertRelativePath(relativePath, 'restore file path');
    const cleanArchivedRelativePath = assertRelativePath(archivedRelativePath, 'archived file path');
    const mode = ['original', 'backup', 'folder'].includes(destinationMode) ? destinationMode : 'original';
    const cleanOriginalSourcePath = String(originalSourcePath || '').trim();
    const destinationRoot = mode === 'folder'
      ? String(restoreFolder || '').trim()
      : mode === 'backup'
        ? String(backupTargetPath || cleanTargetPath).trim()
        : cleanOriginalSourcePath
          ? path.dirname(cleanOriginalSourcePath)
          : '';

    if (!destinationRoot) {
      throw new Error(mode === 'folder'
        ? 'Choose another target folder first.'
        : mode === 'original'
          ? 'The original source path is not available for this archived version. Use Backup target or Other target instead.'
          : 'Restore destination is missing.');
    }

    const destinationRootExists = await pathIsDirectory(destinationRoot);
    if (!destinationRootExists) {
      throw new Error(mode === 'original'
        ? 'The original source folder does not exist or is not readable.'
        : 'Restore destination does not exist or is not readable.');
    }

    // Root-trust guard (H12): these absolute roots come straight from the
    // renderer. Always require the archive SOURCE (cleanTargetPath) to be a
    // configured destination so a compromised renderer can't feed an
    // attacker-staged history tree. For the write DESTINATION, gate the
    // config-derivable modes: 'original' writes with NO resolveInside (a direct
    // arbitrary-overwrite vector — must be inside a configured source), and
    // 'backup' targets a configured destination. 'folder' ("Other target") is
    // deliberately NOT gated: it is a first-class user-typed/-picked destination
    // (the feature itself), and the write is still contained by
    // resolveInside(destinationRoot, ...) with a gated, real archive source.
    await assertRootAllowed(cleanTargetPath, 'history target folder');
    if (mode !== 'folder') {
      await assertRootAllowed(destinationRoot, 'restore destination folder');
    }

    const historyRoot = path.join(cleanTargetPath, cleanHistoryFolderName);
    const archivedPath = resolveInside(historyRoot, cleanArchivedRelativePath, 'archived file path');
    const archivedStats = await statFileOrNull(archivedPath);
    if (!archivedStats) {
      throw new Error('The selected archived file is missing from history.');
    }

    const destinationPath = mode === 'original'
      ? cleanOriginalSourcePath
      : resolveInside(destinationRoot, cleanRelativePath, 'restore destination path');
    const createdAt = new Date();
    const runId = restoreRunId || `restore-${formatHistoryRunId(createdAt)}`;
    const manifestsRoot = path.join(historyRoot, 'manifests');
    const overwrittenVersions = [];

    const currentDestinationStats = await statAnyOrNull(destinationPath);
    if (currentDestinationStats && !currentDestinationStats.isFile()) {
      throw new Error('Restore destination exists but is not a file.');
    }

    const storageCheck = freeSpaceCheckEnabled === false
      ? { ok: true, checked: false, skipped: true, message: 'Free-space check is disabled.' }
      : await checkStorageForRestore({
        targetPath: cleanTargetPath,
        destinationRoot,
        destinationMode: mode,
        restoreBytes: archivedStats.size,
        archiveBytes: currentDestinationStats && currentDestinationStats.isFile() ? currentDestinationStats.size : 0,
        minimumFreeGb
      });

    if (storageCheck.checked && !storageCheck.enoughSpace) {
      throw new Error(storageCheck.message || 'Not enough free space for this restore.');
    }

    if (currentDestinationStats && currentDestinationStats.isFile()) {
      const archiveSubfolder = mode === 'folder' ? 'restore-other-target-current' : mode === 'backup' ? 'restore-backup-target-current' : '';
      const archiveRelativePath = normalizeRelativeForManifest(
        path.join('versions', runId, archiveSubfolder, cleanRelativePath)
      );
      const currentArchivePath = resolveInside(historyRoot, archiveRelativePath, 'restore safety archive path');
      await copyFilePreservingTimes(destinationPath, currentArchivePath, currentDestinationStats);

      overwrittenVersions.push({
        relativePath: cleanRelativePath,
        archivedRelativePath: archiveRelativePath,
        reason: mode === 'folder' ? 'restore-overwrite-other-target' : mode === 'backup' ? 'restore-overwrite-backup-target' : 'restore-overwrite-original-target',
        source: null,
        sourcePath: destinationPath,
        originalSourcePath: destinationPath,
        sourceRoot: destinationRoot,
        sourceLabel: mode === 'folder' ? 'Other target' : mode === 'backup' ? 'Backup target' : 'Original source',
        previous: fileMetadata(currentDestinationStats),
        destinationPath
      });
    }

    await copyFilePreservingTimes(archivedPath, destinationPath, archivedStats);

    await fs.mkdir(manifestsRoot, { recursive: true });
    const completedAt = new Date();
    const manifestPath = path.join(manifestsRoot, `${runId}.json`);
    const manifest = {
      schemaVersion: 1,
      operation: 'restore',
      runId,
      status: 'complete',
      createdAt: createdAt.toISOString(),
      completedAt: completedAt.toISOString(),
      jobId: jobId ? sanitizeJobId(jobId) : null,
      jobName: String(jobName || '').trim(),
      sourcePath: null,
      targetPath: cleanTargetPath,
      historyFolderName: cleanHistoryFolderName,
      robocopy: null,
      restore: {
        relativePath: cleanRelativePath,
        archivedRelativePath: cleanArchivedRelativePath,
        archivedPath,
        destinationMode: mode,
        originalSourcePath: cleanOriginalSourcePath || null,
        destinationRoot,
        destinationPath
      },
      summary: {
        restored: 1,
        archived: overwrittenVersions.length,
        manifestPath
      },
      archivedFiles: overwrittenVersions,
      newFiles: []
    };

    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    return {
      ok: true,
      status: 'success',
      message: `Restored ${cleanRelativePath}.`,
      runId,
      manifestPath,
      destinationPath,
      archivedCurrent: overwrittenVersions.length,
      historyRoot,
      storage: storageCheck,
      restored: {
        relativePath: cleanRelativePath,
        archivedRelativePath: cleanArchivedRelativePath,
        destinationMode: mode,
        originalSourcePath: cleanOriginalSourcePath || null,
        destinationPath
      }
    };
  }

  return {
    runRetentionPolicy,
    runRetentionPolicySingle,
    buildRetentionPlan,
    readHistoryManifests,
    dedupeRetentionCandidates,
    makeHistoryEntryKey,
    normalizeRetentionPolicy,
    emptyRetentionSummary,
    aggregateRetentionResults,
    removeEmptyParents,
    emptyJobHistoryDeleteSummary,
    aggregateJobHistoryDeleteSummaries,
    deleteHistoryCacheForJob,
    listHistoryVersions,
    getOriginalSourcePathFromHistoryEntry,
    listHistoryVersionsSingle,
    restoreHistoryVersion
  };
}

module.exports = { createHistoryOrchestrator };

