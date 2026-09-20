'use strict';

// Pure builders for the run-journal: the trigger label, the job snapshot stored
// in the journal, and the one-way list of recoverable operations derived from a
// File History plan. No I/O — they transform plain objects.

const path = require('path');
const { normalizeRelativeForManifest } = require('./path-utils');

function getRunTrigger(request) {
  if (request && request.recoveryResume === true) return 'recovery-resume';
  if (request && request.backgroundWatched === true) return 'smart-watcher';
  if (request && request.backgroundScheduled === true) return 'scheduled';
  return 'manual';
}

function makeJournalJobSnapshot(request, normalized = {}) {
  return {
    ...request,
    id: normalized.jobId || request.id,
    name: normalized.jobName || request.name,
    sourcePaths: normalized.sourcePaths || request.sourcePaths,
    targetDestinations: normalized.targetDestinations || request.targetDestinations,
    dryRun: false,
    enabled: true
  };
}

function buildOneWayJournalOperations(historyPlan) {
  const operations = [];
  for (const [destinationIndex, entry] of (historyPlan.destinationPlans || []).entries()) {
    for (const [index, item] of (entry.plan.archiveFiles || []).entries()) {
      const isDelete = !item.source || item.reason === 'mirror-delete-candidate';
      operations.push({
        id: `destination-${destinationIndex + 1}-archive-${index + 1}`,
        action: isDelete ? 'mirror-delete' : 'overwrite',
        relativePath: normalizeRelativeForManifest(item.relativePath),
        sourcePath: item.sourcePath || null,
        targetPath: item.targetPath,
        before: item.previous || null,
        expectedAfter: isDelete ? null : (item.source || null),
        sourceExpected: isDelete ? null : (item.source || null),
        recoverable: historyPlan.summary && historyPlan.summary.enabled !== false
      });
    }
    for (const [index, item] of (entry.plan.newFiles || []).entries()) {
      const relativePath = normalizeRelativeForManifest(item.relativePath);
      const matchingRoot = [...(entry.sourceRoots || [])]
        .sort((a, b) => String(b.relativePrefix || '').length - String(a.relativePrefix || '').length)
        .find((root) => {
          const prefix = normalizeRelativeForManifest(root.relativePrefix || '');
          return !prefix || relativePath === prefix || relativePath.startsWith(`${prefix}/`);
        });
      const prefix = matchingRoot ? normalizeRelativeForManifest(matchingRoot.relativePrefix || '') : '';
      const sourceRelativePath = prefix && relativePath.startsWith(`${prefix}/`)
        ? relativePath.slice(prefix.length + 1)
        : relativePath;
      operations.push({
        id: `destination-${destinationIndex + 1}-new-${index + 1}`,
        action: 'copy-new',
        relativePath,
        sourcePath: matchingRoot ? path.join(matchingRoot.sourcePath, sourceRelativePath) : null,
        targetPath: path.join(entry.destination.path, item.relativePath),
        before: null,
        expectedAfter: item.source || null,
        sourceExpected: item.source || null,
        recoverable: true
      });
    }
  }
  return operations;
}

module.exports = { getRunTrigger, makeJournalJobSnapshot, buildOneWayJournalOperations };
