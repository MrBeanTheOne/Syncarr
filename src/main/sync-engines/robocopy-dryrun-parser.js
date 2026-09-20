// Pure parser for Robocopy dry-run output into a Syncarr compare plan.
// Behavior matches the previous in-main implementation 1:1 so existing
// previews stay stable.

const path = require('path');
const { normalizeSyncMode, PREVIEW_FILE_LIMIT } = require('../job-model');
const { normalizeRelativeForManifest, normalizePathForCompare } = require('../path-utils');

const PLAN_SUMMARY_COUNT_KEYS = [
  'scanned',
  'sourceFiles',
  'wouldCopy',
  'wouldArchive',
  'archived',
  'newFiles',
  'skippedOlder',
  'unchanged',
  'conflicts',
  'destinationOnly',
  'copyBytes',
  'archiveBytes',
  'previewFiles'
];

function accumulatePlanSummary(target = {}, source = {}) {
  for (const key of PLAN_SUMMARY_COUNT_KEYS) {
    target[key] = Number(target[key] || 0) + Number(source[key] || 0);
  }
  return target;
}

function findRobocopyRootForPath(sourceRoots, sourcePath, destinationPath) {
  const cleanSource = normalizePathForCompare(sourcePath);
  const cleanDestination = normalizePathForCompare(destinationPath);
  let best = null;

  for (const root of sourceRoots || []) {
    const rootSource = normalizePathForCompare(root.sourcePath);
    const rootDestination = normalizePathForCompare(root.destinationPath);
    // Robocopy emits Windows-style paths regardless of the host running the
    // tests, so match on both separators rather than the host's path.sep.
    const sourceMatches = cleanSource && (cleanSource === rootSource || cleanSource.startsWith(rootSource + '\\') || cleanSource.startsWith(rootSource + '/'));
    const destinationMatches = !cleanDestination || cleanDestination === rootDestination || cleanDestination.startsWith(rootDestination + '\\') || cleanDestination.startsWith(rootDestination + '/');
    if (sourceMatches && destinationMatches) {
      if (!best || rootSource.length > normalizePathForCompare(best.sourcePath).length) best = root;
    }
  }

  return best;
}

