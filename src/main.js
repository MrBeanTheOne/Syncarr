const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, screen, Notification, safeStorage } = require('electron');
const path = require('path');
// original-fs (via ./main/real-fs): the preview/compare, free-space, and history
// pre-scan stat USER files here. Electron's default fs presents `.asar` files as
// virtual directories, which made the preview flag synced app builds' `app.asar`
// as a "Conflict: target-not-file". Bundled-asset reads in this file go through
// nativeImage/loadFile (Electron APIs that handle asar themselves), never this
// `fs`, so using original-fs here is safe. See main/real-fs.js.
const fs = require('./main/real-fs').promises;
const {
  normalizeTelegramSettings,
  sendTelegramMessage,
  shouldNotifyRun,
  buildTelegramRunMessage
} = require('./services/telegram');
const { shouldNotifyDesktop, buildDesktopNotification, buildInterruptedRunsNotification } = require('./main/desktop-notifications');

const {
  PATH_CHECK_TIMEOUT_MS,
  normalizeJob,
  normalizeSchedule,
  sanitizeJobId,
  normalizeSyncMode,
  normalizeTwoWayConflictPolicy,
  assertCompareModeRunnable,
  assertSyncModeRunnable,
  makeCompareFingerprint,
  parseRunRequest,
  makePendingCompare,
  normalizeSourcePaths,
  normalizeTargetDestinations,
  normalizeHistoryLocations,
  sanitizeHistoryFolderName,
  withHistoryExclude,
  sanitizeFolderLabel,
  dedupeLabel,
  RUN_STATUS,
  BUSY_MESSAGE,
  PREVIEW_FILE_LIMIT
} = require('./main/job-model');
const { createConfigStore } = require('./main/config-store');
const { createRunJournalStore } = require('./main/run-journal');
const { createBackgroundScheduler } = require('./main/background-scheduler');
const { createSmartWatcher } = require('./main/smart-watcher');
const {
  createRestorePointManifest,
  listRestorePoints,
  readRestorePointManifest,
  previewRestorePointPlan,
  restoreRestorePointToFolder,
  deleteRestorePointsForJob
} = require('./main/restore-points');
const {
  getPlatform,
  isMacOS,
  pathIdentityKey,
  getPlatformCapabilities,
  calculateTrayWindowPosition,
  killProcessTree
} = require('./main/platform');
const {
  createInitialTrayActivity,
  mergeTrayActivity,
  getScheduledConflictWarnings,
  getTrayVisualState
} = require('./main/tray-activity');
const {
  buildAppMenuTemplate,
  shouldInstallAppMenu
} = require('./main/app-menu');
const {
  getSyncEngine,
  isOperationSupported,
  mergeEngineExitCodes,
  buildUnsupportedOperationResult,
  getSyncEngineMetadata
} = require('./main/sync-engine-registry');
const {
  buildRobocopyDryRunPreview,
  mergeDestinationPlans,
  accumulatePlanSummary
} = require('./main/sync-engines/robocopy-dryrun-parser');
const { createTwoWayState } = require('./main/two-way-state');
const { buildTwoWayComparePreview } = require('./main/two-way-compare');
const { runTwoWayApply } = require('./main/two-way-apply');
const { createTwoWayHistoryManifests } = require('./main/two-way-history');
const { markHistoryFolderHidden } = require('./main/history-folder');
const { normalizeRelativeForManifest } = require('./main/path-utils');
const { trimSavedRunOutput } = require('./main/run-record-store');
const { getRunTrigger, makeJournalJobSnapshot, buildOneWayJournalOperations } = require('./main/run-journal-operations');
const { buildSourceSyncRoots } = require('./main/source-sync-roots');
const { countOptionalDestinationIssues, applyDestinationWarningStatus, makeSkippedOptionalPreviewSummary } = require('./main/destination-results');
const { createTrayTaskMapper } = require('./main/tray-task-mapper');
const { createTrayIcons, TRAY_ICON_BY_STATE } = require('./main/tray-icons');
const { applyLoginItemSettings, getLoginItemStatus } = require('./main/login-items');
const { getAppIconImage, getWindowIconImage, getTrayIconImage } = createTrayIcons({ assetsRoot: __dirname });
const { mapWithConcurrency } = require('./main/async-utils');
const {
  collectSourceFiles: collectSourceFilesRaw,
  shouldSourceReplaceTarget,
  fileMetadata
} = require('./main/fs-utils');
const { isNoOpSyncPlan, reconcileNoChangeStatus, resolveSkipOlderSource } = require('./main/sync-plan-utils');
const {
  formatHistoryRunId,
  makeNoOpRobocopySummary,
  buildNoOpSyncMessage,
  buildCompareCompletionMessage,
  buildSyncCompletionMessage
} = require('./main/sync-messages');
const { getAutomaticPreviewFailure } = require('./main/automatic-run-safety');
const {
  checkStorageForRequest,
  checkStorageForPlan
} = require('./main/storage-check');
const { createHistoryOrchestrator } = require('./main/history-orchestrator');
const { createSyncEngineRunner } = require('./main/sync-engine-runner');
const { registerIpcHandlers } = require('./main/ipc');
const { createPathAllowlist } = require('./main/path-allowlist');
const { createSyncRun } = require('./main/sync-run');
const { createHistoryPlan } = require('./main/history-plan');
const { installWebContentsGuards } = require('./main/window-guards');
const { pruneWarnedScheduleKeys } = require('./main/scheduler-policy');
const { createTelegramTokenCodec } = require('./main/telegram-token');

// Root allow-list for privileged FS IPC (H12). Assigned once readConfig exists
// (below); referenced lazily by the orchestrator thunk + IPC handlers, both of
// which only run at IPC time — long after this is set.
let pathAllowlist = null;

// File-history retention, cache deletion, version listing, and restore now live
// in src/main/history-orchestrator.js. The two main-process collaborators it
// can't import (the userData path and the shared pathIsDirectory probe) are
// injected here. pathIsDirectory is a hoisted function declaration, so it is
// already defined at module-load time.
const {
  runRetentionPolicy,
  emptyRetentionSummary,
  aggregateRetentionResults,
  emptyJobHistoryDeleteSummary,
  aggregateJobHistoryDeleteSummaries,
  deleteHistoryCacheForJob,
  listHistoryVersions,
  restoreHistoryVersion
} = createHistoryOrchestrator({
  getUserDataPath: () => app.getPath('userData'),
  pathIsDirectory,
  // Gate renderer-supplied restore roots against the allow-list (assigned below,
  // before any IPC can fire). Fail-closed if somehow unset.
  assertRootAllowed: (root, label) => (pathAllowlist
    ? pathAllowlist.assertRootAllowed(root, label)
    : Promise.reject(new Error('Path allow-list is not ready.')))
});

let mainWindow = null;
let activeProcess = null;
let activeRunId = null;
let activeCancellationRequest = null;
const syncEventListeners = new Set();

// The sync-engine invocation layer lives in src/main/sync-engine-runner.js.
// It collaborates with this module's run state, so the cancellation/event
// helpers and a setter for the live child process are injected here. Those
// helpers are hoisted function declarations, so they are usable at this point.
const setActiveProcess = (child) => { activeProcess = child; };
const {
  createEngineProgressState,
  runSyncEngineSequence
} = createSyncEngineRunner({
  emitSyncEvent,
  isActiveRunCancelled,
  cancelMessageFor,
  requestProcessTreeKill,
  setActiveProcess
});

// Per-archived-item fs.stat fan-out for the file-history retention walk. The
// previous implementation awaited one stat per archived version sequentially,
// which turned the retention phase after a sync into minutes over SMB to a
// NAS when the history folder had thousands of versions. 16 concurrent stats
// matches the restore-point scan (src/main/sync-engines/robocopy-engine.js
// has a similar constant) so we don't blow past the SMB share's queue depth.
const HISTORY_STAT_CONCURRENCY = 16;


function isActiveRunCancelled(runId = activeRunId) {
  if (!activeCancellationRequest) return false;
  if (!runId || !activeCancellationRequest.runId) return true;
  return String(activeCancellationRequest.runId) === String(runId);
}

function makeCancellationError(runId = activeRunId) {
  const error = new Error('Run cancelled by user.');
  error.code = 'SYNCARR_CANCELLED';
  error.status = 'cancelled';
  error.runId = runId || null;
  return error;
}

function isCancellationError(error) {
  return Boolean(error && (error.code === 'SYNCARR_CANCELLED' || error.status === RUN_STATUS.CANCELLED || /cancelled by user/i.test(error.message || '')));
}

// True when a finished run RESULT represents a user cancellation, whether it
// surfaced via the `canceled` flag or a 'cancelled' status string. (Distinct
// from isCancellationError, which inspects a thrown error object.) The renderer
// mirrors this as isCancelledRun in src/renderer/app.js.
function isCancelledRun(result) {
  return Boolean(result && (result.canceled || String(result.status || '').toLowerCase() === RUN_STATUS.CANCELLED));
}

const { scheduledTaskToTrayTask, trayStatusForResult } = createTrayTaskMapper({ isCancelledRun });

function throwIfRunCancelled(runId = activeRunId) {
  if (isActiveRunCancelled(runId)) throw makeCancellationError(runId);
}

function requestActiveCancellation() {
  if (!activeProcess && !activeRunId) return null;
  activeCancellationRequest = {
    runId: activeRunId || null,
    at: new Date().toISOString(),
    pid: activeProcess && activeProcess.pid ? activeProcess.pid : null
  };
  return activeCancellationRequest;
}

function clearActiveRunState() {
  activeProcess = null;
  activeRunId = null;
  activeCancellationRequest = null;
}

// Setters for the shared run-state that the extracted sync-run module writes
// through. They must mutate THESE module lets so the retained predicates
// (isActiveRunCancelled / throwIfRunCancelled / isOperationBusy / clearActiveRunState)
// stay the single source of truth. (setActiveProcess already exists below and is
// shared with the sync-engine runner.)
function setActiveRunId(value) { activeRunId = value; }
function setActiveCancellationRequest(value) { activeCancellationRequest = value; }

function isOperationBusy({ allowBackgroundScheduler = false, allowSmartWatcher = false } = {}) {
  if (activeProcess || activeRunId) return true;
  if (!allowBackgroundScheduler && backgroundScheduler && backgroundScheduler.isRunning()) return true;
  return !allowSmartWatcher && Boolean(smartWatcher && smartWatcher.isRunning());
}

