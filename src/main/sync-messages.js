// Pure presentation helpers extracted from src/main.js: byte/run-id/quote
// formatters and the human-readable completion / no-op summary messages for
// compare and sync runs. No main-process state — every input is passed in.
//
// makeNoOpRobocopySummary returns an engine-shaped (Robocopy) summary object
// for the no-op fast path; it reuses the engine's emptyRobocopyLineTotals so
// the shape stays in lockstep with a real Robocopy summary.

const { normalizeSyncMode, RUN_STATUS } = require('./job-model');
const { getPlannedSyncActionCounts } = require('./sync-plan-utils');
const { emptyRobocopyLineTotals } = require('./sync-engines/robocopy-engine');

function formatBytesForMessage(value) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = Number(value) || 0;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount.toFixed(amount >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatHistoryRunId(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function quoteForDisplay(value) {
  const s = String(value);
  if (/\s/.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  return s;
}

function makeNoOpRobocopySummary(historySummary = {}) {
  const skipped = Number(historySummary.unchanged || 0) + Number(historySummary.skippedOlder || 0);
  const files = emptyRobocopyLineTotals();
  files.total = skipped;
  files.skipped = skipped;
  const bytes = emptyRobocopyLineTotals();
  const dirs = emptyRobocopyLineTotals();

  return {
    dirs,
    files,
    bytes,
    copied: 0,
    skipped,
    failed: 0,
    extras: 0
  };
}

function buildNoOpSyncMessage({ syncMode, historySummary, skippedDestinations }) {
  const mode = normalizeSyncMode(syncMode);
  const destinationOnly = Number(historySummary && historySummary.destinationOnly || 0);
  const skippedOlder = Number(historySummary && historySummary.skippedOlder || 0);
  const parts = [];

  if (mode === 'mirror') {
    parts.push('Mirror sync skipped: no copy, update, or delete actions were needed.');
  } else {
    parts.push('One-way sync skipped: no copy or update actions were needed.');
    if (destinationOnly > 0) {
      parts.push(`${destinationOnly.toLocaleString()} destination-only file(s) were left untouched.`);
    }
  }

  if (skippedOlder > 0) {
    parts.push(`${skippedOlder.toLocaleString()} older source file(s) were skipped by the safety rule.`);
  }

  const optionalIssueCount = Array.isArray(skippedDestinations) ? skippedDestinations.length : 0;
  if (optionalIssueCount > 0) {
    parts.push(`${optionalIssueCount.toLocaleString()} optional destination(s) skipped.`);
  }

  return parts.join(' ');
}

function buildCompareCompletionMessage({ syncMode, previewSummary, finalStatus }) {
  const mode = normalizeSyncMode(syncMode);
  const summary = previewSummary || {};
  const counts = getPlannedSyncActionCounts(summary, mode);
  const actions = counts.actionable + counts.blocked;
  const copies = counts.copyOrUpdate;
  const destinationOnly = Number(summary.destinationOnly || 0);
  const archived = counts.archive;
  const skippedText = finalStatus && finalStatus.status === RUN_STATUS.WARNING && finalStatus.optionalIssueCount
    ? ` ${Number(finalStatus.optionalIssueCount).toLocaleString()} optional destination(s) skipped.`
    : '';

  if (!actions) return `No file changes found.${skippedText}`;

  if (mode === 'mirror') {
    return `${actions.toLocaleString()} mirror action(s) found: ${copies.toLocaleString()} copy/update, ${destinationOnly.toLocaleString()} delete candidate(s), ${archived.toLocaleString()} version(s) protected.${skippedText}`;
  }

  return `${actions.toLocaleString()} one-way difference(s) found: ${copies.toLocaleString()} copy/update action(s), ${destinationOnly.toLocaleString()} destination-only file(s) left untouched, ${archived.toLocaleString()} version(s) protected.${skippedText}`;
}

function buildSyncCompletionMessage({ syncMode, finalStatus, summary, getFileCounts, skippedDestinations }) {
  if (!finalStatus || finalStatus.ok !== true) return finalStatus && finalStatus.message ? finalStatus.message : 'Sync did not complete.';

  const mode = normalizeSyncMode(syncMode);
  const counts = typeof getFileCounts === 'function'
    ? getFileCounts(summary || {})
    : { copied: 0, skipped: 0, failed: 0, extras: 0 };

  // A run reclassified to 'no-change' did no actual writing — in non-mirror
  // modes this happens when the only difference is destination-only files that
  // are intentionally left untouched. Say so plainly instead of "completed: 0
  // copied" so repeated runs read as the stable no-change state they are.
  if (finalStatus.status === RUN_STATUS.NO_CHANGE) {
    const base = mode === 'mirror'
      ? 'Mirror sync completed: no changes were needed.'
      : 'One-way sync completed: no changes were needed.';
    const noChangeParts = [base];
    if (mode !== 'mirror' && counts.extras > 0) {
      noChangeParts.push(`${counts.extras.toLocaleString()} destination-only file(s) were left untouched.`);
    }
    return noChangeParts.join(' ');
  }

  const parts = [];
  const copiedText = `${counts.copied.toLocaleString()} copied`;
  const skippedText = `${counts.skipped.toLocaleString()} skipped`;

  if (mode === 'mirror') {
    parts.push(`Mirror sync completed: ${copiedText}, ${counts.extras.toLocaleString()} deleted, ${skippedText}.`);
  } else {
    parts.push(`One-way sync completed: ${copiedText}, ${skippedText}.`);
    if (counts.extras > 0) {
      parts.push(`${counts.extras.toLocaleString()} destination-only file(s) were left untouched.`);
    }
  }

  if (counts.failed > 0) parts.push(`${counts.failed.toLocaleString()} failed.`);
  const optionalIssueCount = Array.isArray(skippedDestinations) ? skippedDestinations.length : Number(finalStatus.optionalIssueCount || 0);
  if (finalStatus.status === RUN_STATUS.WARNING && optionalIssueCount > 0) {
    parts.push(`${optionalIssueCount.toLocaleString()} optional destination(s) skipped.`);
  }

  return parts.join(' ');
}

module.exports = {
  formatBytesForMessage,
  formatHistoryRunId,
  quoteForDisplay,
  makeNoOpRobocopySummary,
  buildNoOpSyncMessage,
  buildCompareCompletionMessage,
  buildSyncCompletionMessage
};
