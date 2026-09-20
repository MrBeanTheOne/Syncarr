'use strict';

// Encodes the multi-source layout rule: a single source copies directly into the
// target, while multiple sources each get their own top-level subfolder (named
// from a deduped, sanitized basename) to avoid relative-path collisions.

const path = require('path');
const { normalizeSourcePaths, sanitizeFolderLabel, dedupeLabel } = require('./job-model');

function buildSourceSyncRoots({ sourcePaths, targetPath }) {
  const paths = normalizeSourcePaths(sourcePaths);
  const multi = paths.length > 1;
  const used = new Map();

  return paths.map((sourcePath, index) => {
    const label = dedupeLabel(
      sanitizeFolderLabel(path.basename(path.resolve(sourcePath)) || `Source ${index + 1}`, `Source ${index + 1}`, 'Source'),
      used
    );

    return {
      index,
      sourcePath,
      label,
      destinationPath: multi ? path.join(targetPath, label) : targetPath,
      relativePrefix: multi ? label : ''
    };
  });
}

module.exports = { buildSourceSyncRoots };
