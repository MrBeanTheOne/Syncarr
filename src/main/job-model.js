const path = require('path');
const { normalizeTelegramSettings } = require('../services/telegram');
const { pathIdentityKey } = require('./platform');

const HISTORY_FOLDER_NAME = '.syncarr-history';
// FreeFileSync artifacts (.ffs_db database, .ffs_lock sync lock, .ffs_tmp
// in-flight temp files) and similar sync-tool droppings are never user content.
// They must never be copied, mirrored, or flagged as two-way changes, so they
// are excluded for every job. withHistoryExclude() merges this list into the
// effective excludes on every compare/sync, so existing jobs get them too
// without editing their saved exclude list.
const DEFAULT_EXCLUDE_PATTERNS = ['node_modules', '.git', 'Thumbs.db', '.DS_Store', '*.ffs_db', '*.ffs_lock', '*.ffs_tmp', HISTORY_FOLDER_NAME];
const DEFAULT_JOB_ID = 'job-default';
const PATH_CHECK_TIMEOUT_MS = 2500;
const ROBOCOPY_COMPARE_TIMEOUT_MS = 60000;
const SUPPORTED_SYNC_MODES = new Set(['oneWay', 'mirror', 'twoWay']);
const COMPARE_SYNC_MODES = new Set(['oneWay', 'mirror', 'twoWay']);
const RUNNABLE_SYNC_MODES = new Set(['oneWay', 'mirror', 'twoWay']);
const TWO_WAY_CONFLICT_POLICIES = new Set(['newer', 'source', 'dest', 'keepBoth']);
const WATCH_MODES = new Set(['compare', 'sync']);
const DEFAULT_WATCH_SETTINGS = {
  enabled: false,
  mode: 'compare',
  settleSeconds: 10,
  maxWaitSeconds: 120
};
const DEFAULT_APP_SETTINGS = {
  schedulerQueuePriority: 'scheduledTime',
  skipManualApplyWarningByMode: {}
};
const SCHEDULER_QUEUE_PRIORITIES = new Set(['scheduledTime', 'syncFirst', 'mostChanges', 'largestCopy', 'smallestCopy']);

// Authoritative run/compare result-status vocabulary. Engines, the orchestrator,
// two-way sync, the scheduler, and the IPC handlers all set `result.status` to
// one of these values and consumers compare against them — centralizing the
// strings here keeps a producer and a consumer from silently drifting apart
// (the exact bug class that "compare vs sync diverging" came from). The renderer
// cannot import this module, so it mirrors the failure/cancelled subset by hand
// (see FAILURE_RUN_STATUSES / isCancelledRun in src/renderer/app.js). The
// auto-updater `app:update` payload statuses (checking/available/downloading/…)
// are a SEPARATE vocabulary and are intentionally NOT modeled here.
const RUN_STATUS = Object.freeze({
  NO_CHANGE: 'no-change',
  SUCCESS: 'success',
  WARNING: 'warning',
  FAILED: 'failed',
  ERROR: 'error',
  FATAL: 'fatal',
  CANCELLED: 'cancelled',
  CONFLICTS: 'conflicts',
  SPACE: 'space',
  BUSY: 'busy',
  DISABLED: 'disabled',
  UNSUPPORTED_SYNC_MODE: 'unsupported-sync-mode',
  REQUIRED_DESTINATION_MISSING: 'required-destination-missing',
  NO_DESTINATION_AVAILABLE: 'no-destination-available',
  SKIPPED_NO_CHANGE: 'skipped-no-change',
  ARCHIVED: 'archived',
  PREPARED: 'prepared',
  COMPLETE: 'complete',
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused'
});

// Shared message strings. NO_CHANGE_MESSAGE accompanies a RUN_STATUS.NO_CHANGE
// result from both engines and the no-change reconciler. BUSY_MESSAGE is the one
// wording every "another operation is already running" rejection should use.
const NO_CHANGE_MESSAGE = 'No files needed to be copied.';
const BUSY_MESSAGE = 'Another compare, sync, restore, or cleanup is already running.';

// Shared numeric tuning constants (one home each; imported where used).
//   PREVIEW_FILE_LIMIT     — max per-run preview rows kept before truncating.
//   FILE_MTIME_TOLERANCE_MS — FAT/SMB timestamp slop for "same file" comparison.
const PREVIEW_FILE_LIMIT = 1000;
const FILE_MTIME_TOLERANCE_MS = 2100;

