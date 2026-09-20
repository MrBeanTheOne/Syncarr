// Two-way compare preview builder.
//
// Phase 2 of two-way sync: produce a *preview* only — nothing is copied or
// deleted here. For each destination we scan both sides, load the last-synced
// baseline from two-way-state, run the pure reconciler (two-way-plan.js), and
// turn the result into Syncarr preview entries that carry a `direction` so the
// UI can show which way each file would move.
//
// I/O is injected (collectFiles, openState) so the orchestration is unit-testable
// without touching the filesystem or the real state store. main.js wires in the
// real collectSourceFiles + createTwoWayState.

'use strict';

const { buildTwoWayPlan } = require('./two-way-plan');
const { PREVIEW_FILE_LIMIT } = require('./job-model');

function joinPrefixed(prefix, relativePath) {
  const clean = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!prefix) return clean;
  return `${String(prefix).replace(/\\/g, '/').replace(/\/+$/, '')}/${clean}`;
}

function toMeta(observation) {
  if (!observation) return null;
  return {
    size: Number(observation.size || 0),
    mtimeMs: Number.isFinite(observation.mtimeMs) ? observation.mtimeMs : null,
    modifiedAt: null,
    sha1: observation.sha1 || null
  };
}

// Map one reconciliation entry onto a Syncarr preview row. The existing preview
// shape uses `source` = incoming content and `target` = the file being replaced;
// we keep that meaning and add `direction` + a human label.
function entryToPreviewRow(planEntry, direction) {
  const S = planEntry.source;       // physical source-side observation (or null)
  const D = planEntry.destination;  // physical destination-side observation (or null)
  let action;
  let label;
  let copyBytes = 0;

  switch (direction) {
    case 'toDest':
      action = D ? 'update-archive' : 'copy-new';
      label = D ? 'Update destination' : 'Copy to destination';
      copyBytes = S ? Number(S.size || 0) : 0;
      break;
    case 'toSource':
      action = S ? 'update-archive' : 'copy-new';
      label = S ? 'Update source' : 'Copy to source';
      copyBytes = D ? Number(D.size || 0) : 0;
      break;
    case 'deleteDest':
      action = 'extra';
      label = 'Delete on destination';
      break;
    case 'deleteSource':
      action = 'extra';
      label = 'Delete on source';
      break;
    case 'keepBoth':
      action = 'conflict';
      label = 'Conflict — keep both';
      break;
    default:
      action = 'conflict';
      label = 'Conflict';
  }

  // Always report the physical sides so the renderer reasons about each pane
  // consistently; `direction` says which way the file actually flows.
  return {
    action,
    label,
    direction,
    relativePath: planEntry.relativePath,
    reason: planEntry.reason,
    conflict: Boolean(planEntry.conflict),
    source: toMeta(S),
    target: toMeta(D),
    copyBytes,
    archiveBytes: 0
  };
}

// Pure: convert a buildTwoWayPlan() result into { files, counts }.
function twoWayPlanToPreviewRows(plan) {
  const rows = [];
  const add = (entries, direction) => {
    for (const e of entries) rows.push(entryToPreviewRow(e, direction));
  };
  add(plan.copyToDest, 'toDest');
  add(plan.copyToSource, 'toSource');
  add(plan.deleteOnDest, 'deleteDest');
  add(plan.deleteOnSource, 'deleteSource');
  add(plan.keepBoth, 'keepBoth');
  return rows;
}

function emptyTwoWaySummary(historyEnabled, conflictPolicy = 'newer') {
  return {
    enabled: historyEnabled !== false,
    twoWay: true,
    conflictPolicy,
    scanned: 0,
    wouldCopy: 0,
    copyToDest: 0,
    copyToSource: 0,
    deleteOnDest: 0,
    deleteOnSource: 0,
    keepBoth: 0,
    conflicts: 0,
    newFiles: 0,
    unchanged: 0,
    destinationOnly: 0,
    copyBytes: 0,
    archiveBytes: 0,
    estimatedWriteBytes: 0,
    previewFiles: 0,
    previewTruncated: false
  };
}

