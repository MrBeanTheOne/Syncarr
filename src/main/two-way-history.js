const fs = require('fs/promises');
const path = require('path');
const { sanitizeJobId, normalizeSourcePaths, normalizeTargetDestinations, HISTORY_FOLDER_NAME } = require('./job-model');
const { normalizeRelativeForManifest } = require('./path-utils');
const { pathIdentityKey } = require('./platform');

async function createTwoWayHistoryManifests({
  archives,
  runId,
  createdAt,
  completedAt,
  jobId,
  jobName,
  sourcePaths,
  targetDestinations,
  historyFolderName,
  status,
  message
} = {}) {
  const groups = new Map();
  for (const archive of Array.isArray(archives) ? archives : []) {
    if (!archive || !archive.rootPath || !archive.archivedRelativePath) continue;
    const key = pathIdentityKey(path.resolve(archive.rootPath));
    if (!groups.has(key)) groups.set(key, { rootPath: archive.rootPath, archives: [] });
    groups.get(key).archives.push(archive);
  }

  const manifests = [];
  for (const group of groups.values()) {
    const historyRoot = path.join(group.rootPath, historyFolderName || HISTORY_FOLDER_NAME);
    const manifestsRoot = path.join(historyRoot, 'manifests');
    const manifestPath = path.join(manifestsRoot, `${runId}.json`);
    const archivedFiles = group.archives.map((archive) => ({
      relativePath: normalizeRelativeForManifest(archive.relativePath),
      archivedRelativePath: normalizeRelativeForManifest(archive.archivedRelativePath),
      reason: archive.side === 'source' ? 'two-way-source-change' : 'two-way-destination-change',
      sourcePath: archive.sourcePath || null,
      originalSourcePath: archive.sourcePath || null,
      sourceRoot: archive.sourceRoot || null,
      previous: archive.previous || null,
      side: archive.side
    }));
    const manifest = {
      schemaVersion: 1,
      operation: 'two-way-sync',
      runId,
      status: status || 'success',
      createdAt: (createdAt instanceof Date ? createdAt : new Date(createdAt || Date.now())).toISOString(),
      completedAt: completedAt || new Date().toISOString(),
      jobId: sanitizeJobId(jobId),
      jobName: String(jobName || '').trim(),
      sourcePath: normalizeSourcePaths(sourcePaths)[0] || '',
      sourcePaths: normalizeSourcePaths(sourcePaths),
      targetPath: group.rootPath,
      targetDestinations: normalizeTargetDestinations(targetDestinations, ''),
      historyFolderName: historyFolderName || HISTORY_FOLDER_NAME,
      summary: {
        twoWay: true,
        archived: archivedFiles.length,
        manifestPath
      },
      archivedFiles,
      newFiles: [],
      message: String(message || '')
    };

    await fs.mkdir(manifestsRoot, { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    manifests.push({ rootPath: group.rootPath, manifestPath, archived: archivedFiles.length });
  }

  return manifests;
}

module.exports = { createTwoWayHistoryManifests };