function normalizeConfig(config) {
  const rawJobs = Array.isArray(config.jobs) && config.jobs.length
    ? config.jobs
    : [{ id: config.activeJobId || (config.job && config.job.id) || DEFAULT_JOB_ID, ...(config.job || {}) }];

  let jobs = rawJobs.map((item, index) => normalizeJob(item, index === 0 ? DEFAULT_JOB_ID : `job-${index + 1}`));
  jobs = ensureUniqueJobIds(jobs);

  let activeJobId = sanitizeJobId(config.activeJobId || (config.job && config.job.id) || jobs[0].id);
  if (!jobs.some((item) => item.id === activeJobId)) activeJobId = jobs[0].id;

  const job = jobs.find((item) => item.id === activeJobId) || jobs[0];

  return {
    ...config,
    activeJobId,
    job,
    jobs,
    lastRuns: Array.isArray(config.lastRuns) ? config.lastRuns : [],
    pendingCompares: config.pendingCompares && typeof config.pendingCompares === 'object' ? config.pendingCompares : {},
    appSettings: normalizeAppSettings(config.appSettings),
    backgroundSettings: normalizeBackgroundSettings(config.backgroundSettings),
    telegramSettings: normalizeTelegramSettings(config.telegramSettings)
  };
}

function normalizeBackgroundSettings(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    startAtLogin: raw.startAtLogin === true,
    closeToTray: raw.closeToTray !== false,
    startMinimized: raw.startMinimized === true,
    autoCheckUpdates: raw.autoCheckUpdates !== false,
    desktopNotifications: raw.desktopNotifications !== false,
    notifyBeforeScheduledRun: raw.notifyBeforeScheduledRun !== false,
    schedulerPaused: raw.schedulerPaused === true
  };
}


function normalizeAppSettings(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const priority = String(raw.schedulerQueuePriority || DEFAULT_APP_SETTINGS.schedulerQueuePriority);
  const rawSkipMap = raw.skipManualApplyWarningByMode && typeof raw.skipManualApplyWarningByMode === 'object'
    ? raw.skipManualApplyWarningByMode
    : {};
  const skipManualApplyWarningByMode = {};

  SUPPORTED_SYNC_MODES.forEach((mode) => {
    if (rawSkipMap[mode] === true) skipManualApplyWarningByMode[mode] = true;
  });

  return {
    ...DEFAULT_APP_SETTINGS,
    schedulerQueuePriority: SCHEDULER_QUEUE_PRIORITIES.has(priority) ? priority : DEFAULT_APP_SETTINGS.schedulerQueuePriority,
    skipManualApplyWarningByMode
  };
}

function normalizeJob(input, fallbackId = DEFAULT_JOB_ID) {
  const job = {
    id: fallbackId,
    name: 'Music to NAS',
    enabled: true,
    notificationsEnabled: false,
    syncMode: 'oneWay',
    twoWayConflictPolicy: 'newer',
    sourcePath: '',
    sourcePaths: [],
    targetPath: '',
    targetDestinations: [],
    excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
    skipOlderSource: true,
    copySubfolders: true,
    historyEnabled: true,
    historyFolderName: HISTORY_FOLDER_NAME,
    freeSpaceCheckEnabled: true,
    minimumFreeGb: 1,
    retentionEnabled: false,
    retentionMaxVersions: 10,
    retentionMaxAgeDays: 365,
    retentionKeepLatest: true,
    retentionPruneEmptyFolders: true,
    retentionPruneAfterSync: false,
    restorePointsEnabled: false,
    restorePointRetentionMax: 50,
    watch: DEFAULT_WATCH_SETTINGS,
    schedule: normalizeSchedule(),
    ...(input || {})
  };

  job.id = sanitizeJobId(job.id || fallbackId);
  job.schedule = normalizeSchedule(job.schedule);
  job.sourcePaths = normalizeSourcePaths(job.sourcePaths && job.sourcePaths.length ? job.sourcePaths : job.sourcePath);
  job.sourcePath = job.sourcePaths[0] || '';
  job.targetDestinations = normalizeTargetDestinations(job.targetDestinations, job.targetPath);
  job.targetPath = job.targetDestinations[0] ? job.targetDestinations[0].path : String(job.targetPath || '').trim();
  job.historyFolderName = sanitizeHistoryFolderName(job.historyFolderName);
  job.excludePatterns = withHistoryExclude(job.excludePatterns, job.historyFolderName);
  job.minimumFreeGb = clampNumber(job.minimumFreeGb, 0, 1024, 1);
  job.retentionMaxVersions = Math.max(1, Math.floor(clampNumber(job.retentionMaxVersions, 1, 999, 10)));
  job.retentionMaxAgeDays = Math.max(1, Math.floor(clampNumber(job.retentionMaxAgeDays, 1, 36500, 365)));
  job.enabled = job.enabled !== false;
  job.notificationsEnabled = job.notificationsEnabled === true;
  job.syncMode = normalizeSyncMode(job.syncMode);
  job.twoWayConflictPolicy = normalizeTwoWayConflictPolicy(job.twoWayConflictPolicy);
  job.retentionKeepLatest = job.retentionKeepLatest !== false;
  job.retentionPruneEmptyFolders = job.retentionPruneEmptyFolders !== false;
  job.restorePointsEnabled = job.restorePointsEnabled === true;
  job.restorePointRetentionMax = Math.max(1, Math.floor(clampNumber(job.restorePointRetentionMax, 1, 1000, 50)));
  job.watch = normalizeWatchSettings(job.watch);

  return job;
}