function accumulatePlanIntoSummary(summary, plan, rows) {
  const s = plan.summary || {};
  summary.copyToDest += s.copyToDest || 0;
  summary.copyToSource += s.copyToSource || 0;
  summary.deleteOnDest += s.deleteOnDest || 0;
  summary.deleteOnSource += s.deleteOnSource || 0;
  summary.keepBoth += s.keepBoth || 0;
  summary.conflicts += s.conflicts || 0;
  summary.unchanged += s.unchanged || 0;
  summary.wouldCopy += (s.copyToDest || 0) + (s.copyToSource || 0);
  // "new" = copies where nothing exists on the receiving side yet.
  for (const e of plan.copyToDest) if (!e.destination) summary.newFiles += 1;
  for (const e of plan.copyToSource) if (!e.source) summary.newFiles += 1;
  for (const row of rows) summary.copyBytes += Number(row.copyBytes || 0);
  // Surface deletes through the standard "destination-only" channel too so the
  // existing overview has a non-zero signal until the renderer learns two-way.
  summary.destinationOnly += (s.deleteOnDest || 0) + (s.deleteOnSource || 0);
}

// Build a file-entry list from collectFiles output, prefixed for multi-source.
function toEntries(files, relativePrefix) {
  const out = [];
  for (const file of Array.isArray(files) ? files : []) {
    if (!file) continue;
    const stats = file.stats || file;
    const size = Number(stats.size);
    const mtimeMs = Number(stats.mtimeMs);
    if (!Number.isFinite(size) || !Number.isFinite(mtimeMs)) continue;
    out.push({
      relativePath: joinPrefixed(relativePrefix, file.relativePath),
      size,
      mtimeMs,
      sha1: file.sha1 || stats.sha1 || null
    });
  }
  return out;
}

// Orchestrate a two-way compare preview across all source roots / destinations.
// Source roots that target the same destination index share one baseline and
// are reconciled together (their paths are prefixed so multi-source folders stay
// distinct), which matches how the store records prefixed paths.
async function buildTwoWayComparePreview({
  sourceRoots,
  destinations,
  excludePatterns,
  copySubfolders,
  historyEnabled,
  jobId,
  basePath,
  conflictPolicy = 'newer',
  collectFiles,
  openState
}) {
  const summary = emptyTwoWaySummary(historyEnabled, conflictPolicy);
  const files = [];
  const roots = Array.isArray(sourceRoots) ? sourceRoots : [];
  const destinationList = Array.isArray(destinations) ? destinations : [];

  const indexOfDestination = (destination) => {
    const idx = destinationList.indexOf(destination);
    if (idx >= 0) return idx;
    if (destination && Number.isInteger(destination.index)) return destination.index;
    return 0;
  };

  // Group roots by destination index so each baseline is reconciled once.
  const groups = new Map();
  for (const root of roots) {
    const destinationIndex = indexOfDestination(root.destination);
    if (!groups.has(destinationIndex)) groups.set(destinationIndex, []);
    groups.get(destinationIndex).push(root);
  }

  for (const [destinationIndex, groupRoots] of groups) {
    const sourceEntries = [];
    const destEntries = [];

    for (const root of groupRoots) {
      let sourceFiles = [];
      let destFiles = [];
      try {
        sourceFiles = await collectFiles({ sourcePath: root.sourcePath, copySubfolders, excludePatterns });
      } catch {
        sourceFiles = [];
      }
      try {
        destFiles = await collectFiles({ sourcePath: root.destinationPath, copySubfolders, excludePatterns });
      } catch {
        destFiles = [];
      }
      sourceEntries.push(...toEntries(sourceFiles, root.relativePrefix));
      destEntries.push(...toEntries(destFiles, root.relativePrefix));
    }

    let baseline = [];
    let state = null;
    try {
      state = openState({ userDataPath: basePath, jobId, destinationIndex });
      if (state && state.ready) await state.ready;
      baseline = state && typeof state.listRecords === 'function' ? state.listRecords() : [];
    } catch {
      baseline = [];
    } finally {
      if (state && typeof state.close === 'function') {
        try { await state.close(); } catch { /* best effort */ }
      }
    }

    const plan = buildTwoWayPlan({
      sourceFiles: sourceEntries,
      destFiles: destEntries,
      baseline,
      policy: conflictPolicy
    });
    summary.conflictPolicy = plan.policy;

    const rows = twoWayPlanToPreviewRows(plan);
    accumulatePlanIntoSummary(summary, plan, rows);

    for (const row of rows) {
      if (files.length < PREVIEW_FILE_LIMIT) files.push(row);
      else summary.previewTruncated = true;
    }
  }

  summary.previewFiles = summary.copyToDest + summary.copyToSource
    + summary.deleteOnDest + summary.deleteOnSource + summary.keepBoth;
  summary.scanned = summary.previewFiles;
  summary.estimatedWriteBytes = summary.copyBytes;

  return { summary, files };
}

module.exports = {
  buildTwoWayComparePreview,
  twoWayPlanToPreviewRows,
  entryToPreviewRow,
  toEntries,
  PREVIEW_FILE_LIMIT
};
