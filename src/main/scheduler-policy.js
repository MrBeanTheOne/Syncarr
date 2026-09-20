const { normalizeSchedule, sanitizeJobId, DEFAULT_JOB_ID } = require('./job-model');

const WEEKDAY_ORDER = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function computeNextRunAt(scheduleInput, from = new Date()) {
  const schedule = normalizeSchedule(scheduleInput);
  const reference = new Date(from);
  const start = new Date(reference);
  start.setSeconds(0, 0);

  if (schedule.frequency === 'startup') return new Date(start.getTime() + 1000);

  if (schedule.frequency === 'interval') {
    const amount = schedule.intervalValue * (schedule.intervalUnit === 'minutes' ? 60_000 : 3_600_000);
    return new Date(start.getTime() + amount);
  }

  const [hour, minute] = schedule.time.split(':').map((part) => Number(part));
  if (schedule.frequency === 'daily') {
    const candidate = new Date(start);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate <= reference) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }

  const wantedDays = schedule.days.length ? schedule.days : ['MO'];
  for (let offset = 0; offset <= 14; offset += 1) {
    const candidate = new Date(start);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    if (wantedDays.includes(WEEKDAY_ORDER[candidate.getDay()]) && candidate > reference) return candidate;
  }

  const fallback = new Date(start);
  fallback.setDate(fallback.getDate() + 7);
  fallback.setHours(hour, minute, 0, 0);
  return fallback;
}

function taskTime(task) {
  const date = task && task.dueAt instanceof Date ? task.dueAt : new Date(task && task.dueAt);
  const time = date.getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function pickNextScheduledTask(tasks) {
  const candidates = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => taskTime(a) - taskTime(b) || Number(a.jobIndex || 0) - Number(b.jobIndex || 0))[0] || null;
}

function selectSchedulerRunTasks({ dueTasks = [], futureTasks = [], forceNext = false } = {}) {
  if (dueTasks.length) return { tasks: [...dueTasks], forced: false };
  if (!forceNext) return { tasks: [], forced: false };
  const nextTask = pickNextScheduledTask(futureTasks);
  return nextTask
    ? { tasks: [{ ...nextTask, reason: 'manual-scheduled' }], forced: true }
    : { tasks: [], forced: false };
}

function getSummaryQueueStats(summary) {
  if (!summary || typeof summary !== 'object') return { changes: 0, copyBytes: 0 };
  const changes = Number(summary.previewFiles ?? summary.wouldCopy ?? 0)
    || (Number(summary.wouldCopy || 0) + Number(summary.wouldArchive || 0) + Number(summary.conflicts || 0));
  const copyBytes = Number(summary.copyBytes ?? summary.estimatedWriteBytes ?? 0) || 0;
  return { changes, copyBytes };
}

function getScheduledTaskStats(config, job) {
  const jobId = sanitizeJobId(job && job.id);
  const pending = config && config.pendingCompares && config.pendingCompares[jobId];
  const pendingSummary = pending && pending.result && pending.result.summary;
  if (pendingSummary) return getSummaryQueueStats(pendingSummary);
  const run = Array.isArray(config && config.lastRuns)
    ? config.lastRuns.find((item) => sanitizeJobId(item.jobId || DEFAULT_JOB_ID) === jobId)
    : null;
  return getSummaryQueueStats(run && (run.summary || run.history));
}

function sortScheduledQueue(tasks, priority = 'scheduledTime', config = {}) {
  const decorated = (Array.isArray(tasks) ? tasks : []).map((task) => ({
    ...task,
    stats: task.stats || getScheduledTaskStats(config, task.job),
    isSync: normalizeSchedule(task.schedule).mode === 'sync'
  }));

  decorated.sort((a, b) => {
    if (priority === 'syncFirst' && a.isSync !== b.isSync) return a.isSync ? -1 : 1;
    if (priority === 'mostChanges' && b.stats.changes !== a.stats.changes) return b.stats.changes - a.stats.changes;
    if (priority === 'largestCopy' && b.stats.copyBytes !== a.stats.copyBytes) return b.stats.copyBytes - a.stats.copyBytes;
    if (priority === 'smallestCopy' && a.stats.copyBytes !== b.stats.copyBytes) return a.stats.copyBytes - b.stats.copyBytes;
    return taskTime(a) - taskTime(b) || Number(a.jobIndex || 0) - Number(b.jobIndex || 0);
  });
  return decorated;
}

// Pre-run warning dedupe keys are `${jobId}:${dueMs}`. Once a task's due time
// has passed, its key can never match again (the key embeds the absolute due
// timestamp), so past-due keys are pure garbage — prune them on every warning
// pass to keep the long-lived process's Set from growing forever (audit M10).
// Future-dated keys must be kept: they are the active dedupe entries.
function pruneWarnedScheduleKeys(keys, nowMs) {
  if (!keys || typeof keys.delete !== 'function') return keys;
  for (const key of [...keys]) {
    const dueMs = Number(String(key).slice(String(key).lastIndexOf(':') + 1));
    if (!Number.isFinite(dueMs) || dueMs <= nowMs) keys.delete(key);
  }
  return keys;
}

module.exports = {
  computeNextRunAt,
  pickNextScheduledTask,
  selectSchedulerRunTasks,
  getScheduledTaskStats,
  sortScheduledQueue,
  pruneWarnedScheduleKeys
};