function normalizeWatchSettings(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const settleSeconds = Math.max(2, Math.floor(clampNumber(raw.settleSeconds, 2, 300, DEFAULT_WATCH_SETTINGS.settleSeconds)));
  const maxWaitSeconds = Math.max(
    settleSeconds,
    Math.floor(clampNumber(raw.maxWaitSeconds, settleSeconds, 1800, DEFAULT_WATCH_SETTINGS.maxWaitSeconds))
  );

  return {
    enabled: raw.enabled === true,
    mode: WATCH_MODES.has(raw.mode) ? raw.mode : DEFAULT_WATCH_SETTINGS.mode,
    settleSeconds,
    maxWaitSeconds
  };
}

function ensureUniqueJobIds(jobs) {
  const seen = new Set();

  return jobs.map((job, index) => {
    const fallbackId = index === 0 ? DEFAULT_JOB_ID : `job-${index + 1}`;
    const baseId = sanitizeJobId(job.id || fallbackId);
    let nextId = baseId;
    let suffix = 2;

    while (seen.has(nextId)) {
      nextId = `${baseId}-${suffix}`;
      suffix += 1;
    }

    seen.add(nextId);
    return { ...job, id: nextId };
  });
}

function sanitizeJobId(input) {
  const clean = String(input || '')
    .trim()
    .replace(/[^a-z0-9_-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return clean || DEFAULT_JOB_ID;
}

function normalizeSyncMode(input) {
  const clean = String(input || '').trim();
  return SUPPORTED_SYNC_MODES.has(clean) ? clean : 'oneWay';
}

function normalizeTwoWayConflictPolicy(input) {
  const clean = String(input || '').trim();
  return TWO_WAY_CONFLICT_POLICIES.has(clean) ? clean : 'newer';
}

function assertCompareModeRunnable(mode) {
  const clean = normalizeSyncMode(mode);
  if (COMPARE_SYNC_MODES.has(clean)) return null;
  return 'This sync mode is not available for Compare.';
}

function assertSyncModeRunnable(mode, options = {}) {
  const clean = normalizeSyncMode(mode);
  const label = clean === 'mirror' ? 'Mirror source to destination' : 'Two-way sync';

  if (clean === 'mirror') {
    return options && options.allowMirrorApply === true
      ? null
      : 'Mirror apply is available only from a confirmed manual run. Run Compare, review the delete candidates, then apply the plan manually.';
  }

  if (RUNNABLE_SYNC_MODES.has(clean)) return null;
  return `${label} can be compared in this build, but applying it is locked until the safety system is complete.`;
}


function makeCompareFingerprint(job) {
  const clean = {
    syncMode: normalizeSyncMode(job && job.syncMode),
    twoWayConflictPolicy: normalizeTwoWayConflictPolicy(job && job.twoWayConflictPolicy),
    sourcePaths: normalizeSourcePaths(job && (job.sourcePaths && job.sourcePaths.length ? job.sourcePaths : job.sourcePath)),
    targetPath: String((job && job.targetPath) || '').trim(),
    targetDestinations: normalizeTargetDestinations(job && job.targetDestinations, job && job.targetPath).map((destination) => ({ path: destination.path, required: destination.required !== false })),
    excludePatterns: Array.isArray(job && job.excludePatterns) ? job.excludePatterns : DEFAULT_EXCLUDE_PATTERNS,
    skipOlderSource: job && job.skipOlderSource !== false,
    copySubfolders: job && job.copySubfolders !== false,
    historyEnabled: job && job.historyEnabled !== false,
    historyFolderName: sanitizeHistoryFolderName((job && job.historyFolderName) || HISTORY_FOLDER_NAME),
    freeSpaceCheckEnabled: job && job.freeSpaceCheckEnabled !== false,
    minimumFreeGb: clampNumber(job && job.minimumFreeGb, 0, 1024, 1)
  };
  return stableStringify(clean);
}

// Normalize a sync/compare run REQUEST into the cleaned fields that
// runCompareOnly, executeSyncRun, runTwoWaySyncRun, and buildSyncPreview all
// derive identically (the source of the historical compare-vs-sync drift).
// Returns the superset; each caller destructures the subset it needs. Per-run
// values (runId, primaryTargetPath) are intentionally NOT computed here — the
// callers own those.
function parseRunRequest(request = {}) {
  const raw = request && typeof request === 'object' ? request : {};
  const cleanHistoryFolderName = sanitizeHistoryFolderName(raw.historyFolderName);
  return {
    jobId: sanitizeJobId(raw.id),
    jobName: String(raw.name || '').trim(),
    cleanSourcePaths: normalizeSourcePaths(raw.sourcePaths && raw.sourcePaths.length ? raw.sourcePaths : raw.sourcePath),
    cleanDestinations: normalizeTargetDestinations(raw.targetDestinations, raw.targetPath),
    cleanHistoryFolderName,
    cleanTwoWayConflictPolicy: normalizeTwoWayConflictPolicy(raw.twoWayConflictPolicy),
    cleanExcludePatterns: withHistoryExclude(Array.isArray(raw.excludePatterns) ? raw.excludePatterns : [], cleanHistoryFolderName)
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function makePendingCompare({ jobId, jobName, syncMode, sourcePaths, targetPath, targetDestinations, fingerprint, result, createdAt }) {
  return {
    jobId,
    jobName,
    syncMode: normalizeSyncMode(syncMode),
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : new Date().toISOString(),
    sourcePath: sourcePaths[0] || '',
    sourcePaths,
    targetPath,
    targetDestinations: normalizeTargetDestinations(targetDestinations, targetPath),
    fingerprint,
    result: {
      ok: result.ok === true,
      message: result.message || '',
      summary: result.history || null,
      files: Array.isArray(result.previewFiles) ? result.previewFiles : [],
      storage: result.storage || null
    }
  };
}

function normalizeSchedule(input = {}) {
  const allowedModes = new Set(['compare', 'sync']);
  const allowedFrequencies = new Set(['interval', 'daily', 'weekly', 'startup']);
  const allowedUnits = new Set(['minutes', 'hours']);
  const allowedDays = new Set(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);
  const raw = input && typeof input === 'object' ? input : {};
  const intervalValue = Math.max(1, Math.floor(clampNumber(raw.intervalValue, 1, 10000, 1)));
  const days = Array.isArray(raw.days)
    ? raw.days.map((day) => String(day || '').toUpperCase()).filter((day) => allowedDays.has(day))
    : ['MO'];

  return {
    enabled: raw.enabled === true,
    mode: allowedModes.has(raw.mode) ? raw.mode : 'compare',
    frequency: allowedFrequencies.has(raw.frequency) ? raw.frequency : 'daily',
    intervalValue,
    intervalUnit: allowedUnits.has(raw.intervalUnit) ? raw.intervalUnit : 'hours',
    time: sanitizeScheduleTime(raw.time),
    days: days.length ? Array.from(new Set(days)) : ['MO'],
    nextRunAt: raw.nextRunAt || null,
    lastRun: raw.lastRun && typeof raw.lastRun === 'object' ? raw.lastRun : null
  };
}

function sanitizeScheduleTime(input) {
  const value = String(input || '').trim();
  if (/^([01]?\d|2[0-3]):[0-5]\d$/.test(value)) {
    const [hour, minute] = value.split(':');
    return `${String(Number(hour)).padStart(2, '0')}:${minute}`;
  }
  return '02:00';
}


function normalizeSourcePaths(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || '').split(/\r?\n|\s*\|\s*/);
  const seen = new Set();
  const paths = [];

  for (const item of raw) {
    const clean = String(item || '').trim();
    if (!clean) continue;
    const key = pathIdentityKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(clean);
  }

  return paths;
}


function normalizeTargetDestinations(input, fallbackPath = '') {
  const raw = Array.isArray(input)
    ? input
    : [];
  const items = [];

  if (raw.length) {
    for (const item of raw) {
      if (typeof item === 'string') {
        items.push({ path: item, required: true });
      } else if (item && typeof item === 'object') {
        items.push({
          path: item.path || item.targetPath || '',
          required: item.required !== false,
          label: item.label || ''
        });
      }
    }
  }

  const fallback = String(fallbackPath || '').trim();
  if (!items.length && fallback) {
    items.push({ path: fallback, required: true, label: '' });
  }

  const seen = new Set();
  const destinations = [];

  for (const item of items) {
    const cleanPath = String(item.path || '').trim();
    if (!cleanPath) continue;
    const key = pathIdentityKey(cleanPath);
    if (seen.has(key)) continue;
    seen.add(key);
    destinations.push({
      path: cleanPath,
      required: item.required !== false,
      label: String(item.label || '').trim()
    });
  }

  return withUniqueDestinationLabels(destinations);
}

function normalizeHistoryLocations(input = {}) {
  const destinations = normalizeTargetDestinations(input.targetDestinations, input.targetPath);
  if (normalizeSyncMode(input.syncMode) !== 'twoWay') return destinations;

  const sourceLocations = normalizeSourcePaths(
    input.sourcePaths && input.sourcePaths.length ? input.sourcePaths : input.sourcePath
  ).map((sourcePath, index) => ({
    path: sourcePath,
    required: true,
    label: `Source ${index + 1} - ${path.basename(path.resolve(sourcePath)) || `Folder ${index + 1}`}`
  }));

  return normalizeTargetDestinations([...destinations, ...sourceLocations], '');
}

function withUniqueDestinationLabels(destinations) {
  const used = new Map();
  return destinations.map((destination, index) => {
    const label = dedupeLabel(
      sanitizeFolderLabel(destination.label || path.basename(path.resolve(destination.path)) || `Destination ${index + 1}`, `Destination ${index + 1}`, 'Destination'),
      used
    );
    return { ...destination, label };
  });
}

// Sanitize a user/derived folder name into a filesystem-safe display label.
// Shared by source-root and destination labelling (was sanitizeSourceLabel in
// main.js + sanitizeDestinationLabel here). defaultLabel is the last-resort
// value used only when both input and fallback are empty.
function sanitizeFolderLabel(input, fallback, defaultLabel = 'Folder') {
  const clean = String(input || fallback || defaultLabel)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[.\s]+$/g, '')
    .replace(/^-+|-+$/g, '');

  return clean || fallback || defaultLabel;
}

// Disambiguate a label against the ones already seen, appending -2, -3, … on a
// case-insensitive collision. Mutates `used` (Map of lowercased label -> count).
// Shared by buildSourceSyncRoots (main.js) and withUniqueDestinationLabels.
function dedupeLabel(label, used) {
  const baseKey = label.toLowerCase();
  const nextCount = (used.get(baseKey) || 0) + 1;
  used.set(baseKey, nextCount);
  return nextCount > 1 ? `${label}-${nextCount}` : label;
}



function withHistoryExclude(excludePatterns, historyFolderName) {
  const seen = new Set();
  const next = [];

  for (const pattern of [...DEFAULT_EXCLUDE_PATTERNS, ...(excludePatterns || []), historyFolderName]) {
    const clean = String(pattern || '').trim();
    const key = pathIdentityKey(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    next.push(clean);
  }

  return next;
}

function sanitizeHistoryFolderName(input) {
  const clean = String(input || HISTORY_FOLDER_NAME).trim();
  if (!clean || clean === '.' || clean === '..' || clean.includes('/') || clean.includes('\\')) {
    return HISTORY_FOLDER_NAME;
  }
  return clean;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

module.exports = {
  HISTORY_FOLDER_NAME,
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_JOB_ID,
  DEFAULT_WATCH_SETTINGS,
  PATH_CHECK_TIMEOUT_MS,
  ROBOCOPY_COMPARE_TIMEOUT_MS,
  SUPPORTED_SYNC_MODES,
  TWO_WAY_CONFLICT_POLICIES,
  DEFAULT_APP_SETTINGS,
  SCHEDULER_QUEUE_PRIORITIES,
  RUN_STATUS,
  NO_CHANGE_MESSAGE,
  BUSY_MESSAGE,
  PREVIEW_FILE_LIMIT,
  FILE_MTIME_TOLERANCE_MS,
  normalizeConfig,
  normalizeAppSettings,
  normalizeJob,
  normalizeWatchSettings,
  sanitizeJobId,
  normalizeSyncMode,
  normalizeTwoWayConflictPolicy,
  assertCompareModeRunnable,
  assertSyncModeRunnable,
  makeCompareFingerprint,
  parseRunRequest,
  stableStringify,
  makePendingCompare,
  normalizeSchedule,
  sanitizeScheduleTime,
  normalizeSourcePaths,
  normalizeTargetDestinations,
  normalizeHistoryLocations,
  withUniqueDestinationLabels,
  sanitizeFolderLabel,
  dedupeLabel,
  sanitizeHistoryFolderName,
  clampNumber,
  withHistoryExclude
};
