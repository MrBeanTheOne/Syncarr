const ACTIVITY_STATUSES = new Set([
  'idle',
  'running',
  'success',
  'warning',
  'error',
  'cancelled',
  'paused'
]);

const TASK_KINDS = new Set(['compare', 'sync', 'preview', 'restore', 'retention', 'task']);

function cleanText(value, fallback = '', maxLength = 240) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return (clean || fallback).slice(0, maxLength);
}

function cleanDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function normalizeProgress(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const percentValue = Number(raw.percent);
  const hasPercent = raw.percent !== null && raw.percent !== undefined && raw.percent !== '';
  const percent = hasPercent && Number.isFinite(percentValue)
    ? Math.max(0, Math.min(100, Math.round(percentValue)))
    : null;

  return {
    percent,
    indeterminate: raw.indeterminate === true || percent === null,
    copied: cleanNumber(raw.copied),
    skipped: cleanNumber(raw.skipped),
    failed: cleanNumber(raw.failed),
    extra: cleanNumber(raw.extra),
    processed: cleanNumber(raw.processed),
    total: cleanNumber(raw.total),
    label: cleanText(raw.label || raw.latestText, '', 180),
    file: cleanText(raw.file || raw.latestFile, '', 420)
  };
}

function normalizeTask(input = {}, index = 0) {
  const raw = input && typeof input === 'object' ? input : {};
  const kind = TASK_KINDS.has(raw.kind) ? raw.kind : 'task';
  const name = cleanText(raw.name || raw.jobName, 'Sync task', 120);
  const fallbackId = `${kind}-${index + 1}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task'}`;
  const queuePosition = Math.floor(cleanNumber(raw.queuePosition, index + 1));
  const queueTotal = Math.floor(cleanNumber(raw.queueTotal));

  return {
    id: cleanText(raw.id || raw.jobId, fallbackId, 120),
    name,
    kind,
    label: cleanText(raw.label, kind === 'task' ? 'Task' : kind.charAt(0).toUpperCase() + kind.slice(1), 80),
    message: cleanText(raw.message, '', 240),
    scheduled: raw.scheduled === true,
    dueAt: cleanDate(raw.dueAt),
    startedAt: cleanDate(raw.startedAt),
    completedAt: cleanDate(raw.completedAt),
    queuePosition,
    queueTotal,
    progress: normalizeProgress(raw.progress)
  };
}

function normalizeQueue(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 12).map((task, index) => normalizeTask(task, index));
}

function normalizeConflictWarnings(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 12).map((warning, index) => ({
    id: cleanText(warning && (warning.id || warning.jobId), `conflict-${index + 1}`, 120),
    name: cleanText(warning && (warning.name || warning.jobName), 'Sync job', 120),
    message: cleanText(warning && warning.message, 'Scheduled sync was skipped because conflicts need review.', 240),
    at: cleanDate(warning && warning.at)
  }));
}

function hasSuccessfulCompareAfter(runs, jobId, after) {
  const afterMs = new Date(after).getTime();
  if (!Number.isFinite(afterMs) || !Array.isArray(runs)) return false;
  return runs.some((run) => {
    const runMs = new Date(run && run.at).getTime();
    return run && run.dryRun === true && run.ok === true
      && cleanText(run.jobId, '') === cleanText(jobId, '')
      && Number.isFinite(runMs) && runMs > afterMs;
  });
}

function getScheduledConflictWarnings(tasks, recentRuns = []) {
  if (!Array.isArray(tasks)) return [];
  return normalizeConflictWarnings(tasks.flatMap((task) => {
    const job = task && task.job;
    const schedule = task && task.schedule || job && job.schedule;
    const lastRun = schedule && schedule.lastRun;
    if (String(lastRun && lastRun.status || '').toLowerCase() !== 'conflicts'
      || lastRun.conflictAcknowledgedAt
      || hasSuccessfulCompareAfter(recentRuns, job && job.id, lastRun.at)) return [];
    return [{ id: job && job.id, name: job && job.name, message: lastRun.message, at: lastRun.at }];
  }));
}

function createInitialTrayActivity(now = new Date()) {
  return {
    schemaVersion: 1,
    status: 'idle',
    schedulerPaused: false,
    conflictWarnings: [],
    active: null,
    queue: [],
    updatedAt: cleanDate(now) || new Date().toISOString()
  };
}

function mergeTrayActivity(current, patch = {}, now = new Date()) {
  const previous = current && typeof current === 'object'
    ? current
    : createInitialTrayActivity(now);
  const next = patch && typeof patch === 'object' ? patch : {};
  const hasActive = Object.prototype.hasOwnProperty.call(next, 'active');
  const hasQueue = Object.prototype.hasOwnProperty.call(next, 'queue');
  const hasConflictWarnings = Object.prototype.hasOwnProperty.call(next, 'conflictWarnings');
  const requestedStatus = cleanText(next.status, previous.status, 40).toLowerCase();
  const status = ACTIVITY_STATUSES.has(requestedStatus) ? requestedStatus : 'idle';

  let active = previous.active || null;
  if (hasActive) {
    if (next.active === null) {
      active = null;
    } else {
      const previousProgress = active && active.progress ? active.progress : {};
      const nextProgress = next.active && next.active.progress ? next.active.progress : {};
      active = normalizeTask({
        ...(active || {}),
        ...(next.active || {}),
        progress: { ...previousProgress, ...nextProgress }
      });
    }
  }

  return {
    schemaVersion: 1,
    status,
    schedulerPaused: Object.prototype.hasOwnProperty.call(next, 'schedulerPaused')
      ? next.schedulerPaused === true
      : previous.schedulerPaused === true,
    conflictWarnings: hasConflictWarnings
      ? normalizeConflictWarnings(next.conflictWarnings)
      : normalizeConflictWarnings(previous.conflictWarnings),
    active,
    queue: hasQueue ? normalizeQueue(next.queue) : normalizeQueue(previous.queue),
    updatedAt: cleanDate(next.updatedAt || now) || new Date().toISOString()
  };
}

function getTrayVisualState(activity) {
  const status = activity && activity.status;
  if (status === 'running') return 'syncing';
  if (status === 'cancelled') return 'warning';
  return ACTIVITY_STATUSES.has(status) ? status : 'idle';
}

module.exports = {
  createInitialTrayActivity,
  mergeTrayActivity,
  normalizeProgress,
  getScheduledConflictWarnings,
  getTrayVisualState
};
