const { normalizeSchedule, sanitizeJobId, RUN_STATUS } = require('./job-model');
const {
  computeNextRunAt,
  selectSchedulerRunTasks,
  sortScheduledQueue,
  getScheduledTaskStats
} = require('./scheduler-policy');

function createBackgroundScheduler({
  readConfig,
  writeConfig,
  runJob,
  isBusy = () => false,
  onState = () => {},
  now = () => new Date(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  tickIntervalMs = 30_000,
  initialDelayMs = 1_200
} = {}) {
  if (typeof readConfig !== 'function' || typeof writeConfig !== 'function' || typeof runJob !== 'function') {
    throw new Error('Background scheduler requires config and run dependencies.');
  }

  const startupRunKeys = new Set();
  let intervalTimer = null;
  let initialTimer = null;
  let running = false;

  function scheduleKey(job, schedule) {
    return `${sanitizeJobId(job && job.id)}:${schedule.mode}:${schedule.frequency}:${schedule.intervalValue}:${schedule.intervalUnit}:${schedule.time}:${schedule.days.join(',')}`;
  }

  function buildTask(job, schedule, dueAt, jobIndex, reason = 'scheduled', config = {}) {
    return {
      job,
      schedule,
      dueAt,
      jobIndex,
      reason,
      stats: getScheduledTaskStats(config, job)
    };
  }

  function collectTasks(config, referenceDate, { initialize = false } = {}) {
    const dueTasks = [];
    const futureTasks = [];
    const jobs = Array.isArray(config.jobs) ? config.jobs : [];
    let changed = false;

    jobs.forEach((job, jobIndex) => {
      if (!job || job.enabled === false) return;
      const schedule = normalizeSchedule(job.schedule);
      if (!schedule.enabled) return;

      if (schedule.frequency === 'startup') {
        if (!startupRunKeys.has(scheduleKey(job, schedule))) {
          dueTasks.push(buildTask(job, schedule, referenceDate, jobIndex, 'startup', config));
        }
        return;
      }

      let nextRunAt = schedule.nextRunAt ? new Date(schedule.nextRunAt) : null;
      if (!nextRunAt || Number.isNaN(nextRunAt.getTime())) {
        nextRunAt = computeNextRunAt(schedule, referenceDate);
        if (initialize) {
          job.schedule = { ...schedule, nextRunAt: nextRunAt.toISOString() };
          changed = true;
        }
      }

      const task = buildTask(job, schedule, nextRunAt, jobIndex, 'scheduled', config);
      if (nextRunAt <= referenceDate) dueTasks.push(task);
      else futureTasks.push(task);
    });

    return { dueTasks, futureTasks, changed };
  }

  async function publishQueue(configInput = null) {
    const config = configInput || await readConfig();
    const referenceDate = now();
    const { dueTasks, futureTasks } = collectTasks(config, referenceDate);
    const priority = config.appSettings && config.appSettings.schedulerQueuePriority;
    const tasks = sortScheduledQueue([...dueTasks, ...futureTasks], priority, config);
    const paused = config.backgroundSettings && config.backgroundSettings.schedulerPaused === true;
    onState({ type: paused ? 'paused' : 'queue', tasks, recentRuns: config.lastRuns || [], running });
    return tasks;
  }

  async function saveScheduleResult(task, result, referenceDate) {
    const latest = await readConfig();
    const jobs = (latest.jobs || []).map((job) => {
      if (sanitizeJobId(job.id) !== sanitizeJobId(task.job.id)) return job;
      const schedule = normalizeSchedule(job.schedule);
      schedule.lastRun = {
        at: referenceDate.toISOString(),
        ok: result && result.ok === true,
        status: result ? (result.status || (result.ok ? 'success' : 'error')) : 'error',
        message: result && result.message || '',
        action: schedule.mode === 'sync' ? 'sync' : 'compare',
        reason: task.reason,
        code: result && result.code !== undefined ? result.code : null
      };
      schedule.nextRunAt = schedule.frequency === 'startup'
        ? null
        : computeNextRunAt(schedule, referenceDate).toISOString();
      return { ...job, schedule };
    });
    return writeConfig({ ...latest, jobs });
  }

  async function tick({ forceNext = false } = {}) {
    if (running || isBusy()) return { ok: false, status: 'busy', tasksRun: 0 };
    running = true;
    let tasksRun = 0;
    try {
      let config = await readConfig();
      const referenceDate = now();
      const collected = collectTasks(config, referenceDate, { initialize: true });
      if (collected.changed) config = await writeConfig(config);

      const paused = config.backgroundSettings && config.backgroundSettings.schedulerPaused === true;
      if (paused && !forceNext) {
        const priority = config.appSettings && config.appSettings.schedulerQueuePriority;
        const tasks = sortScheduledQueue([...collected.dueTasks, ...collected.futureTasks], priority, config);
        onState({ type: 'paused', tasks, recentRuns: config.lastRuns || [], running });
        return { ok: true, status: 'paused', forced: false, tasksRun: 0 };
      }

      const selection = selectSchedulerRunTasks({
        dueTasks: collected.dueTasks,
        futureTasks: collected.futureTasks,
        forceNext
      });
      if (!selection.tasks.length) {
        await publishQueue(config);
        return { ok: true, status: 'idle', forced: false, tasksRun: 0 };
      }

      const priority = config.appSettings && config.appSettings.schedulerQueuePriority;
      const orderedTasks = sortScheduledQueue(selection.tasks, priority, config);
      // Future-scheduled tasks aren't run this tick, but they are still pending
      // and must keep showing in the tray while a task runs. The `start` /
      // `event` / `complete` queue therefore carries the remaining due tasks
      // *plus* these futures; otherwise the tray would blank the pending list
      // for the duration of the run and only repopulate it on the final
      // publishQueue, which reads as pending tasks vanishing and reappearing.
      const selectedIds = new Set(orderedTasks.map((task) => sanitizeJobId(task.job && task.job.id)));
      const futurePending = collected.futureTasks.filter(
        (task) => !selectedIds.has(sanitizeJobId(task.job && task.job.id))
      );
      for (let index = 0; index < orderedTasks.length; index += 1) {
        if (isBusy()) break;
        const task = orderedTasks[index];
        if (task.schedule.frequency === 'startup') startupRunKeys.add(scheduleKey(task.job, task.schedule));
        const remaining = orderedTasks.slice(index + 1);
        const pending = sortScheduledQueue([...remaining, ...futurePending], priority, config);
        onState({ type: 'start', task, queue: pending, forced: selection.forced });

        let result;
        try {
          result = await runJob({
            ...task,
            forced: selection.forced,
            onEvent: (event) => onState({ type: 'event', task, event, queue: pending })
          });
        } catch (error) {
          result = { ok: false, status: 'error', message: error && error.message ? error.message : String(error), code: null };
        }

        if (result && result.status === RUN_STATUS.BUSY) break;
        tasksRun += 1;
        config = await saveScheduleResult(task, result, now());
        onState({ type: 'complete', task, result, queue: pending, forced: selection.forced });
      }

      await publishQueue(config);
      return { ok: true, status: 'complete', forced: selection.forced, tasksRun };
    } finally {
      running = false;
    }
  }

  function reportError(error) {
    onState({ type: 'error', message: error && error.message ? error.message : String(error) });
  }

  function start() {
    if (intervalTimer) return;
    // Surface tick failures instead of swallowing them. tick() resets `running`
    // in its finally so the loop recovers, but a persistently throwing tick
    // (e.g. readConfig rejecting on a locked/corrupt config) would otherwise stop
    // scheduled backups silently — no error event, no log. Emit an error state
    // the way the watcher does so the tray/UI can show that scheduling stalled.
    const runTick = () => tick().catch(reportError);
    intervalTimer = setIntervalFn(runTick, tickIntervalMs);
    initialTimer = setTimeoutFn(runTick, initialDelayMs);
    publishQueue().catch(reportError);
  }

  function stop() {
    if (intervalTimer) clearIntervalFn(intervalTimer);
    if (initialTimer) clearTimeoutFn(initialTimer);
    intervalTimer = null;
    initialTimer = null;
  }

  return {
    start,
    stop,
    tick,
    runNext: () => tick({ forceNext: true }),
    refresh: () => publishQueue(),
    isRunning: () => running
  };
}

module.exports = { createBackgroundScheduler };
