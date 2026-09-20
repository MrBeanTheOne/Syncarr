const fs = require('fs');
const path = require('path');
const {
  normalizeJob,
  normalizeSourcePaths,
  normalizeWatchSettings,
  sanitizeJobId
} = require('./job-model');
// Exclude matching is shared with the rest of the engine — see fs-utils so the
// watcher and the sync planner skip the exact same paths.
const { makeExcludeMatcher } = require('./fs-utils');

const MAX_REPORTED_PATHS = 100;
// Cap on how many extra settle windows a watched run may wait past its max-wait
// deadline while the source is still being written. Bounds the postponement so a
// source that never quiesces still eventually syncs (anti-starvation).
const MAX_WAIT_EXTENSIONS = 6;

function createSmartWatcher({
  readConfig,
  runJob,
  isBusy = () => false,
  onState = () => {},
  watchFn = fs.watch,
  now = () => new Date(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  busyRetryMs = 5_000,
  refreshRetryMs = 30_000
} = {}) {
  if (typeof readConfig !== 'function' || typeof runJob !== 'function') {
    throw new Error('Smart watcher requires config and run dependencies.');
  }

  const handles = new Map();
  const pending = new Map();
  const sourceStates = new Map();
  let refreshTimer = null;
  let running = false;
  let runningJobId = null;
  let stopped = true;
  let watchedJobs = [];
  let status = { enabledJobs: 0, watchedSources: 0, unavailableSources: 0 };

  function emit(state) {
    try { onState(state); } catch { /* Watch observers cannot interrupt file monitoring. */ }
  }

  function clearPending() {
    for (const entry of pending.values()) {
      if (entry.timer) clearTimeoutFn(entry.timer);
    }
    pending.clear();
  }

  function closeHandles() {
    for (const handle of handles.values()) {
      try { handle.close(); } catch { /* Already closed. */ }
    }
    handles.clear();
  }

  function buildStatus() {
    const jobs = watchedJobs.map((job) => {
      const jobId = sanitizeJobId(job.id);
      const sources = Array.from(sourceStates.values()).filter((source) => source.jobId === jobId);
      const pendingEntry = pending.get(jobId);
      return {
        id: jobId,
        name: job.name,
        mode: normalizeWatchSettings(job.watch).mode,
        watchedSources: sources.filter((source) => source.available).length,
        unavailableSources: sources.filter((source) => !source.available).length,
        pendingChanges: pendingEntry ? pendingEntry.eventCount : 0,
        dueAt: pendingEntry ? pendingEntry.dueAt : null,
        running: runningJobId === jobId
      };
    });

    return {
      enabledJobs: watchedJobs.length,
      watchedSources: Array.from(sourceStates.values()).filter((source) => source.available).length,
      unavailableSources: Array.from(sourceStates.values()).filter((source) => !source.available).length,
      jobs
    };
  }

  function publishStatus() {
    status = buildStatus();
    emit({ type: 'watching', ...status });
    return status;
  }

  function scheduleRefresh() {
    if (stopped || refreshTimer) return;
    refreshTimer = setTimeoutFn(() => {
      refreshTimer = null;
      refresh().catch((error) => emit({ type: 'error', message: error.message || String(error) }));
    }, refreshRetryMs);
  }

  function armPending(jobId, delayMs = null) {
    const entry = pending.get(jobId);
    if (!entry || stopped) return;
    if (entry.timer) clearTimeoutFn(entry.timer);
    const watch = normalizeWatchSettings(entry.job.watch);
    const elapsed = Math.max(0, now().getTime() - entry.firstAt);
    const remainingMax = Math.max(0, watch.maxWaitSeconds * 1000 - elapsed);
    const waitMs = delayMs === null
      ? Math.max(0, Math.min(watch.settleSeconds * 1000, remainingMax))
      : Math.max(1, Number(delayMs) || 1);
    entry.dueAt = new Date(now().getTime() + waitMs).toISOString();
    entry.timer = setTimeoutFn(() => {
      entry.timer = null;
      attemptRun(jobId).catch((error) => emit({ type: 'error', jobId, message: error.message || String(error) }));
    }, waitMs);
  }

  function recordChange(job, sourcePath, eventType, filename, shouldExclude) {
    if (stopped) return;
    const relativePath = filename === null || filename === undefined
      ? ''
      : String(Buffer.isBuffer(filename) ? filename.toString() : filename);
    const isExcluded = shouldExclude || makeExcludeMatcher(job.excludePatterns || []);
    if (relativePath && isExcluded(relativePath)) return;

    const jobId = sanitizeJobId(job.id);
    const timestamp = now().getTime();
    let entry = pending.get(jobId);
    if (!entry) {
      entry = {
        job,
        firstAt: timestamp,
        lastAt: timestamp,
        paths: new Set(),
        eventCount: 0,
        timer: null,
        dueAt: null,
        maxWaitExtensions: 0
      };
      pending.set(jobId, entry);
    }
    entry.job = job;
    entry.lastAt = timestamp;
    entry.eventCount += 1;
    if (entry.paths.size < MAX_REPORTED_PATHS) {
      entry.paths.add(relativePath ? path.join(sourcePath, relativePath) : sourcePath);
    }
    armPending(jobId);
    emit({
      type: 'change',
      jobId,
      jobName: job.name,
      eventType,
      path: relativePath,
      changeCount: entry.eventCount,
      dueAt: entry.dueAt
    });
  }

  async function attemptRun(jobId) {
    const entry = pending.get(jobId);
    if (!entry || stopped) return;
    if (running || isBusy()) {
      armPending(jobId, busyRetryMs);
      emit({ type: 'waiting', jobId, jobName: entry.job.name, reason: 'busy', dueAt: entry.dueAt });
      return;
    }

    // The max-wait cap can fire this timer while the source is STILL being
    // written (change events arriving faster than the settle window keep the due
    // time pinned at the cap). Launching then would sync a half-written tree. If
    // the source has NOT been quiet for a full settle window, grant a bounded
    // quiescence tail — a fresh settle window that is not subject to the cap —
    // rather than firing mid-write. MAX_WAIT_EXTENSIONS bounds this so a source
    // that never settles still eventually runs (the anti-starvation guarantee).
    const watch = normalizeWatchSettings(entry.job.watch);
    const idleMs = now().getTime() - entry.lastAt;
    if (idleMs < watch.settleSeconds * 1000 && (entry.maxWaitExtensions || 0) < MAX_WAIT_EXTENSIONS) {
      entry.maxWaitExtensions = (entry.maxWaitExtensions || 0) + 1;
      armPending(jobId, watch.settleSeconds * 1000);
      emit({ type: 'waiting', jobId, jobName: entry.job.name, reason: 'settling', dueAt: entry.dueAt });
      return;
    }

    // Claim the run lock synchronously, BEFORE the first await. Otherwise the
    // scheduler tick (or a second watcher fire) can pass its own busy check
    // during `await readConfig()` — while `running` is still false — and launch a
    // second sync against the same destination. The finally resets the lock on
    // every exit path (job removed, disabled, or run completed).
    running = true;
    runningJobId = jobId;
    try {
      const config = await readConfig();
      const rawJob = (config.jobs || []).find((job) => sanitizeJobId(job.id) === jobId);
      if (!rawJob) {
        pending.delete(jobId);
        return;
      }
      const job = normalizeJob(rawJob, jobId);
      const watch = normalizeWatchSettings(job.watch);
      if (job.enabled === false || !watch.enabled || !normalizeSourcePaths(job.sourcePaths).length) {
        pending.delete(jobId);
        return;
      }

      pending.delete(jobId);
      const task = {
        job,
        watch,
        schedule: { mode: watch.mode },
        dueAt: now(),
        reason: 'watch',
        stats: { changes: entry.eventCount, copyBytes: 0 },
        changes: {
          count: entry.eventCount,
          paths: Array.from(entry.paths),
          firstAt: new Date(entry.firstAt).toISOString(),
          lastAt: new Date(entry.lastAt).toISOString()
        }
      };

      emit({ type: 'start', task, queue: [], forced: false });
      let result;
      try {
        result = await runJob({
          ...task,
          onEvent: (event) => emit({ type: 'event', task, event, queue: [] })
        });
      } catch (error) {
        result = { ok: false, status: 'error', message: error.message || String(error), code: null };
      }
      emit({ type: 'complete', task, result, queue: [], forced: false });
      if (pending.has(jobId)) armPending(jobId);
    } finally {
      running = false;
      runningJobId = null;
    }
  }

  async function refresh(configInput = null) {
    if (stopped) return status;
    if (refreshTimer) clearTimeoutFn(refreshTimer);
    refreshTimer = null;

    const config = configInput || await readConfig();
    if (stopped) return status;
    const jobs = (config.jobs || [])
      .map((job, index) => normalizeJob(job, `job-${index + 1}`))
      .filter((job) => job.enabled !== false && normalizeWatchSettings(job.watch).enabled);

    closeHandles();
    sourceStates.clear();
    watchedJobs = jobs;

    const jobsById = new Map(jobs.map((job) => [sanitizeJobId(job.id), job]));
    for (const [jobId, entry] of pending.entries()) {
      const job = jobsById.get(jobId);
      if (!job || !normalizeSourcePaths(job.sourcePaths).length) {
        if (entry.timer) clearTimeoutFn(entry.timer);
        pending.delete(jobId);
      } else {
        entry.job = job;
        if (!entry.timer) armPending(jobId);
      }
    }

    for (const job of jobs) {
      const sources = normalizeSourcePaths(job.sourcePaths && job.sourcePaths.length ? job.sourcePaths : job.sourcePath);
      const shouldExclude = makeExcludeMatcher(job.excludePatterns || []);
      for (const sourcePath of sources) {
        const key = `${sanitizeJobId(job.id)}:${sourcePath}`;
        const sourceState = {
          jobId: sanitizeJobId(job.id),
          jobName: job.name,
          sourcePath,
          available: false,
          message: ''
        };
        sourceStates.set(key, sourceState);
        try {
          const handle = watchFn(sourcePath, { recursive: job.copySubfolders !== false, persistent: false }, (eventType, filename) => {
            recordChange(job, sourcePath, eventType, filename, shouldExclude);
          });
          sourceState.available = true;
          if (handle && typeof handle.on === 'function') {
            handle.on('error', (error) => {
              try { handle.close(); } catch { /* Already closed. */ }
              handles.delete(key);
              sourceState.available = false;
              sourceState.message = error.message || String(error);
              emit({ type: 'error', jobId: job.id, jobName: job.name, sourcePath, message: error.message || String(error) });
              publishStatus();
              scheduleRefresh();
            });
          }
          handles.set(key, handle);
        } catch (error) {
          sourceState.message = error.message || String(error);
          emit({ type: 'error', jobId: job.id, jobName: job.name, sourcePath, message: error.message || String(error) });
        }
      }
    }

    status = publishStatus();
    if (status.unavailableSources > 0) scheduleRefresh();
    return status;
  }

  async function start() {
    if (!stopped) return status;
    stopped = false;
    return refresh();
  }

  function stop() {
    stopped = true;
    if (refreshTimer) clearTimeoutFn(refreshTimer);
    refreshTimer = null;
    closeHandles();
    clearPending();
    sourceStates.clear();
    watchedJobs = [];
    status = { enabledJobs: 0, watchedSources: 0, unavailableSources: 0, jobs: [] };
  }

  return {
    start,
    stop,
    refresh,
    isRunning: () => running,
    getStatus: () => buildStatus()
  };
}

module.exports = {
  createSmartWatcher,
  // Re-exported under its historical name for tests/back-compat; the
  // implementation now lives in fs-utils so all exclude matching stays in sync.
  makeWatchExcludeMatcher: makeExcludeMatcher
};
