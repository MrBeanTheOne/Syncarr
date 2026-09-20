// File-history-plan subsystem, extracted VERBATIM from src/main.js into an
// injectable factory so the mirror-delete archival decision and the restore-point
// manifest producer can be tested in isolation. Mirrors the createSyncRun /
// createSyncEngineRunner factory pattern. The 8 function bodies are byte-identical
// to the originals in src/main.js; the ONLY structural change is that fs,
// collectSourceFiles, and throwIfRunCancelled — the three collaborators that carry
// main-process I/O or the cancellation-singleton closure — are injected via deps,
// while every other collaborator is a pure sibling-module import required here.
const path = require('path');
const { mapWithConcurrency } = require('./async-utils');
const { normalizeRelativeForManifest } = require('./path-utils');
const { markHistoryFolderHidden } = require('./history-folder');
const { buildSourceSyncRoots } = require('./source-sync-roots');
const {
  sanitizeJobId,
  normalizeSyncMode,
  normalizeSourcePaths,
  normalizeTargetDestinations,
  PREVIEW_FILE_LIMIT
} = require('./job-model');
const { shouldSourceReplaceTarget, fileMetadata } = require('./fs-utils');
const { mergeDestinationPlans, accumulatePlanSummary } = require('./sync-engines/robocopy-dryrun-parser');

const HISTORY_STAT_CONCURRENCY = 16;

