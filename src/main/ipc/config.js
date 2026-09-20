// Config load + save. These are the two channels the renderer uses to read
// and mutate the on-disk app configuration. Save has non-trivial merge logic
// for backward compatibility with the single-job (`config.job`) shape — that
// lived here in main.js for years, kept intact here.

const { sanitizeJobId, normalizeSchedule } = require('../job-model');

// The scheduler owns schedule.nextRunAt / schedule.lastRun — it advances them
// after every run. The renderer, however, round-trips whatever schedule it last
// loaded and config:save replaces the whole jobs array, so a save carrying a
// stale nextRunAt silently reverts the scheduler's advance. The job then looks
// due again and re-runs on the next tick — the "scheduled task loops forever"
// bug. Re-read the on-disk bookkeeping here and keep it: the renderer owns the
// schedule *config* (enabled/frequency/time/days/mode/interval), never the
// runtime timestamps. Only when the user actually changes the timing config do
// we drop nextRunAt (null) so the scheduler recomputes it on the next tick.
function scheduleTimingKey(schedule) {
  const s = normalizeSchedule(schedule);
  return JSON.stringify([s.enabled, s.mode, s.frequency, s.intervalValue, s.intervalUnit, s.time, s.days]);
}

function preserveSchedulerState(nextJobs, currentJobs) {
  if (!Array.isArray(nextJobs)) return nextJobs;
  const byId = new Map((currentJobs || []).map((job) => [sanitizeJobId(job.id), job]));
  return nextJobs.map((job) => {
    const current = byId.get(sanitizeJobId(job && job.id));
    if (!current) return job; // new job — scheduler arms it on the next tick
    const currentSchedule = normalizeSchedule(current.schedule);
    const nextSchedule = normalizeSchedule(job && job.schedule);
    const timingChanged = scheduleTimingKey(currentSchedule) !== scheduleTimingKey(nextSchedule);
    return {
      ...job,
      schedule: {
        ...nextSchedule,
        lastRun: currentSchedule.lastRun,
        nextRunAt: timingChanged ? null : currentSchedule.nextRunAt
      }
    };
  });
}

function register(ipcMain, deps) {
  const { readConfig, writeConfig, refreshBackgroundScheduler, refreshSmartWatcher, redactTelegramSettings } = deps;
  // M1: the renderer never receives the Telegram token — configs crossing the
  // IPC boundary are redacted to a botTokenConfigured boolean.
  const redact = typeof redactTelegramSettings === 'function' ? redactTelegramSettings : (config) => config;

  ipcMain.handle('config:load', async () => redact(await readConfig()));

  ipcMain.handle('config:save', async (_event, nextConfig) => {
    const current = await readConfig();
    const merged = {
      ...current,
      ...nextConfig,
      job: {
        ...current.job,
        ...(nextConfig.job || {})
      }
    };

    // M1: post-redaction the renderer round-trips an EMPTY botToken inside
    // every save. Empty means "keep the stored token"; only a non-empty value
    // replaces it. Without this, the first unrelated settings save would
    // silently wipe the token.
    if (merged.telegramSettings && !String(merged.telegramSettings.botToken || '').trim()) {
      const storedToken = current.telegramSettings && current.telegramSettings.botToken;
      if (storedToken) {
        merged.telegramSettings = { ...merged.telegramSettings, botToken: storedToken };
      }
    }

    if (nextConfig.activeJobId) {
      merged.activeJobId = sanitizeJobId(nextConfig.activeJobId);
    }

    if (Array.isArray(nextConfig.jobs)) {
      merged.jobs = nextConfig.jobs;
    } else if (nextConfig.job) {
      const activeJobId = merged.activeJobId || current.activeJobId || current.job.id;
      const currentJobs = Array.isArray(current.jobs) ? current.jobs : [current.job];
      merged.jobs = currentJobs.map((job) => (
        job.id === activeJobId ? { ...job, ...merged.job, id: activeJobId } : job
      ));

      if (!merged.jobs.some((job) => job.id === activeJobId)) {
        merged.jobs.push({ ...merged.job, id: activeJobId });
      }
    }

    // Never let a renderer save clobber the scheduler's runtime bookkeeping.
    merged.jobs = preserveSchedulerState(merged.jobs, current.jobs);

    const saved = await writeConfig(merged);
    if (refreshBackgroundScheduler) refreshBackgroundScheduler().catch(() => {});
    if (refreshSmartWatcher) refreshSmartWatcher().catch(() => {});
    return redact(saved);
  });
}

module.exports = { register };