function cancelMessageFor(dryRun) {
  return dryRun ? 'Compare cancelled by user.' : 'Sync cancelled by user.';
}

function makeCancelledRunResult({
  runId,
  dryRun = false,
  output = '',
  summary = null,
  history = null,
  storage = null,
  retention = null,
  restorePoint = null,
  jobId,
  jobName,
  syncMode,
  targetDestinations = [],
  skippedDestinations = [],
  destinationResults = [],
  compareCreatedAt,
  compareFingerprint,
  preview = null
} = {}) {
  const message = cancelMessageFor(Boolean(dryRun));
  return {
    ok: false,
    canceled: true,
    code: null,
    status: 'cancelled',
    message,
    output: output ? `${output}${output.endsWith('\n') ? '' : '\n'}${message}\n` : `${message}\n`,
    summary,
    history,
    storage,
    retention,
    restorePoint,
    jobId,
    jobName,
    syncMode: normalizeSyncMode(syncMode),
    targetDestinations,
    skippedDestinations,
    destinationResults,
    compareCreatedAt: compareCreatedAt || new Date().toISOString(),
    compareFingerprint,
    preview: preview || (dryRun ? { ok: false, canceled: true, message, summary: null, files: [], skippedDestinations } : undefined)
  };
}

function requestProcessTreeKill(child = activeProcess) {
  return killProcessTree(child);
}

async function cancelActiveRun() {
  const cancellation = requestActiveCancellation();
  if (!cancellation) return { ok: false, message: 'No compare or sync process is running.' };

  const killed = requestProcessTreeKill(activeProcess);
  const message = killed && cancellation.pid
    ? `Cancellation requested. Stopping process tree ${cancellation.pid}...`
    : 'Cancellation requested. Syncarr will stop after the current preparation step.';

  emitSyncEvent({
    type: 'stdout',
    runId: cancellation.runId,
    text: `\n${message}\n`
  });

  return { ok: true, message };
}

// Background-operation state. Scheduling and sync execution are owned by the
// main process, so no renderer window is required while Syncarr is resident.
let tray = null;
let trayWindow = null;
let isQuiting = false;
let backgroundSettingsCache = {
  startAtLogin: false,
  closeToTray: true,
  startMinimized: false,
  autoCheckUpdates: true,
  desktopNotifications: true,
  notifyBeforeScheduledRun: true,
  schedulerPaused: false
};
let autoUpdaterRef = null; // null = not loaded, false = unavailable, object = loaded
let updateCheckWasInteractive = false; // gates updater error events to user-initiated checks
const hiddenArgumentRequested = process.argv.includes('--hidden');
let trayActivity = createInitialTrayActivity();
let trayActivityResetTimer = null;
let backgroundScheduler = null;
let smartWatcher = null;
const warnedScheduleKeys = new Set();
const SCHEDULE_WARNING_MS = 5 * 60 * 1000;

try {
  app.setAppUserModelId('ca.retile.syncarr');
} catch {
  // App user model ID is only relevant on Windows packaged builds.
}

function shouldStartHidden() {
  if (hiddenArgumentRequested) return true;
  if (!isMacOS()) return false;
  try {
    return app.getLoginItemSettings().wasOpenedAsHidden === true;
  } catch {
    return false;
  }
}

const configStore = createConfigStore(app);
// M1: the Telegram bot token is sealed with OS-level encryption (safeStorage/
// DPAPI) before it touches disk and opened back into memory on read. Every
// internal consumer goes through these wrapped functions, so notify paths
// keep seeing a usable token while syncarr-config.json holds only ciphertext.
// The renderer additionally gets a REDACTED view via redactTelegramSettings
// at the IPC layer (ipc/config.js).
const telegramTokenCodec = createTelegramTokenCodec({ safeStorage });
const readConfig = async () => telegramTokenCodec.openTelegramSettings(await configStore.readConfig());
const writeConfig = async (config) => telegramTokenCodec.openTelegramSettings(
  await configStore.writeConfig(telegramTokenCodec.sealTelegramSettings(config))
);

// One-time upgrade sweep: seal a plaintext token left by pre-M1 versions —
// including the rotating backups, which are byte-copies of older configs.
// Best-effort: a failure just leaves the pre-M1 plaintext behavior in place.
async function migratePlaintextTelegramToken() {
  try {
    if (!telegramTokenCodec.isEncryptionAvailable()) return;
    const raw = await configStore.readConfig();
    if (telegramTokenCodec.hasPlaintextToken(raw)) {
      await configStore.writeConfig(telegramTokenCodec.sealTelegramSettings(raw));
    }
    for (const backupPath of configStore.getBackupPaths()) {
      try {
        const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
        if (telegramTokenCodec.hasPlaintextToken(backup)) {
          await fs.writeFile(backupPath, JSON.stringify(telegramTokenCodec.sealTelegramSettings(backup), null, 2), 'utf8');
        }
      } catch {
        // Missing/corrupt backups are the config store's recovery ladder's problem.
      }
    }
  } catch {
    // Migration is advisory; never block startup on it.
  }
}
pathAllowlist = createPathAllowlist({ readConfig });
let runJournalStore = null;

function getRunJournalStore() {
  if (!runJournalStore) runJournalStore = createRunJournalStore({ basePath: app.getPath('userData') });
  return runJournalStore;
}

async function finishRunJournal(runJournal, status, result) {
  if (!runJournal) return false;
  try {
    await getRunJournalStore().finish(runJournal, status, result);
    return true;
  } catch (error) {
    emitSyncEvent({
      type: 'error',
      runId: runJournal.runId || null,
      text: `Recovery journal could not be finalized: ${error.message || String(error)}\n`
    });
    return false;
  }
}

async function resetTwoWayStateForRecovery(run) {
  const destinations = Array.isArray(run && run.targetDestinations) ? run.targetDestinations : [];
  const count = Math.max(1, destinations.length);
  for (let destinationIndex = 0; destinationIndex < count; destinationIndex += 1) {
    const state = createTwoWayState({
      userDataPath: app.getPath('userData'),
      jobId: run && run.jobId,
      destinationIndex
    });
    await state.ready;
    try {
      await state.clear();
    } finally {
      await state.close();
    }
  }
}

async function notifyJobRunIfNeeded({ request, result, dryRun }) {
  try {
    const config = await readConfig();
    const jobId = sanitizeJobId((request && request.id) || (result && result.jobId) || config.activeJobId);
    const job = (config.jobs || []).find((item) => sanitizeJobId(item.id) === jobId) || normalizeJob(request || {}, jobId);

    if (shouldNotifyRun({ settings: config.telegramSettings, job, result, dryRun })) {
      await sendTelegramMessage(
        config.telegramSettings,
        buildTelegramRunMessage({ job, result, dryRun }),
        { parseMode: 'HTML' }
      );
    }

    maybeShowDesktopNotification({ job, result, dryRun, settings: config.backgroundSettings });
  } catch {
    // Notifications must never make Compare or Sync fail.
  }
}

function maybeShowDesktopNotification({ job, result, dryRun, settings }) {
  try {
    if (!Notification || typeof Notification.isSupported !== 'function' || !Notification.isSupported()) return;
    if (!shouldNotifyDesktop({ settings, result, dryRun })) return;
    const { title, body, urgent, silent, jobId } = buildDesktopNotification({ job, result, dryRun });
    const notification = new Notification({
      title,
      body,
      silent: Boolean(silent),
      timeoutType: 'default',
      urgency: urgent ? 'critical' : 'normal',
      icon: getAppIconImage()
    });
    notification.on('click', () => {
      showMainWindow();
      // Best-effort deep link: if the window already existed the renderer jumps
      // to the notified job; if it was just recreated the event is simply lost
      // and the app opens normally.
      if (jobId) sendToRenderer('app:focusJob', { jobId });
    });
    notification.show();
  } catch {
    // A failed toast must never affect the run.
  }
}

// On startup, proactively surface any run that was interrupted (crash / force-
// quit mid-sync). Previously these lingered "interrupted" until the user opened
// the Sync tab; a resident tray app can go days without that, leaving a partial
// two-way baseline or a half-applied run unreconciled and unnoticed.
async function surfaceInterruptedRunsOnStartup() {
  try {
    const interrupted = await getRunJournalStore().list({ incompleteOnly: true });
    const notification = buildInterruptedRunsNotification(interrupted);
    if (!notification) return;
    if (backgroundSettingsCache && backgroundSettingsCache.desktopNotifications === false) return;
    if (!Notification || typeof Notification.isSupported !== 'function' || !Notification.isSupported()) return;
    const toast = new Notification({
      title: notification.title,
      body: notification.body,
      silent: false, // interrupted runs always chime — they need attention
      urgency: notification.urgent ? 'critical' : 'normal',
      icon: getAppIconImage()
    });
    toast.on('click', () => showMainWindow());
    toast.show();
  } catch {
    // Surfacing interrupted runs is best-effort and must never block startup.
  }
}

async function resolveDestinationAvailability(destinations, options = {}) {
  const available = [];
  const skipped = [];
  const missingRequired = [];
  const allowCreatable = options.allowCreatable === true;
  const timeoutMs = Number(options.timeoutMs || PATH_CHECK_TIMEOUT_MS);

  for (const destination of destinations) {
    const exists = await pathIsDirectory(destination.path, { timeoutMs });
    if (exists) {
      available.push({ ...destination, available: true, creatable: false });
      continue;
    }

    const parentReachable = allowCreatable ? await destinationParentIsReachable(destination.path, { timeoutMs }) : false;
    if (parentReachable) {
      available.push({
        ...destination,
        available: false,
        creatable: true,
        reason: 'destination-will-be-created'
      });
      continue;
    }

    const missing = { ...destination, available: false, creatable: false, reason: 'not-connected-or-unreadable' };
    if (destination.required) missingRequired.push(missing);
    else skipped.push(missing);
  }

  return { available, skipped, missingRequired };
}