function createHistoryPlan({ fs, collectSourceFiles, throwIfRunCancelled }) {
async function analyzeMultiDestinationHistoryPlan({
  sourcePaths,
  destinations,
  skippedDestinations,
  excludePatterns,
  skipOlderSource,
  copySubfolders,
  historyEnabled,
  historyFolderName,
  syncMode
}) {
  const destinationPlans = [];

  for (const destination of destinations) {
    const sourceRoots = buildSourceSyncRoots({ sourcePaths, targetPath: destination.path });
    const plan = await analyzeMultiSourceHistoryPlan({
      sourceRoots,
      targetPath: destination.path,
      excludePatterns,
      skipOlderSource,
      copySubfolders,
      historyEnabled,
      historyFolderName,
      syncMode
    });
    destinationPlans.push({ destination, sourceRoots, plan });
  }

  return mergeDestinationPlans(destinationPlans, destinations, skippedDestinations || [], historyFolderName, historyEnabled);
}

async function analyzeMultiSourceHistoryPlan({
  sourceRoots,
  excludePatterns,
  skipOlderSource,
  copySubfolders,
  historyEnabled,
  historyFolderName,
  targetPath,
  syncMode
}) {
  const plans = [];

  for (const root of sourceRoots) {
    plans.push(await analyzeFileHistoryPlan({
      sourcePath: root.sourcePath,
      targetPath: root.destinationPath,
      displayPrefix: root.relativePrefix,
      sourceLabel: root.label,
      excludePatterns,
      skipOlderSource,
      copySubfolders,
      historyEnabled,
      historyFolderName,
      syncMode
    }));
  }

  return mergeHistoryPlans(plans, sourceRoots, targetPath, historyFolderName, historyEnabled);
}

function mergeHistoryPlans(plans, sourceRoots, targetPath, historyFolderName, historyEnabled) {
  const summary = {
    enabled: historyEnabled !== false,
    historyFolderName,
    scanned: 0,
    wouldCopy: 0,
    wouldArchive: 0,
    archived: 0,
    newFiles: 0,
    skippedOlder: 0,
    unchanged: 0,
    conflicts: 0,
    destinationOnly: 0,
    copyBytes: 0,
    archiveBytes: 0,
    estimatedWriteBytes: 0,
    previewFiles: 0,
    previewTruncated: false,
    manifestPath: null,
    sourceCount: sourceRoots.length
  };

  const plan = {
    enabled: historyEnabled !== false,
    historyFolderName,
    sourcePath: sourceRoots[0] ? sourceRoots[0].sourcePath : '',
    sourcePaths: sourceRoots.map((root) => root.sourcePath),
    sourceRoots,
    targetPath,
    archiveFiles: [],
    newFiles: [],
    previewFiles: [],
    summary
  };

  for (const child of plans) {
    const childSummary = child.summary || {};
    accumulatePlanSummary(summary, childSummary);
    summary.previewTruncated = summary.previewTruncated || Boolean(childSummary.previewTruncated);
    plan.archiveFiles.push(...(child.archiveFiles || []));
    plan.newFiles.push(...(child.newFiles || []));
    for (const file of child.previewFiles || []) {
      if (plan.previewFiles.length < PREVIEW_FILE_LIMIT) plan.previewFiles.push(file);
      else summary.previewTruncated = true;
    }
  }

  summary.estimatedWriteBytes = summary.copyBytes + (plan.enabled ? summary.archiveBytes : 0);
  return plan;
}

async function analyzeFileHistoryPlan({
  sourcePath,
  targetPath,
  displayPrefix = '',
  sourceLabel = '',
  excludePatterns,
  skipOlderSource,
  copySubfolders,
  historyEnabled,
  historyFolderName,
  syncMode
}) {
  const cleanMode = normalizeSyncMode(syncMode);
  const effectiveCopySubfolders = cleanMode === 'mirror' ? true : copySubfolders;
  const sourceFiles = await collectSourceFiles({
    sourcePath,
    copySubfolders: effectiveCopySubfolders,
    excludePatterns
  });

  const plan = {
    enabled: historyEnabled !== false,
    historyFolderName,
    sourcePath,
    targetPath,
    archiveFiles: [],
    newFiles: [],
    previewFiles: [],
    summary: {
      enabled: historyEnabled !== false,
      historyFolderName,
      scanned: sourceFiles.length,
      wouldCopy: 0,
      wouldArchive: 0,
      archived: 0,
      newFiles: 0,
      skippedOlder: 0,
      unchanged: 0,
      conflicts: 0,
      copyBytes: 0,
      archiveBytes: 0,
      estimatedWriteBytes: 0,
      previewFiles: 0,
      previewTruncated: false,
      manifestPath: null,
      destinationOnly: 0
    }
  };

  // Pre-fetch every target-side stat with bounded concurrency. Run inline as a
  // serial `await fs.stat` per file, this loop paid one full SMB round-trip per
  // file — the dominant cost of a no-change sync to a NAS (~90s for 22k files).
  // Fanning the stats out (order preserved) leaves the loop below doing no I/O.
  const targetStatsList = await mapWithConcurrency(sourceFiles, HISTORY_STAT_CONCURRENCY, async (sourceFile) => {
    throwIfRunCancelled();
    try {
      return await fs.stat(path.join(targetPath, sourceFile.relativePath));
    } catch {
      return null;
    }
  });

  for (let fileIndex = 0; fileIndex < sourceFiles.length; fileIndex += 1) {
    const sourceFile = sourceFiles[fileIndex];
    const targetStats = targetStatsList[fileIndex];
    const displayRelativePath = normalizeRelativeForManifest(displayPrefix ? path.join(displayPrefix, sourceFile.relativePath) : sourceFile.relativePath);
    const targetFilePath = path.join(targetPath, sourceFile.relativePath);

    if (!targetStats) {
      plan.summary.wouldCopy += 1;
      plan.summary.newFiles += 1;
      plan.summary.copyBytes += sourceFile.stats.size;
      addPreviewFile(plan, {
        action: 'copy-new',
        label: 'New file',
        relativePath: displayRelativePath,
        reason: 'missing-target',
        source: fileMetadata(sourceFile.stats),
        sourceRoot: sourcePath,
        sourceLabel,
        target: null,
        copyBytes: sourceFile.stats.size,
        archiveBytes: 0
      });
      plan.newFiles.push({
        relativePath: displayRelativePath,
        source: fileMetadata(sourceFile.stats)
      });
      continue;
    }

    if (!targetStats.isFile()) {
      plan.summary.conflicts += 1;
      addPreviewFile(plan, {
        action: 'conflict',
        label: 'Conflict',
        relativePath: displayRelativePath,
        reason: 'target-not-file',
        source: fileMetadata(sourceFile.stats),
        sourceRoot: sourcePath,
        sourceLabel,
        target: fileMetadata(targetStats),
        copyBytes: 0,
        archiveBytes: 0
      });
      continue;
    }

    const decision = shouldSourceReplaceTarget(sourceFile.stats, targetStats, skipOlderSource);

    if (!decision.copy) {
      if (decision.reason === 'older-source') {
        plan.summary.skippedOlder += 1;
      } else {
        plan.summary.unchanged += 1;
      }
      addPreviewFile(plan, {
        action: decision.reason === 'older-source' ? 'skip-older-source' : 'unchanged',
        label: decision.reason === 'older-source' ? 'Skip older source' : 'Unchanged',
        relativePath: displayRelativePath,
        reason: decision.reason,
        source: fileMetadata(sourceFile.stats),
        sourceRoot: sourcePath,
        sourceLabel,
        target: fileMetadata(targetStats),
        copyBytes: 0,
        archiveBytes: 0
      });
      continue;
    }

    plan.summary.wouldCopy += 1;
    plan.summary.wouldArchive += 1;
    plan.summary.copyBytes += sourceFile.stats.size;
    plan.summary.archiveBytes += targetStats.size;
    addPreviewFile(plan, {
      action: 'update-archive',
      label: 'Update with history',
      relativePath: displayRelativePath,
      reason: decision.reason,
      source: fileMetadata(sourceFile.stats),
        sourceRoot: sourcePath,
        sourceLabel,
      target: fileMetadata(targetStats),
      copyBytes: sourceFile.stats.size,
      archiveBytes: targetStats.size
    });
    plan.archiveFiles.push({
      relativePath: displayRelativePath,
      sourcePath: sourceFile.fullPath,
      sourceRoot: sourcePath,
      sourceLabel,
      targetPath: targetFilePath,
      reason: decision.reason,
      source: fileMetadata(sourceFile.stats),
      previous: fileMetadata(targetStats)
    });
  }


  if (cleanMode === 'mirror') {
    await addMirrorDeleteCandidatesToHistoryPlan({
      plan,
      sourceFiles,
      sourcePath,
      targetPath,
      displayPrefix,
      sourceLabel,
      excludePatterns,
      historyEnabled,
      copySubfolders: true
    });
  }

  plan.summary.estimatedWriteBytes = plan.summary.copyBytes + (plan.enabled ? plan.summary.archiveBytes : 0);

  return plan;
}

async function addMirrorDeleteCandidatesToHistoryPlan({
  plan,
  sourceFiles,
  sourcePath,
  targetPath,
  displayPrefix = '',
  sourceLabel = '',
  excludePatterns,
  historyEnabled,
  copySubfolders
}) {
  const sourceRelativeSet = new Set(
    (sourceFiles || []).map((file) => normalizeRelativeForManifest(file.relativePath).toLowerCase())
  );

  let targetFiles = [];
  try {
    targetFiles = await collectSourceFiles({
      sourcePath: targetPath,
      copySubfolders,
      excludePatterns
    });
  } catch {
    return;
  }

  for (const targetFile of targetFiles) {
    const cleanRelative = normalizeRelativeForManifest(targetFile.relativePath);
    if (!cleanRelative || sourceRelativeSet.has(cleanRelative.toLowerCase())) continue;

    const displayRelativePath = normalizeRelativeForManifest(displayPrefix ? path.join(displayPrefix, cleanRelative) : cleanRelative);
    const archiveBytes = historyEnabled !== false ? targetFile.stats.size : 0;

    plan.summary.destinationOnly += 1;
    plan.summary.wouldArchive += historyEnabled !== false ? 1 : 0;
    plan.summary.archiveBytes += archiveBytes;

    addPreviewFile(plan, {
      action: 'extra',
      label: 'Mirror delete candidate',
      relativePath: displayRelativePath,
      reason: 'mirror-destination-only',
      source: null,
      sourceRoot: sourcePath,
      sourceLabel,
      target: fileMetadata(targetFile.stats),
      copyBytes: 0,
      archiveBytes
    });

    plan.archiveFiles.push({
      relativePath: displayRelativePath,
      sourcePath: null,
      sourceRoot: sourcePath,
      sourceLabel,
      targetPath: targetFile.fullPath,
      reason: 'mirror-delete-candidate',
      source: null,
      previous: fileMetadata(targetFile.stats)
    });
  }
}

function addPreviewFile(plan, file) {
  plan.summary.previewFiles += 1;

  if (plan.previewFiles.length >= PREVIEW_FILE_LIMIT) {
    plan.summary.previewTruncated = true;
    return;
  }

  plan.previewFiles.push({
    ...file,
    relativePath: normalizeRelativeForManifest(file.relativePath)
  });
}

async function createHistorySnapshot({ plan, runId, createdAt, sourcePath, sourcePaths, sourceRoots, targetPath, historyFolderName, jobId, jobName, targetDestination = null, targetDestinations = [], onArchived = null }) {
  const historyRoot = path.join(targetPath, historyFolderName);
  const versionsRoot = path.join(historyRoot, 'versions', runId);
  const manifestsRoot = path.join(historyRoot, 'manifests');
  const archivedFiles = [];

  if (plan.archiveFiles.length || plan.newFiles.length) {
    await fs.mkdir(historyRoot, { recursive: true });
    await markHistoryFolderHidden(historyRoot);
  }

  for (const [index, item] of plan.archiveFiles.entries()) {
    const currentStats = await fs.stat(item.targetPath);
    if (!currentStats.isFile()) {
      throw new Error(`Cannot archive non-file target: ${item.relativePath}`);
    }

    const archivedPath = path.join(versionsRoot, item.relativePath);
    await fs.mkdir(path.dirname(archivedPath), { recursive: true });
    await fs.copyFile(item.targetPath, archivedPath);

    try {
      await fs.utimes(archivedPath, currentStats.atime, currentStats.mtime);
    } catch {
      // Timestamps are useful for restore, but a copy is still valid if this fails.
    }

    if (typeof onArchived === 'function') {
      await onArchived(item, {
        index,
        archivedPath,
        previous: item.previous || fileMetadata(currentStats)
      });
    }

    archivedFiles.push({
      relativePath: normalizeRelativeForManifest(item.relativePath),
      archivedRelativePath: normalizeRelativeForManifest(path.join('versions', runId, item.relativePath)),
      reason: item.reason,
      source: item.source || null,
      // Store the exact source file path when available. This lets the restore UI send
      // a version back to the original folder the file came from instead of only
      // restoring into the backup/destination folder.
      sourcePath: item.sourcePath || null,
      originalSourcePath: item.sourcePath || null,
      sourceRoot: item.sourceRoot || null,
      sourceLabel: item.sourceLabel || '',
      previous: item.previous || fileMetadata(currentStats)
    });
  }

  const manifest = {
    schemaVersion: 1,
    runId,
    status: 'prepared',
    createdAt: createdAt.toISOString(),
    completedAt: null,
    jobId: sanitizeJobId(jobId),
    jobName: String(jobName || '').trim(),
    sourcePath,
    sourcePaths: Array.isArray(sourcePaths) ? sourcePaths : normalizeSourcePaths(sourcePath),
    sourceRoots: Array.isArray(sourceRoots) ? sourceRoots.map((root) => ({
      sourcePath: root.sourcePath,
      label: root.label,
      destinationPath: root.destinationPath,
      relativePrefix: root.relativePrefix
    })) : [],
    targetPath,
    targetDestination: targetDestination ? { path: targetDestination.path, label: targetDestination.label, required: targetDestination.required !== false } : null,
    targetDestinations: normalizeTargetDestinations(targetDestinations, targetPath),
    historyFolderName,
    robocopy: null,
    summary: {
      ...plan.summary,
      archived: archivedFiles.length
    },
    archivedFiles,
    newFiles: plan.newFiles
  };

  let manifestPath = null;
  if (archivedFiles.length || plan.newFiles.length) {
    await fs.mkdir(manifestsRoot, { recursive: true });
    manifestPath = path.join(manifestsRoot, `${runId}.json`);
    manifest.summary.manifestPath = manifestPath;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  return {
    manifestPath,
    summary: {
      ...plan.summary,
      archived: archivedFiles.length,
      manifestPath
    }
  };
}

async function finalizeHistoryManifest(manifestPath, result) {
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const finalized = {
    ...manifest,
    status: result.robocopyOk ? 'complete' : 'incomplete',
    completedAt: result.completedAt,
    robocopy: {
      code: result.robocopyCode,
      status: result.robocopyStatus,
      ok: result.robocopyOk,
      summary: result.robocopySummary
    }
  };

  await fs.writeFile(manifestPath, JSON.stringify(finalized, null, 2), 'utf8');
}

  return {
    analyzeMultiDestinationHistoryPlan,
    analyzeMultiSourceHistoryPlan,
    mergeHistoryPlans,
    analyzeFileHistoryPlan,
    addMirrorDeleteCandidatesToHistoryPlan,
    addPreviewFile,
    createHistorySnapshot,
    finalizeHistoryManifest
  };
}

module.exports = { createHistoryPlan };