function robocopyActionToPreview(action, syncMode = 'oneWay') {
  const clean = String(action || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (clean === 'new file') return { action: 'copy-new', label: 'New file', reason: 'robocopy-new-file' };
  if (clean === 'newer' || clean === 'changed' || clean === 'tweaked') return { action: 'update-archive', label: 'Update', reason: `robocopy-${clean.replace(/\s+/g, '-')}` };
  if (clean === 'older') {
    return normalizeSyncMode(syncMode) === 'mirror'
      ? { action: 'update-archive', label: 'Mirror replace', reason: 'robocopy-older-source-mirror' }
      : { action: 'skip-older-source', label: 'Skip older source', reason: 'robocopy-older-source' };
  }
  if (clean === 'same') return { action: 'unchanged', label: 'Unchanged', reason: 'robocopy-same' };
  if (clean.startsWith('*extra')) {
    return normalizeSyncMode(syncMode) === 'mirror'
      ? { action: 'extra', label: 'Mirror delete candidate', reason: 'robocopy-extra-mirror' }
      : { action: 'extra', label: 'Destination-only', reason: 'robocopy-extra-one-way' };
  }
  return { action: 'copy-new', label: action || 'File action', reason: 'robocopy-action' };
}

function parseRobocopySizeAndName(detail) {
  const clean = String(detail || '').trim();
  if (!clean) return { sizeBytes: 0, name: '' };

  // Robocopy may print the size column as either plain bytes or as a value plus
  // a short unit (for example: "1.2 m    File.wav"). Older parsing stripped
  // only the number, leaving the unit letter as a fake first character in the
  // preview. Keep the actual destination filename intact by removing both.
  const unitMatch = clean.match(/^([0-9][0-9.,]*)(?:\s+)([kmgtpe]?b?|bytes?)\s+(.+)$/i);
  if (unitMatch && unitMatch[3]) {
    return {
      sizeBytes: robocopyDisplaySizeToBytes(unitMatch[1], unitMatch[2]),
      name: unitMatch[3].trim()
    };
  }

  const plainMatch = clean.match(/^([0-9][0-9.,]*)(?:\s{2,}|\t+)(.+)$/);
  if (plainMatch && plainMatch[2]) {
    return {
      sizeBytes: Number(plainMatch[1].replace(/,/g, '')) || 0,
      name: plainMatch[2].trim()
    };
  }

  const looseMatch = clean.match(/^([0-9][0-9.,]*)(?:\s+)(.+)$/);
  if (looseMatch && looseMatch[2]) {
    return {
      sizeBytes: Number(looseMatch[1].replace(/,/g, '')) || 0,
      name: looseMatch[2].trim()
    };
  }

  return { sizeBytes: 0, name: clean };
}

function parseRobocopyFileSize(detail) {
  return parseRobocopySizeAndName(detail).sizeBytes;
}

function stripRobocopySize(detail) {
  return parseRobocopySizeAndName(detail).name;
}

function robocopyDisplaySizeToBytes(value, unit) {
  const amount = Number(String(value || '0').replace(/,/g, '')) || 0;
  const cleanUnit = String(unit || '').trim().toLowerCase();
  if (!cleanUnit || cleanUnit === 'b' || cleanUnit === 'byte' || cleanUnit === 'bytes') return Math.round(amount);
  const first = cleanUnit.charAt(0);
  const powers = { k: 1, m: 2, g: 3, t: 4, p: 5, e: 6 };
  const power = powers[first] || 0;
  return Math.round(amount * Math.pow(1024, power));
}

function makeRelativeFromRobocopy({ root, currentDirectory, detail }) {
  const fileName = stripRobocopySize(detail);
  if (!fileName) return '';

  // Robocopy paths are always Windows-style; use win32 semantics so the
  // parser produces identical results on Windows and on CI/test hosts.
  let fullPath = fileName;
  if (!path.win32.isAbsolute(fullPath)) {
    fullPath = path.win32.join(currentDirectory || root.sourcePath, fileName);
  }

  let relativePath = '';
  try {
    relativePath = path.win32.relative(root.sourcePath, fullPath);
  } catch {
    relativePath = fileName;
  }

  if (!relativePath || relativePath.startsWith('..')) relativePath = fileName;
  if (root.relativePrefix) relativePath = path.win32.join(root.relativePrefix, relativePath);
  if (root.destinationLabel && root.destinationCount > 1) relativePath = path.win32.join(root.destinationLabel, relativePath);
  return normalizeRelativeForManifest(relativePath);
}

function buildEmptySummary({ historyEnabled, historyFolderName, sourceRoots, destinationCount }) {
  return {
    enabled: historyEnabled !== false,
    historyFolderName,
    scanned: 0,
    sourceFiles: 0,
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
    destinationOnly: 0,
    sourceCount: new Set((sourceRoots || []).map((root) => root.sourcePath)).size,
    destinationCount
  };
}

function buildRobocopyDryRunPreview({ output, sourceRoots, destinations, historyEnabled, historyFolderName, syncMode }) {
  const cleanMode = normalizeSyncMode(syncMode);
  const destinationCount = Array.isArray(destinations) ? destinations.length : 0;
  const roots = (sourceRoots || []).map((root) => ({ ...root, destinationCount }));
  const files = [];
  const seen = new Set();
  let currentSource = '';
  let currentDestination = '';
  let currentRoot = roots[0] || null;
  let currentDirectory = currentRoot ? currentRoot.sourcePath : '';

  const summary = buildEmptySummary({ historyEnabled, historyFolderName, sourceRoots: roots, destinationCount });

  const addFile = (entry) => {
    if (!entry.relativePath) return;
    const key = `${entry.destinationPath || ''}|${entry.relativePath}|${entry.action}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    summary.previewFiles += 1;
    if (files.length < PREVIEW_FILE_LIMIT) files.push(entry);
    else summary.previewTruncated = true;
  };

  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const sourceMatch = line.match(/^Source\s*:\s*(.+)$/i);
    if (sourceMatch) {
      currentSource = sourceMatch[1].trim();
      currentDirectory = currentSource;
      currentRoot = findRobocopyRootForPath(roots, currentSource, currentDestination) || currentRoot;
      continue;
    }

    const destinationMatch = line.match(/^(?:Dest|Destination)\s*:\s*(.+)$/i);
    if (destinationMatch) {
      currentDestination = destinationMatch[1].trim();
      currentRoot = findRobocopyRootForPath(roots, currentSource, currentDestination) || currentRoot;
      continue;
    }

    const dirMatch = line.match(/^New Dir\s+\d+\s+(.+)$/i);
    if (dirMatch) {
      currentDirectory = dirMatch[1].trim();
      currentRoot = findRobocopyRootForPath(roots, currentDirectory, currentDestination) || currentRoot;
      continue;
    }

    const fileMatch = line.match(/^(\*EXTRA File|New File|Newer|Older|Changed|Tweaked|Same)\s+(.+)$/i);
    if (!fileMatch || !currentRoot) continue;

    const actionMeta = robocopyActionToPreview(fileMatch[1], cleanMode);
    const parsedSize = parseRobocopyFileSize(fileMatch[2]);
    const isMirrorExtra = actionMeta.action === 'extra' && cleanMode === 'mirror';
    const copyBytes = ['copy-new', 'update-archive'].includes(actionMeta.action) ? parsedSize : 0;
    const archiveBytes = isMirrorExtra && historyEnabled !== false ? parsedSize : 0;
    const relativePath = makeRelativeFromRobocopy({ root: currentRoot, currentDirectory, detail: fileMatch[2] });
    if (!relativePath) continue;

    if (actionMeta.action === 'copy-new') {
      summary.wouldCopy += 1;
      summary.newFiles += 1;
      summary.copyBytes += copyBytes;
    } else if (actionMeta.action === 'update-archive') {
      summary.wouldCopy += 1;
      summary.wouldArchive += historyEnabled !== false ? 1 : 0;
      summary.copyBytes += copyBytes;
    } else if (actionMeta.action === 'extra') {
      summary.destinationOnly += 1;
      if (isMirrorExtra) {
        summary.wouldArchive += historyEnabled !== false ? 1 : 0;
        summary.archiveBytes += archiveBytes;
      }
    } else if (actionMeta.action === 'skip-older-source') {
      summary.skippedOlder += 1;
    } else if (actionMeta.action === 'unchanged') {
      summary.unchanged += 1;
    }

    // Count every file present on the SOURCE side (anything but a
    // destination-only extra). The empty-source mirror safety guard keys on this
    // — `scanned`/`previewFiles` also count the very extras it guards against, so
    // an all-extras (empty source) mirror would otherwise never read as empty.
    if (actionMeta.action !== 'extra') summary.sourceFiles += 1;

    if (actionMeta.action === 'unchanged') continue;

    addFile({
      action: actionMeta.action,
      label: actionMeta.label,
      relativePath,
      reason: actionMeta.reason,
      sourceRoot: currentRoot.sourcePath,
      sourceLabel: currentRoot.label || '',
      destinationPath: currentRoot.destination && currentRoot.destination.path ? currentRoot.destination.path : '',
      destinationLabel: currentRoot.destinationLabel || '',
      destinationRequired: currentRoot.destinationRequired !== false,
      source: actionMeta.action === 'extra' ? null : { size: copyBytes, mtimeMs: null, modifiedAt: null },
      target: actionMeta.action === 'extra' ? { size: parsedSize, mtimeMs: null, modifiedAt: null } : null,
      copyBytes,
      archiveBytes
    });
  }

  summary.scanned = summary.previewFiles;
  summary.estimatedWriteBytes = summary.copyBytes + (historyEnabled !== false ? summary.archiveBytes : 0);
  return { summary, files };
}

function prefixPreviewFilesForDestination(files, destination, destinationCount) {
  if (!Array.isArray(files)) return [];
  return files.map((file) => ({
    ...file,
    relativePath: destinationCount > 1
      ? normalizeRelativeForManifest(path.join(destination.label, file.relativePath || ''))
      : normalizeRelativeForManifest(file.relativePath || ''),
    destinationPath: destination.path,
    destinationLabel: destination.label,
    destinationRequired: destination.required !== false
  }));
}

function mergeDestinationPlans(destinationPlans, destinations, skippedDestinations, historyFolderName, historyEnabled) {
  const summary = {
    enabled: historyEnabled !== false,
    historyFolderName,
    scanned: 0,
    sourceFiles: 0,
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
    destinationOnly: 0,
    sourceCount: destinationPlans[0] && destinationPlans[0].plan && destinationPlans[0].plan.sourceRoots ? destinationPlans[0].plan.sourceRoots.length : 0,
    destinationCount: destinations.length,
    skippedDestinationCount: skippedDestinations.length,
    skippedDestinations: skippedDestinations.map((destination) => ({
      path: destination.path,
      label: destination.label,
      required: destination.required !== false,
      reason: destination.reason || 'not-connected-or-unreadable'
    }))
  };

  const aggregate = {
    enabled: historyEnabled !== false,
    historyFolderName,
    sourcePath: '',
    sourcePaths: [],
    sourceRoots: [],
    targetPath: destinations[0] ? destinations[0].path : '',
    targetDestinations: destinations,
    skippedDestinations,
    archiveFiles: [],
    newFiles: [],
    previewFiles: [],
    destinationPlans,
    summary
  };

  for (const entry of destinationPlans) {
    const plan = entry.plan || {};
    const childSummary = plan.summary || {};
    accumulatePlanSummary(summary, childSummary);
    summary.previewTruncated = summary.previewTruncated || Boolean(childSummary.previewTruncated);
    aggregate.sourcePaths = plan.sourcePaths || aggregate.sourcePaths;
    aggregate.sourceRoots = plan.sourceRoots || aggregate.sourceRoots;
    aggregate.archiveFiles.push(...(plan.archiveFiles || []));
    aggregate.newFiles.push(...(plan.newFiles || []));

    const prefixed = prefixPreviewFilesForDestination(plan.previewFiles || [], entry.destination, destinations.length);
    for (const file of prefixed) {
      if (aggregate.previewFiles.length < PREVIEW_FILE_LIMIT) aggregate.previewFiles.push(file);
      else summary.previewTruncated = true;
    }
  }

  summary.estimatedWriteBytes = summary.copyBytes + (aggregate.enabled ? summary.archiveBytes : 0);
  return aggregate;
}

module.exports = {
  buildRobocopyDryRunPreview,
  mergeDestinationPlans,
  accumulatePlanSummary,
  prefixPreviewFilesForDestination,
  // Exported for tests + rare callers that need to share parsing.
  findRobocopyRootForPath,
  robocopyActionToPreview,
  parseRobocopyFileSize,
  stripRobocopySize,
  parseRobocopySizeAndName,
  robocopyDisplaySizeToBytes,
  makeRelativeFromRobocopy,
  PREVIEW_FILE_LIMIT
};
