// Pure builders + gating for desktop (Windows) toast notifications. The actual
// electron Notification is created in main.js; keeping these helpers pure makes
// them unit-testable and free of electron dependencies.

const { formatBytes, formatNumber } = require('../services/telegram');
const { extractRunStats } = require('./run-stats');

/**
 * Decide whether a run should raise a desktop toast.
 * Desktop notifications are global (not per-job like Telegram): failures and
 * warnings always surface; successful syncs notify; successful compares are too
 * frequent to toast. Missing settings count as enabled (the schema default is
 * `desktopNotifications: true`).
 */
function shouldNotifyDesktop({ settings, result, dryRun } = {}) {
  if (settings && settings.desktopNotifications === false) return false;
  const ok = Boolean(result && result.ok);
  if (!ok) return true;
  if (dryRun) return false;
  return true;
}

function countNoun(count, noun) {
  return `${formatNumber(count)} ${noun}${Number(count) === 1 ? '' : 's'}`;
}

/**
 * Describe the work a sync run actually did, skipping zero stats. Returns ''
 * when the run changed nothing.
 */
function describeSyncWork(stats) {
  const parts = [];
  if (stats.copied) parts.push(`${countNoun(stats.copied, 'file')} copied`);
  if (stats.deleted) {
    parts.push(stats.mode === 'twoWay'
      ? `${formatNumber(stats.deleted)} deleted`
      : `${formatNumber(stats.deleted)} removed from destination`);
  }
  if (stats.archived) parts.push(`${formatNumber(stats.archived)} archived to history`);
  if (!parts.length) return '';
  let text = parts.join(', ');
  if (stats.copyBytes) text += ` (${formatBytes(stats.copyBytes)})`;
  return text;
}

function buildDesktopNotification({ job, result, dryRun } = {}) {
  const ok = Boolean(result && result.ok);
  const status = String((result && result.status) || (ok ? 'success' : 'error')).toLowerCase();
  const jobName = (job && job.name) || (result && result.jobName) || 'Sync job';
  const action = dryRun ? 'Compare' : 'Sync';
  const warning = status === 'warning' || status === 'warn';

  let title;
  if (warning) title = `${jobName}: ${action} finished with warnings`;
  else if (status === 'cancelled' || status === 'canceled') title = `${jobName}: ${action} cancelled`;
  else if (ok) title = `${jobName}: ${action} complete`;
  else title = `${jobName}: ${action} failed`;

  const stats = extractRunStats({ job, result, dryRun });

  let body;
  if (!ok) {
    const message = (result && result.message) || 'Open Syncarr to review the run log.';
    if (stats.failed) {
      const progress = stats.copied ? ` (${formatNumber(stats.copied)} copied before the error)` : '';
      body = `${message} ${countNoun(stats.failed, 'file')} failed${progress}. Click to review.`;
    } else {
      body = message;
    }
  } else if (dryRun) {
    let planned = `${countNoun(stats.plannedActions, 'change')} planned`;
    if (stats.plannedDeletes) planned += `, including ${countNoun(stats.plannedDeletes, 'delete')}`;
    if (stats.copyBytes) planned += ` (${formatBytes(stats.copyBytes)} to copy)`;
    body = planned;
  } else {
    const work = describeSyncWork(stats);
    if (warning) {
      body = work
        ? `${work} — finished with warnings. Click to review.`
        : 'Finished with warnings. Click to review.';
    } else if (work) {
      body = work;
    } else {
      body = stats.skipped
        ? `No changes — ${countNoun(stats.skipped, 'file')} already up to date`
        : 'No changes — everything already up to date';
    }
  }

  return {
    title: title.slice(0, 120),
    body: String(body || '').slice(0, 240),
    urgent: !ok,
    // Only clean successes are silent; failures, cancellations and warning
    // finishes should chime (Windows ignores `urgency`, so this is the knob).
    silent: ok && !warning,
    jobId: (job && job.id) || (result && result.jobId) || null
  };
}

/**
 * Build a startup toast when a previous run was interrupted (crash / force-quit
 * mid-sync). syncarr is a resident tray app that runs unattended, so without a
 * proactive nudge an interrupted run is only ever noticed if the user happens to
 * open the Sync tab. Returns null when nothing is interrupted.
 */
function buildInterruptedRunsNotification(interruptedRuns) {
  const runs = (Array.isArray(interruptedRuns) ? interruptedRuns : []).filter(Boolean);
  if (!runs.length) return null;

  const count = runs.length;
  const names = [...new Set(runs.map((run) => (run && (run.jobName || run.jobId)) || '').filter(Boolean))];
  const nameHint = names.length === 1 ? `"${names[0]}"` : `${count} job(s)`;

  return {
    title: count === 1
      ? 'Syncarr: an interrupted run needs review'
      : `Syncarr: ${count} interrupted runs need review`,
    body: `A previous run of ${nameHint} did not finish (likely a crash or force-quit). Open Syncarr to resume or roll it back.`.slice(0, 240),
    urgent: true,
    silent: false
  };
}

module.exports = { shouldNotifyDesktop, buildDesktopNotification, buildInterruptedRunsNotification };