async function destinationParentIsReachable(inputPath, options = {}) {
  const clean = String(inputPath || '').trim();
  if (!clean) return false;

  const candidates = [];
  try {
    const parent = path.dirname(clean);
    if (parent && parent !== clean) candidates.push(parent);
  } catch {
    // Keep best-effort fallbacks below.
  }

  try {
    const parsed = path.parse(clean);
    if (parsed.root) candidates.push(parsed.root);
  } catch {
    // Ignore parse failures.
  }

  const seen = new Set();
  for (const candidate of candidates) {
    const key = pathIdentityKey(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (await pathIsDirectory(candidate, { timeoutMs: options.timeoutMs || PATH_CHECK_TIMEOUT_MS })) return true;
  }

  return false;
}

function appendSkippedDestinationLog(runId, dryRun, skippedDestinations) {
  if (!Array.isArray(skippedDestinations) || !skippedDestinations.length) return '';
  const text = skippedDestinations
    .map((destination) => `Optional destination skipped: ${destination.label} (${destination.path})`)
    .join('\n') + '\n';
  emitSyncEvent({ type: 'stdout', runId, dryRun, text });
  return text;
}

function buildDestinationSourceRoots({ sourcePaths, destinations }) {
  const roots = [];
  for (const destination of destinations || []) {
    const destinationRoots = buildSourceSyncRoots({ sourcePaths, targetPath: destination.path });
    for (const root of destinationRoots) {
      roots.push({
        ...root,
        destination,
        destinationLabel: destination.label,
        destinationRequired: destination.required !== false
      });
    }
  }
  return roots;
}


async function buildInternalComparePreview(options) {
  const plan = await analyzeMultiDestinationHistoryPlan(options);
  return {
    summary: plan.summary,
    files: plan.previewFiles
  };
}

async function checkStorageForDestinationPlans({ destinationPlans, historyEnabled, minimumFreeGb }) {
  const checks = [];

  for (const entry of destinationPlans || []) {
    const destination = entry.destination;
    const plan = entry.plan;
    checks.push({
      destination,
      ...(await checkStorageForPlan({
        targetPath: destination.path,
        historyPlan: plan,
        historyEnabled,
        minimumFreeGb
      }))
    });
  }

  const blocking = checks.find((check) => check.checked && !check.enoughSpace);
  const checked = checks.some((check) => check.checked);
  const estimatedWriteBytes = checks.reduce((total, check) => total + (Number(check.estimatedWriteBytes) || 0), 0);

  return {
    ok: !blocking,
    checked,
    enoughSpace: !blocking,
    checks,
    estimatedWriteBytes,
    message: blocking
      ? `Destination ${blocking.destination && blocking.destination.label ? blocking.destination.label : blocking.path} does not have enough free space. ${blocking.message || ''}`.trim()
      : checked
        ? 'Enough free space for all available destinations.'
        : 'Free-space check could not be completed.'
  };
}



let trayState = 'idle';
let trayResetTimer = null;

function setTrayState(state = 'idle', options = {}) {
  const cleanState = Object.prototype.hasOwnProperty.call(TRAY_ICON_BY_STATE, state) ? state : 'idle';
  trayState = cleanState;
  if (trayResetTimer) {
    clearTimeout(trayResetTimer);
    trayResetTimer = null;
  }
  if (tray) {
    const image = getTrayIconImage(cleanState);
    tray.setImage(image);
    const label = cleanState.charAt(0).toUpperCase() + cleanState.slice(1);
    tray.setToolTip(cleanState === 'idle' ? 'Syncarr' : `Syncarr — ${label}`);
  }
  const resetAfterMs = Number(options.resetAfterMs || 0);
  if (resetAfterMs > 0 && cleanState !== 'idle') {
    trayResetTimer = setTimeout(() => setTrayState('idle'), resetAfterMs);
  }
  return trayState;
}

function sendToTrayWindow(channel, payload) {
  if (trayWindow && !trayWindow.isDestroyed()) {
    trayWindow.webContents.send(channel, payload);
  }
}

function setTrayActivity(patch = {}) {
  const previousStatus = trayActivity.status;
  const previousQueueLength = trayActivity.queue.length;
  trayActivity = mergeTrayActivity(trayActivity, patch);

  if (trayActivityResetTimer) {
    clearTimeout(trayActivityResetTimer);
    trayActivityResetTimer = null;
  }

  const visualState = getTrayVisualState(trayActivity);
  if (visualState !== trayState) setTrayState(visualState);
  sendToTrayWindow('tray:activity', trayActivity);

  const taskName = trayActivity.active && trayActivity.active.name;
  const queueText = trayActivity.queue.length ? `, ${trayActivity.queue.length} pending` : '';
  if (tray) {
    tray.setToolTip(taskName ? `Syncarr - ${taskName}${queueText}` : `Syncarr${queueText}`);
  }

  if (previousStatus !== trayActivity.status || previousQueueLength !== trayActivity.queue.length) refreshTrayMenu();

  if ([RUN_STATUS.SUCCESS, RUN_STATUS.WARNING, RUN_STATUS.ERROR, RUN_STATUS.CANCELLED].includes(trayActivity.status)) {
    trayActivityResetTimer = setTimeout(() => {
      setTrayActivity({ status: 'idle', active: null });
    }, 12000);
  }

  return trayActivity;
}

function handleBackgroundSchedulerState(state) {
  if (!state) return;
  if (['watching', 'change', 'waiting', 'error'].includes(state.type)) {
    sendToRenderer('watcher:event', {
      type: state.type,
      enabledJobs: state.enabledJobs,
      watchedSources: state.watchedSources,
      unavailableSources: state.unavailableSources,
      jobs: state.jobs,
      jobId: state.jobId,
      jobName: state.jobName,
      sourcePath: state.sourcePath,
      path: state.path,
      changeCount: state.changeCount,
      dueAt: state.dueAt,
      reason: state.reason,
      message: state.message
    });
    return;
  }
  if (state.type === 'queue') {
    // A recurring job re-arms itself right after running, so publishQueue can
    // list the job that is still showing in the active card. Drop the active
    // job from the pending list so it is never shown as both running and pending.
    const activeId = trayActivity.active && trayActivity.active.id;
    const allTasks = state.tasks || [];
    const tasks = allTasks.filter((task) => !(activeId && task && task.job && task.job.id === activeId));
    setTrayActivity({
      status: trayActivity.status === 'paused' ? 'idle' : trayActivity.status,
      schedulerPaused: false,
      conflictWarnings: getScheduledConflictWarnings(allTasks, state.recentRuns),
      queue: tasks.map((task, index) => scheduledTaskToTrayTask(task, index, tasks.length))
    });
    maybeWarnBeforeScheduledRun(tasks);
    sendToRenderer('scheduler:event', { type: 'queue', count: tasks.length });
    return;
  }

  if (state.type === 'paused') {
    const tasks = state.tasks || [];
    const queue = tasks.map((task, index) => scheduledTaskToTrayTask(task, index, tasks.length));
    const conflictWarnings = getScheduledConflictWarnings(tasks, state.recentRuns);
    setTrayActivity(trayActivity.status === 'running'
      ? { schedulerPaused: true, conflictWarnings, queue }
      : { status: 'paused', schedulerPaused: true, conflictWarnings, active: null, queue });
    sendToRenderer('scheduler:event', { type: 'paused', count: tasks.length });
    return;
  }

  if (state.type === 'start') {
    const queue = state.queue || [];
    const active = scheduledTaskToTrayTask(state.task, 0, queue.length + 1);
    active.startedAt = new Date().toISOString();
    const watched = state.task && state.task.reason === 'watch';
    active.message = watched
      ? 'Source changes settled. Starting watched task.'
      : (state.forced ? 'Starting early from the tray.' : 'Scheduled task is starting.');
    active.progress.label = active.message;
    setTrayActivity({
      status: 'running',
      active,
      queue: queue.map((task, index) => scheduledTaskToTrayTask(task, index, queue.length))
    });
    sendToRenderer(watched ? 'watcher:event' : 'scheduler:event', {
      type: 'start',
      jobId: active.id,
      jobName: active.name,
      forced: state.forced === true,
      mode: active.kind
    });
    return;
  }

  if (state.type === 'event' && state.event && state.event.type === 'progress') {
    const progress = state.event.progress || {};
    const copied = Number(progress.copied) || 0;
    const skipped = Number(progress.skipped) || 0;
    const failed = Number(progress.failed) || 0;
    const extra = Number(progress.extra) || 0;
    const watched = state.task && state.task.reason === 'watch';
    const total = watched ? 0 : Number(state.task && state.task.stats && state.task.stats.changes || 0);
    const completed = copied + failed + extra;
    setTrayActivity({
      active: {
        progress: {
          percent: total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : null,
          indeterminate: total <= 0,
          copied,
          skipped,
          failed,
          extra,
          processed: copied + skipped + failed + extra,
          total,
          label: progress.latestText || progress.label || 'Processing files...',
          file: progress.latestFile || progress.file || ''
        }
      }
    });
    return;
  }

  if (state.type === 'complete') {
    const queue = state.queue || [];
    const active = scheduledTaskToTrayTask(state.task, 0, queue.length + 1);
    active.completedAt = new Date().toISOString();
    const watched = state.task && state.task.reason === 'watch';
    active.message = state.result && state.result.message || (watched ? 'Watched task complete.' : 'Scheduled task complete.');
    active.progress = {
      ...(trayActivity.active && trayActivity.active.progress || active.progress),
      percent: state.result && state.result.ok ? 100 : null,
      indeterminate: false,
      label: active.message
    };
    setTrayActivity({
      status: trayStatusForResult(state.result),
      active,
      queue: queue.map((task, index) => scheduledTaskToTrayTask(task, index, queue.length))
    });
    sendToRenderer(watched ? 'watcher:event' : 'scheduler:event', {
      type: 'complete',
      jobId: active.id,
      jobName: active.name,
      kind: active.kind,
      result: state.result
    });
  }
}

function maybeWarnBeforeScheduledRun(tasks) {
  try {
    if (backgroundSettingsCache.desktopNotifications === false
      || backgroundSettingsCache.notifyBeforeScheduledRun === false
      || backgroundSettingsCache.schedulerPaused === true
      || !Notification || !Notification.isSupported()) return;

    const nowMs = Date.now();
    // Keys embed the absolute due time, so past-due entries can never match
    // again — drop them here so the Set stays bounded for the life of the
    // process (audit M10).
    pruneWarnedScheduleKeys(warnedScheduleKeys, nowMs);
    const nextTask = (tasks || []).find((task) => {
      const dueMs = new Date(task && task.dueAt).getTime();
      return Number.isFinite(dueMs) && dueMs > nowMs && dueMs - nowMs <= SCHEDULE_WARNING_MS;
    });
    if (!nextTask) return;

    const dueMs = new Date(nextTask.dueAt).getTime();
    const key = `${sanitizeJobId(nextTask.job && nextTask.job.id)}:${dueMs}`;
    if (warnedScheduleKeys.has(key)) return;
    warnedScheduleKeys.add(key);

    const minutes = Math.max(1, Math.ceil((dueMs - nowMs) / 60_000));
    const jobName = nextTask.job && nextTask.job.name || 'Scheduled task';
    const notification = new Notification({
      title: 'Syncarr scheduled task soon',
      body: `${jobName} starts in about ${minutes} minute${minutes === 1 ? '' : 's'}. Pause automatic schedules from the tray or Settings.`,
      silent: false,
      icon: getAppIconImage()
    });
    notification.on('click', () => showMainWindow());
    notification.show();
  } catch {
    // Pre-run warnings are advisory and must never affect scheduling.
  }
}

async function setSchedulerPaused(paused) {
  const config = await readConfig();
  await writeConfig({
    ...config,
    backgroundSettings: { ...config.backgroundSettings, schedulerPaused: paused === true }
  });
  await loadBackgroundSettings();
  setTrayActivity({ schedulerPaused: paused === true });
  refreshTrayMenu();
  if (backgroundScheduler) await backgroundScheduler.refresh();
  return { ok: true, schedulerPaused: paused === true };
}

async function runBackgroundAutomaticTask({ job, mode, onEvent, reason }) {
  const dryRun = mode !== 'sync';
  const automaticLabel = reason === 'watch' ? 'Watched' : 'Scheduled';
  const backgroundFlags = {
    scheduled: reason !== 'watch',
    watched: reason === 'watch',
    backgroundScheduled: reason !== 'watch',
    backgroundWatched: reason === 'watch'
  };
  const unsubscribe = subscribeSyncEvents(onEvent);
  try {
    if (!dryRun) {
      const preview = normalizeSyncMode(job.syncMode) === 'twoWay'
        ? await runCompareOnly({ ...job, ...backgroundFlags })
        : await buildSyncPreview(job);
      const previewFailure = getAutomaticPreviewFailure(preview, automaticLabel, {
        mode: normalizeSyncMode(job.syncMode),
        requireStorageCheck: normalizeSyncMode(job.syncMode) === 'twoWay' && job.freeSpaceCheckEnabled !== false,
        allowResolvedConflicts: normalizeSyncMode(job.syncMode) === 'twoWay'
          && normalizeTwoWayConflictPolicy(job.twoWayConflictPolicy) !== 'newer'
      });
      if (previewFailure) return previewFailure;
    }

    const runRequest = {
      ...job,
      dryRun,
      ...backgroundFlags,
      allowMirrorApply: !dryRun && normalizeSyncMode(job.syncMode) === 'mirror'
    };
    return dryRun && normalizeSyncMode(job.syncMode) === 'twoWay'
      ? runCompareOnly(runRequest)
      : executeSyncRun(runRequest);
  } finally {
    unsubscribe();
  }
}

async function runBackgroundScheduledTask(task) {
  return runBackgroundAutomaticTask({
    job: task.job,
    mode: task.schedule.mode,
    onEvent: task.onEvent,
    reason: task.reason || 'scheduled'
  });
}

async function runBackgroundWatchedTask(task) {
  return runBackgroundAutomaticTask({
    job: task.job,
    mode: task.watch.mode,
    onEvent: task.onEvent,
    reason: 'watch'
  });
}

function startBackgroundScheduler() {
  if (backgroundScheduler) return backgroundScheduler;
  backgroundScheduler = createBackgroundScheduler({
    readConfig,
    writeConfig,
    runJob: runBackgroundScheduledTask,
    isBusy: () => Boolean(activeProcess || activeRunId || (smartWatcher && smartWatcher.isRunning())),
    onState: handleBackgroundSchedulerState
  });
  backgroundScheduler.start();
  return backgroundScheduler;
}

function startSmartWatcher() {
  if (smartWatcher) return smartWatcher;
  smartWatcher = createSmartWatcher({
    readConfig,
    runJob: runBackgroundWatchedTask,
    isBusy: () => Boolean(activeProcess || activeRunId || (backgroundScheduler && backgroundScheduler.isRunning())),
    onState: handleBackgroundSchedulerState
  });
  smartWatcher.start().catch((error) => {
    handleBackgroundSchedulerState({ type: 'error', message: error.message || String(error) });
  });
  return smartWatcher;
}

function createTrayWindow() {
  if (trayWindow && !trayWindow.isDestroyed()) return trayWindow;

  trayWindow = new BrowserWindow({
    width: 390,
    height: 300,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'tray-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  installWebContentsGuards(trayWindow.webContents);
  trayWindow.loadFile(path.join(__dirname, 'renderer', 'tray.html'));
  trayWindow.on('blur', () => {
    if (trayWindow && !trayWindow.webContents.isDevToolsOpened()) trayWindow.hide();
  });
  trayWindow.on('closed', () => {
    trayWindow = null;
  });
  return trayWindow;
}

function positionTrayWindow(desiredHeight) {
  if (!tray || !trayWindow || trayWindow.isDestroyed()) return;
  const trayBounds = tray.getBounds();
  const current = trayWindow.getBounds();
  const width = current.width;
  // Use the caller-provided height (during a resize) so size and position are
  // computed together; otherwise keep the current height.
  const height = Number(desiredHeight) > 0 ? Math.round(Number(desiredHeight)) : current.height;
  const windowBounds = { x: current.x, y: current.y, width, height };
  const trayCenter = {
    x: Math.round(trayBounds.x + trayBounds.width / 2),
    y: Math.round(trayBounds.y + trayBounds.height / 2)
  };
  const display = screen.getDisplayNearestPoint(trayCenter);
  const workArea = display.workArea;
  const bounds = display.bounds;
  const position = calculateTrayWindowPosition({ trayBounds, windowBounds, workArea });

  // Pin the flyout flush against the taskbar so it "hugs" it, rather than
  // floating up beside a tray-overflow icon. The taskbar edge is wherever the
  // work area is inset from the full display bounds.
  const margin = 8;
  const workRight = workArea.x + workArea.width;
  const workBottom = workArea.y + workArea.height;
  if (workBottom < bounds.y + bounds.height) {
    position.y = workBottom - height - margin; // taskbar at bottom (common)
  } else if (workArea.y > bounds.y) {
    position.y = workArea.y + margin; // taskbar at top
  } else if (workArea.x > bounds.x) {
    position.x = workArea.x + margin; // taskbar at left
  } else if (workRight < bounds.x + bounds.width) {
    position.x = workRight - width - margin; // taskbar at right
  }

  // Set size + position in one call so a height change can never leave the
  // window positioned for a stale height (which floated the panel after a run).
  trayWindow.setBounds({ x: position.x, y: position.y, width, height }, false);
}

function showTrayWindow() {
  const panel = createTrayWindow();
  const show = () => {
    if (!panel || panel.isDestroyed()) return;
    positionTrayWindow();
    panel.show();
    panel.focus();
    sendToTrayWindow('tray:activity', trayActivity);
  };

  if (panel.webContents.isLoading()) panel.webContents.once('did-finish-load', show);
  else show();
}

function toggleTrayWindow() {
  const panel = createTrayWindow();
  if (panel.isVisible()) panel.hide();
  else showTrayWindow();
}

function createWindow({ startHidden = false } = {}) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: '#0a0f14',
    show: false,
    icon: getWindowIconImage(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  installWebContentsGuards(mainWindow.webContents);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow.show();
  });

  // Closing the window hides it to the tray instead of quitting, so scheduled
  // jobs keep running. A real quit (tray menu / before-quit) sets isQuiting.
  mainWindow.on('close', (event) => {
    if (!isQuiting && backgroundSettingsCache.closeToTray) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    mainWindow = null;
  });
}

function showMainWindow() {
  if (trayWindow && !trayWindow.isDestroyed()) trayWindow.hide();
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow({ startHidden: false });
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function emitSyncEvent(payload) {
  sendToRenderer('sync:event', payload);
  for (const listener of syncEventListeners) {
    try {
      listener(payload);
    } catch {
      // Observers must never interrupt a sync operation.
    }
  }
}

function subscribeSyncEvents(listener) {
  if (typeof listener !== 'function') return () => {};
  syncEventListeners.add(listener);
  return () => syncEventListeners.delete(listener);
}

function buildTray() {
  if (tray) return;
  try {
    tray = new Tray(getTrayIconImage(trayState));
  } catch {
    tray = null;
    return;
  }
  setTrayState(trayState);
  tray.on('double-click', showMainWindow);
  tray.on('click', toggleTrayWindow);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Open Syncarr', click: showMainWindow },
    {
      label: 'Run next scheduled task now',
      enabled: trayActivity.status !== 'running' && trayActivity.queue.length > 0,
      click: () => { startBackgroundScheduler().runNext().catch(() => {}); }
    },
    {
      label: backgroundSettingsCache.schedulerPaused ? 'Resume automatic schedules' : 'Pause automatic schedules',
      click: () => { setSchedulerPaused(!backgroundSettingsCache.schedulerPaused).catch(() => {}); }
    },
    { label: 'Cancel current task', enabled: trayActivity.status === 'running', click: () => { cancelActiveRun().catch(() => {}); } },
    { type: 'separator' },
    { label: 'Check for updates…', click: () => { checkForUpdates({ interactive: true }).catch(() => {}); } },
    { type: 'separator' },
    { label: 'Quit Syncarr', click: () => { isQuiting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

function installAppMenu() {
  if (!shouldInstallAppMenu(getPlatform())) return;
  const template = buildAppMenuTemplate({
    isMacOS: true,
    productName: app.getName(),
    version: app.getVersion(),
    actions: { showMainWindow }
  });
  if (!template) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function loadBackgroundSettings() {
  try {
    const config = await readConfig();
    backgroundSettingsCache = config.backgroundSettings || backgroundSettingsCache;
  } catch {
    // Keep defaults already in backgroundSettingsCache.
  }
  return backgroundSettingsCache;
}

function getAutoUpdater() {
  if (autoUpdaterRef !== null) return autoUpdaterRef;
  try {
    const updater = require('electron-updater').autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => sendToRenderer('app:update', { status: 'checking' }));
    updater.on('update-available', (info) => sendToRenderer('app:update', { status: 'available', version: info && info.version }));
    updater.on('update-not-available', (info) => sendToRenderer('app:update', { status: 'none', version: info && info.version }));
    updater.on('download-progress', (p) => sendToRenderer('app:update', { status: 'downloading', percent: p && Math.round(p.percent) }));
    updater.on('update-downloaded', (info) => sendToRenderer('app:update', { status: 'downloaded', version: info && info.version }));
    updater.on('error', (err) => {
      const message = String(err && err.message || err);
      // Background checks fail routinely (offline, no published release yet);
      // only surface the failure when the user explicitly clicked "Check".
      if (!updateCheckWasInteractive) {
        console.error('[syncarr] Background update check failed:', message);
        return;
      }
      sendToRenderer('app:update', { status: 'error', message });
    });
    autoUpdaterRef = updater;
  } catch {
    // electron-updater is an optional dependency; auto-update is simply
    // disabled until it is installed and the app runs as a packaged build.
    autoUpdaterRef = false;
  }
  return autoUpdaterRef;
}

async function checkForUpdates({ interactive = false } = {}) {
  const updater = getAutoUpdater();
  if (!updater) {
    if (interactive) sendToRenderer('app:update', { status: 'unsupported', message: 'Auto-update is not available in this build.' });
    return { ok: false, status: 'unsupported', message: 'Auto-update is not available in this build.' };
  }
  if (!app.isPackaged) {
    if (interactive) sendToRenderer('app:update', { status: 'dev', message: 'Auto-update only runs in a packaged build.' });
    return { ok: false, status: 'dev', message: 'Auto-update only runs in a packaged build.' };
  }
  try {
    updateCheckWasInteractive = interactive;
    const result = await updater.checkForUpdates();
    return { ok: true, version: result && result.updateInfo && result.updateInfo.version };
  } catch (error) {
    const message = String(error && error.message || error);
    if (interactive) sendToRenderer('app:update', { status: 'error', message });
    return { ok: false, status: 'error', message };
  }
}

async function bootstrap() {
  const startHidden = shouldStartHidden();
  // Seal any plaintext Telegram token left by pre-M1 versions (config +
  // rotating backups). Runs after app-ready so safeStorage is available.
  await migratePlaintextTelegramToken();
  await loadBackgroundSettings();
  applyLoginItemSettings(backgroundSettingsCache);
  buildTray();
  installAppMenu();
  startBackgroundScheduler();
  startSmartWatcher();
  if (!startHidden) createWindow({ startHidden: false });

  // Nudge the user about any run left interrupted by a prior crash/force-quit.
  // Fire-and-forget: startup must not wait on a journal scan.
  surfaceInterruptedRunsOnStartup().catch(() => {});

  if (backgroundSettingsCache.autoCheckUpdates) {
    setTimeout(() => { checkForUpdates({ interactive: false }).catch(() => {}); }, 8000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow({ startHidden: false });
    else showMainWindow();
  });
}

// Global safety net for the resident main process. Without these, an unhandled
// rejection or a thrown error on a non-IPC path (a timer, a stream callback, a
// fire-and-forget promise) tears down the whole process under modern Node
// defaults — killing the tray, scheduler, watcher, and any in-flight sync with
// no trace. A backup tool must not die silently, so log and keep running.
process.on('unhandledRejection', (reason) => {
  const detail = reason && reason.stack ? reason.stack : (reason && reason.message ? reason.message : String(reason));
  console.error('[syncarr] Unhandled promise rejection (kept alive):', detail);
});
process.on('uncaughtException', (error) => {
  const detail = error && error.stack ? error.stack : (error && error.message ? error.message : String(error));
  console.error('[syncarr] Uncaught exception (kept alive):', detail);
});

// Single-instance lock: autostart + a manual launch must not spawn two copies
// (which would double-run scheduled jobs). The second instance just surfaces
// the existing window.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
  app.on('before-quit', () => {
    isQuiting = true;
    if (backgroundScheduler) backgroundScheduler.stop();
    if (smartWatcher) smartWatcher.stop();
    if (trayActivityResetTimer) clearTimeout(trayActivityResetTimer);
  });
  app.whenReady().then(bootstrap).catch((error) => {
    const detail = error && error.stack ? error.stack : (error && error.message ? error.message : String(error));
    console.error('[syncarr] Startup (bootstrap) failed:', detail);
  });
}

app.on('window-all-closed', () => {
  // With close-to-tray the window is hidden (not closed), so this only fires on
  // a real quit. Keep the app alive on macOS per platform convention.
  if (!isMacOS()) app.quit();
});

// Register every IPC handler. The handlers themselves live in src/main/ipc/*
// and only declare the dependencies they need — this bundle is the single
// source of truth for what crosses the IPC boundary.
registerIpcHandlers(ipcMain, {
  // electron namespaces
  app,
  dialog,

  // privileged-root allow-list (gates renderer-supplied restore/delete roots)
  pathAllowlist,

  // M1: strips the Telegram token (and its ciphertext) from configs crossing
  // the IPC boundary, replacing it with a botTokenConfigured boolean.
  redactTelegramSettings: telegramTokenCodec.redactTelegramSettings,

  // platform / capabilities
  getPlatform,
  getPlatformCapabilities,
  getSyncEngineMetadata,

  // updater
  getAutoUpdater,
  checkForUpdates,

  // config + settings
  readConfig,
  writeConfig,
  loadBackgroundSettings,
  applyLoginItemSettings,
  getLoginItemStatus,
  refreshTrayMenu,
  getBackgroundSettings: () => backgroundSettingsCache,
  setSchedulerPaused,
  refreshBackgroundScheduler: () => (backgroundScheduler ? backgroundScheduler.refresh() : Promise.resolve()),
  refreshSmartWatcher: () => (smartWatcher ? smartWatcher.refresh() : Promise.resolve()),
  getSmartWatcherStatus: () => (smartWatcher
    ? smartWatcher.getStatus()
    : { enabledJobs: 0, watchedSources: 0, unavailableSources: 0, jobs: [] }),
  getConfigHealth: () => configStore.getHealth(),
  getRunJournalStore,

  // tray
  getTrayActivity: () => trayActivity,
  setTrayActivity,
  setTrayState,
  positionTrayWindow,

  // window refs (live, mutated by createWindow/showMainWindow/createTrayWindow)
  getMainWindow: () => mainWindow,
  getTrayWindow: () => trayWindow,
  showMainWindow,
  startBackgroundScheduler,

  // operation gating
  isOperationBusy,
  setActiveRunId: (runId) => { activeRunId = runId; },
  clearActiveRunId: () => { activeRunId = null; },
  setIsQuiting: (v) => { isQuiting = v; },

  // cancellation
  cancelActiveRun,

  // telegram
  normalizeTelegramSettings,
  sendTelegramMessage,

  // sync orchestration
  executeSyncRun,
  resetTwoWayStateForRecovery,
  runCompareOnly,

  // history / retention / restore points / restore
  listHistoryVersions,
  restoreHistoryVersion,
  deleteHistoryCacheForJob,
  emptyJobHistoryDeleteSummary,
  aggregateJobHistoryDeleteSummaries,
  formatHistoryRunId,
  listRestorePoints,
  readRestorePointManifest,
  previewRestorePointPlan,
  restoreRestorePointToFolder,
  deleteRestorePointsForJob,
  checkStorageForRequest,

  // sync event bus
  emitSyncEvent
});

// Build the compare/run fingerprint from a job's fields, applying the shared
// transforms (mode normalization, mirror-aware skip-older, the `!== false`
// defaults) in ONE place so the ~8 call sites in runCompareOnly/executeSyncRun
// can't drift on how the fingerprint inputs are derived. targetPath is passed
// explicitly because each caller resolves its own primaryTargetPath.
function makeJobFingerprint({
  syncMode,
  twoWayConflictPolicy,
  sourcePaths,
  targetPath,
  targetDestinations,
  excludePatterns,
  skipOlderSource,
  copySubfolders,
  historyEnabled,
  historyFolderName,
  freeSpaceCheckEnabled,
  minimumFreeGb
}) {
  return makeCompareFingerprint({
    syncMode: normalizeSyncMode(syncMode),
    twoWayConflictPolicy,
    sourcePaths,
    targetPath,
    targetDestinations,
    excludePatterns,
    skipOlderSource: resolveSkipOlderSource(syncMode, skipOlderSource),
    copySubfolders: copySubfolders !== false,
    historyEnabled: historyEnabled !== false,
    historyFolderName,
    freeSpaceCheckEnabled: freeSpaceCheckEnabled !== false,
    minimumFreeGb
  });
}

async function runCompareOnly(request = {}) {
  const {
    id,
    name,
    syncMode,
    twoWayConflictPolicy,
    sourcePath,
    sourcePaths,
    targetPath,
    targetDestinations,
    excludePatterns,
    skipOlderSource,
    copySubfolders,
    historyEnabled,
    historyFolderName,
    freeSpaceCheckEnabled,
    minimumFreeGb
  } = request || {};
  const acknowledgeScheduledConflict = request.backgroundScheduled !== true && request.backgroundWatched !== true;

  if (request && request.enabled === false) {
    return {
      ok: false,
      code: null,
      status: 'disabled',
      message: 'This job is disabled.',
      output: '',
      summary: null,
      preview: { ok: false, message: 'This job is disabled.', summary: null, files: [] }
    };
  }

  const modeMessage = assertCompareModeRunnable(syncMode);
  if (modeMessage) {
    return {
      ok: false,
      code: null,
      status: 'unsupported-sync-mode',
      message: modeMessage,
      output: modeMessage,
      summary: null,
      preview: { ok: false, message: modeMessage, summary: null, files: [] }
    };
  }

  if (!isOperationSupported('compare')) {
    const unsupported = buildUnsupportedOperationResult('compare');
    return {
      ...unsupported,
      preview: { ok: false, message: unsupported.message, summary: null, files: [] }
    };
  }
  const syncEngine = getSyncEngine();
  const syncInterface = syncEngine.interface;

  if (isOperationBusy({
    allowBackgroundScheduler: request && request.backgroundScheduled === true,
    allowSmartWatcher: request && request.backgroundWatched === true
  })) {
    return {
      ok: false,
      code: null,
      status: 'busy',
      message: BUSY_MESSAGE,
      output: '',
      summary: null,
      preview: { ok: false, message: BUSY_MESSAGE, summary: null, files: [] }
    };
  }

  const { cleanSourcePaths, cleanDestinations, jobId, jobName, cleanHistoryFolderName, cleanTwoWayConflictPolicy, cleanExcludePatterns } = parseRunRequest(request);

  if (!cleanSourcePaths.length || !cleanDestinations.length) {
    return {
      ok: false,
      code: null,
      status: 'error',
      message: 'At least one source folder and one destination are required.',
      output: '',
      summary: null,
      preview: { ok: false, message: 'At least one source folder and one destination are required.', summary: null, files: [] }
    };
  }

  const runStartedAt = new Date();
  const runId = formatHistoryRunId(runStartedAt);

  activeCancellationRequest = null;
  activeRunId = runId;

  const successfulDestinations = [];
  const successfulSourceRoots = [];
  const skippedDestinations = [];
  const runProgressState = createEngineProgressState();
  let combined = '';
  let aggregateCode = 0;
  let fatalResult = null;

  const primaryTargetPath = cleanDestinations[0] ? cleanDestinations[0].path : targetPath;
  const compareFingerprint = makeJobFingerprint({ syncMode, twoWayConflictPolicy: cleanTwoWayConflictPolicy, sourcePaths: cleanSourcePaths, targetPath: primaryTargetPath, targetDestinations: cleanDestinations, excludePatterns: cleanExcludePatterns, skipOlderSource, copySubfolders, historyEnabled, historyFolderName: cleanHistoryFolderName, freeSpaceCheckEnabled, minimumFreeGb });

  // Fill the fields every terminal compare result shares; callers pass the parts
  // that vary (ok/code/status/message/summary/history/storage/preview).
  const makeCompareResult = (parts) => ({
    ok: false,
    code: null,
    status: 'error',
    message: '',
    output: combined,
    summary: null,
    history: null,
    storage: null,
    retention: null,
    jobId,
    jobName,
    syncMode: normalizeSyncMode(syncMode),
    targetDestinations: cleanDestinations,
    skippedDestinations,
    compareCreatedAt: runStartedAt.toISOString(),
    compareFingerprint,
    preview: null,
    ...parts
  });

  // Persist the run record, optionally notify, emit the terminal 'complete'
  // event, and return the result. swallowSaveError mirrors the catch-block paths
  // that must keep their result even if the save fails.
  const saveAndEmitCompare = async (result, { pending, notify = true, swallowSaveError = false } = {}) => {
    const save = saveCompareRunRecord({ result, runStartedAt, jobId, jobName, sourcePaths: cleanSourcePaths, targetPath: primaryTargetPath, targetDestinations: cleanDestinations, skippedDestinations, acknowledgeScheduledConflict, pending });
    if (swallowSaveError) {
      try { await save; } catch { /* keep the result; persistence is best-effort */ }
    } else {
      await save;
    }
    if (notify) notifyJobRunIfNeeded({ request, result, dryRun: true }).catch(() => {});
    emitSyncEvent({ type: 'complete', runId, dryRun: true, result });
    return result;
  };

  try {
    emitSyncEvent({
      type: 'stdout',
      runId,
      dryRun: true,
      text: `Compare started for ${cleanSourcePaths.length} source(s) and ${cleanDestinations.length} destination(s).\n`
    });

    for (const destination of cleanDestinations) {
      throwIfRunCancelled(runId);
      const sourceRoots = buildDestinationSourceRoots({ sourcePaths: cleanSourcePaths, destinations: [destination] });
      const destinationHeader = `\n--- Destination: ${destination.label || 'Destination'} (${destination.required !== false ? 'required' : 'optional'}) | ${destination.path} ---\n`;
      combined += destinationHeader;
      emitSyncEvent({ type: 'stdout', runId, dryRun: true, text: destinationHeader });

      const result = await runSyncEngineSequence({
        runId,
        dryRun: true,
        sourceRoots,
        excludePatterns: cleanExcludePatterns,
        skipOlderSource: skipOlderSource !== false,
        copySubfolders: copySubfolders !== false,
        syncMode: normalizeSyncMode(syncMode),
        progressState: runProgressState
      });

      combined += result.output;
      if (result.canceled || isActiveRunCancelled(runId)) {
        const cancelled = makeCancelledRunResult({
          runId,
          dryRun: true,
          output: combined,
          summary: syncInterface.parseSummary(combined),
          jobId,
          jobName,
          syncMode,
          targetDestinations: cleanDestinations,
          skippedDestinations,
          compareCreatedAt: runStartedAt.toISOString(),
          compareFingerprint
        });
        await saveAndEmitCompare(cancelled, { pending: false, notify: false });
        clearActiveRunState();
        return cancelled;
      }
      const code = Number.isFinite(result.code) ? result.code : 16;
      const interpreted = syncInterface.interpretExitCode(code);

      if (!interpreted.ok && destination.required === false) {
        const skipped = {
          ...destination,
          available: false,
          creatable: false,
          reason: result.timedOut ? 'compare-timed-out' : 'optional-compare-failed'
        };
        skippedDestinations.push(skipped);
        const skipText = `Optional destination skipped during compare: ${destination.label} (${destination.path}) - ${interpreted.message}\n`;
        combined += skipText;
        emitSyncEvent({ type: 'stdout', runId, dryRun: true, text: skipText });
        continue;
      }

      aggregateCode = mergeEngineExitCodes(syncEngine, aggregateCode, code);

      if (!interpreted.ok) {
        fatalResult = { destination, code, interpreted, output: result.output, timedOut: result.timedOut };
        break;
      }

      successfulDestinations.push(destination);
      successfulSourceRoots.push(...sourceRoots);
    }

    if (fatalResult) {
      const message = fatalResult.timedOut
        ? `Required destination compare timed out: ${fatalResult.destination.label} (${fatalResult.destination.path}).`
        : `Required destination compare failed: ${fatalResult.destination.label} (${fatalResult.destination.path}). ${fatalResult.interpreted.message}`;
      const summary = syncInterface.parseSummary(combined);
      const result = makeCompareResult({
        code: fatalResult.code,
        status: fatalResult.interpreted.status,
        message,
        summary,
        preview: { ok: false, message, summary: null, files: [], skippedDestinations }
      });
      return await saveAndEmitCompare(result, { pending: false });
    }

    if (!successfulDestinations.length) {
      const message = 'No destination was available for compare. Optional destinations were skipped.';
      const result = makeCompareResult({
        status: 'no-destination-available',
        message,
        preview: { ok: false, message, summary: null, files: [], skippedDestinations }
      });
      return await saveAndEmitCompare(result, { pending: false });
    }

    const summary = syncInterface.parseSummary(combined);
    const interpreted = reconcileNoChangeStatus({
      interpreted: syncInterface.interpretExitCode(aggregateCode),
      fileCounts: syncInterface.getFileCounts(summary),
      summary,
      syncMode
    });
    const finalStatus = applyDestinationWarningStatus(interpreted, skippedDestinations);
    const preview = normalizeSyncMode(syncMode) === 'twoWay'
      ? await buildTwoWayComparePreview({
          sourceRoots: successfulSourceRoots,
          destinations: cleanDestinations,
          excludePatterns: cleanExcludePatterns,
          copySubfolders: copySubfolders !== false,
          historyEnabled: historyEnabled !== false,
          jobId,
          basePath: app.getPath('userData'),
          conflictPolicy: cleanTwoWayConflictPolicy,
          collectFiles: collectSourceFiles,
          openState: createTwoWayState
        })
      : syncEngine.id === 'robocopy'
        ? buildRobocopyDryRunPreview({
            output: combined,
            sourceRoots: successfulSourceRoots,
            destinations: successfulDestinations,
            historyEnabled: historyEnabled !== false,
            historyFolderName: cleanHistoryFolderName,
            syncMode: normalizeSyncMode(syncMode)
          })
        : await buildInternalComparePreview({
            sourcePaths: cleanSourcePaths,
            destinations: successfulDestinations,
            skippedDestinations,
            excludePatterns: cleanExcludePatterns,
            skipOlderSource: resolveSkipOlderSource(syncMode, skipOlderSource),
            copySubfolders: copySubfolders !== false,
            historyEnabled: historyEnabled !== false,
            historyFolderName: cleanHistoryFolderName,
            syncMode: normalizeSyncMode(syncMode)
          });

    preview.summary = makeSkippedOptionalPreviewSummary(preview.summary, skippedDestinations);

    const previewResult = {
      ok: finalStatus.ok,
      message: finalStatus.ok
        ? buildCompareCompletionMessage({ syncMode: normalizeSyncMode(syncMode), previewSummary: preview.summary, finalStatus })
        : finalStatus.message,
      summary: preview.summary,
      files: preview.files,
      storage: { ok: true, checked: false, skipped: true, message: freeSpaceCheckEnabled === false ? 'Free-space check is disabled.' : 'Free-space check runs during update sync.' },
      skippedDestinations
    };

    const result = makeCompareResult({
      ok: finalStatus.ok,
      code: aggregateCode,
      status: finalStatus.status,
      message: previewResult.message,
      summary,
      history: preview.summary,
      storage: previewResult.storage,
      preview: previewResult
    });

    return await saveAndEmitCompare(result, { pending: finalStatus.ok });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (isCancellationError(error)) {
      const cancelled = makeCancelledRunResult({
        runId,
        dryRun: true,
        output: combined,
        jobId,
        jobName,
        syncMode,
        targetDestinations: cleanDestinations,
        skippedDestinations,
        compareCreatedAt: runStartedAt.toISOString(),
        compareFingerprint
      });
      return await saveAndEmitCompare(cancelled, { pending: false, notify: false, swallowSaveError: true });
    }
    const result = makeCompareResult({
      message,
      output: combined + `\n${message}\n`,
      preview: { ok: false, message, summary: null, files: [], skippedDestinations }
    });
    return await saveAndEmitCompare(result, { pending: false, swallowSaveError: true });
  } finally {
    clearActiveRunState();
  }
}

async function saveCompareRunRecord({ result, runStartedAt, jobId, jobName, sourcePaths, targetPath, targetDestinations, skippedDestinations, acknowledgeScheduledConflict = false, pending }) {
  const config = await readConfig();
  const nextRuns = [
    {
      at: new Date().toISOString(),
      dryRun: true,
      code: result.code ?? null,
      status: result.status || (result.ok ? 'success' : 'error'),
      ok: result.ok === true,
      message: result.message || '',
      output: trimSavedRunOutput(result.output || ''),
      sourcePath: sourcePaths[0] || '',
      sourcePaths,
      targetPath,
      targetDestinations,
      skippedDestinations,
      syncMode: normalizeSyncMode(result.syncMode),
      summary: result.summary || null,
      history: result.history || null,
      storage: result.storage || null,
      retention: null,
      jobId,
      jobName
    },
    ...(config.lastRuns || [])
  ].slice(0, 20);

  const pendingCompares = { ...(config.pendingCompares || {}) };
  if (pending && result.preview && result.preview.ok) {
    pendingCompares[jobId] = makePendingCompare({
      jobId,
      jobName,
      syncMode: normalizeSyncMode(result.syncMode),
      sourcePaths,
      targetPath,
      targetDestinations,
      fingerprint: result.compareFingerprint,
      createdAt: runStartedAt,
      result: {
        ok: true,
        message: result.message || '',
        history: result.history || null,
        previewFiles: result.preview.files || [],
        storage: result.storage || null
      }
    });
  } else {
    delete pendingCompares[jobId];
  }

  let acknowledged = false;
  const jobs = (config.jobs || []).map((job) => {
    if (!acknowledgeScheduledConflict || result.ok !== true || sanitizeJobId(job.id) !== jobId) return job;
    const schedule = normalizeSchedule(job.schedule);
    if (String(schedule.lastRun && schedule.lastRun.status || '').toLowerCase() !== RUN_STATUS.CONFLICTS) return job;
    schedule.lastRun = { ...schedule.lastRun, conflictAcknowledgedAt: new Date().toISOString() };
    acknowledged = true;
    return { ...job, schedule };
  });

  await writeConfig({ ...config, jobs, lastRuns: nextRuns, pendingCompares });
  if (acknowledged && backgroundScheduler) await backgroundScheduler.refresh();
}


async function runTwoWaySyncRun({
  request,
  cleanSourcePaths,
  cleanDestinations,
  jobId,
  jobName,
  copySubfolders,
  historyEnabled,
  retentionEnabled,
  retentionMaxVersions,
  retentionMaxAgeDays,
  retentionKeepLatest,
  retentionPruneEmptyFolders,
  retentionPruneAfterSync,
  restorePointsEnabled,
  restorePointRetentionMax
}) {
  const runStartedAt = new Date();
  const runId = formatHistoryRunId(runStartedAt);
  const { cleanHistoryFolderName, cleanTwoWayConflictPolicy, cleanExcludePatterns } = parseRunRequest(request);
  const primaryTargetPath = cleanDestinations[0] ? cleanDestinations[0].path : '';

  activeCancellationRequest = null;
  activeRunId = runId;

  emitSyncEvent({ type: 'stdout', runId, dryRun: false, text: `Two-way sync started for ${cleanSourcePaths.length} source(s) and ${cleanDestinations.length} destination(s).\n` });
  let runJournal = null;

  const makeCancelled = async () => {
    const cancelled = makeCancelledRunResult({ runId, dryRun: false, output: 'Two-way sync canceled.\n', jobId, jobName, syncMode: 'twoWay', targetDestinations: cleanDestinations, skippedDestinations: [] });
    await finishRunJournal(runJournal, 'cancelled', { message: cancelled.message });
    emitSyncEvent({ type: 'complete', runId, dryRun: false, result: cancelled });
    clearActiveRunState();
    return cancelled;
  };

  try {
    const sourceRoots = buildDestinationSourceRoots({ sourcePaths: cleanSourcePaths, destinations: cleanDestinations });
    runJournal = await getRunJournalStore().createRun({
      runId,
      jobId,
      jobName,
      syncMode: 'twoWay',
      trigger: getRunTrigger(request),
      startedAt: runStartedAt,
      job: makeJournalJobSnapshot(request, { jobId, jobName, sourcePaths: cleanSourcePaths, targetDestinations: cleanDestinations }),
      sourcePaths: cleanSourcePaths,
      targetDestinations: cleanDestinations
    });
    const apply = await runTwoWayApply({
      sourceRoots,
      destinations: cleanDestinations,
      excludePatterns: cleanExcludePatterns,
      copySubfolders: copySubfolders !== false,
      historyEnabled: historyEnabled !== false,
      historyFolderName: cleanHistoryFolderName,
      jobId,
      basePath: app.getPath('userData'),
      runId,
      conflictPolicy: cleanTwoWayConflictPolicy,
      collectFiles: collectSourceFiles,
      openState: createTwoWayState,
      prepareHistoryRoot: markHistoryFolderHidden,
      isCancelled: () => isActiveRunCancelled(runId),
      onProgress: (progress) => emitSyncEvent({ type: 'progress', runId, dryRun: false, progress }),
      onPlan: ({ operations }) => getRunJournalStore().plan(runJournal, operations),
      onOperation: (operationId, patch) => getRunJournalStore().recordOperation(runJournal, operationId, patch)
    });

    if (apply.status === RUN_STATUS.CANCELLED) return await makeCancelled();

    const deletes = Number(apply.deletedOnDest || 0) + Number(apply.deletedOnSource || 0);
    const summary = {
      twoWay: true,
      conflictPolicy: cleanTwoWayConflictPolicy,
      enabled: historyEnabled !== false,
      wouldCopy: Number(apply.copiedToDest || 0) + Number(apply.copiedToSource || 0),
      copyToDest: Number(apply.copiedToDest || 0),
      copyToSource: Number(apply.copiedToSource || 0),
      deleteOnDest: Number(apply.deletedOnDest || 0),
      deleteOnSource: Number(apply.deletedOnSource || 0),
      keepBoth: Number(apply.keptBoth || 0),
      conflicts: Number(apply.conflicts || 0),
      archived: Number(apply.archived || 0),
      copyBytes: Number(apply.bytesCopied || 0),
      archiveBytes: apply.archives.reduce((total, archive) => total + Number(archive && archive.previous && archive.previous.size || 0), 0),
      destinationOnly: deletes,
      previewFiles: Number(apply.copiedToDest || 0) + Number(apply.copiedToSource || 0) + deletes + Number(apply.keptBoth || 0),
      errors: apply.errors.length
    };
    let historyManifests = [];
    if (historyEnabled !== false && apply.archives.length) {
      try {
        historyManifests = await createTwoWayHistoryManifests({
          archives: apply.archives,
          runId,
          createdAt: runStartedAt,
          completedAt: new Date().toISOString(),
          jobId,
          jobName,
          sourcePaths: cleanSourcePaths,
          targetDestinations: cleanDestinations,
          historyFolderName: cleanHistoryFolderName,
          status: apply.ok ? 'success' : 'error'
        });
      } catch (error) {
        apply.ok = false;
        apply.errors.push({ relativePath: '', op: 'historyManifest', message: error.message || String(error) });
        summary.errors = apply.errors.length;
      }
    }

    const manifestPaths = historyManifests.map((manifest) => manifest.manifestPath);
    const historySummary = {
      ...summary,
      historyFolderName: cleanHistoryFolderName,
      archived: Number(apply.archived || 0),
      manifestPath: manifestPaths[0] || null,
      manifestPaths
    };
    emitSyncEvent({
      type: 'history',
      phase: 'archived',
      runId,
      dryRun: false,
      syncMode: 'twoWay',
      history: historySummary,
      jobId,
      jobName
    });

    const ok = apply.ok === true;
    const changed = Number(summary.previewFiles || 0) > 0;
    const message = `Two-way sync ${ok ? 'completed' : 'completed with errors'}: ${summary.copyToDest} to destination, ${summary.copyToSource} to source, ${deletes} deleted, ${summary.conflicts} conflict(s)${summary.errors ? `, ${summary.errors} error(s)` : ''}.`;
    let retentionResult = null;
    if (ok && changed && retentionEnabled === true && retentionPruneAfterSync === true) {
      try {
        retentionResult = await runRetentionPolicy({
          syncMode: 'twoWay',
          sourcePaths: cleanSourcePaths,
          targetDestinations: cleanDestinations,
          historyFolderName: cleanHistoryFolderName,
          retentionMaxVersions,
          retentionMaxAgeDays,
          retentionKeepLatest,
          retentionPruneEmptyFolders,
          jobId,
          apply: true
        });
      } catch (error) {
        retentionResult = {
          ok: false,
          message: error.message || String(error),
          summary: emptyRetentionSummary()
        };
      }
      emitSyncEvent({ type: 'retention', runId, retention: retentionResult });
    }

    let restorePoint = null;
    if (ok && changed && restorePointsEnabled === true) {
      try {
        restorePoint = await createRestorePointManifest({
          basePath: app.getPath('userData'),
          jobId,
          jobName,
          runId,
          syncMode: 'twoWay',
          createdAt: runStartedAt,
          sourcePaths: cleanSourcePaths,
          destinations: normalizeHistoryLocations({
            syncMode: 'twoWay',
            sourcePaths: cleanSourcePaths,
            targetDestinations: cleanDestinations
          }),
          excludePatterns: cleanExcludePatterns,
          historyFolderName: cleanHistoryFolderName,
          historySummary,
          robocopySummary: {
            files: { copied: summary.wouldCopy, extras: deletes, failed: summary.errors },
            bytes: {}
          },
          status: 'success',
          message,
          maxRestorePoints: restorePointRetentionMax,
          onProgress: (progress) => emitSyncEvent({
            type: 'progress',
            runId,
            dryRun: false,
            progress: {
              kind: 'phase',
              label: 'Indexing two-way restore point',
              latestText: `Indexing restore point - ${Number(progress && progress.scannedFiles || 0).toLocaleString()} file(s) scanned`,
              latestFile: progress && progress.currentPath ? progress.currentPath : '',
              copied: summary.wouldCopy,
              skipped: 0,
              failed: summary.errors,
              extra: deletes
            }
          })
        });
      } catch (error) {
        restorePoint = { ok: false, message: error.message || String(error) };
      }

      emitSyncEvent({ type: 'restore-point', runId, restorePoint, jobId, jobName });
    }
    const output = [
      `--- TWO-WAY SYNC ${runStartedAt.toLocaleString()} ---`,
      `Job: ${jobName || 'Sync job'}`,
      message,
      ...apply.errors.slice(0, 50).map((e) => `ERROR ${e.op} ${e.relativePath}: ${e.message}`),
      ''
    ].join('\n');

    const result = {
      ok,
      code: ok ? 0 : 8,
      status: ok ? 'success' : 'error',
      message,
      output,
      summary,
      history: historySummary,
      storage: { ok: true, checked: false, skipped: true, message: 'Free-space check is not applied to two-way sync yet.' },
      retention: retentionResult,
      restorePoint,
      jobId,
      jobName,
      syncMode: 'twoWay',
      targetDestinations: cleanDestinations,
      skippedDestinations: [],
      destinationResults: cleanDestinations.map((destination) => ({
        destinationPath: destination.path,
        destinationLabel: destination.label,
        destinationRequired: destination.required !== false,
        destinationRole: destination.required !== false ? 'required' : 'optional',
        code: ok ? 0 : 8,
        status: ok ? 'success' : 'error',
        message
      })),
      compareCreatedAt: runStartedAt.toISOString()
    };

    try {
      const config = await readConfig();
      const nextRuns = [{
        at: new Date().toISOString(), dryRun: false, code: result.code, status: result.status, ok: result.ok === true,
        message: result.message, output: trimSavedRunOutput(result.output || ''),
        sourcePath: cleanSourcePaths[0] || '', sourcePaths: cleanSourcePaths, targetPath: primaryTargetPath,
        targetDestinations: cleanDestinations, skippedDestinations: [], destinationResults: result.destinationResults,
        summary: result.summary, history: result.history, storage: result.storage, retention: result.retention, restorePoint: result.restorePoint || null,
        syncMode: 'twoWay', jobId, jobName
      }, ...(config.lastRuns || [])].slice(0, 20);
      const pendingCompares = { ...(config.pendingCompares || {}) };
      delete pendingCompares[jobId];
      await writeConfig({ ...config, lastRuns: nextRuns, pendingCompares });
    } catch {
      // Keep the result even if run history cannot be saved.
    }

    notifyJobRunIfNeeded({ request, result, dryRun: false }).catch(() => {});
    await finishRunJournal(runJournal, result.ok ? 'completed' : 'failed', {
      message: result.message,
      status: result.status,
      summary: result.summary
    });
    emitSyncEvent({ type: 'complete', runId, dryRun: false, result });
    clearActiveRunState();
    return result;
  } catch (error) {
    if (isCancellationError(error)) return await makeCancelled();
    const msg = error && error.message ? error.message : String(error);
    const result = { ok: false, code: null, status: 'error', message: msg, output: `${msg}\n`, summary: null, history: null, storage: null, retention: null, jobId, jobName, syncMode: 'twoWay', targetDestinations: cleanDestinations, skippedDestinations: [] };
    await finishRunJournal(runJournal, 'failed', { message: msg });
    emitSyncEvent({ type: 'complete', runId, dryRun: false, result });
    clearActiveRunState();
    return result;
  }
}

// executeSyncRun was extracted verbatim into ./main/sync-run.js (createSyncRun).
// This thin, hoisted wrapper lazily instantiates the runner on first call so the
// deps bundle is resolved at run time — after every module-level binding exists —
// sidestepping declaration-order/TDZ concerns. Behavior is unchanged.
let _syncRunInstance = null;
function executeSyncRun(request = {}) {
  if (!_syncRunInstance) {
    _syncRunInstance = createSyncRun({
      assertCompareModeRunnable, assertSyncModeRunnable, isOperationSupported, buildUnsupportedOperationResult,
      getSyncEngine, isOperationBusy, BUSY_MESSAGE, parseRunRequest, pathIsDirectory, PATH_CHECK_TIMEOUT_MS,
      normalizeSyncMode, runTwoWaySyncRun, resolveDestinationAvailability, formatHistoryRunId, createEngineProgressState,
      emitSyncEvent, appendSkippedDestinationLog, throwIfRunCancelled, buildDestinationSourceRoots, runSyncEngineSequence,
      isActiveRunCancelled, makeCancelledRunResult, makeJobFingerprint, clearActiveRunState, reconcileNoChangeStatus,
      applyDestinationWarningStatus, buildRobocopyDryRunPreview, buildInternalComparePreview, resolveSkipOlderSource,
      makeSkippedOptionalPreviewSummary, buildCompareCompletionMessage, readConfig, writeConfig, trimSavedRunOutput,
      makePendingCompare, notifyJobRunIfNeeded, analyzeMultiDestinationHistoryPlan, checkStorageForDestinationPlans,
      isNoOpSyncPlan, makeNoOpRobocopySummary, buildNoOpSyncMessage, getRunJournalStore, getRunTrigger,
      makeJournalJobSnapshot, buildOneWayJournalOperations, createHistorySnapshot, isCancellationError, finishRunJournal,
      mergeEngineExitCodes, buildSyncCompletionMessage, finalizeHistoryManifest, runRetentionPolicy, emptyRetentionSummary,
      aggregateRetentionResults, createRestorePointManifest, app,
      setActiveRunId, setActiveProcess, setActiveCancellationRequest
    });
  }
  return _syncRunInstance.executeSyncRun(request);
}

async function pathIsDirectory(inputPath, options = {}) {
  const timeoutMs = Number(options.timeoutMs || PATH_CHECK_TIMEOUT_MS);
  const clean = String(inputPath || '').trim();
  if (!clean) return false;

  const check = fs.stat(clean)
    .then((stats) => stats.isDirectory())
    .catch(() => false);

  if (!timeoutMs || timeoutMs <= 0) return await check;

  return await Promise.race([
    check,
    new Promise((resolve) => {
      setTimeout(() => resolve(false), timeoutMs);
    })
  ]);
}

async function buildSyncPreview(request) {
  const {
    sourcePath,
    sourcePaths,
    targetPath,
    targetDestinations,
    excludePatterns,
    skipOlderSource,
    copySubfolders,
    historyEnabled,
    historyFolderName,
    freeSpaceCheckEnabled,
    minimumFreeGb,
    syncMode
  } = request || {};

  const { cleanSourcePaths, cleanDestinations, cleanHistoryFolderName, cleanExcludePatterns } = parseRunRequest(request);

  if (!cleanSourcePaths.length || !cleanDestinations.length) {
    return {
      ok: false,
      message: 'At least one source folder and one destination are required.',
      summary: null,
      files: [],
      storage: null
    };
  }

  for (const candidateSource of cleanSourcePaths) {
    const sourceExists = await pathIsDirectory(candidateSource, { timeoutMs: PATH_CHECK_TIMEOUT_MS });
    if (!sourceExists) {
      return {
        ok: false,
        message: `Source folder does not exist or is not readable: ${candidateSource}`,
        summary: null,
        files: [],
        storage: null
      };
    }
  }

  const destinationAvailability = await resolveDestinationAvailability(cleanDestinations, { allowCreatable: true });
  if (destinationAvailability.missingRequired.length) {
    return {
      ok: false,
      message: `Required destination is missing or unreadable: ${destinationAvailability.missingRequired.map((item) => `${item.label} (${item.path})`).join(', ')}`,
      summary: null,
      files: [],
      storage: null,
      skippedDestinations: destinationAvailability.skipped,
      missingRequiredDestinations: destinationAvailability.missingRequired
    };
  }

  if (!destinationAvailability.available.length) {
    return {
      ok: false,
      message: 'No destination is currently available. Optional destinations were skipped, but there was nowhere to preview.',
      summary: null,
      files: [],
      storage: null,
      skippedDestinations: destinationAvailability.skipped
    };
  }

  const historyPlan = await analyzeMultiDestinationHistoryPlan({
    sourcePaths: cleanSourcePaths,
    destinations: destinationAvailability.available,
    skippedDestinations: destinationAvailability.skipped,
    excludePatterns: cleanExcludePatterns,
    skipOlderSource: resolveSkipOlderSource(syncMode, skipOlderSource),
    copySubfolders: copySubfolders !== false,
    historyEnabled: historyEnabled !== false,
    historyFolderName: cleanHistoryFolderName,
    syncMode: normalizeSyncMode(syncMode)
  });
  const storage = freeSpaceCheckEnabled === false
    ? { ok: true, checked: false, skipped: true, message: 'Free-space check is disabled.' }
    : await checkStorageForDestinationPlans({
      destinationPlans: historyPlan.destinationPlans,
      historyEnabled: historyEnabled !== false,
      minimumFreeGb
    });

  const skippedText = destinationAvailability.skipped.length
    ? ` ${destinationAvailability.skipped.length} optional destination(s) skipped.`
    : '';

  return {
    ok: true,
    message: historyPlan.summary.previewFiles
      ? buildCompareCompletionMessage({
          syncMode: normalizeSyncMode(syncMode),
          previewSummary: historyPlan.summary,
          finalStatus: { ok: true, status: destinationAvailability.skipped.length ? 'warning' : 'success', optionalIssueCount: destinationAvailability.skipped.length }
        })
      : `No file changes found.${skippedText}`,
    summary: historyPlan.summary,
    files: historyPlan.previewFiles,
    storage,
    targetDestinations: cleanDestinations,
    skippedDestinations: destinationAvailability.skipped
  };
}



// The file-history-plan subsystem (analyzeFileHistoryPlan, the mirror-delete
// archival decision, createHistorySnapshot, finalizeHistoryManifest, and the
// multi-source / multi-destination aggregators) was extracted verbatim into
// ./main/history-plan.js (createHistoryPlan). This thin, hoisted wrapper lazily
// instantiates the factory on first use so the injected collaborators
// (fs, collectSourceFiles, throwIfRunCancelled) resolve at run time — after every
// module-level binding exists. Only the three externally-referenced entry points
// are re-exposed; the other five functions are internal to the subsystem.
let _historyPlanInstance = null;
function getHistoryPlan() {
  if (!_historyPlanInstance) {
    _historyPlanInstance = createHistoryPlan({ fs, collectSourceFiles, throwIfRunCancelled });
  }
  return _historyPlanInstance;
}
function analyzeMultiDestinationHistoryPlan(options) {
  return getHistoryPlan().analyzeMultiDestinationHistoryPlan(options);
}
function createHistorySnapshot(options) {
  return getHistoryPlan().createHistorySnapshot(options);
}
function finalizeHistoryManifest(manifestPath, result) {
  return getHistoryPlan().finalizeHistoryManifest(manifestPath, result);
}


// The per-file fs helpers, the exclude matcher, and the path-safety helpers
// now live in src/main/fs-utils.js (imported above). collectSourceFiles is
// wrapped here so it keeps closing over the cancellation singleton + stat
// concurrency; every call site (including the two-way `collectFiles`
// injection) behaves exactly as before.
function collectSourceFiles(options) {
  return collectSourceFilesRaw({
    ...options,
    throwIfCancelled: throwIfRunCancelled,
    concurrency: HISTORY_STAT_CONCURRENCY
  });
}
