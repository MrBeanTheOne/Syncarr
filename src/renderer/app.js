const {
  renderFileIcon,
  renderFolderIcon,
  fileKindLabel,
  cssEscape,
  joinForDisplay,
  formatDate,
  readNumberInput,
  formatNumber,
  formatBytes,
  escapeAttr,
  escapeHtml,
  formatDateTime,
  formatDuration,
  formatRelativeAge,
  withTimeout
} = window.SyncarrRendererUtils;

const {
  buildRunHistoryStatsText
} = window.SyncarrRunHistoryUtils;

const {
  applyTelegramSettingsToForm: applyTelegramSettingsToFormUtil,
  updateTelegramSettingsVisibility: updateTelegramSettingsVisibilityUtil,
  getTelegramSettingsFromForm: getTelegramSettingsFromFormUtil,
  renderTelegramStatus: renderTelegramStatusUtil
} = window.SyncarrTelegramUtils;

const {
  modeLabel: restorePointModeLabel,
  restorePointTypeLabel,
  restorePointSummaryText,
  restorePointStatusTone
} = window.SyncarrRestorePointUtils;

const {
  renderSelectionCard: renderInspectorSelectionCard,
  renderActionNote: renderInspectorActionNote
} = window.SyncarrHistoryInspectorUtils;

const {
  renderManifestOverview: renderRestorePointManifestOverview
} = window.SyncarrRestorePointDetailsUtils;

const {
  baseName: restorePointBaseName,
  parseCwd: parseRestorePointCwd,
  renderBreadcrumb: renderRestorePointBrowserBreadcrumb,
  renderBrowser: renderRestorePointManifestBrowser,
  describeCwd: describeRestorePointCwd
} = window.SyncarrRestorePointBrowserUtils;

const {
  renderRestorePointPlan
} = window.SyncarrRestorePointPlanUtils;

const {
  isMirrorMode,
  getDestinationOnlyHelp,
  getDestinationOnlyState,
  getCompareModeLabels
} = window.SyncarrCompareLabels;
window.SyncarrCompareLabels.configure({ normalizeSyncMode });

const {
  getProgressVisualAction,
  getProgressActionStatus,
  getProgressFileLine,
  getProgressCompletedCount
} = window.SyncarrRunProgress;
window.SyncarrRunProgress.configure({ isMirrorMode });

const {
  previewSidePathLabel,
  joinPreviewDisplayPath,
  compactPreviewPath,
  previewFileSize,
  formatSizeTransition,
  twoWaySideMeta,
  previewFolderTone,
  previewActionClass
} = window.SyncarrPreviewFormat;

const {
  formatStorageLog,
  formatRetentionLog,
  formatRestorePointLog,
  buildRunLog
} = window.SyncarrRunLogFormat;
window.SyncarrRunLogFormat.configure({ normalizeSourcePaths, normalizeTargetDestinations, normalizeSyncMode });

const {
  sanitizePreviewPathPart,
  buildPreviewFileMap,
  previewEntriesAt,
  summarizePreviewActions,
  getPreviewActionCounts
} = window.SyncarrPreviewModel;

const { previewHasActionableWork } = window.SyncarrPreviewActionable;
const { computeSyncSummaryMetrics } = window.SyncarrSummaryMetrics;

const els = {
  pageTitle: document.getElementById('pageTitle'),
  pageEyebrowText: document.getElementById('pageEyebrowText'),
  jobName: document.getElementById('jobName'),
  jobEnabled: document.getElementById('jobEnabled'),
  jobNotificationsEnabled: document.getElementById('jobNotificationsEnabled'),
  jobConflictWarning: document.getElementById('jobConflictWarning'),
  syncMode: document.getElementById('syncMode'),
  syncModeDescription: document.getElementById('syncModeDescription'),
  twoWayConflictPolicyField: document.getElementById('twoWayConflictPolicyField'),
  twoWayConflictPolicy: document.getElementById('twoWayConflictPolicy'),
  twoWayConflictPolicyDescription: document.getElementById('twoWayConflictPolicyDescription'),
  sourcePath: document.getElementById('sourcePath'),
  sourceList: document.getElementById('sourceList'),
  addSourceBtn: document.getElementById('addSourceBtn'),
  targetPath: document.getElementById('targetPath'),
  targetList: document.getElementById('targetList'),
  addDestinationBtn: document.getElementById('addDestinationBtn'),
  historyEnabled: document.getElementById('historyEnabled'),
  freeSpaceCheckEnabled: document.getElementById('freeSpaceCheckEnabled'),
  minimumFreeGb: document.getElementById('minimumFreeGb'),
  restorePointsEnabled: document.getElementById('restorePointsEnabled'),
  retentionEnabled: document.getElementById('retentionEnabled'),
  retentionMaxVersions: document.getElementById('retentionMaxVersions'),
  retentionMaxAgeDays: document.getElementById('retentionMaxAgeDays'),
  retentionKeepLatest: document.getElementById('retentionKeepLatest'),
  retentionPruneEmptyFolders: document.getElementById('retentionPruneEmptyFolders'),
  retentionPruneAfterSync: document.getElementById('retentionPruneAfterSync'),
  fileHistoryOptions: document.getElementById('fileHistoryOptions'),
  retentionOptions: document.getElementById('retentionOptions'),
  skipOlderSource: document.getElementById('skipOlderSource'),
  copySubfolders: document.getElementById('copySubfolders'),
  saveJobBtn: document.getElementById('saveJobBtn'),
  compareBtn: document.getElementById('compareBtn'),
  syncBtn: document.getElementById('syncBtn'),
  manualRunConfirmOverlay: document.getElementById('manualRunConfirmOverlay'),
  manualRunConfirmJob: document.getElementById('manualRunConfirmJob'),
  manualRunConfirmMode: document.getElementById('manualRunConfirmMode'),
  manualRunConfirmDate: document.getElementById('manualRunConfirmDate'),
  manualRunConfirmAge: document.getElementById('manualRunConfirmAge'),
  manualRunConfirmSummary: document.getElementById('manualRunConfirmSummary'),
  manualRunConfirmTitle: document.getElementById('manualRunConfirmTitle'),
  manualRunConfirmText: document.getElementById('manualRunConfirmText'),
  manualRunConfirmRemember: document.getElementById('manualRunConfirmRemember'),
  manualRunConfirmCancel: document.getElementById('manualRunConfirmCancel'),
  manualRunConfirmApply: document.getElementById('manualRunConfirmApply'),
  resetManualRunWarningsBtn: document.getElementById('resetManualRunWarningsBtn'),
  filePreviewPanel: document.getElementById('filePreviewPanel'),
  cancelBtn: document.getElementById('cancelBtn'),
  targetTestResult: document.getElementById('targetTestResult'),
  logOutput: document.getElementById('logOutput'),
  logTitle: document.getElementById('logTitle'),
  logSubtitle: document.getElementById('logSubtitle'),
  runState: document.getElementById('runState'),
  metricCopied: document.getElementById('metricCopied'),
  metricSkipped: document.getElementById('metricSkipped'),
  metricFailed: document.getElementById('metricFailed'),
  metricBytes: document.getElementById('metricBytes'),
  metricHistory: document.getElementById('metricHistory'),
  metricDeletedLabel: document.getElementById('metricDeletedLabel'),
  metricDeleted: document.getElementById('metricDeleted'),
  recentRuns: document.getElementById('recentRuns'),
  saveBar: document.getElementById('saveBar'),
  discardJobBtn: document.getElementById('discardJobBtn'),
  jobList: document.getElementById('jobList'),
  newJobBtn: document.getElementById('newJobBtn'),
  duplicateJobBtn: document.getElementById('duplicateJobBtn'),
  deleteJobBtn: document.getElementById('deleteJobBtn'),
  viewTabs: document.querySelectorAll('[data-view-tab]'),
  syncView: document.getElementById('syncView'),
  historyView: document.getElementById('historyView'),
  settingsView: document.getElementById('settingsView'),
  telegramEnabled: document.getElementById('telegramEnabled'),
  telegramBotToken: document.getElementById('telegramBotToken'),
  telegramChatId: document.getElementById('telegramChatId'),
  telegramNotifySuccess: document.getElementById('telegramNotifySuccess'),
  telegramNotifyFailure: document.getElementById('telegramNotifyFailure'),
  telegramNotifyCompare: document.getElementById('telegramNotifyCompare'),
  telegramStatus: document.getElementById('telegramStatus'),
  testTelegramBtn: document.getElementById('testTelegramBtn'),
  previewRows: document.getElementById('previewRows'),
  previewOverview: document.getElementById('previewOverview'),
  previewSearch: document.getElementById('previewSearch'),
  previewBreadcrumb: document.getElementById('previewBreadcrumb'),
  runHint: document.getElementById('runHint'),
  scheduleEnabled: document.getElementById('scheduleEnabled'),
  scheduleMode: document.getElementById('scheduleMode'),
  scheduleFrequency: document.getElementById('scheduleFrequency'),
  scheduleIntervalFields: document.getElementById('scheduleIntervalFields'),
  scheduleIntervalValue: document.getElementById('scheduleIntervalValue'),
  scheduleIntervalUnit: document.getElementById('scheduleIntervalUnit'),
  scheduleTimeFields: document.getElementById('scheduleTimeFields'),
  scheduleTime: document.getElementById('scheduleTime'),
  scheduleWeekdays: document.getElementById('scheduleWeekdays'),
  scheduleDayInputs: document.querySelectorAll('[data-weekday]'),
  scheduleStatus: document.getElementById('scheduleStatus'),
  watchEnabled: document.getElementById('watchEnabled'),
  watchMode: document.getElementById('watchMode'),
  watchSettleSeconds: document.getElementById('watchSettleSeconds'),
  watchMaxWaitSeconds: document.getElementById('watchMaxWaitSeconds'),
  watchSettingsFields: document.getElementById('watchSettingsFields'),
  watchStatus: document.getElementById('watchStatus'),
  runOverlay: document.getElementById('runOverlay'),
  runModal: document.getElementById('runModal'),
  runScrim: document.getElementById('runScrim'),
  runJobLabel: document.getElementById('runJobLabel'),
  minimizeRunBtn: document.getElementById('minimizeRunBtn'),
  closeRunBtn: document.getElementById('closeRunBtn'),
  runProgress: document.getElementById('runProgress'),
  runMetrics: document.getElementById('runMetrics'),
  compareOverlayPanel: document.getElementById('compareOverlayPanel'),
  compareSourceStatus: document.getElementById('compareSourceStatus'),
  compareSourceSub: document.getElementById('compareSourceSub'),
  compareDestinationStatus: document.getElementById('compareDestinationStatus'),
  compareDestinationSub: document.getElementById('compareDestinationSub'),
  compareSourceDetails: document.getElementById('compareSourceDetails'),
  compareDestinationDetails: document.getElementById('compareDestinationDetails'),
  runPct: document.getElementById('runPct'),
  runEta: document.getElementById('runEta'),
  runFill: document.getElementById('runFill'),
  runFillBar: document.getElementById('runFillBar'),
  runFile: document.getElementById('runFile'),
  runCurrentAction: document.getElementById('runCurrentAction'),
  runResume: document.getElementById('runResume'),
  runMini: document.getElementById('runMini'),
  runMiniText: document.getElementById('runMiniText'),
  runMiniSub: document.getElementById('runMiniSub'),
  refreshHistoryBtn: document.getElementById('refreshHistoryBtn'),
  historySearch: document.getElementById('historySearch'),
  historyBreadcrumb: document.getElementById('historyBreadcrumb'),
  historyRows: document.getElementById('historyRows'),
  historyStatus: document.getElementById('historyStatus'),
  historyJobName: document.getElementById('historyJobName'),
  historyFileCount: document.getElementById('historyFileCount'),
  historyVersionCount: document.getElementById('historyVersionCount'),
  historyManifestCount: document.getElementById('historyManifestCount'),
  historyErrorCount: document.getElementById('historyErrorCount'),
  recoveryRunsPanel: document.getElementById('recoveryRunsPanel'),
  refreshRecoveryRunsBtn: document.getElementById('refreshRecoveryRunsBtn'),
  recoveryConfigStatus: document.getElementById('recoveryConfigStatus'),
  recoveryRunRows: document.getElementById('recoveryRunRows'),
  refreshRestorePointsBtn: document.getElementById('refreshRestorePointsBtn'),
  restorePointRows: document.getElementById('restorePointRows'),
  restorePointStatus: document.getElementById('restorePointStatus'),
  restorePointSelected: document.getElementById('restorePointSelected'),
  historyInspectorTitle: document.getElementById('historyInspectorTitle'),
  historyInspectorState: document.getElementById('historyInspectorState'),
  historyFileInspectorBlock: document.getElementById('historyFileInspectorBlock'),
  restorePointInspectorBlock: document.getElementById('restorePointInspectorBlock'),
  restorePointActions: document.getElementById('restorePointActions'),
  historyRestoreControls: document.getElementById('historyRestoreControls'),
  historySelected: document.getElementById('historySelected'),
  restoreModeButtons: document.querySelectorAll('[data-restore-mode]'),
  restoreFolderPath: document.getElementById('restoreFolderPath'),
  restoreFolderField: document.getElementById('restoreFolderField'),
  pickRestoreFolderBtn: document.getElementById('pickRestoreFolderBtn'),
  restoreSelectedBtn: document.getElementById('restoreSelectedBtn'),
  historyResult: document.getElementById('historyResult'),
  collapseToggles: document.querySelectorAll('[data-collapse-toggle]')
};

// ---------------------------------------------------------------------------
// Job-model mirror (renderer copy). The renderer cannot require() main-process
// modules, so the constants below — and the normalizers further down
// (normalizeSyncMode, normalizeTwoWayConflictPolicy, sanitizeJobId,
// normalizeSchedule, normalizeWatchSettings, sanitizeScheduleTime,
// sanitizeDestinationLabel, computeNextRunAt) — intentionally DUPLICATE the
// authoritative definitions in src/main/job-model.js (computeNextRunAt mirrors
// src/main/scheduler-policy.js). Keep the values/keys here in sync with that
// source of truth:
//   DEFAULT_JOB_ID, DEFAULT_EXCLUDE_PATTERNS  <- job-model constants (same name)
//   DEFAULT_SCHEDULE                          <- job-model normalizeSchedule() defaults
//   DEFAULT_WATCH_SETTINGS, DEFAULT_APP_SETTINGS, SCHEDULER_QUEUE_PRIORITIES <- same-named job-model exports
//   SYNC_MODES (keys)                         <- job-model SUPPORTED_SYNC_MODES
//   TWO_WAY_CONFLICT_POLICIES (keys)          <- job-model TWO_WAY_CONFLICT_POLICIES
// The structural fix (exposing these via preload, e.g. window.syncarr.constants)
// is a separate, larger task; this header is the Phase E doc cross-reference.
// ---------------------------------------------------------------------------
const DEFAULT_JOB_ID = 'job-default';
const DEFAULT_EXCLUDE_PATTERNS = ['node_modules', '.git', 'Thumbs.db', '.DS_Store', '*.ffs_db', '*.ffs_lock', '*.ffs_tmp', '.syncarr-history'];

// Configured here (not at the top) because DEFAULT_EXCLUDE_PATTERNS must already
// be initialized; the normalize* it injects are hoisted function declarations.
const { makeCompareFingerprint } = window.SyncarrCompareFingerprint;
window.SyncarrCompareFingerprint.configure({
  normalizeSyncMode,
  normalizeTwoWayConflictPolicy,
  normalizeSourcePaths,
  normalizeTargetDestinations,
  defaultExcludePatterns: DEFAULT_EXCLUDE_PATTERNS
});

const DEFAULT_SCHEDULE = {
  enabled: false,
  mode: 'compare',
  frequency: 'daily',
  intervalValue: 1,
  intervalUnit: 'hours',
  time: '02:00',
  days: ['MO'],
  nextRunAt: null,
  lastRun: null
};
const DEFAULT_WATCH_SETTINGS = {
  enabled: false,
  mode: 'compare',
  settleSeconds: 10,
  maxWaitSeconds: 120
};
const WEEKDAY_ORDER = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const WEEKDAY_LABELS = { SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat' };
const DEFAULT_APP_SETTINGS = {
  schedulerQueuePriority: 'scheduledTime',
  skipManualApplyWarningByMode: {}
};
const SCHEDULER_QUEUE_PRIORITIES = {
  scheduledTime: 'Scheduled time / job order',
  syncFirst: 'Sync jobs before compare-only jobs',
  mostChanges: 'Most file changes first',
  largestCopy: 'Largest estimated copy size first',
  smallestCopy: 'Smallest estimated copy size first'
};

const SYNC_MODES = {
  oneWay: {
    label: 'One-way backup',
    shortLabel: 'One-way',
    description: 'Copy source changes to destination. Destination-only files are kept.',
    detail: 'Safe default. File history protects destination files before overwrites.',
    compareRunnable: true,
    syncRunnable: true
  },
  mirror: {
    label: 'Mirror source to destination',
    shortLabel: 'Mirror',
    description: 'Make the destination match the source. Destination-only files are delete candidates.',
    detail: 'Compare first, review File Preview, then apply manually or by schedule after a fresh safety preview.',
    compareRunnable: true,
    syncRunnable: true
  },
  twoWay: {
    label: 'Two-way sync',
    shortLabel: 'Two-way',
    description: 'Sync changes in both directions. The selected precedence rule resolves conflicts; safe deletions propagate to the other side.',
    detail: 'Compare to preview the direction of every change, then apply. Files are archived before any overwrite or delete on both sides.',
    compareRunnable: true,
    syncRunnable: true
  }
};

const TWO_WAY_CONFLICT_POLICIES = {
  newer: {
    label: 'Newest file wins',
    description: 'The most recently modified file wins. Timestamp ties keep both versions; an edit beats a deletion.'
  },
  source: {
    label: 'Source takes precedence',
    description: 'When both sides changed, source overwrites destination. A source-side deletion also wins over a destination edit.'
  },
  dest: {
    label: 'Destination takes precedence',
    description: 'When both sides changed, destination overwrites source. A destination-side deletion also wins over a source edit.'
  },
  keepBoth: {
    label: 'Keep both versions',
    description: 'When both copies changed, Syncarr keeps the source name and creates a conflicted copy for the destination version. An edit still beats a deletion.'
  }
};

let config = null;
let runtimeInfo = { platform: 'win32', capabilities: { pathSeparator: '\\', caseSensitivePaths: false } };
let running = false;
let restoreRunning = false;
let completionRenderedByEvent = false;
let lastRenderedCompletionKey = '';
let activeView = 'sync';
let dirty = false;
let compareDone = false;
let compareReadyAt = null;
let lastCompareScannedAt = null;
let compareFingerprint = null;
let runOverlayOpen = false;
let runOverlayMode = 'sync';
let runOverlayFinished = false;
let runMinimized = false;
let runStartTime = 0;
let runPlanTotal = 0;
let activeTrayTask = null;
let pendingTrayProgress = null;
let trayProgressTimer = null;
let trayProgressLastSentAt = 0;
let logMode = 'live';
let liveLogBuffer = 'Ready.';
let selectedRecentRunIndex = null;
let visibleRecentRuns = [];

const jobState = {
  jobs: [],
  activeJobId: DEFAULT_JOB_ID
};

const previewState = {
  files: [],
  summary: null,
  message: '',
  ok: null,
  syncMode: 'oneWay',
  cwd: '',
  expandedFile: null
};

const historyState = {
  versions: [],
  cwd: '',
  expandedFile: null,
  selectedId: null,
  restoreMode: 'original',
  restoreFolder: '',
  loadedJobId: null,
  lastRefreshedAt: null,
  lastRefreshOk: null
};

const restorePointState = {
  points: [],
  selectedId: null,
  loadedJobId: null,
  lastRefreshOk: null,
  disabledReason: '',
  selectedManifest: null,
  manifestLoading: false,
  manifestError: '',
  cwd: '',
  selectedFilePath: '',
  selectedFileDestinationIndex: null,
  planLoading: false,
  planError: '',
  planResult: null,
  restoreFolder: '',
  restoring: false,
  restoreError: '',
  restoreResult: null,
  manifestCache: new Map()
};

let historyCleanupPromptOpen = false;
const watcherRuntimeByJob = new Map();
let watcherOverview = null;
const recoveryState = { runs: [], config: null, expandedRunId: null, busy: false };

init();

async function init() {
  bindEvents();
  window.syncarr.onSyncEvent(handleSyncEvent);
  if (typeof window.syncarr.onSchedulerEvent === 'function') {
    window.syncarr.onSchedulerEvent((payload) => {
      if (!payload) return;
      if (payload.type === 'complete') {
        refreshConfigAfterBackgroundRun();
        toastBackgroundRunComplete(payload, 'schedule');
      }
    });
  }
  if (typeof window.syncarr.onWatcherEvent === 'function') {
    window.syncarr.onWatcherEvent(handleWatcherEvent);
  }
  if (typeof window.syncarr.onFocusJob === 'function') {
    window.syncarr.onFocusJob(handleFocusJobRequest);
  }
  const [loadedConfig, loadedRuntimeInfo, loadedWatcherStatus, loadedRecoveryStatus] = await Promise.all([
    window.syncarr.loadConfig(),
    window.syncarr.getAppInfo().catch(() => runtimeInfo),
    typeof window.syncarr.getWatcherStatus === 'function'
      ? window.syncarr.getWatcherStatus().catch(() => null)
      : Promise.resolve(null),
    typeof window.syncarr.getRecoveryStatus === 'function'
      ? window.syncarr.getRecoveryStatus().catch(() => null)
      : Promise.resolve(null)
  ]);
  config = loadedConfig;
  runtimeInfo = loadedRuntimeInfo || runtimeInfo;
  if (loadedWatcherStatus) applyWatcherSnapshot(loadedWatcherStatus);
  if (loadedRecoveryStatus) applyRecoveryStatus(loadedRecoveryStatus);
  if (window.SyncarrRendererUtils && typeof window.SyncarrRendererUtils.configurePlatform === 'function') {
    window.SyncarrRendererUtils.configurePlatform(runtimeInfo.platform);
  }
  if (els.restoreFolderPath) els.restoreFolderPath.placeholder = getRestoreFolderPlaceholder();
  syncJobStateFromConfig(config);
  applyConfigToForm(config);
  applyTelegramSettingsToForm(config.telegramSettings);
  renderTelegramStatus();
  renderJobList();
  loadPersistedCompareForActiveJob();
  renderPreviewTable();
  renderPreviewStatus();
  setPreviewAccess(compareDone);
  setPreviewPanelVisible(true);
  renderRecentRuns(config.lastRuns || []);
  renderHistoryVersions();
  renderHistorySelection();
  renderRestorePoints();
  renderRestorePointSelection();
  renderRestorePointFileBrowser();
  renderRecoveryRuns();
  setRunState('Idle');
  updateRunButtons();
  startCompareAgeTicker();
  updatePageHeader();
}

function bindEvents() {
  els.viewTabs.forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.viewTab));
  });

  els.collapseToggles.forEach((button) => {
    button.addEventListener('click', () => toggleCollapse(button.dataset.collapseToggle));
  });

  els.jobList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-job-id]');
    if (!button) return;
    await switchJob(button.getAttribute('data-job-id'));
  });

  els.newJobBtn.addEventListener('click', async () => {
    await createNewJob();
  });

  els.duplicateJobBtn.addEventListener('click', async () => {
    await duplicateCurrentJob();
  });

  els.deleteJobBtn.addEventListener('click', async () => {
    await deleteCurrentJob();
  });

  els.recentRuns.addEventListener('click', (event) => {
    const row = event.target.closest('[data-run-index]');
    if (!row) return;
    const index = Number(row.getAttribute('data-run-index'));
    const run = visibleRecentRuns[index] || null;
    if (run) showRunLog(run, index);
  });

  els.addSourceBtn.addEventListener('click', () => {
    addSourceRow('');
    syncSourceTextareaFromRows();
    updateSidebar();
    markDirty();
    invalidateCompare();
  });

  els.sourceList.addEventListener('input', (event) => {
    if (!event.target.matches('[data-source-input]')) return;
    syncSourceTextareaFromRows();
    updateSidebar();
    markDirty();
    invalidateCompare();
  });

  els.sourceList.addEventListener('click', async (event) => {
    const browseButton = event.target.closest('[data-source-browse]');
    if (browseButton) {
      const index = Number(browseButton.getAttribute('data-source-browse'));
      const picked = await window.syncarr.pickSource();
      if (!picked) return;
      setSourceRowValue(index, picked);
      syncSourceTextareaFromRows();
      updateSidebar();
      markDirty();
      invalidateCompare();
      return;
    }

    const removeButton = event.target.closest('[data-source-remove]');
    if (removeButton) {
      const index = Number(removeButton.getAttribute('data-source-remove'));
      removeSourceRow(index);
      syncSourceTextareaFromRows();
      updateSidebar();
      markDirty();
      invalidateCompare();
    }
  });


  if (els.addDestinationBtn) {
    els.addDestinationBtn.addEventListener('click', () => {
      addDestinationRow({ path: '', required: false });
      syncTargetInputFromRows();
      updateSidebar();
      markDirty();
      invalidateCompare();
    });
  }

  if (els.targetList) {
    els.targetList.addEventListener('input', (event) => {
      if (!event.target.matches('[data-destination-input]')) return;
      syncTargetInputFromRows();
      updateSidebar();
      markDirty();
      invalidateCompare();
    });

    els.targetList.addEventListener('change', (event) => {
      if (!event.target.matches('[data-destination-required]')) return;
      syncTargetInputFromRows();
      updateSidebar();
      markDirty();
      invalidateCompare();
    });

    els.targetList.addEventListener('click', async (event) => {
      const browseButton = event.target.closest('[data-destination-browse]');
      if (browseButton) {
        const index = Number(browseButton.getAttribute('data-destination-browse'));
        const picked = await window.syncarr.pickSource();
        if (!picked) return;
        setDestinationRowValue(index, picked);
        syncTargetInputFromRows();
        updateSidebar();
        markDirty();
        invalidateCompare();
        return;
      }

      const testButton = event.target.closest('[data-destination-test]');
      if (testButton) {
        const index = Number(testButton.getAttribute('data-destination-test'));
        const input = els.targetList.querySelector(`[data-destination-input="${index}"]`);
        const result = await window.syncarr.testTarget(input ? input.value : '');
        renderTargetTest(result);
        return;
      }

      const removeButton = event.target.closest('[data-destination-remove]');
      if (removeButton) {
        const index = Number(removeButton.getAttribute('data-destination-remove'));
        removeDestinationRow(index);
        updateSidebar();
        markDirty();
        invalidateCompare();
      }
    });
  }

  els.discardJobBtn.addEventListener('click', () => {
    discardChanges();
  });

  els.saveJobBtn.addEventListener('click', async () => {
    await saveJob();
    appendLog('\nSaved job.\n');
    toast('success', 'Job saved');
  });

  if (els.resetManualRunWarningsBtn) {
    els.resetManualRunWarningsBtn.addEventListener('click', async () => {
      await resetManualRunWarningChoices();
    });
  }

  if (els.testTelegramBtn) {
    els.testTelegramBtn.addEventListener('click', async () => {
      await testTelegramSettings();
    });
  }

  [els.telegramEnabled, els.telegramBotToken, els.telegramChatId, els.telegramNotifySuccess, els.telegramNotifyFailure, els.telegramNotifyCompare]
    .filter(Boolean)
    .forEach((control) => {
      const refreshTelegramUi = () => {
        updateTelegramSettingsVisibility();
        renderTelegramStatus();
        markDirty();
      };
      control.addEventListener('input', refreshTelegramUi);
      control.addEventListener('change', refreshTelegramUi);
    });

  els.previewSearch.addEventListener('input', () => {
    previewState.expandedFile = null;
    renderPreviewTable();
  });

  els.previewRows.addEventListener('click', (event) => {
    const file = event.target.closest('[data-preview-file]');
    if (file) {
      togglePreviewFile(file.getAttribute('data-preview-file'));
      return;
    }
    const folder = event.target.closest('[data-preview-folder]');
    if (folder) {
      enterPreviewFolder(folder.getAttribute('data-preview-folder'));
    }
  });

  els.previewBreadcrumb.addEventListener('click', (event) => {
    const crumb = event.target.closest('[data-preview-crumb]');
    if (!crumb) return;
    previewState.cwd = crumb.getAttribute('data-preview-crumb');
    previewState.expandedFile = null;
    renderPreviewTable();
  });

  els.minimizeRunBtn.addEventListener('click', minimizeRun);
  els.closeRunBtn.addEventListener('click', closeRunOverlay);
  els.runMini.addEventListener('click', restoreRun);
  els.runScrim.addEventListener('click', () => {
    if (running) minimizeRun();
    else closeRunOverlay();
  });

  els.compareBtn.addEventListener('click', async () => {
    await runJob(true);
  });

  els.syncBtn.addEventListener('click', async () => {
    await runJob(false);
  });

  els.cancelBtn.addEventListener('click', async () => {
    if (els.cancelBtn.disabled) return;

    els.cancelBtn.disabled = true;
    els.cancelBtn.textContent = 'Cancelling…';
    setRunState(runOverlayMode === 'compare' ? 'Cancelling compare' : 'Cancelling sync', 'warning');
    if (els.runEta) els.runEta.textContent = 'Cancellation requested…';
    if (els.runFile) {
      els.runFile.textContent = runOverlayMode === 'compare'
        ? 'Stopping the current compare process…'
        : 'Stopping the current sync process…';
    }
    if (runMinimized) {
      els.runMiniText.textContent = runOverlayMode === 'compare' ? 'Cancelling compare' : 'Cancelling sync';
      els.runMiniSub.textContent = 'Stopping…';
    }

    let result = null;
    try {
      result = await window.syncarr.cancelSync();
    } catch (error) {
      result = { ok: false, message: error && error.message ? error.message : String(error) };
    }

    appendLog(`\n${result.message || 'Cancellation requested.'}\n`);
    if (!result.ok) {
      els.cancelBtn.disabled = false;
      els.cancelBtn.textContent = 'Cancel';
    }
  });

  if (els.refreshHistoryBtn) {
    els.refreshHistoryBtn.addEventListener('click', async () => {
      await loadHistory();
    });
  }

  if (els.refreshRestorePointsBtn) {
    els.refreshRestorePointsBtn.addEventListener('click', async () => {
      await loadRestorePoints({ preserveSelection: true });
    });
  }

  if (els.refreshRecoveryRunsBtn) {
    els.refreshRecoveryRunsBtn.addEventListener('click', loadRecoveryStatus);
  }

  if (els.recoveryRunRows) {
    els.recoveryRunRows.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-recovery-action]');
      if (!button || recoveryState.busy) return;
      const action = button.getAttribute('data-recovery-action');
      const runId = button.getAttribute('data-run-id');
      const jobId = button.getAttribute('data-job-id');
      if (action === 'inspect') {
        recoveryState.expandedRunId = recoveryState.expandedRunId === runId ? null : runId;
        renderRecoveryRuns();
        return;
      }
      await runRecoveryAction(action, { runId, jobId });
    });
  }

  if (els.restorePointBreadcrumb) {
    els.restorePointBreadcrumb.addEventListener('click', (event) => {
      const crumb = event.target.closest('[data-restore-point-crumb]');
      if (!crumb) return;
      restorePointState.cwd = crumb.getAttribute('data-restore-point-crumb') || '';
      clearRestorePointFileSelection();
      clearRestorePointPlan();
      renderRestorePointFileBrowser();
      renderRestorePointSelection();
    });
  }

  if (els.restorePointFileRows) {
    els.restorePointFileRows.addEventListener('click', (event) => {
      const folder = event.target.closest('[data-restore-point-folder]');
      if (folder) {
        restorePointState.cwd = folder.getAttribute('data-restore-point-folder') || '';
        clearRestorePointFileSelection();
        clearRestorePointPlan();
        renderRestorePointFileBrowser();
        renderRestorePointSelection();
        return;
      }
      const file = event.target.closest('[data-restore-point-file]');
      if (file) {
        const relPath = file.getAttribute('data-restore-point-file') || '';
        const parsed = parseRestorePointCwd ? parseRestorePointCwd(restorePointState.cwd) : { destinationIndex: null };
        restorePointState.selectedFilePath = relPath;
        restorePointState.selectedFileDestinationIndex = parsed.destinationIndex;
        clearRestorePointPlan();
        renderRestorePointFileBrowser();
        renderRestorePointSelection();
        setRestorePointStatus(`Restore point file selected: ${relPath}`, 'success');
      }
    });
  }

  if (els.restorePointActions) {
    els.restorePointActions.addEventListener('click', async (event) => {
      const browse = event.target.closest('[data-restore-point-pick-folder]');
      if (browse) {
        const selected = await window.syncarr.pickRestoreFolder();
        if (selected) {
          restorePointState.restoreFolder = selected;
          clearRestorePointPlan();
          renderRestorePointSelection();
        }
        return;
      }
      const preflight = event.target.closest('[data-restore-point-preflight]');
      if (preflight) {
        await previewSelectedRestorePointPlan();
        return;
      }
      const apply = event.target.closest('[data-restore-point-apply]');
      if (apply) await restoreSelectedRestorePointToFolder();
    });
    els.restorePointActions.addEventListener('change', (event) => {
      const input = event.target.closest('[data-restore-point-folder-input]');
      if (!input) return;
      restorePointState.restoreFolder = input.value.trim();
      clearRestorePointPlan();
      renderRestorePointSelection();
    });
  }

  els.historySearch.addEventListener('input', () => {
    renderHistoryVersions();
  });

  if (els.historySelected) {
    els.historySelected.addEventListener('click', (event) => {
      const version = event.target.closest('[data-inspector-version-id]');
      if (!version) return;
      selectHistoryVersion(version.getAttribute('data-inspector-version-id'));
    });
  }

  els.restorePointRows.addEventListener('click', (event) => {
    const back = event.target.closest('[data-restore-point-back]');
    if (back) {
      exitRestorePointSnapshotBrowser();
      return;
    }

    const crumb = event.target.closest('[data-restore-point-crumb]');
    if (crumb) {
      restorePointState.cwd = crumb.getAttribute('data-restore-point-crumb') || '';
      clearRestorePointFileSelection();
      clearRestorePointPlan();
      renderRestorePointFileBrowser();
      renderRestorePointSelection();
      return;
    }

    const folder = event.target.closest('[data-restore-point-folder]');
    if (folder) {
      restorePointState.cwd = folder.getAttribute('data-restore-point-folder') || '';
      clearRestorePointFileSelection();
      clearRestorePointPlan();
      renderRestorePointFileBrowser();
      renderRestorePointSelection();
      return;
    }

    const file = event.target.closest('[data-restore-point-file]');
    if (file) {
      const relPath = file.getAttribute('data-restore-point-file') || '';
      const parsed = parseRestorePointCwd ? parseRestorePointCwd(restorePointState.cwd) : { destinationIndex: null };
      restorePointState.selectedFilePath = relPath;
      restorePointState.selectedFileDestinationIndex = parsed.destinationIndex;
      clearRestorePointPlan();
      renderRestorePointFileBrowser();
      renderRestorePointSelection();
      setRestorePointStatus(`Restore point file selected: ${relPath}`, 'success');
      return;
    }

    const row = event.target.closest('[data-restore-point-id]');
    if (!row) return;
    selectRestorePoint(row.getAttribute('data-restore-point-id'));
  });

  els.historyRows.addEventListener('click', (event) => {
    const version = event.target.closest('[data-version-id]');
    if (version) {
      selectHistoryVersion(version.getAttribute('data-version-id'));
      return;
    }
    const file = event.target.closest('[data-file]');
    if (file) {
      toggleHistoryFile(file.getAttribute('data-file'));
      return;
    }
    const folder = event.target.closest('[data-folder]');
    if (folder) {
      enterHistoryFolder(folder.getAttribute('data-folder'));
    }
  });

  els.historyBreadcrumb.addEventListener('click', (event) => {
    const crumb = event.target.closest('[data-crumb]');
    if (!crumb) return;
    historyState.cwd = crumb.getAttribute('data-crumb');
    historyState.expandedFile = null;
    renderHistoryVersions();
  });

  els.restoreModeButtons.forEach((button) => {
    button.addEventListener('click', () => setRestoreMode(button.dataset.restoreMode));
  });

  els.pickRestoreFolderBtn.addEventListener('click', async () => {
    const picked = await window.syncarr.pickRestoreFolder();
    if (!picked) return;
    historyState.restoreFolder = picked;
    els.restoreFolderPath.value = picked;
    setRestoreMode('folder');
    renderHistorySelection();
  });

  els.restoreFolderPath.addEventListener('input', () => {
    historyState.restoreFolder = els.restoreFolderPath.value.trim();
    renderHistorySelection();
  });

  els.restoreSelectedBtn.addEventListener('click', async () => {
    await restoreSelectedVersion();
  });

  ['input', 'change'].forEach((eventName) => {
    els.jobName.addEventListener(eventName, updateSidebar);
    if (els.jobEnabled) els.jobEnabled.addEventListener(eventName, updateSidebar);
    if (els.jobNotificationsEnabled) els.jobNotificationsEnabled.addEventListener(eventName, updateSidebar);
    if (els.syncMode) els.syncMode.addEventListener(eventName, () => {
      renderSyncModeDescription();
      updateSidebar();
      updateRunButtons();
      renderWatcherStatusFromForm();
    });
    if (els.twoWayConflictPolicy) els.twoWayConflictPolicy.addEventListener(eventName, renderSyncModeDescription);
    els.targetPath.addEventListener(eventName, updateSidebar);
    els.syncView.addEventListener(eventName, (event) => {
      if (!event.target.matches('input, select, textarea')) return;
      const inScheduleSettings = Boolean(event.target.closest('.schedule-panel'));
      const inWatchSettings = Boolean(event.target.closest('.watch-settings'));
      markDirty();
      if (!inScheduleSettings && !inWatchSettings) invalidateCompare();
      if (inScheduleSettings) {
        updateScheduleFieldVisibility();
        renderScheduleStatusFromForm();
        updateSidebar();
      }
      if (inWatchSettings) {
        updateWatcherFieldVisibility();
        renderWatcherStatusFromForm();
        updateSidebar();
      }
      if (event.target.id === 'historyEnabled' && eventName === 'change') {
        void maybeOfferHistoryCacheCleanupOnDisable();
      }
      if (event.target.id === 'historyEnabled' || event.target.id === 'retentionEnabled') {
        updateHistorySettingsVisibility();
        renderSyncModeDescription();
      }
    });
  });
}

function syncJobStateFromConfig(nextConfig) {
  const rawJobs = Array.isArray(nextConfig.jobs) && nextConfig.jobs.length
    ? nextConfig.jobs
    : [nextConfig.job || createDefaultJob()];

  jobState.jobs = rawJobs.map((job, index) => normalizeRendererJob(job, index));
  jobState.activeJobId = sanitizeJobId(nextConfig.activeJobId || (nextConfig.job && nextConfig.job.id) || jobState.jobs[0].id);

  if (!jobState.jobs.some((job) => job.id === jobState.activeJobId)) {
    jobState.activeJobId = jobState.jobs[0].id;
  }
}

function normalizeRendererJob(input, index = 0) {
  const fallback = createDefaultJob(index);
  const merged = {
    ...fallback,
    ...(input || {}),
    id: sanitizeJobId((input && input.id) || fallback.id),
    excludePatterns: Array.isArray(input && input.excludePatterns)
      ? input.excludePatterns
      : DEFAULT_EXCLUDE_PATTERNS
  };

  merged.sourcePaths = normalizeSourcePaths(merged.sourcePaths && merged.sourcePaths.length ? merged.sourcePaths : merged.sourcePath);
  merged.sourcePath = merged.sourcePaths[0] || '';
  merged.targetDestinations = normalizeTargetDestinations(merged.targetDestinations, merged.targetPath);
  merged.targetPath = merged.targetDestinations[0] ? merged.targetDestinations[0].path : String(merged.targetPath || '').trim();
  merged.enabled = merged.enabled !== false;
  merged.notificationsEnabled = merged.notificationsEnabled === true;
  merged.syncMode = normalizeSyncMode(merged.syncMode);
  merged.twoWayConflictPolicy = normalizeTwoWayConflictPolicy(merged.twoWayConflictPolicy);
  merged.schedule = normalizeSchedule(merged.schedule);
  merged.watch = normalizeWatchSettings(merged.watch);
  return merged;
}

function createDefaultJob(index = 0) {
  return {
    id: index === 0 ? DEFAULT_JOB_ID : `job-${index + 1}`,
    name: index === 0 ? 'Music to NAS' : 'New sync job',
    enabled: true,
    notificationsEnabled: false,
    syncMode: 'oneWay',
    twoWayConflictPolicy: 'newer',
    sourcePath: '',
    sourcePaths: [],
    targetPath: '',
    targetDestinations: [],
    excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
    historyEnabled: true,
    historyFolderName: '.syncarr-history',
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
    skipOlderSource: true,
    copySubfolders: true,
    schedule: { ...DEFAULT_SCHEDULE },
    watch: { ...DEFAULT_WATCH_SETTINGS }
  };
}

// normalizeSyncMode / normalizeTwoWayConflictPolicy mirror the same-named
// validators in src/main/job-model.js (renderer copy — keep defaults in sync).
function normalizeSyncMode(value) {
  const clean = String(value || '').trim();
  return Object.prototype.hasOwnProperty.call(SYNC_MODES, clean) ? clean : 'oneWay';
}

function normalizeTwoWayConflictPolicy(value) {
  const clean = String(value || '').trim();
  return Object.prototype.hasOwnProperty.call(TWO_WAY_CONFLICT_POLICIES, clean) ? clean : 'newer';
}

function getTwoWayConflictPolicyInfo(value) {
  return TWO_WAY_CONFLICT_POLICIES[normalizeTwoWayConflictPolicy(value)];
}

function getSyncModeInfo(value) {
  return SYNC_MODES[normalizeSyncMode(value)] || SYNC_MODES.oneWay;
}

function isCompareModeRunnable(value) {
  const info = getSyncModeInfo(value);
  return info.compareRunnable !== false;
}

function isSyncModeRunnable(value) {
  const info = getSyncModeInfo(value);
  return info.syncRunnable === true || info.runnable === true;
}

function isWarningRun(value) {
  return String((value && value.status) || value || '').toLowerCase() === 'warning';
}

// Run-result statuses the UI treats as a hard failure. Mirrors the failure
// subset of the main-process RUN_STATUS vocabulary (src/main/job-model.js); the
// renderer can't import that module, so keep this list in sync by hand.
const FAILURE_RUN_STATUSES = ['error', 'fatal', 'space', 'disabled', 'busy', 'required-destination-missing', 'no-destination-available', 'unsupported-sync-mode'];

function isFailureRunStatus(status) {
  const clean = String(status || '').trim().toLowerCase();
  if (!clean) return false;
  return FAILURE_RUN_STATUSES.includes(clean) || clean.includes('failed');
}

// True when a finished run result represents a user cancellation, whether it
// surfaced via the `canceled` flag or a 'cancelled' status string. Mirrors the
// main-process isCancelledRun helper (src/main.js).
function isCancelledRun(result) {
  return Boolean(result && (result.canceled || String(result.status || '').toLowerCase() === 'cancelled'));
}

function getRunVisualKind(result) {
  if (isCancelledRun(result)) return 'warning';
  if (isWarningRun(result)) return 'warning';
  if (result && result.status && isFailureRunStatus(result.status)) return 'error';
  return result && result.ok ? 'success' : 'error';
}

function formatRunStatusLabel(status) {
  const clean = String(status || '').trim().toLowerCase();
  if (!clean) return 'Unknown';
  if (clean === 'warning') return 'Warning';
  if (clean === 'success') return 'Success';
  if (clean === 'no-change') return 'No change';
  if (clean === 'cancelled' || clean === 'canceled') return 'Cancelled';
  if (clean === 'error' || clean === 'fatal') return 'Failed';
  return clean.replace(/-/g, ' ').replace(/^./, (char) => char.toUpperCase());
}

function getLastRunForJob(jobId) {
  if (!config || !Array.isArray(config.lastRuns)) return null;
  const cleanJobId = sanitizeJobId(jobId || DEFAULT_JOB_ID);
  return config.lastRuns.find((item) => sanitizeJobId(item && item.jobId || DEFAULT_JOB_ID) === cleanJobId) || null;
}

// When a job has no live (pending) compare to restore, the run card should
// still report when the folders were last scanned, using saved run history.
// lastRuns is newest-first; use the most recent run of ANY kind — a real sync
// walks the folders just like a compare does, so a scheduled run overnight
// must not leave the card claiming the last scan was the days-old compare.
function lastScanTimeForActiveJob(jobId) {
  if (!config || !Array.isArray(config.lastRuns)) return null;
  const cleanJobId = sanitizeJobId(jobId || DEFAULT_JOB_ID);
  const scan = config.lastRuns.find(
    (item) => sanitizeJobId((item && item.jobId) || DEFAULT_JOB_ID) === cleanJobId
  );
  return (scan && (scan.compareCreatedAt || scan.at)) || null;
}

function renderSyncModeDescription() {
  if (!els.syncModeDescription) return;
  const mode = normalizeSyncMode(els.syncMode ? els.syncMode.value : 'oneWay');
  const info = getSyncModeInfo(mode);
  const conflictPolicy = normalizeTwoWayConflictPolicy(els.twoWayConflictPolicy && els.twoWayConflictPolicy.value);
  const conflictInfo = getTwoWayConflictPolicyInfo(conflictPolicy);
  if (els.twoWayConflictPolicyField) els.twoWayConflictPolicyField.classList.toggle('hidden', mode !== 'twoWay');
  if (els.twoWayConflictPolicyDescription) els.twoWayConflictPolicyDescription.textContent = conflictInfo.description;
  els.syncModeDescription.classList.remove('warning', 'error', 'ok');
  els.syncModeDescription.classList.add(info.syncRunnable ? 'ok' : 'warning');
  els.syncModeDescription.innerHTML = `
    <strong>${escapeHtml(info.label)}</strong>
    <span>${escapeHtml(info.description)}</span>
    <small>${escapeHtml(mode === 'twoWay' ? `${info.detail} Conflict rule: ${conflictInfo.label}.` : info.detail)}</small>
  `;
}

function getActiveJob() {
  return jobState.jobs.find((job) => job.id === jobState.activeJobId) || jobState.jobs[0] || createDefaultJob();
}

function renderJobList() {
  if (!jobState.jobs.length) {
    els.jobList.innerHTML = '';
    return;
  }

  els.jobList.innerHTML = jobState.jobs.map((job) => {
    const active = job.id === jobState.activeJobId;
    const enabled = job.enabled !== false;
    const sourceSummary = formatSourceSummary(job);
    const destinationSummary = formatDestinationSummary(job);
    const pathLabel = sourceSummary && destinationSummary ? `${sourceSummary} -> ${destinationSummary}` : 'Not configured';
    const scheduleLabel = enabled ? formatScheduleSummary(job) : 'Disabled';
    const modeLabel = getSyncModeInfo(job.syncMode).shortLabel;
    const lastRun = getLastRunForJob(job.id);
    const scheduledConflict = isConflictBlockedRun(job.schedule && job.schedule.lastRun, job.id);
    const lastStatus = lastRun ? formatRunStatusLabel(lastRun.status || (lastRun.ok ? 'success' : 'error')) : 'Never run';
    const pillClass = scheduledConflict
      ? ' warning'
      : !enabled
      ? ' error'
      : lastRun
        ? ` ${getRunVisualKind({ ok: lastRun.ok ?? !isFailureRunStatus(lastRun.status), status: lastRun.status })}`
        : ' neutral';
    const pillText = scheduledConflict ? 'Conflict blocked' : (enabled ? `Last: ${lastStatus}` : 'Disabled');
    return `
      <button class="job-row${active ? ' active' : ''}${enabled ? '' : ' disabled'}" data-job-id="${escapeAttr(job.id)}" type="button">
        <span>
          <strong>${escapeHtml(job.name || 'Sync job')}</strong>
          <small>${escapeHtml(pathLabel)}</small>
          <small>${escapeHtml(modeLabel)} · ${escapeHtml(scheduleLabel)}</small>
        </span>
        <span class="mini-pill${pillClass}">${escapeHtml(pillText)}</span>
      </button>
    `;
  }).join('');

  const busy = running || restoreRunning;
  els.jobList.querySelectorAll('button').forEach((button) => {
    button.disabled = busy;
  });
}

// Deep link from a clicked desktop notification: jump to the notified job.
// Deliberately a no-op while a run is active or the form has unsaved edits —
// a notification click must never trigger an implicit save or disrupt a run.
async function handleFocusJobRequest(payload) {
  try {
    const jobId = sanitizeJobId(payload && payload.jobId);
    if (!jobId || running || restoreRunning || dirty) return;
    if (!jobState.jobs.some((job) => sanitizeJobId(job.id) === jobId)) return;
    if (activeView !== 'sync') switchView('sync');
    if (jobId !== jobState.activeJobId) await switchJob(jobId);
  } catch { /* Focus is best-effort; never let it break the renderer. */ }
}

async function switchJob(jobId) {
  const nextJobId = sanitizeJobId(jobId);
  if (nextJobId === jobState.activeJobId || running || restoreRunning) return;

  await saveJob({ preserveForm: true });
  jobState.activeJobId = nextJobId;
  config = await window.syncarr.saveConfig({
    activeJobId: jobState.activeJobId,
    jobs: jobState.jobs
  });

  syncJobStateFromConfig(config);
  applyConfigToForm(config);
  resetJobDerivedViews();
  renderJobList();

  if (activeView === 'history') {
    await loadHistory();
  }
}

async function createNewJob() {
  if (running || restoreRunning) return;

  await saveJob({ preserveForm: true });
  const id = makeUniqueJobId(`job-${Date.now()}`);
  jobState.jobs.push({
    ...createDefaultJob(jobState.jobs.length),
    id,
    name: 'New sync job'
  });
  jobState.activeJobId = id;
  config = await window.syncarr.saveConfig({ activeJobId: id, jobs: jobState.jobs });
  syncJobStateFromConfig(config);
  applyConfigToForm(config);
  resetJobDerivedViews();
  renderJobList();
  toast('success', 'New job created');

  if (activeView === 'history') {
    await loadHistory();
  }
}

async function duplicateCurrentJob() {
  if (running || restoreRunning) return;

  await saveJob({ preserveForm: true });
  const current = getActiveJob();
  const id = makeUniqueJobId(`${current.id || DEFAULT_JOB_ID}-copy`);
  jobState.jobs.push({
    ...current,
    id,
    name: `${current.name || 'Sync job'} copy`
  });
  jobState.activeJobId = id;
  config = await window.syncarr.saveConfig({ activeJobId: id, jobs: jobState.jobs });
  syncJobStateFromConfig(config);
  applyConfigToForm(config);
  resetJobDerivedViews();
  renderJobList();
  toast('success', `Duplicated as "${jobState.jobs[jobState.jobs.length - 1].name}"`);

  if (activeView === 'history') {
    await loadHistory();
  }
}

// Themed replacements for the native window.confirm / window.alert popups so
// every prompt matches the app shell. Both return Promises (resolve from the
// in-app dialog defined in dialog.js).
function uiConfirm(options) {
  return window.SyncarrDialog.confirm(options);
}
function uiAlert(title, message, tone = 'info') {
  return window.SyncarrDialog.alert({ title, message, tone });
}
// Ephemeral, non-blocking feedback (toasts.js). Guarded because the module is
// absent in the window-shim test harness.
function toast(kind, message, opts) {
  if (window.SyncarrToasts && typeof window.SyncarrToasts[kind] === 'function') {
    window.SyncarrToasts[kind](message, opts);
  }
}

async function deleteCurrentJob() {
  if (running || restoreRunning) return;

  if (jobState.jobs.length <= 1) {
    toast('warning', "Can't delete this job — keep at least one sync job.");
    return;
  }

  const current = getActiveJob();
  const confirmed = await uiConfirm({
    title: 'Delete this job?',
    message: `${current.name || 'Sync job'}\n\nThis removes the saved job and cleans this job's file history cache from its destinations. Destination and source files are not deleted.`,
    confirmLabel: 'Delete job',
    cancelLabel: 'Keep job',
    tone: 'danger'
  });
  if (!confirmed) return;

  let cleanupResult = null;
  try {
    cleanupResult = await deleteHistoryCacheForJob(current);
  } catch (error) {
    const continueDelete = await uiConfirm({
      title: 'History cleanup failed',
      message: `${error.message || String(error)}\n\nDelete the saved job anyway?`,
      confirmLabel: 'Delete anyway',
      cancelLabel: 'Keep job',
      tone: 'danger'
    });
    if (!continueDelete) return;
  }

  jobState.jobs = jobState.jobs.filter((job) => job.id !== jobState.activeJobId);
  jobState.activeJobId = jobState.jobs[0].id;
  config = await window.syncarr.saveConfig({
    activeJobId: jobState.activeJobId,
    jobs: jobState.jobs
  });

  syncJobStateFromConfig(config);
  applyConfigToForm(config);
  resetJobDerivedViews();
  renderJobList();
  toast('success', `Deleted "${current.name || 'Sync job'}"`);

  if (cleanupResult && cleanupResult.summary) {
    appendLog(`Job deleted. File history cleanup removed ${formatNumber(cleanupResult.summary.archivedFilesDeleted || 0)} archived file(s), ${formatNumber(cleanupResult.summary.manifestsDeleted || 0)} manifest(s), and ${formatNumber(cleanupResult.summary.restorePointsDeleted || 0)} restore point(s).\n`);
  }

  if (activeView === 'history') {
    await loadHistory();
  }
}

async function maybeOfferHistoryCacheCleanupOnDisable() {
  if (!els.historyEnabled || els.historyEnabled.checked) return;
  if (historyCleanupPromptOpen) return;
  const current = getActiveJob();
  if (!current || current.historyEnabled === false) return;

  historyCleanupPromptOpen = true;
  try {
    const cleanup = await uiConfirm({
      title: 'File history disabled',
      message: "File history is being disabled for this job.\n\nDo you also want to delete this job's existing file history cache from its destinations? Keeping it preserves the existing restore cache.",
      confirmLabel: 'Delete cache',
      cancelLabel: 'Keep cache',
      tone: 'warning'
    });

    if (!cleanup) {
      clearHistoryAndRestorePointStateForDisabledJob(getJobFromForm());
      return;
    }

    const result = await deleteHistoryCacheForJob(getJobFromForm());
    appendLog(`File history cache cleanup removed ${formatNumber(result.summary && result.summary.archivedFilesDeleted || 0)} archived file(s), ${formatNumber(result.summary && result.summary.manifestsDeleted || 0)} manifest(s), and ${formatNumber(result.summary && result.summary.restorePointsDeleted || 0)} restore point(s).\n`);
    clearHistoryAndRestorePointStateForDisabledJob(getJobFromForm());
    if (activeView === 'history') {
      await loadHistory();
      await loadRestorePoints();
    }
  } catch (error) {
    await uiAlert('Could not delete file history cache', error.message || String(error), 'danger');
  } finally {
    historyCleanupPromptOpen = false;
  }
}

function clearHistoryAndRestorePointStateForDisabledJob(job) {
  const targetJob = job || getJobFromForm();
  historyState.versions = [];
  historyState.filtered = [];
  historyState.cwd = '';
  historyState.expandedFile = null;
  historyState.selectedId = null;
  historyState.loadedJobId = targetJob && targetJob.id ? targetJob.id : null;
  historyState.lastRefreshedAt = new Date().toISOString();
  historyState.lastRefreshOk = false;
  restorePointState.points = [];
  restorePointState.selectedId = null;
  restorePointState.selectedManifest = null;
  restorePointState.manifestLoading = false;
  restorePointState.manifestError = '';
  restorePointState.cwd = '';
  restorePointState.restoreFolder = '';
  restorePointState.restoring = false;
  clearRestorePointFileSelection();
  clearRestorePointPlan();
  if (restorePointState.manifestCache && typeof restorePointState.manifestCache.clear === 'function') restorePointState.manifestCache.clear();
  restorePointState.loadedJobId = targetJob && targetJob.id ? targetJob.id : null;
  restorePointState.lastRefreshOk = false;
  restorePointState.disabledReason = 'File history is disabled for this job. Enable it in the job configuration to browse restore points.';
}

async function deleteHistoryCacheForJob(job) {
  if (!window.syncarr || typeof window.syncarr.deleteJobHistoryCache !== 'function') {
    throw new Error('History cleanup is not available in this build.');
  }

  const request = {
    jobId: job.id || jobState.activeJobId,
    jobName: job.name || 'Sync job',
    targetPath: job.targetPath,
    targetDestinations: job.targetDestinations,
    sourcePaths: job.sourcePaths,
    syncMode: job.syncMode,
    historyFolderName: job.historyFolderName || '.syncarr-history',
    pruneEmptyFolders: true
  };

  const result = await window.syncarr.deleteJobHistoryCache(request);
  if (!result || !result.ok) {
    throw new Error((result && result.message) || 'History cleanup failed.');
  }
  return result;
}

function upsertCurrentJobInState() {
  const job = getJobFromForm();
  const index = jobState.jobs.findIndex((item) => item.id === job.id);

  if (index >= 0) {
    jobState.jobs[index] = {
      ...jobState.jobs[index],
      ...job
    };
  } else {
    jobState.jobs.push(job);
  }
}

function makeUniqueJobId(seed) {
  const base = sanitizeJobId(seed);
  const existing = new Set(jobState.jobs.map((job) => job.id));
  let next = base;
  let suffix = 2;

  while (existing.has(next)) {
    next = `${base}-${suffix}`;
    suffix += 1;
  }

  return next;
}

// Mirror of job-model.js sanitizeJobId (renderer copy — keep in sync).
function sanitizeJobId(input) {
  const clean = String(input || '')
    .trim()
    .replace(/[^a-z0-9_-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return clean || DEFAULT_JOB_ID;
}

// Mirror of job-model.js normalizeSchedule (renderer copy — keep in sync).
function normalizeSchedule(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const mode = ['compare', 'sync'].includes(raw.mode) ? raw.mode : DEFAULT_SCHEDULE.mode;
  const frequency = ['interval', 'daily', 'weekly', 'startup'].includes(raw.frequency) ? raw.frequency : DEFAULT_SCHEDULE.frequency;
  const intervalUnit = ['minutes', 'hours'].includes(raw.intervalUnit) ? raw.intervalUnit : DEFAULT_SCHEDULE.intervalUnit;
  const intervalValue = Math.max(1, Math.floor(Number(raw.intervalValue) || DEFAULT_SCHEDULE.intervalValue));
  const days = Array.isArray(raw.days)
    ? raw.days.map((day) => String(day || '').toUpperCase()).filter((day) => WEEKDAY_LABELS[day])
    : DEFAULT_SCHEDULE.days;

  return {
    ...DEFAULT_SCHEDULE,
    ...raw,
    enabled: raw.enabled === true,
    mode,
    frequency,
    intervalValue,
    intervalUnit,
    time: sanitizeScheduleTime(raw.time),
    days: days.length ? Array.from(new Set(days)) : [...DEFAULT_SCHEDULE.days],
    nextRunAt: raw.nextRunAt || null,
    lastRun: raw.lastRun && typeof raw.lastRun === 'object' ? raw.lastRun : null
  };
}

// Mirror of job-model.js normalizeWatchSettings (renderer copy — keep in sync).
function normalizeWatchSettings(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const settleSeconds = Math.max(2, Math.min(300, Math.floor(Number(raw.settleSeconds) || DEFAULT_WATCH_SETTINGS.settleSeconds)));
  const maxWaitSeconds = Math.max(
    settleSeconds,
    Math.min(1800, Math.floor(Number(raw.maxWaitSeconds) || DEFAULT_WATCH_SETTINGS.maxWaitSeconds))
  );
  return {
    enabled: raw.enabled === true,
    mode: ['compare', 'sync'].includes(raw.mode) ? raw.mode : DEFAULT_WATCH_SETTINGS.mode,
    settleSeconds,
    maxWaitSeconds
  };
}

// Mirror of job-model.js sanitizeScheduleTime (renderer copy — keep in sync).
function sanitizeScheduleTime(input) {
  const value = String(input || '').trim();
  if (/^([01]?\d|2[0-3]):[0-5]\d$/.test(value)) {
    const [hour, minute] = value.split(':');
    return `${String(Number(hour)).padStart(2, '0')}:${minute}`;
  }
  return DEFAULT_SCHEDULE.time;
}

function scheduleKey(schedule) {
  const clean = normalizeSchedule(schedule);
  return [clean.enabled, clean.mode, clean.frequency, clean.intervalValue, clean.intervalUnit, clean.time, clean.days.join(',')].join('|');
}

function rendererPathIdentityKey(input) {
  const clean = String(input || '').trim();
  return runtimeInfo.platform === 'win32'
    ? clean.replace(/\//g, '\\').toLowerCase()
    : clean;
}

function getSourcePathPlaceholder() {
  if (runtimeInfo.platform === 'darwin') return '/Users/you/Pictures';
  if (runtimeInfo.platform === 'linux') return '/home/you/Pictures';
  return 'C:\\Users\\you\\Pictures';
}

function getDestinationPathPlaceholder() {
  if (runtimeInfo.platform === 'darwin') return '/Volumes/Backups';
  if (runtimeInfo.platform === 'linux') return '/mnt/backups';
  return '\\\\NAS\\Backups';
}

function getRestoreFolderPlaceholder() {
  if (runtimeInfo.platform === 'darwin') return '/Users/you/Syncarr Restores';
  if (runtimeInfo.platform === 'linux') return '/home/you/Syncarr Restores';
  return 'D:\\Syncarr Restores';
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
    const key = rendererPathIdentityKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(clean);
  }

  return paths;
}


function normalizeTargetDestinations(input, fallbackPath = '') {
  const raw = Array.isArray(input) ? input : [];
  const items = [];
  if (raw.length) {
    raw.forEach((item) => {
      if (typeof item === 'string') {
        items.push({ path: item, required: true });
      } else if (item && typeof item === 'object') {
        items.push({ path: item.path || item.targetPath || '', required: item.required !== false, label: item.label || '' });
      }
    });
  }
  const fallback = String(fallbackPath || '').trim();
  if (!items.length && fallback) items.push({ path: fallback, required: true, label: '' });

  const seen = new Set();
  const destinations = [];
  items.forEach((item, index) => {
    const cleanPath = String(item.path || '').trim();
    if (!cleanPath) return;
    const key = rendererPathIdentityKey(cleanPath);
    if (seen.has(key)) return;
    seen.add(key);
    destinations.push({
      path: cleanPath,
      required: item.required !== false,
      label: sanitizeDestinationLabel(item.label || basenameForDisplay(cleanPath) || `Destination ${index + 1}`, `Destination ${index + 1}`)
    });
  });

  return uniqueDestinationLabels(destinations);
}

function uniqueDestinationLabels(destinations) {
  const used = new Map();
  return destinations.map((destination, index) => {
    let label = sanitizeDestinationLabel(destination.label, `Destination ${index + 1}`);
    const key = label.toLowerCase();
    const count = (used.get(key) || 0) + 1;
    used.set(key, count);
    if (count > 1) label = `${label}-${count}`;
    return { ...destination, label };
  });
}

// Mirror of job-model.js sanitizeFolderLabel(input, fallback, 'Destination')
// (renderer copy — keep in sync).
function sanitizeDestinationLabel(input, fallback) {
  const clean = String(input || fallback || 'Destination')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[.\s]+$/g, '')
    .replace(/^-+|-+$/g, '');
  return clean || fallback || 'Destination';
}

function basenameForDisplay(inputPath) {
  const clean = String(inputPath || '').replace(/[\\/]+$/g, '');
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || clean || '';
}

function formatDestinationSummary(job) {
  const destinations = normalizeTargetDestinations(job && job.targetDestinations, job && job.targetPath);
  if (!destinations.length) return '';
  if (destinations.length === 1) return destinations[0].path;
  const required = destinations.filter((destination) => destination.required).length;
  const optional = destinations.length - required;
  return `${destinations.length} destinations (${required} required${optional ? `, ${optional} optional` : ''})`;
}

function setTargetDestinationsToForm(destinations, fallbackPath = '') {
  const cleanDestinations = normalizeTargetDestinations(destinations, fallbackPath);
  const rows = cleanDestinations.length ? cleanDestinations : [{ path: '', required: true, label: 'Destination 1' }];
  els.targetPath.value = cleanDestinations[0] ? cleanDestinations[0].path : '';
  if (!els.targetList) return;
  els.targetList.innerHTML = rows.map((destination, index) => renderDestinationRow(destination, index, rows.length)).join('');
}

function renderDestinationRow(destination, index, count) {
  const canRemove = count > 1;
  const required = destination.required !== false;
  return `
    <div class="destination-row" data-destination-row="${index}">
      <input data-destination-input="${index}" type="text" value="${escapeAttr(destination.path || '')}" placeholder="${escapeAttr(getDestinationPathPlaceholder())}" />
      <select data-destination-required="${index}" title="Destination requirement">
        <option value="required"${required ? ' selected' : ''}>Required</option>
        <option value="optional"${required ? '' : ' selected'}>Optional</option>
      </select>
      <button class="secondary small" data-destination-browse="${index}" type="button">Browse</button>
      <button class="secondary small" data-destination-test="${index}" type="button">Test</button>
      <button class="ghost small destination-remove${canRemove ? '' : ' hidden'}" data-destination-remove="${index}" type="button" title="Remove destination">Remove</button>
    </div>
  `;
}

function getTargetDestinationsFromForm() {
  if (!els.targetList) return normalizeTargetDestinations([], els.targetPath.value);
  const rows = Array.from(els.targetList.querySelectorAll('.destination-row'));
  const values = rows.map((row) => {
    const input = row.querySelector('[data-destination-input]');
    const required = row.querySelector('[data-destination-required]');
    return {
      path: input ? input.value : '',
      required: required ? required.value !== 'optional' : true
    };
  });
  return normalizeTargetDestinations(values, '');
}

function syncTargetInputFromRows() {
  const destinations = getTargetDestinationsFromForm();
  els.targetPath.value = destinations[0] ? destinations[0].path : '';
  refreshDestinationRowButtons();
}

function refreshDestinationRowButtons() {
  if (!els.targetList) return;
  const rows = Array.from(els.targetList.querySelectorAll('.destination-row'));
  rows.forEach((row, index) => {
    row.dataset.destinationRow = String(index);
    ['input', 'required', 'browse', 'test', 'remove'].forEach((key) => {
      const attr = key === 'input' ? 'data-destination-input' : `data-destination-${key}`;
      const control = row.querySelector(`[${attr}]`);
      if (control) control.setAttribute(attr, String(index));
    });
    const remove = row.querySelector('[data-destination-remove]');
    if (remove) remove.classList.toggle('hidden', rows.length <= 1);
  });
}

function addDestinationRow(destination = { path: '', required: false }) {
  if (!els.targetList) return;
  const index = els.targetList.querySelectorAll('.destination-row').length;
  els.targetList.insertAdjacentHTML('beforeend', renderDestinationRow(destination, index, index + 1));
  refreshDestinationRowButtons();
  const inputs = els.targetList.querySelectorAll('[data-destination-input]');
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
}

function setDestinationRowValue(index, value) {
  const input = els.targetList.querySelector(`[data-destination-input="${index}"]`);
  if (input) input.value = value;
}

function removeDestinationRow(index) {
  const rows = Array.from(els.targetList.querySelectorAll('.destination-row'));
  if (rows.length <= 1) {
    const input = rows[0] && rows[0].querySelector('[data-destination-input]');
    if (input) input.value = '';
  } else if (rows[index]) {
    rows[index].remove();
  }
  refreshDestinationRowButtons();
  syncTargetInputFromRows();
}

function updateHistorySettingsVisibility() {
  if (els.fileHistoryOptions) els.fileHistoryOptions.classList.toggle('hidden', !els.historyEnabled.checked);
  if (els.restorePointsEnabled) els.restorePointsEnabled.disabled = !els.historyEnabled.checked;
  if (els.retentionOptions) els.retentionOptions.classList.toggle('hidden', !els.historyEnabled.checked || !els.retentionEnabled.checked);
}

function formatSourceSummary(job) {
  const paths = normalizeSourcePaths(job && job.sourcePaths && job.sourcePaths.length ? job.sourcePaths : job && job.sourcePath);
  if (!paths.length) return '';
  if (paths.length === 1) return paths[0];
  return `${paths.length} source folders`;
}

function setSourcePathsToForm(paths) {
  const cleanPaths = normalizeSourcePaths(paths);
  const rows = cleanPaths.length ? cleanPaths : [''];
  els.sourcePath.value = cleanPaths.join('\n');
  els.sourceList.innerHTML = rows.map((value, index) => renderSourceRow(value, index, rows.length)).join('');
}

function renderSourceRow(value, index, count) {
  const canRemove = count > 1;
  return `
    <div class="source-row" data-source-row="${index}">
      <input data-source-input="${index}" type="text" value="${escapeAttr(value || '')}" placeholder="${escapeAttr(getSourcePathPlaceholder())}" />
      <button class="secondary small" data-source-browse="${index}" type="button">Browse</button>
      <button class="ghost small source-remove${canRemove ? '' : ' hidden'}" data-source-remove="${index}" type="button" title="Remove source folder">Remove</button>
    </div>
  `;
}

function getSourcePathsFromForm() {
  if (!els.sourceList) return normalizeSourcePaths(els.sourcePath.value);
  const values = Array.from(els.sourceList.querySelectorAll('[data-source-input]'))
    .map((input) => input.value);
  return normalizeSourcePaths(values);
}

function syncSourceTextareaFromRows() {
  els.sourcePath.value = getSourcePathsFromForm().join('\n');
  refreshSourceRemoveButtons();
}

function refreshSourceRemoveButtons() {
  const rows = Array.from(els.sourceList.querySelectorAll('.source-row'));
  rows.forEach((row, index) => {
    row.dataset.sourceRow = String(index);
    const input = row.querySelector('[data-source-input]');
    const browse = row.querySelector('[data-source-browse]');
    const remove = row.querySelector('[data-source-remove]');
    if (input) input.setAttribute('data-source-input', String(index));
    if (browse) browse.setAttribute('data-source-browse', String(index));
    if (remove) {
      remove.setAttribute('data-source-remove', String(index));
      remove.classList.toggle('hidden', rows.length <= 1);
    }
  });
}

function addSourceRow(value = '') {
  const index = els.sourceList.querySelectorAll('.source-row').length;
  els.sourceList.insertAdjacentHTML('beforeend', renderSourceRow(value, index, index + 1));
  refreshSourceRemoveButtons();
  const inputs = els.sourceList.querySelectorAll('[data-source-input]');
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
}

function setSourceRowValue(index, value) {
  const input = els.sourceList.querySelector(`[data-source-input="${index}"]`);
  if (input) input.value = value;
}

function removeSourceRow(index) {
  const rows = Array.from(els.sourceList.querySelectorAll('.source-row'));
  if (rows.length <= 1) {
    const input = rows[0] && rows[0].querySelector('[data-source-input]');
    if (input) input.value = '';
  } else if (rows[index]) {
    rows[index].remove();
  }
  refreshSourceRemoveButtons();
}

function resetJobDerivedViews() {
  logMode = 'live';
  selectedRecentRunIndex = null;
  visibleRecentRuns = [];
  previewState.files = [];
  previewState.summary = null;
  previewState.message = '';
  previewState.ok = null;
  previewState.cwd = '';
  previewState.expandedFile = null;
  if (els.previewSearch) els.previewSearch.value = '';
  historyState.versions = [];
  historyState.filtered = [];
  historyState.cwd = '';
  historyState.expandedFile = null;
  historyState.selectedId = null;
  historyState.loadedJobId = null;
  restorePointState.points = [];
  restorePointState.selectedId = null;
  restorePointState.selectedManifest = null;
  restorePointState.manifestLoading = false;
  restorePointState.manifestError = '';
  restorePointState.cwd = '';
  restorePointState.restoreFolder = '';
  restorePointState.restoring = false;
  clearRestorePointFileSelection();
  clearRestorePointPlan();
  if (restorePointState.manifestCache && typeof restorePointState.manifestCache.clear === 'function') restorePointState.manifestCache.clear();
  restorePointState.loadedJobId = null;
  restorePointState.lastRefreshOk = null;
  restorePointState.disabledReason = '';

  loadPersistedCompareForActiveJob();
  renderPreviewTable();
  renderPreviewStatus();
  setPreviewAccess(compareDone);
  setPreviewPanelVisible(true);
  renderRecentRuns(config && Array.isArray(config.lastRuns) ? config.lastRuns : []);
  renderHistoryMetrics({ versions: [], files: 0, manifestsRead: 0, manifestErrors: 0 });
  renderHistoryVersions();
  renderHistorySelection();
  renderRestorePoints();
  renderRestorePointSelection();
  renderRestorePointFileBrowser();
  setHistoryStatus('Not loaded yet.', null);

  if (!compareDone) {
    compareReadyAt = null;
    compareFingerprint = null;
    runPlanTotal = 0;
    setLastScanHint();
  }
  updateRunButtons();
}


function normalizeAppSettings(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const priority = String(raw.schedulerQueuePriority || DEFAULT_APP_SETTINGS.schedulerQueuePriority);
  const rawSkipMap = raw.skipManualApplyWarningByMode && typeof raw.skipManualApplyWarningByMode === 'object'
    ? raw.skipManualApplyWarningByMode
    : {};
  const skipManualApplyWarningByMode = {};

  Object.keys(SYNC_MODES).forEach((mode) => {
    if (rawSkipMap[mode] === true) skipManualApplyWarningByMode[mode] = true;
  });

  return {
    ...DEFAULT_APP_SETTINGS,
    schedulerQueuePriority: Object.prototype.hasOwnProperty.call(SCHEDULER_QUEUE_PRIORITIES, priority)
      ? priority
      : DEFAULT_APP_SETTINGS.schedulerQueuePriority,
    skipManualApplyWarningByMode
  };
}

function getAppSettingsFromForm() {
  const existing = normalizeAppSettings(config && config.appSettings);
  return normalizeAppSettings({
    ...existing
  });
}

async function resetManualRunWarningChoices() {
  const appSettings = normalizeAppSettings({
    ...(config && config.appSettings ? config.appSettings : {}),
    skipManualApplyWarningByMode: {}
  });

  config = await window.syncarr.saveConfig({ appSettings });
}

function applyTelegramSettingsToForm(input = {}) {
  return applyTelegramSettingsToFormUtil(els, input);
}
function updateTelegramSettingsVisibility() {
  return updateTelegramSettingsVisibilityUtil(els);
}
function getTelegramSettingsFromForm() {
  return getTelegramSettingsFromFormUtil(els);
}
function renderTelegramStatus(status) {
  return renderTelegramStatusUtil(els, status);
}

async function testTelegramSettings() {
  await saveJob();
  renderTelegramStatus({ ok: true, message: 'Sending Telegram test...' });
  let result = null;
  try {
    result = await window.syncarr.testTelegram(getTelegramSettingsFromForm());
  } catch (error) {
    result = { ok: false, message: error && error.message ? error.message : String(error) };
  }
  renderTelegramStatus(result);
}

function switchView(viewName) {
  const aliases = { maintenance: 'settings' };
  const requested = aliases[viewName] || viewName;
  const views = ['sync', 'history', 'settings'];
  activeView = views.includes(requested) ? requested : 'sync';
  els.viewTabs.forEach((button) => {
    const tabView = aliases[button.dataset.viewTab] || button.dataset.viewTab;
    button.classList.toggle('active', tabView === activeView);
  });
  els.syncView.classList.toggle('hidden', activeView !== 'sync');
  els.historyView.classList.toggle('hidden', activeView !== 'history');
  if (els.settingsView) els.settingsView.classList.toggle('hidden', activeView !== 'settings');
  // Each view is a fresh page; keep the scroll offset of the previous view
  // from landing the user mid-page (guard: the test window shim has no scrollTo).
  if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  updatePageHeader();
  renderJobList();

  if (activeView === 'history') {
    void loadHistory({ preserveSelection: true });
    void loadRestorePoints({ preserveSelection: true });
  }

  if (activeView === 'sync') {
    // The interrupted-runs panel lives on the Sync tab now; refresh it on
    // entry so a freshly interrupted run surfaces without a manual refresh.
    void loadRecoveryStatus();
  }
}

function applyRecoveryStatus(status) {
  recoveryState.runs = status && Array.isArray(status.runs) ? status.runs : [];
  recoveryState.config = status && status.config ? status.config : null;
}

async function loadRecoveryStatus() {
  if (!window.syncarr || typeof window.syncarr.getRecoveryStatus !== 'function') return;
  const status = await window.syncarr.getRecoveryStatus();
  applyRecoveryStatus(status);
  renderRecoveryRuns(status && status.ok === false ? status.message : '');
}

function renderRecoveryRuns(errorMessage = '') {
  if (!els.recoveryRunRows) return;
  const health = recoveryState.config;
  const showHealth = health && (health.recovered || health.ok === false);
  if (els.recoveryConfigStatus) {
    els.recoveryConfigStatus.classList.toggle('hidden', !showHealth);
    els.recoveryConfigStatus.textContent = showHealth
      ? (health.message || `Configuration was recovered from ${health.source || 'a backup'}. Review job settings before the next run.`)
      : '';
  }
  // Only surface the interrupted-runs panel when something needs attention —
  // an interrupted run, a recovered-config warning, or a load error. When the
  // app is healthy it stays hidden so it doesn't clutter the Sync tab.
  if (els.recoveryRunsPanel) {
    const needsAttention = recoveryState.runs.length > 0 || showHealth || Boolean(errorMessage);
    els.recoveryRunsPanel.classList.toggle('hidden', !needsAttention);
  }
  if (errorMessage) {
    els.recoveryRunRows.innerHTML = `<div class="history-empty">${escapeHtml(errorMessage)}</div>`;
    return;
  }
  if (!recoveryState.runs.length) {
    els.recoveryRunRows.innerHTML = '<div class="history-empty">No interrupted sync runs need attention.</div>';
    return;
  }
  els.recoveryRunRows.innerHTML = recoveryState.runs.map((run) => {
    const operations = Array.isArray(run.operations) ? run.operations : [];
    const archived = operations.filter((item) => item.archivePath).length;
    const completed = operations.filter((item) => item.status === 'completed').length;
    const expanded = recoveryState.expandedRunId === run.runId;
    const details = operations.slice(0, 100).map((item) => `${item.status || 'planned'} | ${item.action || 'operation'} | ${item.relativePath || item.targetPath || ''}`).join('\n');
    return `
      <article class="recovery-run-card">
        <div class="recovery-run-main">
          <strong>${escapeHtml(run.jobName || 'Sync job')} - ${escapeHtml(getSyncModeInfo(run.syncMode).shortLabel)}</strong>
          <small>Interrupted ${escapeHtml(formatDateTime(run.startedAt))} | ${formatNumber(operations.length)} planned | ${formatNumber(completed)} completed | ${formatNumber(archived)} archived</small>
          <small>${escapeHtml(run.trigger || 'manual')} | ${escapeHtml(run.runId || '')}</small>
        </div>
        <div class="recovery-run-actions">
          <button class="secondary small" type="button" data-recovery-action="inspect" data-job-id="${escapeAttr(run.jobId)}" data-run-id="${escapeAttr(run.runId)}">${expanded ? 'Hide details' : 'Inspect'}</button>
          <button class="secondary small" type="button" data-recovery-action="resume" data-job-id="${escapeAttr(run.jobId)}" data-run-id="${escapeAttr(run.runId)}">Resume safely</button>
          <button class="secondary small" type="button" data-recovery-action="rollback" data-job-id="${escapeAttr(run.jobId)}" data-run-id="${escapeAttr(run.runId)}">Preview rollback</button>
          <button class="ghost small" type="button" data-recovery-action="dismiss" data-job-id="${escapeAttr(run.jobId)}" data-run-id="${escapeAttr(run.runId)}">Dismiss</button>
        </div>
        ${expanded ? `<pre class="recovery-operation-list">${escapeHtml(details || 'No mutation operations were recorded before interruption.')}</pre>` : ''}
      </article>`;
  }).join('');
}

async function runRecoveryAction(action, request) {
  recoveryState.busy = true;
  renderRecoveryRuns();
  try {
    let result;
    if (action === 'rollback') {
      const preview = await window.syncarr.previewRecoveryRollback(request);
      if (!preview.ready) {
        await uiAlert('Rollback needs review', preview.message || 'Rollback needs manual review. No files were changed.', 'warning');
        return;
      }
      const totals = preview.totals || {};
      const confirmed = await uiConfirm({
        title: 'Roll back this interrupted run?',
        message: `Restore ${totals.restore || 0} original file(s) and remove ${totals.remove || 0} file(s) created by the run.\n\nFiles changed afterward will never be overwritten.`,
        confirmLabel: 'Roll back',
        tone: 'danger'
      });
      if (!confirmed) return;
      result = await window.syncarr.rollbackRecoveryRun(request);
    } else if (action === 'resume') {
      const confirmed = await uiConfirm({
        title: 'Resume this job?',
        message: 'Resume this job from a fresh scan. The old partial plan will not be replayed blindly.',
        confirmLabel: 'Resume',
        tone: 'question'
      });
      if (!confirmed) return;
      result = await window.syncarr.resumeRecoveryRun(request);
    } else if (action === 'dismiss') {
      const confirmed = await uiConfirm({
        title: 'Dismiss interrupted run?',
        message: 'Dismiss this interrupted run without changing any files?',
        confirmLabel: 'Dismiss',
        tone: 'question'
      });
      if (!confirmed) return;
      result = await window.syncarr.dismissRecoveryRun(request);
    }
    if (result) {
      appendLog(`\nRecovery: ${result.message || (result.ok ? 'completed' : 'failed')}\n`);
      if (!result.ok) await uiAlert('Recovery action failed', result.message || 'Recovery action failed.', 'danger');
    }
  } catch (error) {
    await uiAlert('Something went wrong', error && error.message ? error.message : String(error), 'danger');
  } finally {
    recoveryState.busy = false;
    await loadRecoveryStatus();
  }
}

function updatePageHeader() {
  const meta = {
    sync: {
      eyebrow: 'Local → NAS workspace',
      title: 'Sync'
    },
    history: {
      eyebrow: 'Per-job restore browser',
      title: 'File history'
    },
    settings: {
      eyebrow: 'Application settings',
      title: 'Settings'
    }
  }[activeView] || {
    eyebrow: 'Local → NAS workspace',
    title: 'Sync'
  };

  if (els.pageEyebrowText) els.pageEyebrowText.textContent = meta.eyebrow;
  if (els.pageTitle) els.pageTitle.textContent = meta.title;
}

function applyConfigToForm(nextConfig) {
  const job = getActiveJob() || nextConfig.job || {};
  els.jobName.value = job.name || 'Music to NAS';
  if (els.jobEnabled) els.jobEnabled.checked = job.enabled !== false;
  if (els.jobNotificationsEnabled) els.jobNotificationsEnabled.checked = job.notificationsEnabled === true;
  if (els.syncMode) els.syncMode.value = normalizeSyncMode(job.syncMode);
  if (els.twoWayConflictPolicy) els.twoWayConflictPolicy.value = normalizeTwoWayConflictPolicy(job.twoWayConflictPolicy);
  setSourcePathsToForm(job.sourcePaths && job.sourcePaths.length ? job.sourcePaths : job.sourcePath);
  setTargetDestinationsToForm(job.targetDestinations, job.targetPath);
  els.historyEnabled.checked = job.historyEnabled !== false;
  els.freeSpaceCheckEnabled.checked = job.freeSpaceCheckEnabled !== false;
  els.minimumFreeGb.value = job.minimumFreeGb ?? 1;
  if (els.restorePointsEnabled) els.restorePointsEnabled.checked = job.restorePointsEnabled === true;
  els.retentionEnabled.checked = job.retentionEnabled === true;
  els.retentionMaxVersions.value = job.retentionMaxVersions || 10;
  els.retentionMaxAgeDays.value = job.retentionMaxAgeDays || 365;
  els.retentionKeepLatest.checked = job.retentionKeepLatest !== false;
  els.retentionPruneEmptyFolders.checked = job.retentionPruneEmptyFolders !== false;
  els.retentionPruneAfterSync.checked = job.retentionPruneAfterSync === true;
  els.skipOlderSource.checked = job.skipOlderSource !== false;
  els.copySubfolders.checked = job.copySubfolders !== false;
  updateHistorySettingsVisibility();
  renderSyncModeDescription();
  applyScheduleToForm(job.schedule);
  applyWatchToForm(job.watch);
  updateSidebar();
  updateRunButtons();
}

function getJobFromForm() {
  const activeJob = getActiveJob();
  return {
    id: jobState.activeJobId || DEFAULT_JOB_ID,
    name: els.jobName.value.trim() || 'Music to NAS',
    enabled: els.jobEnabled ? els.jobEnabled.checked : true,
    notificationsEnabled: els.jobNotificationsEnabled ? els.jobNotificationsEnabled.checked : false,
    syncMode: normalizeSyncMode(els.syncMode ? els.syncMode.value : 'oneWay'),
    twoWayConflictPolicy: normalizeTwoWayConflictPolicy(els.twoWayConflictPolicy && els.twoWayConflictPolicy.value),
    sourcePath: getSourcePathsFromForm()[0] || '',
    sourcePaths: getSourcePathsFromForm(),
    targetPath: (getTargetDestinationsFromForm()[0] && getTargetDestinationsFromForm()[0].path) || els.targetPath.value.trim(),
    targetDestinations: getTargetDestinationsFromForm(),
    excludePatterns: Array.isArray(activeJob.excludePatterns) ? activeJob.excludePatterns : DEFAULT_EXCLUDE_PATTERNS,
    historyEnabled: els.historyEnabled.checked,
    historyFolderName: '.syncarr-history',
    freeSpaceCheckEnabled: els.freeSpaceCheckEnabled.checked,
    minimumFreeGb: readNumberInput(els.minimumFreeGb, 1),
    retentionEnabled: els.retentionEnabled.checked,
    retentionMaxVersions: Math.max(1, Math.floor(readNumberInput(els.retentionMaxVersions, 10))),
    retentionMaxAgeDays: Math.max(1, Math.floor(readNumberInput(els.retentionMaxAgeDays, 365))),
    retentionKeepLatest: els.retentionKeepLatest.checked,
    retentionPruneEmptyFolders: els.retentionPruneEmptyFolders.checked,
    retentionPruneAfterSync: els.retentionPruneAfterSync.checked,
    restorePointsEnabled: Boolean(els.historyEnabled.checked && els.restorePointsEnabled && els.restorePointsEnabled.checked),
    restorePointRetentionMax: activeJob.restorePointRetentionMax || 50,
    skipOlderSource: els.skipOlderSource.checked,
    copySubfolders: els.copySubfolders.checked,
    schedule: getScheduleFromForm(activeJob.schedule),
    watch: getWatchFromForm(activeJob.watch)
  };
}

function applyScheduleToForm(scheduleInput) {
  const schedule = normalizeSchedule(scheduleInput);
  els.scheduleEnabled.checked = schedule.enabled;
  els.scheduleMode.value = schedule.mode;
  els.scheduleFrequency.value = schedule.frequency;
  els.scheduleIntervalValue.value = schedule.intervalValue;
  els.scheduleIntervalUnit.value = schedule.intervalUnit;
  els.scheduleTime.value = schedule.time;
  els.scheduleDayInputs.forEach((input) => {
    input.checked = schedule.days.includes(input.dataset.weekday);
  });
  updateScheduleFieldVisibility();
  renderScheduleStatus(schedule);
  renderJobConflictWarning(schedule.lastRun);
}

function isConflictBlockedRun(run, jobId = jobState.activeJobId) {
  if (String(run && run.status || '').toLowerCase() !== 'conflicts' || run.conflictAcknowledgedAt) return false;
  const blockedAt = new Date(run.at).getTime();
  if (!Number.isFinite(blockedAt)) return true;
  return !((config && config.lastRuns) || []).some((candidate) => {
    const candidateAt = new Date(candidate && candidate.at).getTime();
    return candidate && candidate.dryRun === true && candidate.ok === true
      && sanitizeJobId(candidate.jobId) === sanitizeJobId(jobId)
      && Number.isFinite(candidateAt) && candidateAt > blockedAt;
  });
}

function renderJobConflictWarning(lastRun) {
  if (!els.jobConflictWarning) return;
  const blocked = isConflictBlockedRun(lastRun);
  els.jobConflictWarning.classList.toggle('hidden', !blocked);
  if (!blocked) return;
  const when = lastRun.at ? formatDateTime(lastRun.at) : 'the last scheduled attempt';
  els.jobConflictWarning.innerHTML = `
    <strong>Scheduled task blocked by conflicts</strong>
    <span>${escapeHtml(lastRun.message || 'This job did not run because its preview found unresolved conflicts.')}</span>
    <small>Blocked ${escapeHtml(when)}. Run Compare and review the conflicting files before the next scheduled run.</small>
  `;
}

function applyWatchToForm(watchInput) {
  const watch = normalizeWatchSettings(watchInput);
  if (els.watchEnabled) els.watchEnabled.checked = watch.enabled;
  if (els.watchMode) els.watchMode.value = watch.mode;
  if (els.watchSettleSeconds) els.watchSettleSeconds.value = watch.settleSeconds;
  if (els.watchMaxWaitSeconds) els.watchMaxWaitSeconds.value = watch.maxWaitSeconds;
  updateWatcherFieldVisibility();
  renderWatcherStatus(watch);
}

function getWatchFromForm(previousWatch = {}) {
  const previous = normalizeWatchSettings(previousWatch);
  return normalizeWatchSettings({
    ...previous,
    enabled: els.watchEnabled ? els.watchEnabled.checked : false,
    mode: els.watchMode ? els.watchMode.value : 'compare',
    settleSeconds: els.watchSettleSeconds ? readNumberInput(els.watchSettleSeconds, 10) : 10,
    maxWaitSeconds: els.watchMaxWaitSeconds ? readNumberInput(els.watchMaxWaitSeconds, 120) : 120
  });
}

function updateWatcherFieldVisibility() {
  if (els.watchSettingsFields && els.watchEnabled) {
    els.watchSettingsFields.classList.toggle('hidden', !els.watchEnabled.checked);
  }
}

function renderWatcherStatusFromForm() {
  renderWatcherStatus(getWatchFromForm(getActiveJob().watch));
}

function renderWatcherStatus(watchInput) {
  if (!els.watchStatus) return;
  const watch = normalizeWatchSettings(watchInput);
  const job = getActiveJob();
  const runtime = watcherRuntimeByJob.get(sanitizeJobId(job && job.id)) || null;
  const sourceCount = normalizeSourcePaths(job && (job.sourcePaths && job.sourcePaths.length ? job.sourcePaths : job.sourcePath)).length;
  els.watchStatus.classList.remove('ok', 'error', 'warning');

  if (!watch.enabled) {
    els.watchStatus.innerHTML = '<strong>Smart watcher</strong><span>Disabled.</span><small>Enable watching to react to source changes.</small>';
    return;
  }

  const action = watch.mode === 'sync' ? 'safe sync' : 'compare';
  let tone = 'ok';
  let statusText = `Watching ${formatNumber(sourceCount)} source folder(s).`;
  let note = `Runs ${action} after ${formatNumber(watch.settleSeconds)} quiet second(s), within ${formatNumber(watch.maxWaitSeconds)} seconds.`;

  if (job && job.enabled === false) {
    tone = 'warning';
    statusText = 'Watcher paused because this job is disabled.';
    note = 'Enable the job to resume source monitoring.';
  } else if (!sourceCount) {
    tone = 'error';
    statusText = 'No source folder is configured.';
    note = 'Add a source folder before enabling the watcher.';
  } else if (watch.mode === 'sync' && normalizeSyncMode(job && job.syncMode) === 'twoWay' && job.freeSpaceCheckEnabled !== false) {
    tone = 'warning';
    statusText = 'Watching, but automatic two-way apply is paused.';
    note = 'Two-way free-space preflight is not available yet. Use Compare only, or explicitly disable the free-space check for this job.';
  } else if (watch.mode === 'sync' && !isSyncModeRunnable(job && job.syncMode)) {
    tone = 'warning';
    statusText = 'Watching, but automatic apply is locked for this sync mode.';
    note = 'Switch the watched action to Compare only or choose a runnable sync mode.';
  } else if (runtime) {
    if (runtime.type === 'change') {
      tone = 'warning';
      statusText = `${formatNumber(runtime.changeCount || 1)} change event(s) pending.`;
      note = runtime.dueAt ? `Expected run after ${formatDateTime(runtime.dueAt)} if changes stay quiet.` : note;
    } else if (runtime.type === 'waiting') {
      tone = 'warning';
      statusText = 'Changes are queued behind another operation.';
      note = 'The watcher will retry automatically when Syncarr is idle.';
    } else if (runtime.type === 'start') {
      statusText = `Watched ${runtime.mode === 'sync' ? 'sync' : 'compare'} is running.`;
      note = 'Additional source changes will be queued for another pass.';
    } else if (runtime.type === 'complete') {
      tone = runtime.result && runtime.result.ok ? 'ok' : 'error';
      statusText = runtime.result && runtime.result.ok ? 'Last watched run completed.' : 'Last watched run failed.';
      note = runtime.result && runtime.result.message ? runtime.result.message : note;
    } else if (runtime.type === 'error') {
      tone = 'error';
      statusText = 'A source folder could not be watched.';
      note = runtime.message || 'Syncarr will retry automatically.';
    }
  } else if (watcherOverview && watcherOverview.unavailableSources > 0) {
    tone = 'warning';
    note = `${formatNumber(watcherOverview.unavailableSources)} source folder(s) are unavailable; Syncarr will retry.`;
  }

  els.watchStatus.classList.add(tone);
  els.watchStatus.innerHTML = `<strong>Smart watcher</strong><span>${escapeHtml(statusText)}</span><small>${escapeHtml(note)}</small>`;
}

function handleWatcherEvent(payload) {
  if (!payload) return;
  if (payload.type === 'watching') applyWatcherSnapshot(payload);
  if (payload.jobId) watcherRuntimeByJob.set(sanitizeJobId(payload.jobId), payload);
  renderWatcherStatus(getActiveJob().watch);
  if (payload.type === 'complete') {
    refreshConfigAfterBackgroundRun();
    toastBackgroundRunComplete(payload, 'watch');
  }
}

// Surface background (scheduled/watched) run completions as toasts — these runs
// finish while the user is elsewhere in the app, with no run modal open.
// Successful compares stay quiet (same rationale as shouldNotifyDesktop: watch
// compares are far too frequent); failures always surface.
function toastBackgroundRunComplete(payload, origin) {
  const result = payload && payload.result;
  if (!result) return;
  const jobName = payload.jobName || 'Sync job';
  const label = origin === 'watch' ? 'Watched run' : 'Scheduled run';
  if (result.ok !== true) {
    toast('error', `${label} failed — check Recent runs for details`, { title: jobName });
    return;
  }
  if (payload.kind !== 'sync') return;
  const copied = window.SyncarrSummaryMetrics
    ? Number(window.SyncarrSummaryMetrics.extractCopiedCount(result.summary)) || 0
    : 0;
  const detail = copied > 0
    ? `${formatNumber(copied)} file${copied === 1 ? '' : 's'} copied`
    : 'no changes needed';
  toast('success', `${label} finished — ${detail}`, { title: jobName });
}

function applyWatcherSnapshot(snapshot) {
  watcherOverview = snapshot;
  const activeIds = new Set();

  for (const jobStatus of Array.isArray(snapshot.jobs) ? snapshot.jobs : []) {
    const jobId = sanitizeJobId(jobStatus.id);
    activeIds.add(jobId);
    if (jobStatus.running) {
      watcherRuntimeByJob.set(jobId, { type: 'start', jobId, mode: jobStatus.mode || 'compare' });
    } else if (Number(jobStatus.pendingChanges || 0) > 0) {
      watcherRuntimeByJob.set(jobId, {
        type: 'change',
        jobId,
        changeCount: Number(jobStatus.pendingChanges || 0),
        dueAt: jobStatus.dueAt || null
      });
    } else if (Number(jobStatus.unavailableSources || 0) > 0) {
      watcherRuntimeByJob.set(jobId, {
        type: 'error',
        jobId,
        message: `${formatNumber(jobStatus.unavailableSources)} source folder(s) are unavailable. Syncarr will retry automatically.`
      });
    } else {
      const previous = watcherRuntimeByJob.get(jobId);
      if (previous && ['start', 'change', 'waiting', 'error'].includes(previous.type)) {
        watcherRuntimeByJob.delete(jobId);
      }
    }
  }

  for (const [jobId, runtime] of watcherRuntimeByJob.entries()) {
    if (!activeIds.has(jobId) && runtime && ['start', 'change', 'waiting', 'error'].includes(runtime.type)) {
      watcherRuntimeByJob.delete(jobId);
    }
  }
}

function getScheduleFromForm(previousSchedule = {}) {
  const previous = normalizeSchedule(previousSchedule);
  const next = normalizeSchedule({
    ...previous,
    enabled: els.scheduleEnabled.checked,
    mode: els.scheduleMode.value,
    frequency: els.scheduleFrequency.value,
    intervalValue: readNumberInput(els.scheduleIntervalValue, 1),
    intervalUnit: els.scheduleIntervalUnit.value,
    time: els.scheduleTime.value,
    days: Array.from(els.scheduleDayInputs).filter((input) => input.checked).map((input) => input.dataset.weekday)
  });

  if (!next.enabled) {
    next.nextRunAt = null;
  } else if (!previous.nextRunAt || scheduleKey(previous) !== scheduleKey(next)) {
    next.nextRunAt = computeNextRunAt(next, new Date()).toISOString();
  }

  return next;
}

function updateScheduleFieldVisibility() {
  const frequency = els.scheduleFrequency.value;
  els.scheduleIntervalFields.classList.toggle('hidden', frequency !== 'interval');
  els.scheduleTimeFields.classList.toggle('hidden', !['daily', 'weekly'].includes(frequency));
  els.scheduleWeekdays.classList.toggle('hidden', frequency !== 'weekly');
}

function renderScheduleStatusFromForm() {
  renderScheduleStatus(getScheduleFromForm(getActiveJob().schedule));
}

function renderScheduleStatus(scheduleInput) {
  if (!els.scheduleStatus) return;
  const schedule = normalizeSchedule(scheduleInput);
  els.scheduleStatus.classList.remove('ok', 'error', 'warning');

  if (!schedule.enabled) {
    els.scheduleStatus.innerHTML = `
      <strong>Schedule</strong>
      <span>Disabled.</span>
      <small>Enable scheduling to calculate the next run.</small>
    `;
    return;
  }

  const conflictBlocked = isConflictBlockedRun(schedule.lastRun);
  els.scheduleStatus.classList.add(conflictBlocked ? 'warning' : 'ok');
  const nextText = schedule.frequency === 'startup'
    ? 'Next app start'
    : formatDateTime(schedule.nextRunAt || computeNextRunAt(schedule, new Date()).toISOString());
  const lastText = schedule.lastRun && schedule.lastRun.at
    ? `${formatDateTime(schedule.lastRun.at)} | ${schedule.lastRun.status || 'complete'}`
    : 'No scheduled run yet';

  els.scheduleStatus.innerHTML = `
    <strong>${conflictBlocked ? 'Schedule needs attention' : 'Schedule'}</strong>
    <span>${escapeHtml(formatScheduleSummary({ schedule }))}</span>
    <small>Next: ${escapeHtml(nextText)} | Last: ${escapeHtml(lastText)}</small>
  `;
}

function formatScheduleSummary(job) {
  const schedule = normalizeSchedule(job && job.schedule);
  if (!schedule.enabled) return 'Schedule: off';

  const action = schedule.mode === 'sync' ? 'sync' : 'compare';
  if (schedule.frequency === 'startup') return `Schedule: ${action} when app starts`;
  if (schedule.frequency === 'interval') {
    const unit = schedule.intervalValue === 1 ? schedule.intervalUnit.replace(/s$/, '') : schedule.intervalUnit;
    return `Schedule: ${action} every ${schedule.intervalValue} ${unit}`;
  }
  if (schedule.frequency === 'weekly') {
    const days = schedule.days.map((day) => WEEKDAY_LABELS[day] || day).join(', ');
    return `Schedule: ${action} weekly ${days} at ${schedule.time}`;
  }
  return `Schedule: ${action} daily at ${schedule.time}`;
}

// Mirror of scheduler-policy.js computeNextRunAt (renderer copy — keep in sync).
function computeNextRunAt(scheduleInput, from = new Date()) {
  const schedule = normalizeSchedule(scheduleInput);
  const start = new Date(from);
  start.setSeconds(0, 0);

  if (schedule.frequency === 'startup') {
    return new Date(start.getTime() + 1000);
  }

  if (schedule.frequency === 'interval') {
    const amount = schedule.intervalValue * (schedule.intervalUnit === 'minutes' ? 60_000 : 3_600_000);
    return new Date(start.getTime() + amount);
  }

  const [hour, minute] = schedule.time.split(':').map((part) => Number(part));

  if (schedule.frequency === 'daily') {
    const candidate = new Date(start);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate <= from) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }

  const wantedDays = schedule.days.length ? schedule.days : DEFAULT_SCHEDULE.days;
  for (let offset = 0; offset <= 14; offset += 1) {
    const candidate = new Date(start);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    const dayCode = WEEKDAY_ORDER[candidate.getDay()];
    if (wantedDays.includes(dayCode) && candidate > from) return candidate;
  }

  const fallback = new Date(start);
  fallback.setDate(fallback.getDate() + 7);
  fallback.setHours(hour, minute, 0, 0);
  return fallback;
}

async function saveJob(options = {}) {
  upsertCurrentJobInState();
  config = await window.syncarr.saveConfig({
    activeJobId: jobState.activeJobId,
    job: getJobFromForm(),
    jobs: jobState.jobs,
    appSettings: getAppSettingsFromForm(),
    telegramSettings: getTelegramSettingsFromForm()
  });
  syncJobStateFromConfig(config);
  if (!options.preserveForm) applyConfigToForm(config);
  renderJobList();
  updateSidebar();
  renderScheduleStatus(getActiveJob().schedule);
  dirty = false;
  updateSaveBar();
  return config;
}

function publishTrayActivity(patch) {
  if (!window.syncarr || typeof window.syncarr.setTrayActivity !== 'function') return;
  window.syncarr.setTrayActivity(patch || {});
}

function getTrayTaskKindLabel(kind) {
  if (kind === 'compare') return 'Compare';
  if (kind === 'sync') return 'Sync';
  if (kind === 'preview') return 'Preview';
  if (kind === 'restore') return 'Restore';
  if (kind === 'retention') return 'Retention';
  return 'Task';
}

function makeTrayTask(jobInput, kind = 'task', options = {}) {
  const job = normalizeRendererJob(jobInput || {});
  return {
    id: job.id,
    name: job.name || 'Sync job',
    kind,
    label: getTrayTaskKindLabel(kind),
    message: options.message || '',
    scheduled: options.scheduled === true,
    dueAt: options.dueAt || null,
    startedAt: options.startedAt || null,
    completedAt: options.completedAt || null,
    queuePosition: options.queuePosition || 0,
    queueTotal: options.queueTotal || 0,
    progress: options.progress || {}
  };
}

function beginTrayTask(job, kind, options = {}) {
  const startedAt = new Date().toISOString();
  activeTrayTask = makeTrayTask(job, kind, {
    ...options,
    startedAt,
    progress: {
      indeterminate: true,
      total: Number(options.total || 0),
      label: options.message || `Preparing ${getTrayTaskKindLabel(kind).toLowerCase()}...`
    }
  });
  publishTrayActivity({
    status: 'running',
    active: activeTrayTask,
    ...(Array.isArray(options.queue) ? { queue: options.queue } : {})
  });
}

function sendTrayProgress(progress) {
  if (!activeTrayTask || !progress) return;
  const copied = Number(progress.copied) || 0;
  const skipped = Number(progress.skipped) || 0;
  const failed = Number(progress.failed) || 0;
  const extra = Number(progress.extra) || 0;
  const processed = copied + skipped + failed + extra;
  const total = Number(activeTrayTask.progress && activeTrayTask.progress.total) || 0;
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round(((copied + failed + extra) / total) * 100))) : null;
  pendingTrayProgress = {
    percent,
    indeterminate: percent === null,
    copied,
    skipped,
    failed,
    extra,
    processed,
    total,
    label: getProgressActionStatus(progress, normalizeSyncMode(getJobFromForm().syncMode), activeTrayTask.kind === 'compare'),
    file: progress.latestFile || progress.file || ''
  };

  const flush = () => {
    trayProgressTimer = null;
    if (!pendingTrayProgress || !activeTrayTask) return;
    activeTrayTask = { ...activeTrayTask, progress: pendingTrayProgress };
    pendingTrayProgress = null;
    trayProgressLastSentAt = Date.now();
    publishTrayActivity({ active: { progress: activeTrayTask.progress } });
  };

  const waitMs = Math.max(0, 200 - (Date.now() - trayProgressLastSentAt));
  if (!waitMs) flush();
  else if (!trayProgressTimer) trayProgressTimer = window.setTimeout(flush, waitMs);
}

function completeTrayTask(result) {
  if (!activeTrayTask || !result) return;
  if (trayProgressTimer) window.clearTimeout(trayProgressTimer);
  trayProgressTimer = null;
  pendingTrayProgress = null;

  const cancelled = isCancelledRun(result);
  const visualKind = getRunVisualKind(result);
  const status = cancelled ? 'cancelled' : (result.ok ? (visualKind === 'warning' ? 'warning' : 'success') : 'error');
  const progress = {
    ...(activeTrayTask.progress || {}),
    percent: result.ok ? 100 : (activeTrayTask.progress && activeTrayTask.progress.percent),
    indeterminate: false,
    label: result.message || (result.ok ? 'Task complete.' : 'Task failed.')
  };
  publishTrayActivity({
    status,
    active: {
      ...activeTrayTask,
      message: result.message || '',
      completedAt: new Date().toISOString(),
      progress
    }
  });
  activeTrayTask = null;
}

async function runJob(dryRun) {
  const currentJobForRun = getJobFromForm();
  if (currentJobForRun.enabled === false) {
    setRunHint('This job is disabled. Enable it before running Compare or Sync.', 'stale');
    appendLog(`\nJob disabled: ${currentJobForRun.name || 'Sync job'} cannot run.\n`);
    updateRunButtons();
    return;
  }

  if (dryRun) {
    await runCompareJob();
    return;
  }

  if (!isSyncModeRunnable(currentJobForRun.syncMode)) {
    const info = getSyncModeInfo(currentJobForRun.syncMode);
    setRunHint(`${info.label}: sync apply is locked for safety. Use Compare to inspect the plan.`, 'stale');
    appendLog(`\nSync mode locked: ${info.label} can be compared, but applying it is blocked in this build.\n`);
    updateRunButtons();
    return;
  }

  const applyConfirmed = await confirmManualRunApplyPlan(currentJobForRun);
  if (!applyConfirmed) {
    setRunHint('Sync cancelled — the last Compare plan was not applied.', 'stale');
    appendLog(`\nManual sync cancelled before applying the last Compare plan.\n`);
    updateRunButtons();
    return;
  }

  await saveJob();
  clearSummary();

  const job = getJobFromForm();
  startLiveLog('Sync log', job.name);
  openRunOverlay(job.name, 'sync');

  setBusy(true, 'Sync running');
  completionRenderedByEvent = false;
  appendLog(`\n--- ${normalizeSyncMode(job.syncMode) === 'mirror' ? 'MIRROR SYNC' : 'UPDATE SYNC'} ${new Date().toLocaleString()} ---\n`);

  let result = null;
  try {
    result = await window.syncarr.runSync({ ...job, dryRun: false, manual: true, allowMirrorApply: normalizeSyncMode(job.syncMode) === 'mirror' });
  } catch (error) {
    result = {
      ok: false,
      code: null,
      status: 'error',
      message: error && error.message ? error.message : String(error),
      output: '',
      summary: null,
      history: null,
      storage: null,
      retention: null
    };
  } finally {
    setBusy(false);
  }

  if (!completionRenderedByEvent) {
    safeRenderRunCompletion(result);
  }
  await finalizeCompletedSyncEvent();
}


function formatActionNoun(count, singular, plural = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

function buildManualRunActionSummary({ mode, counts, summary }) {
  const cleanMode = normalizeSyncMode(mode || 'oneWay');
  const newFiles = Number(counts && counts.newFiles || 0);
  const changed = Number(counts && counts.changed || 0);
  const archived = Number((summary && summary.wouldArchive) || (counts && counts.archive) || changed || 0);
  const issues = Number((summary && summary.conflicts) || (counts && counts.issues) || 0);
  const destinationOnly = Number((counts && counts.destinationOnly) || (summary && summary.destinationOnly) || 0);
  const estimatedWrite = Number((summary && (summary.estimatedWriteBytes || summary.copyBytes)) || (counts && counts.copyBytes) || 0);
  const rows = [];

  if (cleanMode === 'twoWay') {
    const policy = getTwoWayConflictPolicyInfo(summary && summary.conflictPolicy);
    const toDestination = Number(summary && summary.copyToDest || 0);
    const toSource = Number(summary && summary.copyToSource || 0);
    const deleteDestination = Number(summary && summary.deleteOnDest || 0);
    const deleteSource = Number(summary && summary.deleteOnSource || 0);
    const keepBoth = Number(summary && summary.keepBoth || 0);
    if (toDestination) rows.push({ tone: 'new', text: `Copy or update ${formatActionNoun(toDestination, 'file')} on the destination.` });
    if (toSource) rows.push({ tone: 'changed', text: `Copy or update ${formatActionNoun(toSource, 'file')} on the source.` });
    if (deleteDestination) rows.push({ tone: 'delete', text: `Delete ${formatActionNoun(deleteDestination, 'file')} from the destination after archiving.` });
    if (deleteSource) rows.push({ tone: 'delete', text: `Delete ${formatActionNoun(deleteSource, 'file')} from the source after archiving.` });
    if (keepBoth) rows.push({ tone: 'issue', text: `Keep both versions for ${formatActionNoun(keepBoth, 'conflict')}.` });
    rows.push({ tone: issues ? 'issue' : 'neutral', text: `Conflict rule: ${policy.label}${issues ? ` resolves ${formatActionNoun(issues, 'conflict')}.` : '.'}` });
    if (!toDestination && !toSource && !deleteDestination && !deleteSource && !keepBoth) rows.push({ tone: 'neutral', text: 'No file changes are planned.' });
    const writeText = estimatedWrite ? `Estimated write size: ${formatBytes(estimatedWrite)}.` : 'Estimated write size: 0 B.';
    return `
      <strong>Syncarr will apply this saved Two-way plan:</strong>
      <ul>${rows.map((row) => `<li class="${escapeAttr(row.tone)}">${escapeHtml(row.text)}</li>`).join('')}</ul>
      <p>${escapeHtml(writeText)}</p>
    `;
  }

  if (newFiles) rows.push({ tone: 'new', text: `Copy ${formatActionNoun(newFiles, 'new file')} to the destination.` });
  if (changed) rows.push({ tone: 'changed', text: `Replace/update ${formatActionNoun(changed, 'changed file')} on the destination.` });
  if (archived) rows.push({ tone: 'archive', text: `Archive ${formatActionNoun(archived, 'existing destination file')} before overwrite${cleanMode === 'mirror' ? ' or delete' : ''}.` });

  if (cleanMode === 'mirror') {
    if (destinationOnly) {
      rows.push({ tone: 'delete', text: `Delete ${formatActionNoun(destinationOnly, 'destination-only file')} so the destination matches the source.` });
    } else {
      rows.push({ tone: 'neutral', text: 'No destination-only files are planned for deletion.' });
    }
  } else if (destinationOnly) {
    rows.push({ tone: 'neutral', text: `Leave ${formatActionNoun(destinationOnly, 'destination-only file')} untouched because this is One-way mode.` });
  } else {
    rows.push({ tone: 'neutral', text: 'No destination-only files were found in the saved plan.' });
  }

  if (issues) rows.push({ tone: 'issue', text: `${formatActionNoun(issues, 'issue')} should be reviewed before applying the plan.` });
  if (!newFiles && !changed && !(cleanMode === 'mirror' && destinationOnly)) rows.push({ tone: 'neutral', text: 'No copy, replace, or delete actions are planned.' });

  const writeText = estimatedWrite ? `Estimated write size: ${formatBytes(estimatedWrite)}.` : 'Estimated write size: 0 B.';
  return `
    <strong>Syncarr will apply this saved Compare plan:</strong>
    <ul>
      ${rows.map((row) => `<li class="${escapeAttr(row.tone)}">${escapeHtml(row.text)}</li>`).join('')}
    </ul>
    <p>${escapeHtml(writeText)}</p>
  `;
}


async function confirmManualRunApplyPlan(jobInput) {
  const job = normalizeRendererJob(jobInput || getJobFromForm());
  const mode = normalizeSyncMode(job.syncMode || 'oneWay');
  const settings = normalizeAppSettings(config && config.appSettings);

  if (settings.skipManualApplyWarningByMode && settings.skipManualApplyWarningByMode[mode] === true) {
    return true;
  }

  if (!compareDone || !compareReadyAt) {
    setLastScanHint();
    toast('warning', 'Run Compare before applying this sync job.');
    return false;
  }

  const currentFingerprint = makeCompareFingerprint(job);
  if (compareFingerprint && currentFingerprint !== compareFingerprint) {
    invalidateCompare();
    return false;
  }

  if (!els.manualRunConfirmOverlay) {
    return uiConfirm({
      title: 'Apply last Compare plan?',
      message: `You are about to apply the last Compare plan from ${formatDate(compareReadyAt)}.`,
      confirmLabel: 'Apply plan',
      tone: 'warning'
    });
  }

  const summary = previewState.summary || {};
  const modeInfo = getSyncModeInfo(mode);
  const planDate = formatDate(compareReadyAt);
  const ageText = formatRelativeAge(compareReadyAt);

  if (els.manualRunConfirmJob) els.manualRunConfirmJob.textContent = job.name || 'Sync job';
  if (els.manualRunConfirmMode) {
    const policySuffix = mode === 'twoWay' ? ` · ${getTwoWayConflictPolicyInfo(job.twoWayConflictPolicy).label}` : '';
    els.manualRunConfirmMode.textContent = `${modeInfo.label || modeInfo.shortLabel || mode}${policySuffix}`;
  }
  if (els.manualRunConfirmDate) els.manualRunConfirmDate.textContent = planDate;
  if (els.manualRunConfirmAge) els.manualRunConfirmAge.textContent = `${ageText} old`;
  const previewCounts = getPreviewActionCounts(getActionablePreviewFiles(), previewState.summary);

  if (els.manualRunConfirmTitle) els.manualRunConfirmTitle.textContent = mode === 'mirror' ? 'Apply Mirror plan?' : mode === 'twoWay' ? 'Apply Two-way plan?' : 'Apply saved Compare plan?';
  if (els.manualRunConfirmText) {
    els.manualRunConfirmText.textContent = mode === 'mirror'
      ? 'Review the saved Mirror plan before Syncarr changes destination files.'
      : mode === 'twoWay'
        ? `Review both directions before applying. ${getTwoWayConflictPolicyInfo(job.twoWayConflictPolicy).label} will resolve conflicts.`
        : 'Review the saved One-way plan before Syncarr copies or replaces destination files.';
  }
  if (els.manualRunConfirmSummary) {
    els.manualRunConfirmSummary.innerHTML = buildManualRunActionSummary({
      mode,
      counts: previewCounts,
      summary
    });
  }
  if (els.manualRunConfirmRemember) {
    els.manualRunConfirmRemember.checked = false;
    const label = els.manualRunConfirmRemember.closest('label');
    if (label) {
      const labelText = label.querySelector('[data-manual-run-remember-label]');
      if (labelText) labelText.textContent = `Remember my choice for ${modeInfo.shortLabel || modeInfo.label || mode} mode`;
    }
  }

  els.manualRunConfirmOverlay.classList.remove('hidden');

  const confirmed = await new Promise((resolve) => {
    const cleanup = () => {
      if (els.manualRunConfirmCancel) els.manualRunConfirmCancel.onclick = null;
      if (els.manualRunConfirmApply) els.manualRunConfirmApply.onclick = null;
    };
    const finish = (value) => {
      cleanup();
      els.manualRunConfirmOverlay.classList.add('hidden');
      resolve(value);
    };

    if (els.manualRunConfirmCancel) els.manualRunConfirmCancel.onclick = () => finish(false);
    if (els.manualRunConfirmApply) els.manualRunConfirmApply.onclick = () => finish(true);
  });

  if (confirmed && els.manualRunConfirmRemember && els.manualRunConfirmRemember.checked) {
    await rememberManualRunWarningChoice(mode);
  }

  return confirmed;
}

async function rememberManualRunWarningChoice(mode) {
  const cleanMode = normalizeSyncMode(mode);
  const current = normalizeAppSettings(config && config.appSettings);
  const appSettings = normalizeAppSettings({
    ...current,
    skipManualApplyWarningByMode: {
      ...(current.skipManualApplyWarningByMode || {}),
      [cleanMode]: true
    }
  });

  config = await window.syncarr.saveConfig({ appSettings });
}


async function runCompareJob() {
  const compareJob = getJobFromForm();
  if (compareJob.enabled === false) {
    setRunHint('This job is disabled. Enable it before running Compare.', 'stale');
    updateRunButtons();
    return;
  }

  if (!isCompareModeRunnable(compareJob.syncMode)) {
    const info = getSyncModeInfo(compareJob.syncMode);
    setRunHint(`${info.label} Compare is not active in this build.`, 'stale');
    appendLog(`\nCompare unavailable: ${info.label} is prepared but not runnable in this build.\n`);
    updateRunButtons();
    return;
  }

  clearSummary();

  const startedAt = new Date();
  startLiveLog('Compare log', els.jobName.value.trim() || 'Sync job');
  openRunOverlay(els.jobName.value.trim() || 'Sync job', 'compare');
  setRunHint('Comparing source and target…', 'running');
  setBusy(true, 'Compare running');
  completionRenderedByEvent = false;
  appendLog(`\n--- COMPARE DRY RUN ${startedAt.toLocaleString()} ---\n`);
  renderPreviewStatus({ ok: true, message: 'Compare running...', summary: null, files: [] });

  let job = null;
  let result = null;

  try {
    await saveJob();
    job = getJobFromForm();
    result = await withTimeout(
      window.syncarr.compareSync({ ...job, dryRun: true }),
      90_000,
      'Compare timed out after 90 seconds. Check that the source and required destination are reachable.'
    );
    if (result) result = { ...result, dryRun: true };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (/timed out/i.test(message)) {
      try { await window.syncarr.cancelSync(); } catch { /* Best-effort cancel. */ }
    }
    result = {
      ok: false,
      code: null,
      status: 'error',
      message,
      output: error && error.stack ? error.stack : String(error),
      summary: null,
      history: null,
      storage: null,
      retention: null,
      dryRun: true
    };
    appendLog(`\n${message}\n`);
  } finally {
    setBusy(false);
  }

  if (!completionRenderedByEvent) safeRenderRunCompletion(result);

  const fingerprint = result && result.compareFingerprint
    ? result.compareFingerprint
    : makeCompareFingerprint(job || getJobFromForm());

  if (result && result.preview) {
    renderPreviewResult(result.preview, result.ok ? {
      createdAt: result.compareCreatedAt || startedAt.toISOString(),
      fingerprint,
      syncMode: normalizeSyncMode((result && result.syncMode) || (job && job.syncMode) || compareJob.syncMode)
    } : { syncMode: normalizeSyncMode((result && result.syncMode) || (job && job.syncMode) || compareJob.syncMode) });
  } else if (result && result.history && !previewState.summary) {
    renderPreviewResult({
      ok: result.ok,
      message: result.message || '',
      summary: result.history,
      files: []
    }, result.ok ? { createdAt: result.compareCreatedAt || startedAt.toISOString(), fingerprint, syncMode: normalizeSyncMode((result && result.syncMode) || (job && job.syncMode) || compareJob.syncMode) } : { syncMode: normalizeSyncMode((result && result.syncMode) || (job && job.syncMode) || compareJob.syncMode) });
  }

  if (result && result.ok) {
    markCompareReady(result.compareCreatedAt || startedAt.toISOString(), fingerprint);
  } else {
    lastCompareScannedAt = startedAt.toISOString();
    compareReadyAt = null;
    compareFingerprint = null;
    compareDone = false;
    setLastScanHint();
    setPreviewAccess(false);
    setPreviewPanelVisible(true);
    updateRunButtons();
  }

  try {
    config = await window.syncarr.loadConfig();
  } catch {
    // Keep previous config if reload fails.
  }

  renderRecentRuns(config && config.lastRuns ? config.lastRuns : []);
}


function handleSyncEvent(event) {
  if (!event) return;

  if (event.type === 'start') {
    appendLog(`Command:\n${event.command}\n\n`);
  }

  if (event.type === 'stdout' || event.type === 'stderr' || event.type === 'error') {
    appendLog(event.text);
  }

  if (event.type === 'history') {
    renderHistoryEvent(event);
    if (event.preview) {
      renderPreviewResult({
        ok: true,
        message: event.dryRun ? 'Compare preview generated.' : 'Sync plan generated.',
        summary: event.preview.summary,
        files: event.preview.files || []
      }, event.dryRun ? { createdAt: new Date().toISOString(), fingerprint: makeCompareFingerprint(getJobFromForm()), syncMode: normalizeSyncMode(getJobFromForm().syncMode) } : { syncMode: normalizeSyncMode(getJobFromForm().syncMode) });
      if (event.preview.summary) renderPlanSummary(event.preview.summary);
    }
  }

  if (event.type === 'storage') {
    appendLog(formatStorageLog(event.storage));
  }

  if (event.type === 'retention') {
    appendLog(formatRetentionLog(event.retention));
  }

  if (event.type === 'restore-point') {
    appendLog(formatRestorePointLog(event.restorePoint));
  }

  if (event.type === 'restore-point-progress' && event.progress) {
    const progress = event.progress;
    setRestorePointStatus(
      `Restoring ${formatNumber(progress.restoredFiles || 0)} of ${formatNumber(progress.totalFiles || 0)}: ${progress.currentFile || ''}`,
      null
    );
  }

  if (event.type === 'progress') {
    sendTrayProgress(event.progress);
    updateRunProgress(event.progress);
  }

  if (event.type === 'complete') {
    completionRenderedByEvent = true;
    const eventResult = event.result ? { ...event.result, dryRun: event.dryRun === true } : event.result;
    safeRenderRunCompletion(eventResult);
    setBusy(false);

    if (event.dryRun === false) {
      finalizeCompletedSyncEvent().catch((error) => {
        const message = error && error.message ? error.message : String(error);
        appendLog(`\nPost-sync refresh failed: ${message}\n`);
      });
    }
  }
}

async function refreshConfigAfterBackgroundRun() {
  try {
    const latest = await window.syncarr.loadConfig();
    config = latest;
    syncJobStateFromConfig(latest);
    if (!dirty) applyConfigToForm(latest);
    renderJobList();
    renderScheduleStatus(getActiveJob().schedule);
    renderRecentRuns(latest.lastRuns || []);
  } catch {
    // The next explicit refresh or save will retry config loading.
  }
}

async function finalizeCompletedSyncEvent() {
  // Reload config BEFORE clearing the compare preview: the clear re-renders
  // the "Last scanned" hint from config.lastRuns, and the run that just
  // finished only exists in the freshly saved config.
  try {
    config = await window.syncarr.loadConfig();
  } catch {
    // Keep the previous in-memory config if reload fails.
  }
  clearComparePreviewAfterSync();
  renderRecentRuns(config && config.lastRuns ? config.lastRuns : []);
  if (activeView === 'history') {
    await loadHistory({ preserveSelection: true });
    await loadRestorePoints({ preserveSelection: true });
  }
}

function renderResult(result) {
  if (!result) return;

  setDeleteMetricLabel(getCurrentRunMode(result));
  if (result.summary) renderSummary(result.summary);
  if (result.history) renderHistorySummary(result.history);

  const visualKind = getRunVisualKind(result);
  if (isCancelledRun(result)) {
    setRunState(result.message || 'Cancelled', 'warning');
  } else if (result.ok) {
    setRunState(result.message || (visualKind === 'warning' ? 'Complete with warnings' : 'Complete'), visualKind);
  } else {
    setRunState(result.message || 'Error', 'error');
  }

  appendLog(`\nExit code: ${result.code ?? 'n/a'}\n${result.message || ''}\n`);
  if (result.history && result.history.manifestPath) {
    appendLog(`File history manifest: ${result.history.manifestPath}\n`);
  }
  if (result.restorePoint) {
    appendLog(formatRestorePointLog(result.restorePoint));
  }

  if (runOverlayOpen) finishRunOverlay(result);
}

function makeCompletionRenderKey(result) {
  if (!result) return '';
  return [
    result.jobId || '',
    result.compareCreatedAt || '',
    result.status || '',
    result.code ?? 'n/a',
    result.dryRun ? 'compare' : 'sync',
    result.output ? String(result.output).length : 0
  ].join('|');
}

function safeRenderRunCompletion(result) {
  if (!result) return false;

  completeTrayTask(result);

  const key = makeCompletionRenderKey(result);
  if (key && key === lastRenderedCompletionKey) return true;

  try {
    renderResult(result);
    if (key) lastRenderedCompletionKey = key;
    return true;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    try { appendLog(`\nUI completion render warning: ${message}\n`); } catch { /* Ignore logging errors during finalization. */ }
    forceCompleteRunUi(result);
    if (key) lastRenderedCompletionKey = key;
    return false;
  }
}

function forceCompleteRunUi(result) {
  runOverlayFinished = true;
  const ok = Boolean(result && result.ok);
  const cancelled = isCancelledRun(result);
  const visualKind = getRunVisualKind(result);
  const summary = result && result.summary ? result.summary : {};

  try {
    const metrics = computeSyncSummaryMetrics(summary);
    els.metricCopied.textContent = metrics.copied;
    els.metricSkipped.textContent = metrics.skipped;
    els.metricFailed.textContent = metrics.failed;
    els.metricBytes.textContent = metrics.bytes;
  } catch { /* Keep going. */ }

  try {
    if (result && result.history) renderHistorySummary(result.history);
  } catch { /* Keep going. */ }

  try {
    setRunState(result.message || (cancelled ? 'Cancelled' : (ok ? (visualKind === 'warning' ? 'Complete with warnings' : 'Complete') : 'Error')), cancelled ? 'warning' : (ok ? visualKind : 'error'));
  } catch { /* Keep going. */ }

  try {
    if (runOverlayOpen) finishRunOverlay(result);
  } catch {
    try {
      const duration = runStartTime ? formatDuration(Date.now() - runStartTime) : '';
      els.runFill.setAttribute('class', `progress-fill ${cancelled ? 'warning' : (ok ? visualKind : 'error')}`);
      els.runFillBar.setAttribute('width', '100');
      els.runPct.textContent = cancelled ? 'Cancelled' : (ok ? '100%' : 'Stopped');
      els.runEta.textContent = cancelled ? `Cancelled after ${duration || '0s'}` : (ok ? (visualKind === 'warning' ? `Completed with warnings in ${duration}` : `Completed in ${duration}`) : 'Run ended');
      els.runFile.textContent = cancelled ? 'Sync cancelled. Review the summary below.' : (ok ? (visualKind === 'warning' ? 'Sync completed with warnings. Review the summary below.' : 'Sync completed. Review the summary below.') : 'Sync stopped. Review the summary below.');
      setRunCurrentActionClass(cancelled ? 'warning' : (ok ? (visualKind === 'warning' ? 'warning' : 'success') : 'error'));
      els.minimizeRunBtn.classList.add('hidden');
      els.cancelBtn.disabled = false;
      els.cancelBtn.textContent = 'Cancel';
      els.cancelBtn.classList.add('hidden');
      els.closeRunBtn.classList.remove('hidden');
      els.runMini.classList.add(cancelled ? 'warning' : (ok ? (visualKind === 'warning' ? 'warning' : 'done') : 'error'));
      if (runMinimized) restoreRun();
    } catch { /* Last-resort UI finalization failed; leave the main app usable. */ }
  }
}

function renderSummary(summary) {
  const metrics = computeSyncSummaryMetrics(summary);
  els.metricCopied.textContent = metrics.copied;
  els.metricSkipped.textContent = metrics.skipped;
  els.metricFailed.textContent = metrics.failed;
  els.metricBytes.textContent = metrics.bytes;
}

function clearSummary() {
  els.metricCopied.textContent = '-';
  els.metricSkipped.textContent = '-';
  els.metricFailed.textContent = '-';
  if (els.metricDeleted) els.metricDeleted.textContent = '-';
  els.metricBytes.textContent = '-';
  els.metricHistory.textContent = '-';
}

function renderPlanSummary(summary) {
  if (!summary) return;
  setDeleteMetricLabel(getActivePreviewMode());
  els.metricCopied.textContent = formatNumber(summary.wouldCopy || 0);
  els.metricSkipped.textContent = formatNumber((summary.skippedOlder || 0) + (summary.unchanged || 0));
  els.metricFailed.textContent = formatNumber(summary.conflicts || 0);
  if (els.metricDeleted) els.metricDeleted.textContent = formatNumber(summary.destinationOnly || 0);
  els.metricBytes.textContent = formatBytes(summary.copyBytes || 0);
  renderHistorySummary(summary);
}

function renderPreviewResult(result, options = {}) {
  previewState.ok = result ? result.ok : null;
  previewState.message = result ? result.message || '' : '';
  previewState.summary = result ? result.summary || null : null;
  previewState.syncMode = normalizeSyncMode((options && options.syncMode) || (result && result.syncMode) || (els.syncMode && els.syncMode.value) || previewState.syncMode || 'oneWay');
  previewState.files = result && Array.isArray(result.files) ? result.files : [];
  previewState.cwd = '';
  previewState.expandedFile = null;
  if (options.createdAt) compareReadyAt = options.createdAt;
  if (options.fingerprint) compareFingerprint = options.fingerprint;

  renderPreviewTable();
  renderPreviewStatus(result);
  if (result && result.ok && (result.summary || previewState.files.length)) {
    setPreviewAccess(true);
  }
}


function renderPreviewTable() {
  renderPreviewOverview();
  renderPreviewBreadcrumb();

  const actionableFiles = getActionablePreviewFiles();
  if (els.previewBreadcrumb) els.previewBreadcrumb.classList.toggle('empty-preview', actionableFiles.length === 0);
  if (!actionableFiles.length) {
    const emptyMessage = previewState.summary
      ? 'Compare completed. No copied, changed, destination-only, or issue files are currently planned.'
      : 'Run a compare first to see the file preview.';
    els.previewRows.innerHTML = `<div class="preview-empty">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  const fileMap = buildPreviewFileMap(actionableFiles);
  const search = els.previewSearch.value.trim().toLowerCase();

  if (search) {
    renderPreviewSearchResults(fileMap, search);
    return;
  }

  renderPreviewFolder(fileMap);
}

function getActionablePreviewFiles() {
  return getActionableFilesFromList(previewState.files);
}

function renderPreviewOverview() {
  if (!els.previewOverview) return;
  const files = getActionablePreviewFiles();
  const summary = previewState.summary || {};
  if (!previewState.summary && !files.length) {
    els.previewOverview.classList.add('hidden');
    els.previewOverview.innerHTML = '';
    return;
  }

  const counts = getPreviewActionCounts(files, previewState.summary);
  const mode = getActivePreviewMode();
  const cards = summary.twoWay
    ? [
        ['To destination', Number(summary.copyToDest || 0), 'Copied or updated on the destination', 'new'],
        ['To source', Number(summary.copyToSource || 0), 'Copied or updated on the source', 'changed'],
        ['Delete (dest)', Number(summary.deleteOnDest || 0), 'Removed on the destination', 'delete'],
        ['Delete (source)', Number(summary.deleteOnSource || 0), 'Removed on the source', 'delete'],
        ['Conflicts', Number(summary.conflicts || 0), `Rule: ${getTwoWayConflictPolicyInfo(summary.conflictPolicy).label}`, 'issue'],
        ['Write size', formatBytes(summary.estimatedWriteBytes || summary.copyBytes || 0), 'Estimated copy total', 'bytes']
      ]
    : [
        ['New', counts.newFiles, 'Will copy from source', 'new'],
        ['Changed', counts.changed, 'Will replace destination', 'changed'],
        ['Archive', Number(summary.wouldArchive || counts.archive || counts.changed), isMirrorMode(mode) ? 'Versions protected before overwrite/delete' : 'Versions protected before overwrite', 'archive'],
        ['Destination-only', counts.destinationOnly, getDestinationOnlyHelp(mode), 'delete'],
        ['Issues', counts.issues, 'Conflicts or blocked files', 'issue'],
        ['Write size', formatBytes(summary.estimatedWriteBytes || summary.copyBytes || counts.copyBytes), 'Estimated copy + history', 'bytes']
      ];

  els.previewOverview.classList.remove('hidden');
  els.previewOverview.innerHTML = cards.map(([label, value, help, tone]) => `
    <div class="preview-overview-card ${escapeAttr(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${typeof value === 'number' ? formatNumber(value) : escapeHtml(value)}</strong>
      <small>${escapeHtml(help)}</small>
    </div>
  `).join('');
}

function renderPreviewBreadcrumb() {
  if (!els.previewBreadcrumb) return;
  const search = els.previewSearch ? els.previewSearch.value.trim() : '';
  if (search) {
    els.previewBreadcrumb.innerHTML = '<button data-preview-crumb="" class="current" type="button">Search results</button>';
    return;
  }

  const parts = previewState.cwd ? previewState.cwd.split('/') : [];
  const crumbs = [`<button data-preview-crumb="" type="button"${parts.length ? '' : ' class="current"'}>Home</button>`];
  let acc = '';
  parts.forEach((part, index) => {
    acc = acc ? `${acc}/${part}` : part;
    const isLast = index === parts.length - 1;
    crumbs.push('<span class="sep">/</span>');
    crumbs.push(`<button data-preview-crumb="${escapeAttr(acc)}" type="button"${isLast ? ' class="current"' : ''}>${escapeHtml(part)}</button>`);
  });
  els.previewBreadcrumb.innerHTML = crumbs.join('');
}

function renderPreviewFolder(fileMap) {
  const { folders, files } = previewEntriesAt(fileMap, previewState.cwd);
  els.previewRows.innerHTML = renderTwoSidedPreview({ folders: [...folders.values()], files });
}

function renderPreviewSearchResults(fileMap, search) {
  renderPreviewBreadcrumb();

  const matches = [];
  for (const [relPath, file] of fileMap) {
    const haystack = `${relPath} ${file.action || ''} ${file.label || ''} ${file.reason || ''} ${file.destinationLabel || ''} ${file.sourceLabel || ''}`.toLowerCase();
    if (haystack.includes(search)) matches.push({ ...file, name: relPath });
  }
  matches.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  els.previewRows.innerHTML = matches.length
    ? renderTwoSidedPreview({ folders: [], files: matches, searchMode: true })
    : '<div class="history-empty">No copied, changed, destination-only, or issue files match your search.</div>';
}

function renderTwoSidedPreview({ folders, files, searchMode = false }) {
  const sortedFolders = [...folders].sort((a, b) => a.name.localeCompare(b.name));
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));

  return `
    <div class="preview-split">
      ${renderPreviewPane('source', sortedFolders, sortedFiles, searchMode)}
      ${renderPreviewPane('destination', sortedFolders, sortedFiles, searchMode)}
    </div>
  `;
}

function renderPreviewPane(side, folders, files, searchMode) {
  const isSource = side === 'source';
  const mode = getActivePreviewMode();
  const twoWay = isTwoWayPreview();
  const title = isSource ? 'Source' : 'Destination';
  const subtitle = twoWay
    ? (isSource
      ? 'Changes Syncarr will make on the source side.'
      : 'Changes Syncarr will make on the destination side.')
    : (isSource
      ? 'New and changed source files that will be copied.'
      : (isMirrorMode(mode)
        ? 'Destination files that will be created, replaced, archived, or deleted.'
        : 'Destination files that will be created, replaced, archived, or left untouched.'));
  const items = [];

  if (!searchMode) {
    for (const folder of folders) items.push(renderPreviewFolderEntry(folder, side));
  }
  for (const file of files) items.push(renderPreviewSideFileEntry(file, file.name, side));

  return `
    <section class="preview-pane ${side}">
      <header class="preview-pane-head">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(subtitle)}</small>
        </div>
        <span class="mini-pill">${formatNumber(items.length)} visible</span>
      </header>
      <div class="preview-pane-legend">
        ${twoWay ? `
        <span class="legend-dot new"></span>Incoming
        <span class="legend-dot delete"></span>Delete
        <span class="legend-dot issue"></span>Conflict
        ` : `
        <span class="legend-dot new"></span>New
        <span class="legend-dot changed"></span>Changed
        <span class="legend-dot delete"></span>${isMirrorMode(mode) ? 'Delete candidate' : 'Destination-only'}
        <span class="legend-dot issue"></span>Issue
        `}
      </div>
      <div class="preview-pane-list">
        ${items.length ? items.join('') : '<div class="history-empty">No visible actions in this folder.</div>'}
      </div>
    </section>
  `;
}

function renderPreviewFolderEntry(folder, side) {
  const tone = previewFolderTone(folder);
  const detail = [
    folder.newFiles ? `${formatNumber(folder.newFiles)} new` : '',
    folder.changed ? `${formatNumber(folder.changed)} changed` : '',
    folder.destinationOnly ? `${formatNumber(folder.destinationOnly)} ${isMirrorMode(getActivePreviewMode()) ? 'delete candidate' : 'destination-only'}` : '',
    folder.issues ? `${formatNumber(folder.issues)} issue` : ''
  ].filter(Boolean).join(' · ') || `${formatNumber(folder.count)} item(s)`;

  const sideBytes = side === 'source' ? folder.copyBytes : folder.archiveBytes;

  return `
    <button class="history-entry folder preview-entry ${tone}" data-preview-folder="${escapeAttr(folder.relPath)}" type="button">
      <span class="entry-name">
        ${renderFolderIcon()}
        <span class="entry-main"><strong>${escapeHtml(folder.name)}</strong><small>${escapeHtml(detail)}</small></span>
      </span>
      <span class="entry-meta mono">${escapeHtml(sideBytes ? formatBytes(sideBytes) : '-')}</span>
      <span class="entry-status"><span class="mini-pill ${tone}">${escapeHtml(previewToneLabel(tone))}</span><span class="entry-arrow">›</span></span>
    </button>
  `;
}

function renderPreviewSideFileEntry(file, label, side) {
  const expanded = previewState.expandedFile === `${side}:${file.relativePath}`;
  const tone = previewActionClass(file.action);
  const meta = previewSideMeta(file, side);
  const detailLabel = previewSidePathLabel(file, side);
  const planNote = meta.note ? `<small class="entry-plan-note ${escapeAttr(meta.tone || tone)}">${escapeHtml(meta.note)}</small>` : '';

  let html = `
    <button class="history-entry file preview-entry ${tone}${expanded ? ' expanded' : ''}" data-preview-file="${escapeAttr(`${side}:${file.relativePath}`)}" type="button">
      <span class="entry-name">
        ${twoWayDirectionBadge(file)}${renderFileIcon(file.relativePath)}
        <span class="entry-main"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detailLabel)}</small>${planNote}</span>
      </span>
      <span class="entry-meta">${escapeHtml(meta.action)}</span>
      <span class="entry-meta mono">${escapeHtml(meta.size)}</span>
      <span class="entry-status">
        <span class="mini-pill ${tone}">${escapeHtml(meta.state)}</span>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
      </span>
    </button>
  `;

  if (expanded) html += renderPreviewFileDetails(file, side);
  return html;
}

function isTwoWayPreview() {
  return Boolean(previewState.summary && previewState.summary.twoWay);
}

const TWO_WAY_DIR_META = {
  toDest: { glyph: '→', color: '#16a571', title: 'Copy source → destination' },
  toSource: { glyph: '←', color: '#16a571', title: 'Copy destination → source' },
  deleteDest: { glyph: '⊘', color: '#fb7185', title: 'Delete on destination' },
  deleteSource: { glyph: '⊘', color: '#fb7185', title: 'Delete on source' },
  keepBoth: { glyph: '⇄', color: '#d89a10', title: 'Conflict — keep both versions' }
};

function twoWayDirectionBadge(file) {
  if (!file || !file.direction || !isTwoWayPreview()) return '';
  const meta = TWO_WAY_DIR_META[file.direction];
  if (!meta) return '';
  return `<span class="preview-dir" title="${escapeAttr(meta.title)}" style="color:${meta.color};font-weight:700;margin-right:6px">${meta.glyph}</span>`;
}

function previewSideMeta(file, side) {
  if (file.direction && isTwoWayPreview()) return twoWaySideMeta(file, side);
  const action = String(file.action || '');
  const sourceBytes = previewFileSize(file, 'source');
  const targetBytes = previewFileSize(file, 'destination');
  const sourceSize = formatBytes(sourceBytes);
  const targetSize = formatBytes(targetBytes);

  if (side === 'source') {
    if (action === 'copy-new') return { action: 'Will copy', size: sourceSize, state: 'New' };
    if (action === 'update-archive') return { action: 'Will copy changed file', size: sourceSize, state: 'Changed' };
    if (action === 'extra') return { action: 'Missing from source', size: '-', state: getDestinationOnlyState(getActivePreviewMode()) };
    if (action === 'skip-older-source') return { action: 'Will not copy', size: sourceSize, state: 'Issue' };
    if (action === 'conflict') return { action: 'Blocked by conflict', size: sourceSize, state: 'Conflict' };
    return { action: file.label || action || 'Action', size: sourceSize, state: previewToneLabel(previewActionClass(action)) };
  }

  if (action === 'copy-new') {
    return {
      action: 'Create on destination',
      size: sourceSize,
      state: 'New target',
      note: `Target is missing; Syncarr will write ${sourceSize}.`,
      tone: 'new'
    };
  }
  if (action === 'update-archive') {
    return {
      action: 'Archive current, replace',
      size: formatSizeTransition(targetBytes, sourceBytes),
      state: 'Archive + replace',
      note: 'Existing target is protected in file history before replacement.',
      tone: 'changed'
    };
  }
  if (action === 'extra') {
    const mode = getActivePreviewMode();
    if (isMirrorMode(mode)) {
      return {
        action: file.archiveBytes ? 'Archive current, delete' : 'Delete from destination',
        size: targetSize,
        state: file.archiveBytes ? 'Archive + delete' : 'Delete',
        note: 'Only exists on destination; Mirror will remove it.',
        tone: 'delete'
      };
    }
    return {
      action: 'Keep on destination',
      size: targetSize,
      state: 'Left untouched',
      note: 'Only exists on destination; One-way sync leaves it untouched.',
      tone: 'neutral'
    };
  }
  if (action === 'skip-older-source') {
    return {
      action: 'Keep newer destination',
      size: targetSize,
      state: 'Protected',
      note: 'Destination is newer than the source; Syncarr will not overwrite it.',
      tone: 'issue'
    };
  }
  if (action === 'conflict') {
    return {
      action: 'Blocked at destination',
      size: targetSize,
      state: 'Conflict',
      note: 'Review this item before applying the plan.',
      tone: 'issue'
    };
  }
  return { action: file.label || action || 'Action', size: targetSize, state: previewToneLabel(previewActionClass(action)) };
}

function previewToneLabel(tone) {
  if (tone === 'new') return 'New';
  if (tone === 'changed') return 'Changed';
  if (tone === 'delete') return isMirrorMode(getActivePreviewMode()) ? 'Delete' : 'Dest-only';
  if (tone === 'issue' || tone === 'conflict') return 'Issue';
  if (tone === 'skip') return 'Skipped';
  return 'Copy';
}

function renderPreviewFileDetails(file, side) {
  const sourceModified = file.source && file.source.mtime ? formatDate(file.source.mtime) : '-';
  const targetModified = file.target && file.target.mtime ? formatDate(file.target.mtime) : '-';
  const rows = [
    ['Side', side === 'source' ? 'Source' : 'Destination'],
    ['Action', previewSideMeta(file, side).action],
    ['Reason', file.reason || '-'],
    ['Relative path', file.originalRelativePath || file.relativePath || '-'],
    ['Source folder', previewSidePathLabel(file, 'source') || '-'],
    ['Destination', previewSidePathLabel(file, 'destination') || '-'],
    ['Source size', formatBytes(file.source && Number.isFinite(file.source.size) ? file.source.size : null)],
    ['Source modified', sourceModified],
    ['Destination size', formatBytes(file.target && Number.isFinite(file.target.size) ? file.target.size : null)],
    ['Destination modified', targetModified],
    ['Copy bytes', formatBytes(file.copyBytes || 0)],
    ['File history bytes', formatBytes(file.archiveBytes || 0)],
    ['File type', fileKindLabel(file.relativePath)]
  ];

  return `
    <div class="history-versions preview-details">
      <dl class="detail-grid preview-detail-grid">
        ${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}
      </dl>
    </div>
  `;
}

function togglePreviewFile(key) {
  previewState.expandedFile = previewState.expandedFile === key ? null : key;
  renderPreviewTable();
}

function enterPreviewFolder(path) {
  previewState.cwd = path;
  previewState.expandedFile = null;
  renderPreviewTable();
}

function renderPreviewStatus(result = null) {
  if (!els.previewStatus) return;
  const summary = result && result.summary ? result.summary : previewState.summary;
  const ok = result ? result.ok : previewState.ok;
  const message = result ? result.message : previewState.message;
  const ageMs = compareReadyAt ? Date.now() - new Date(compareReadyAt).getTime() : 0;
  const stale = Boolean(compareReadyAt && ageMs >= 30 * 60 * 1000);
  const hasConflicts = Boolean(summary && Number(summary.conflicts || 0) > 0);

  els.previewStatus.classList.remove('hidden', 'ok', 'error', 'warning');

  // Do not show a green Robocopy/result banner after a normal compare.
  // The browser rows are the preview; this card is only for errors or warnings.
  if (ok !== false && summary && !stale && !hasConflicts) {
    els.previewStatus.classList.add('hidden');
    return;
  }

  if (ok === false) {
    els.previewStatus.classList.add('error');
  } else if (stale || hasConflicts) {
    els.previewStatus.classList.add('warning');
  }

  const ageText = compareReadyAt && summary ? ` Last compare: ${formatRelativeAge(compareReadyAt)} old.` : '';
  const details = summary
    ? `${formatNumber(summary.wouldCopy || 0)} copy action(s), ${formatNumber(summary.wouldArchive || 0)} history version(s), ${formatNumber(summary.conflicts || 0)} conflict(s)${summary.previewTruncated ? ', preview truncated' : ''}.${ageText}`
    : 'Run a compare first to see the file preview.';

  els.previewStatus.innerHTML = `
    <strong>Preview</strong>
    <span>${escapeHtml(message || (stale ? 'Compare result is old.' : 'Preview requires attention.'))}</span>
    <small>${escapeHtml(details)}</small>
  `;
}

function renderHistoryEvent(event) {
  const history = event.history || {};
  renderHistorySummary(history);

  if (!history.enabled) {
    appendLog('File history disabled for this run.\n');
    return;
  }

  if (event.phase === 'planned') {
    const mode = normalizeSyncMode(event.syncMode || (event.history && event.history.syncMode) || (els.syncMode && els.syncMode.value) || 'oneWay');
    const prefix = event.dryRun ? 'File history preview' : 'File history plan';
    const action = event.dryRun ? 'would be saved' : 'will be saved';
    const archiveScope = isMirrorMode(mode) ? 'before overwrite/delete' : 'before overwrite';
    const destinationOnly = Number(history.destinationOnly || 0);
    appendLog(`${prefix}: ${formatNumber(history.wouldArchive)} target version(s) ${action} ${archiveScope}. `);
    appendLog(`${formatNumber(history.newFiles)} new file(s), ${formatNumber(history.skippedOlder)} older source file(s) skipped.`);
    if (destinationOnly > 0) {
      appendLog(isMirrorMode(mode)
        ? ` ${formatNumber(destinationOnly)} delete candidate(s) will be archived before deletion.`
        : ` ${formatNumber(destinationOnly)} destination-only file(s) left untouched by one-way sync.`);
    }
    appendLog('\n');
  }

  if (event.phase === 'archived') {
    appendLog(`File history saved: ${formatNumber(history.archived)} version(s) under ${history.historyFolderName}.\n`);
  }
}

function renderHistorySummary(history) {
  if (!history || !history.enabled) {
    els.metricHistory.textContent = 'Off';
    return;
  }

  if (history.archived) {
    els.metricHistory.textContent = formatNumber(history.archived);
    return;
  }

  if (history.wouldArchive) {
    els.metricHistory.textContent = `${formatNumber(history.wouldArchive)} planned`;
    return;
  }

  els.metricHistory.textContent = '0';
}

async function loadRestorePoints(options = {}) {
  if (!window.syncarr || typeof window.syncarr.listRestorePoints !== 'function') {
    restorePointState.points = [];
    restorePointState.selectedId = null;
    restorePointState.selectedManifest = null;
    restorePointState.manifestLoading = false;
    restorePointState.manifestError = '';
    restorePointState.cwd = '';
    clearRestorePointFileSelection();
    clearRestorePointPlan();
    restorePointState.lastRefreshOk = false;
    restorePointState.disabledReason = '';
    renderRestorePoints();
    renderRestorePointSelection();
    renderRestorePointFileBrowser();
    setRestorePointStatus('Restore point browser is not available in this build.', 'error');
    return;
  }

  await saveJob();
  const previousSelection = restorePointState.selectedId;
  const job = getJobFromForm();

  restorePointState.loadedJobId = job.id;

  if (job.historyEnabled === false) {
    restorePointState.points = [];
    restorePointState.selectedId = null;
    restorePointState.selectedManifest = null;
    restorePointState.manifestLoading = false;
    restorePointState.manifestError = '';
    restorePointState.cwd = '';
    clearRestorePointFileSelection();
    clearRestorePointPlan();
    restorePointState.lastRefreshOk = false;
    restorePointState.disabledReason = 'File history is disabled for this job. Enable it in the job configuration to browse restore points.';
    renderRestorePoints();
    renderRestorePointSelection();
    renderRestorePointFileBrowser();
    setRestorePointStatus(restorePointState.disabledReason, 'warning');
    return;
  }

  if (job.restorePointsEnabled !== true) {
    restorePointState.points = [];
    restorePointState.selectedId = null;
    restorePointState.selectedManifest = null;
    restorePointState.manifestLoading = false;
    restorePointState.manifestError = '';
    restorePointState.cwd = '';
    clearRestorePointFileSelection();
    clearRestorePointPlan();
    restorePointState.lastRefreshOk = false;
    restorePointState.disabledReason = 'Restore points are disabled for this job. Enable them in the job configuration to create sync manifests.';
    renderRestorePoints();
    renderRestorePointSelection();
    renderRestorePointFileBrowser();
    setRestorePointStatus(restorePointState.disabledReason, 'warning');
    return;
  }

  restorePointState.disabledReason = '';
  setRestorePointStatus(`Loading restore points for ${job.name || 'Sync job'}...`, null);

  try {
    const result = await window.syncarr.listRestorePoints({ jobId: job.id, limit: 100 });
    restorePointState.lastRefreshOk = result && result.ok !== false;
    restorePointState.points = result && Array.isArray(result.points) ? result.points : [];

    const previousStillExists = options.preserveSelection && restorePointState.points.some((point) => point.id === previousSelection);
    // Auto-select the most recent restore point when there is no selection to
    // preserve, so visiting File history loads its manifest (and the restore
    // point file browser) at least once without requiring a manual click.
    // Archived file history already auto-selects its first version; this keeps
    // the two sides symmetric. The shared inspector defers to a selected
    // restore point, so this just claims it on first load.
    restorePointState.selectedId = previousStillExists
      ? previousSelection
      : (restorePointState.points.length ? restorePointState.points[0].id : null);
    if (restorePointState.manifestCache && typeof restorePointState.manifestCache.forEach === 'function') {
      const liveIds = new Set(restorePointState.points.map((point) => point.id));
      for (const key of restorePointState.manifestCache.keys()) {
        if (!liveIds.has(key)) restorePointState.manifestCache.delete(key);
      }
    }
    restorePointState.selectedManifest = restorePointState.selectedId && restorePointState.manifestCache ? restorePointState.manifestCache.get(restorePointState.selectedId) || null : null;
    restorePointState.manifestLoading = false;
    restorePointState.manifestError = '';
    restorePointState.cwd = '';
    clearRestorePointFileSelection();
    clearRestorePointPlan();

    renderRestorePoints();
    renderRestorePointSelection();
    renderRestorePointFileBrowser();

    if (restorePointState.selectedId) {
      loadSelectedRestorePointManifest();
    }

    if (!result || result.ok === false) {
      setRestorePointStatus(result && result.message ? result.message : 'Could not load restore points.', 'error');
      return;
    }

    const count = restorePointState.points.length;
    setRestorePointStatus(
      count ? `${formatNumber(count)} restore point${count === 1 ? '' : 's'} loaded for ${job.name || 'this job'}.` : 'No restore points recorded for this job yet.',
      count ? 'success' : null
    );
  } catch (error) {
    restorePointState.points = [];
    restorePointState.selectedId = null;
    restorePointState.selectedManifest = null;
    restorePointState.manifestLoading = false;
    restorePointState.manifestError = '';
    restorePointState.cwd = '';
    clearRestorePointFileSelection();
    clearRestorePointPlan();
    restorePointState.lastRefreshOk = false;
    restorePointState.disabledReason = '';
    renderRestorePoints();
    renderRestorePointSelection();
    renderRestorePointFileBrowser();
    setRestorePointStatus(error && error.message ? error.message : String(error), 'error');
  }
}

function renderRestorePoints() {
  if (!els.restorePointRows) return;
  const points = Array.isArray(restorePointState.points) ? restorePointState.points : [];

  if (restorePointState.disabledReason) {
    els.restorePointRows.innerHTML = `
      <div class="restore-point-empty history-disabled-placeholder">
        <strong>Restore points unavailable</strong>
        <span>${escapeHtml(restorePointState.disabledReason)}</span>
      </div>
    `;
    return;
  }

  if (!points.length) {
    els.restorePointRows.innerHTML = `
      <div class="restore-point-empty">
        <strong>No restore points yet.</strong>
        <span>Enable restore points in File history, then run a successful sync.</span>
      </div>
    `;
    return;
  }

  if (restorePointState.selectedId) {
    els.restorePointRows.innerHTML = renderRestorePointSnapshotBrowser();
    return;
  }

  els.restorePointRows.innerHTML = renderRestorePointBrowserHead() + points.map(renderRestorePointRow).join('');
}

function renderRestorePointBrowserHead() {
  return `
    <div class="history-browser-head restore-point-browser-head">
      <span>Restore point</span>
      <span>Mode</span>
      <span>Size</span>
      <span>Status</span>
    </div>
  `;
}

function renderRestorePointRow(point) {
  const active = point.id === restorePointState.selectedId;
  const tone = restorePointStatusTone(point);
  const totals = point.totals || {};
  const count = formatNumber(totals.filesTotal || 0);
  const size = formatBytes(totals.bytesTotal || 0);
  const statusLabel = tone === 'warning' ? 'Review' : tone === 'error' ? 'Issue' : 'Ready';

  return `
    <button class="history-entry restore-point-entry ${escapeHtml(tone)}${active ? ' active' : ''}" data-restore-point-id="${escapeAttr(point.id)}" type="button">
      <span class="entry-name">
        <svg class="entry-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg>
        <span class="entry-main"><strong>${escapeHtml(formatDate(point.createdAt))}</strong><small>${escapeHtml(restorePointSummaryText(point))}</small></span>
      </span>
      <span class="entry-meta">${escapeHtml(restorePointModeLabel(point.syncMode))}</span>
      <span class="entry-meta mono">${escapeHtml(size)}</span>
      <span class="entry-status">
        <span class="mini-pill ${escapeHtml(tone === 'error' ? 'error' : tone === 'warning' ? 'warning' : '')}">${escapeHtml(count)} files · ${escapeHtml(statusLabel)}</span>
        <span class="entry-arrow">›</span>
      </span>
    </button>
  `;
}

function renderRestorePointSnapshotBrowser() {
  const point = getSelectedRestorePoint();
  if (!point) return renderRestorePointBrowserHead();

  const manifest = restorePointState.selectedManifest;
  const tone = restorePointStatusTone(point);
  const totals = point.totals || {};
  const count = formatNumber(totals.filesTotal || 0);
  const size = formatBytes(totals.bytesTotal || 0);
  const statusLabel = tone === 'warning' ? 'Review' : tone === 'error' ? 'Issue' : 'Ready';
  const summary = restorePointState.manifestLoading
    ? 'Loading indexed files for the selected restore point...'
    : restorePointState.manifestError
      ? 'Restore point files could not be loaded.'
      : manifest
        ? describeRestorePointCwd(manifest, restorePointState.cwd)
        : 'Select Refresh if this snapshot does not load.';

  let browserHtml = '';
  let breadcrumbHtml = '<button class="current" type="button">Restore point</button>';

  if (restorePointState.manifestLoading) {
    browserHtml = '<div class="history-empty">Loading restore point files...</div>';
  } else if (restorePointState.manifestError) {
    browserHtml = `<div class="history-empty error">${escapeHtml(restorePointState.manifestError)}</div>`;
  } else if (!manifest) {
    browserHtml = '<div class="history-empty">Loading has not returned a manifest yet. Click Refresh if this remains empty.</div>';
  } else {
    breadcrumbHtml = renderRestorePointBrowserBreadcrumb(manifest, restorePointState.cwd);
    browserHtml = renderRestorePointManifestBrowser(manifest, restorePointState.cwd, {
      selectedFilePath: restorePointState.selectedFilePath
    });
  }

  return `
    <div class="restore-point-snapshot-browser">
      <div class="restore-point-snapshot-head">
        <button class="secondary small restore-point-back-btn" data-restore-point-back type="button">‹ Back to restore points</button>
        <div class="restore-point-snapshot-title">
          <span class="restore-point-snapshot-icon">
            <svg class="entry-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg>
          </span>
          <span>
            <small>Snapshot browser</small>
            <strong>${escapeHtml(formatDate(point.createdAt))}</strong>
          </span>
        </div>
        <span class="mini-pill ${escapeHtml(tone === 'error' ? 'error' : tone === 'warning' ? 'warning' : '')}">${escapeHtml(count)} files · ${escapeHtml(statusLabel)}</span>
      </div>
      <div class="restore-point-snapshot-summary">
        <span>${escapeHtml(restorePointModeLabel(point.syncMode))}</span>
        <span>${escapeHtml(size)}</span>
        <span>${escapeHtml(restorePointSummaryText(point))}</span>
      </div>
      <div class="restore-point-file-browser in-list">
        <div class="restore-point-file-browser-headline">
          <div>
            <h3>Restore point files</h3>
            <p class="muted">${escapeHtml(summary)}</p>
          </div>
        </div>
        <nav class="history-breadcrumb" aria-label="Restore point folders">${breadcrumbHtml}</nav>
        <div class="history-browser restore-point-file-browser-rows">${browserHtml}</div>
      </div>
    </div>
  `;
}

function exitRestorePointSnapshotBrowser() {
  restorePointState.selectedId = null;
  restorePointState.selectedManifest = null;
  restorePointState.manifestLoading = false;
  restorePointState.manifestError = '';
  restorePointState.cwd = '';
  clearRestorePointFileSelection();
  clearRestorePointPlan();
  renderRestorePoints();
  renderRestorePointSelection();
  setRestorePointStatus('Restore point browser closed. Select a restore point to inspect its files.', null);
}

function setHistoryInspectorMode(mode) {
  const restorePointMode = mode === 'restore-point';
  if (els.historyInspectorTitle) {
    els.historyInspectorTitle.textContent = restorePointMode ? 'Restore point' : 'Archived file';
  }
  if (els.historyFileInspectorBlock) els.historyFileInspectorBlock.classList.toggle('hidden', restorePointMode);
  if (els.restorePointInspectorBlock) els.restorePointInspectorBlock.classList.toggle('hidden', !restorePointMode);
  if (els.historyRestoreControls) els.historyRestoreControls.classList.toggle('hidden', restorePointMode);
  if (els.restorePointActions) els.restorePointActions.classList.toggle('hidden', !restorePointMode);
}

function setHistoryInspectorState(label, tone = 'neutral') {
  if (!els.historyInspectorState) return;
  const cleanTone = ['success', 'warning', 'error'].includes(tone) ? tone : 'neutral';
  els.historyInspectorState.classList.remove('neutral', 'success', 'warning', 'error');
  els.historyInspectorState.classList.add(cleanTone);
  els.historyInspectorState.textContent = label || 'Waiting';
}

function selectRestorePoint(restorePointId) {
  if (!restorePointId || restorePointState.selectedId === restorePointId && restorePointState.selectedManifest) {
    return;
  }

  restorePointState.selectedId = restorePointId;
  restorePointState.manifestError = '';
  restorePointState.cwd = '';
  clearRestorePointFileSelection();
  clearRestorePointPlan();
  historyState.selectedId = null;
  activateHistorySection('history-restore-points');

  const cachedManifest = restorePointState.manifestCache && restorePointState.manifestCache.get(restorePointId);
  restorePointState.selectedManifest = cachedManifest || null;
  restorePointState.manifestLoading = !cachedManifest;

  setHistoryInspectorMode('restore-point');
  updateRestorePointRowSelection();
  clearHistoryBrowserSelection();
  renderRestorePointSelection();
  renderRestorePointFileBrowser();

  if (!cachedManifest) {
    loadSelectedRestorePointManifest();
  }
}

function updateRestorePointRowSelection() {
  if (!els.restorePointRows) return;
  const rows = els.restorePointRows.querySelectorAll('[data-restore-point-id]');
  rows.forEach((row) => {
    const active = row.getAttribute('data-restore-point-id') === restorePointState.selectedId;
    row.classList.toggle('active', active);
    const arrow = row.querySelector('.entry-arrow');
    if (arrow) arrow.textContent = active ? '⌄' : '›';
  });
}

function clearHistoryBrowserSelection() {
  if (!els.historyRows) return;
  els.historyRows.querySelectorAll('.history-entry.file.selected').forEach((row) => {
    row.classList.remove('selected');
  });
}



async function loadSelectedRestorePointManifest() {
  const point = getSelectedRestorePoint();
  if (!point || !window.syncarr || typeof window.syncarr.readRestorePoint !== 'function') {
    restorePointState.selectedManifest = null;
    restorePointState.manifestLoading = false;
    restorePointState.manifestError = point ? 'Restore point manifest reader is not available in this build.' : '';
    renderRestorePointSelection();
    renderRestorePointFileBrowser();
    return;
  }

  const cachedManifest = restorePointState.manifestCache && restorePointState.manifestCache.get(point.id);
  if (cachedManifest) {
    restorePointState.selectedManifest = cachedManifest;
    restorePointState.manifestLoading = false;
    restorePointState.manifestError = '';
    renderRestorePointSelection();
    renderRestorePointFileBrowser();
    return;
  }

  const job = getJobFromForm();
  restorePointState.manifestLoading = true;
  restorePointState.manifestError = '';
  restorePointState.selectedManifest = null;
  renderRestorePointSelection();
  renderRestorePointFileBrowser();

  try {
    const result = await window.syncarr.readRestorePoint({
      jobId: job.id,
      restorePointId: point.id,
      maxFilesPerDestination: 10000
    });

    if (restorePointState.selectedId !== point.id) return;

    restorePointState.manifestLoading = false;
    if (!result || result.ok === false) {
      restorePointState.selectedManifest = null;
      restorePointState.manifestError = result && result.message ? result.message : 'Could not read restore point manifest.';
      renderRestorePointSelection();
      renderRestorePointFileBrowser();
      return;
    }

    restorePointState.selectedManifest = result.manifest || null;
    if (restorePointState.selectedManifest && restorePointState.manifestCache) {
      restorePointState.manifestCache.set(point.id, restorePointState.selectedManifest);
    }
    restorePointState.manifestError = '';
    restorePointState.cwd = '';
    renderRestorePointSelection();
    renderRestorePointFileBrowser();
  } catch (error) {
    if (restorePointState.selectedId !== point.id) return;
    restorePointState.selectedManifest = null;
    restorePointState.manifestLoading = false;
    restorePointState.manifestError = error && error.message ? error.message : String(error);
    renderRestorePointSelection();
    renderRestorePointFileBrowser();
  }
}

function getSelectedRestorePoint() {
  return (Array.isArray(restorePointState.points) ? restorePointState.points : [])
    .find((point) => point.id === restorePointState.selectedId) || null;
}


function renderRestorePointFileBrowser() {
  renderRestorePoints();
}

function renderRestorePointSelection() {
  if (!els.restorePointSelected) return;
  const point = getSelectedRestorePoint();
  if (point) setHistoryInspectorMode('restore-point');

  els.restorePointSelected.classList.remove('success', 'ok', 'warning', 'error', 'neutral');

  if (!point) {
    setHistoryInspectorState(restorePointState.disabledReason ? 'Unavailable' : 'Waiting', restorePointState.disabledReason ? 'warning' : 'neutral');
    const reason = restorePointState.disabledReason || 'Refresh restore points and select one to inspect the manifest summary.';
    els.restorePointSelected.innerHTML = renderInspectorSelectionCard({
      kind: 'restore-point',
      tone: restorePointState.disabledReason ? 'warning' : 'neutral',
      eyebrow: 'Restore point',
      title: 'No restore point selected',
      subtitle: reason
    });
    if (els.restorePointActions) {
      els.restorePointActions.innerHTML = renderInspectorActionNote({
        tone: 'neutral',
        title: 'Restore point actions',
        message: 'Select a restore point to browse and restore its verified files.',
        actions: ['Browse manifest', 'Restore to folder']
      });
    }
    return;
  }

  const totals = point.totals || {};
  const pointMode = normalizeSyncMode(point.syncMode || 'oneWay');
  const restorePointExtraCount = pointMode === 'mirror'
    ? Number(totals.deletedFiles || 0)
    : (Number(totals.destinationOnlyFiles || 0) || Number(totals.deletedFiles || 0));
  const tone = restorePointStatusTone(point);
  const readinessPlan = restorePointState.planResult && restorePointState.planResult.plan ? restorePointState.planResult.plan : restorePointState.planResult;
  if (restorePointState.restoring) {
    setHistoryInspectorState('Restoring', 'warning');
  } else if (restorePointState.restoreResult) {
    setHistoryInspectorState('Complete', 'success');
  } else if (restorePointState.restoreError || restorePointState.manifestError) {
    setHistoryInspectorState('Issue', 'error');
  } else if (restorePointState.planLoading || restorePointState.manifestLoading) {
    setHistoryInspectorState('Checking', 'neutral');
  } else if (readinessPlan) {
    setHistoryInspectorState(readinessPlan.ready ? 'Ready' : 'Review', readinessPlan.ready ? 'success' : 'warning');
  } else {
    setHistoryInspectorState(tone === 'success' ? 'Selected' : 'Review', tone);
  }
  els.restorePointSelected.classList.add(tone);
  els.restorePointSelected.innerHTML = renderInspectorSelectionCard({
    kind: 'restore-point',
    tone,
    eyebrow: 'Restore point',
    title: formatDate(point.createdAt),
    subtitle: restorePointSummaryText(point),
    stats: [
      { label: 'Files', value: formatNumber(totals.filesTotal || 0) },
      { label: 'Size', value: formatBytes(totals.bytesTotal || 0) },
      { label: 'Archived', value: formatNumber(totals.archivedVersions || 0) },
      { label: pointMode === 'mirror' ? 'Deleted' : 'Destination-only', value: formatNumber(restorePointExtraCount) }
    ],
    details: [
      { label: 'Mode', value: restorePointModeLabel(point.syncMode) },
      { label: 'Type', value: restorePointTypeLabel(point.type) },
      { label: 'Copied', value: formatNumber(totals.copiedFiles || 0) },
      { label: 'Scan issues', value: formatNumber(totals.scanErrors || 0) },
      { label: 'Manifest', value: point.manifestPath || '-' }
    ]
  });

  if (els.restorePointActions) {
    const manifest = restorePointState.selectedManifest;
    const manifestMessage = restorePointState.manifestLoading
      ? 'Loading manifest contents...'
      : restorePointState.manifestError
        ? restorePointState.manifestError
        : manifest
          ? 'Choose a folder, then run a readiness check for the selected scope.'
          : 'Manifest details are not loaded yet.';
    const manifestTone = restorePointState.manifestError ? 'error' : 'neutral';
    els.restorePointActions.innerHTML = renderRestorePointActionPanel({
      tone: manifestTone,
      message: manifestMessage,
      manifest
    });
  }
}

function renderRestorePointActionPanel({ tone, message, manifest }) {
  const scopeLabel = getRestorePointPlanScopeLabel();
  const canPreview = !!manifest && !restorePointState.manifestLoading && !restorePointState.manifestError;
  const plan = restorePointState.planResult && restorePointState.planResult.plan ? restorePointState.planResult.plan : restorePointState.planResult;
  const canRestore = canPreview && !!restorePointState.restoreFolder && !!plan && plan.ready === true && !restorePointState.restoring;
  const hasPlanFeedback = restorePointState.planLoading || restorePointState.planError || restorePointState.planResult;
  const planHtml = hasPlanFeedback && renderRestorePointPlan ? renderRestorePointPlan({
    loading: restorePointState.planLoading,
    error: restorePointState.planError,
    result: restorePointState.planResult
  }) : '';

  const restoreIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/></svg>';
  const lockedTargetTitle = 'Restore points can only be written to a new folder.';

  return `
    <div class="inspector-action-note ${escapeHtml(tone || 'neutral')}">
      <div class="inspector-action-heading">
        <small>Restore action</small>
        <strong>Choose destination</strong>
        <span>${escapeHtml(scopeLabel)} · ${escapeHtml(message || '')}</span>
      </div>
      <div class="segmented" role="group" aria-label="Restore destination">
        <button type="button" disabled title="${escapeAttr(lockedTargetTitle)}">Original target</button>
        <button type="button" disabled title="${escapeAttr(lockedTargetTitle)}">Backup target</button>
        <button class="active" type="button" aria-pressed="true">Other target</button>
      </div>
      <label>
        Restore folder
        <div class="input-row">
          <input type="text" data-restore-point-folder-input value="${escapeAttr(restorePointState.restoreFolder || '')}" placeholder="${escapeAttr(getRestoreFolderPlaceholder())}" />
          <button class="secondary" type="button" data-restore-point-pick-folder>Browse</button>
        </div>
      </label>
      ${planHtml}
      <div class="button-stack">
        <button class="secondary" type="button" data-restore-point-preflight ${canPreview ? '' : 'disabled'}>Check restore readiness</button>
        <button class="primary" type="button" data-restore-point-apply ${canRestore ? '' : 'disabled'}>${restoreIcon}${restorePointState.restoring ? 'Restoring...' : 'Restore selected version'}</button>
      </div>
      ${restorePointState.restoreError ? `<span class="error">${escapeHtml(restorePointState.restoreError)}</span>` : ''}
      ${restorePointState.restoreResult ? `<span>${escapeHtml(restorePointState.restoreResult.message || 'Restore completed.')}</span>` : ''}
    </div>
  `;
}

function clearRestorePointFileSelection() {
  restorePointState.selectedFilePath = '';
  restorePointState.selectedFileDestinationIndex = null;
}

function clearRestorePointPlan() {
  restorePointState.planLoading = false;
  restorePointState.planError = '';
  restorePointState.planResult = null;
  restorePointState.restoreError = '';
  restorePointState.restoreResult = null;
}

function getRestorePointPlanScope() {
  const parsed = parseRestorePointCwd ? parseRestorePointCwd(restorePointState.cwd) : { destinationIndex: null, relativeDir: '' };
  if (restorePointState.selectedFilePath) {
    return {
      destinationIndex: restorePointState.selectedFileDestinationIndex,
      filePath: restorePointState.selectedFilePath,
      relativePath: ''
    };
  }
  return {
    destinationIndex: parsed.destinationIndex,
    relativePath: parsed.relativeDir || '',
    filePath: ''
  };
}

function getRestorePointPlanScopeLabel() {
  if (restorePointState.selectedFilePath) {
    return `File: ${restorePointBaseName ? restorePointBaseName(restorePointState.selectedFilePath) : restorePointState.selectedFilePath}`;
  }
  const manifest = restorePointState.selectedManifest;
  return describeRestorePointCwd && manifest ? describeRestorePointCwd(manifest, restorePointState.cwd) : 'Full restore point';
}

async function previewSelectedRestorePointPlan() {
  const point = getSelectedRestorePoint();
  if (!point || !window.syncarr || typeof window.syncarr.previewRestorePointPlan !== 'function') {
    restorePointState.planError = 'Restore readiness check is not available in this build.';
    renderRestorePointSelection();
    return;
  }

  const job = getJobFromForm();
  const scope = getRestorePointPlanScope();
  restorePointState.planLoading = true;
  restorePointState.planError = '';
  restorePointState.planResult = null;
  renderRestorePointSelection();

  try {
    const result = await window.syncarr.previewRestorePointPlan({
      jobId: job.id,
      restorePointId: point.id,
      destinationIndex: scope.destinationIndex,
      relativePath: scope.relativePath,
      filePath: scope.filePath,
      restoreFolder: restorePointState.restoreFolder
    });
    if (restorePointState.selectedId !== point.id) return;
    restorePointState.planLoading = false;
    if (!result || result.ok === false) {
      restorePointState.planError = result && result.message ? result.message : 'Could not build restore readiness plan.';
      restorePointState.planResult = null;
    } else {
      restorePointState.planError = '';
      restorePointState.planResult = result.plan || result;
    }
    renderRestorePointSelection();
  } catch (error) {
    if (restorePointState.selectedId !== point.id) return;
    restorePointState.planLoading = false;
    restorePointState.planError = error && error.message ? error.message : String(error);
    restorePointState.planResult = null;
    renderRestorePointSelection();
  }
}

async function restoreSelectedRestorePointToFolder() {
  const point = getSelectedRestorePoint();
  const plan = restorePointState.planResult && restorePointState.planResult.plan ? restorePointState.planResult.plan : restorePointState.planResult;
  if (!point || !plan || plan.ready !== true || !restorePointState.restoreFolder) return;
  if (!window.syncarr || typeof window.syncarr.restorePointToFolder !== 'function') {
    restorePointState.restoreError = 'Restore-to-folder is not available in this build.';
    renderRestorePointSelection();
    return;
  }

  const totals = plan.totals || {};
  const confirmed = await uiConfirm({
    title: 'Restore files to folder?',
    message: `Restore ${formatNumber(totals.filesPlanned || 0)} file(s) (${formatBytes(totals.bytesPlanned || 0)}) to:\n\n${restorePointState.restoreFolder}\n\nExisting files are never overwritten.`,
    confirmLabel: 'Restore',
    tone: 'question'
  });
  if (!confirmed) return;

  const job = getJobFromForm();
  const scope = getRestorePointPlanScope();
  restorePointState.restoring = true;
  restorePointState.restoreError = '';
  restorePointState.restoreResult = null;
  renderRestorePointSelection();

  try {
    const result = await window.syncarr.restorePointToFolder({
      jobId: job.id,
      restorePointId: point.id,
      destinationIndex: scope.destinationIndex,
      relativePath: scope.relativePath,
      filePath: scope.filePath,
      restoreFolder: restorePointState.restoreFolder,
      freeSpaceCheckEnabled: job.freeSpaceCheckEnabled,
      minimumFreeGb: job.minimumFreeGb
    });
    restorePointState.restoring = false;
    if (!result || result.ok === false) {
      restorePointState.restoreError = result && result.message ? result.message : 'Restore failed.';
      restorePointState.restoreResult = null;
      if (result && result.plan) restorePointState.planResult = result.plan;
      setHistoryResult({ ok: false, message: restorePointState.restoreError });
      setRestorePointStatus(restorePointState.restoreError, 'error');
    } else {
      restorePointState.restoreError = '';
      restorePointState.restoreResult = result;
      restorePointState.planResult = null;
      setHistoryResult({ ok: true, message: result.message || 'Restore completed.' });
      setRestorePointStatus(result.message || 'Restore completed.', 'success');
      appendLog(`Restore point completed: ${result.message || `${result.restoredFiles || 0} file(s) restored.`}\n`);
    }
    renderRestorePointSelection();
  } catch (error) {
    restorePointState.restoring = false;
    restorePointState.restoreError = error && error.message ? error.message : String(error);
    restorePointState.restoreResult = null;
    setHistoryResult({ ok: false, message: restorePointState.restoreError });
    setRestorePointStatus(restorePointState.restoreError, 'error');
    renderRestorePointSelection();
  }
}

function setRestorePointStatus(message, tone) {
  if (!els.restorePointStatus) return;
  els.restorePointStatus.classList.remove('ok', 'success', 'warning', 'error');
  if (tone) els.restorePointStatus.classList.add(tone === 'success' ? 'ok' : tone);
  els.restorePointStatus.innerHTML = `
    <strong>Restore points</strong>
    <span>${escapeHtml(message || 'Not loaded yet.')}</span>
  `;
}

async function loadHistory(options = {}) {
  const previousSelection = historyState.selectedId;
  const job = getJobFromForm();

  if (job.historyEnabled === false) {
    renderHistoryDisabledPlaceholder(job);
    return;
  }

  // Show the loading state synchronously — before the first await — so switching
  // jobs never flashes the empty "No archived files" placeholder that
  // resetJobDerivedViews rendered a moment earlier.
  setHistoryBusy(true);
  setHistoryStatus(`Loading file history for ${job.name || 'Sync job'}...`, null);
  if (els.historyRows) {
    els.historyRows.classList.remove('hidden');
    els.historyRows.innerHTML = '<div class="history-empty">Loading file history…</div>';
  }

  await saveJob();

  const result = await window.syncarr.listHistory({
    targetPath: job.targetPath,
    targetDestinations: job.targetDestinations,
    sourcePaths: job.sourcePaths,
    syncMode: job.syncMode,
    historyFolderName: job.historyFolderName,
    jobId: job.id,
    jobName: job.name
  });

  setHistoryBusy(false);
  historyState.loadedJobId = job.id;
  historyState.lastRefreshedAt = new Date().toISOString();
  if (els.historyJobName) els.historyJobName.textContent = job.name || 'Sync job';

  if (!result.ok) {
    historyState.versions = [];
    historyState.filtered = [];
    historyState.selectedId = null;
    renderHistoryMetrics(result);
    renderHistoryVersions();
    renderHistorySelection();
    historyState.lastRefreshOk = false;
    setHistoryStatus(result.message || 'Could not load history.', 'error');
    return;
  }

  historyState.versions = result.versions || [];
  const previousStillExists = options.preserveSelection && historyState.versions.some((version) => version.id === previousSelection);
  historyState.selectedId = previousStillExists ? previousSelection : getFirstAvailableVersionId(historyState.versions);

  renderHistoryMetrics(result);
  renderHistoryVersions();
  renderHistorySelection();
  historyState.lastRefreshOk = true;
  setHistoryStatus(`${job.name || 'Sync job'}: ${result.message}`, result.manifestErrors ? 'warning' : 'success');
}

function renderHistoryDisabledPlaceholder(job) {
  setHistoryBusy(false);
  historyState.loadedJobId = job.id;
  historyState.lastRefreshedAt = new Date().toISOString();
  historyState.versions = [];
  historyState.filtered = [];
  historyState.cwd = '';
  historyState.expandedFile = null;
  historyState.selectedId = null;
  historyState.lastRefreshOk = false;
  restorePointState.points = [];
  restorePointState.selectedId = null;
  restorePointState.loadedJobId = job.id;
  restorePointState.lastRefreshOk = false;
  restorePointState.disabledReason = 'File history is disabled for this job. Enable it in the job configuration to browse restore points.';
  renderRestorePoints();
  setRestorePointStatus(restorePointState.disabledReason, 'warning');
  setHistoryInspectorMode('history');

  if (els.historyJobName) els.historyJobName.textContent = job.name || 'Sync job';
  renderHistoryMetrics({ files: 0, versions: [], manifestsRead: 0, manifestErrors: 0 });
  renderHistoryBreadcrumb();
  if (els.historyRows) {
    els.historyRows.classList.remove('hidden');
    els.historyRows.innerHTML = `
      <div class="history-empty history-disabled-placeholder">
        <strong>File history is disabled for this job.</strong>
        <span>Enable it in the job configuration to browse restore versions.</span>
      </div>
    `;
  }
  renderHistorySelection();
  setHistoryStatus('File history is disabled for this job. Enable it in the job configuration.', 'warning');
}

function renderHistoryMetrics(result) {
  els.historyFileCount.textContent = formatNumber(result.files || 0);
  els.historyVersionCount.textContent = formatNumber((result.versions || []).length);
  els.historyManifestCount.textContent = formatNumber(result.manifestsRead || 0);
  els.historyErrorCount.textContent = formatNumber(result.manifestErrors || 0);
}

function renderHistoryVersions() {
  if (!historyState.versions.length) {
    renderHistoryBreadcrumb();
    els.historyRows.classList.remove('hidden');
    els.historyRows.innerHTML = '<div class="history-empty">No archived files for this job yet.</div>';
    return;
  }

  els.historyRows.classList.remove('hidden');
  const fileMap = buildHistoryFileMap();
  const search = els.historySearch.value.trim().toLowerCase();

  if (search) {
    renderHistorySearchResults(fileMap, search);
    return;
  }

  renderHistoryBreadcrumb();
  renderHistoryFolder(fileMap);
}

function buildHistoryFileMap() {
  const map = new Map();
  for (const version of historyState.versions) {
    const base = String(version.relativePath || '').replace(/\\/g, '/');
    const key = version.destinationLabel ? `${version.destinationLabel}/${base}` : base;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(version);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0));
  }
  return map;
}

function historyEntriesAt(fileMap, cwd) {
  const prefix = cwd ? `${cwd}/` : '';
  const folders = new Map();
  const files = [];

  for (const [relPath, versions] of fileMap) {
    if (prefix && !relPath.startsWith(prefix)) continue;
    const rest = relPath.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash === -1) {
      files.push({ name: rest, relPath, versions });
    } else {
      const folder = rest.slice(0, slash);
      folders.set(folder, (folders.get(folder) || 0) + 1);
    }
  }

  return { folders, files };
}

function renderHistoryBreadcrumb() {
  const parts = historyState.cwd ? historyState.cwd.split('/') : [];
  const crumbs = [`<button data-crumb="" type="button"${parts.length ? '' : ' class="current"'}>Home</button>`];
  let acc = '';
  parts.forEach((part, index) => {
    acc = acc ? `${acc}/${part}` : part;
    const isLast = index === parts.length - 1;
    crumbs.push('<span class="sep">/</span>');
    crumbs.push(`<button data-crumb="${escapeAttr(acc)}" type="button"${isLast ? ' class="current"' : ''}>${escapeHtml(part)}</button>`);
  });
  els.historyBreadcrumb.innerHTML = crumbs.join('');
}

function renderHistoryFolder(fileMap) {
  const { folders, files } = historyEntriesAt(fileMap, historyState.cwd);
  const parts = [renderHistoryBrowserHead()];

  [...folders.keys()].sort((a, b) => a.localeCompare(b)).forEach((name) => {
    const count = folders.get(name);
    const path = historyState.cwd ? `${historyState.cwd}/${name}` : name;
    parts.push(`
      <button class="history-entry folder" data-folder="${escapeAttr(path)}" type="button">
        <span class="entry-name">
          ${renderFolderIcon()}
          <span class="entry-main"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(path)}</small></span>
        </span>
        <span class="entry-meta">Folder</span>
        <span class="entry-meta mono">—</span>
        <span class="entry-status"><span class="mini-pill">${formatNumber(count)} file(s)</span><span class="entry-arrow">›</span></span>
      </button>
    `);
  });

  files.sort((a, b) => a.name.localeCompare(b.name)).forEach((file) => {
    parts.push(renderHistoryFileEntry(file, file.name));
  });

  els.historyRows.innerHTML = parts.length > 1
    ? parts.join('')
    : renderHistoryBrowserHead() + '<div class="history-empty">This folder has no archived files.</div>';
}

function renderHistorySearchResults(fileMap, search) {
  els.historyBreadcrumb.innerHTML = '<button data-crumb="" class="current" type="button">Search results</button>';

  const matches = [];
  for (const [relPath, versions] of fileMap) {
    const haystack = `${relPath} ${versions.map((v) => `${v.runId} ${v.reason || ''}`).join(' ')}`.toLowerCase();
    if (haystack.includes(search)) matches.push({ relPath, versions });
  }
  matches.sort((a, b) => a.relPath.localeCompare(b.relPath));

  els.historyRows.innerHTML = matches.length
    ? renderHistoryBrowserHead() + matches.map((file) => renderHistoryFileEntry({ ...file, name: restorePointBaseName(file.relPath) }, restorePointBaseName(file.relPath))).join('')
    : '<div class="history-empty">No files match your search.</div>';
}

function renderHistoryBrowserHead() {
  return `
    <div class="history-browser-head">
      <span>Name</span>
      <span>Modified</span>
      <span>Size</span>
      <span>Status</span>
    </div>
  `;
}

function renderHistoryFileEntry(file, label) {
  const versions = file.versions;
  const latest = versions[0];
  const available = versions.some((v) => v.available);
  const latestSize = latest && latest.previous ? latest.previous.size : null;
  const statusText = available ? `${versions.length} version(s)` : 'Missing archive';
  const modifiedText = latest ? formatDate(latest.createdAt) : '-';
  const selected = versions.some((version) => version.id === historyState.selectedId);

  return `
    <button class="history-entry file${selected ? ' selected' : ''}${available ? '' : ' unavailable'}" data-file="${escapeAttr(file.relPath)}" type="button">
      <span class="entry-name">
        ${renderFileIcon(file.relPath)}
        <span class="entry-main"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(fileKindLabel(file.relPath))}</small></span>
      </span>
      <span class="entry-meta">${escapeHtml(modifiedText)}</span>
      <span class="entry-meta mono">${escapeHtml(formatBytes(latestSize))}</span>
      <span class="entry-status">
        <span class="mini-pill${available ? '' : ' error'}">${escapeHtml(statusText)}</span>
        <span class="entry-arrow">›</span>
      </span>
    </button>
  `;
}

function toggleHistoryFile(relPath) {
  activateHistorySection('history-archives');
  historyState.expandedFile = null;
  const versions = buildHistoryFileMap().get(relPath) || [];
  const target = versions.find((v) => v.available) || versions[0];
  if (target) {
    historyState.selectedId = target.id;
    restorePointState.selectedId = null;
    restorePointState.selectedManifest = null;
    restorePointState.manifestLoading = false;
    restorePointState.manifestError = '';
    restorePointState.cwd = '';
    clearRestorePointFileSelection();
    clearRestorePointPlan();
    setHistoryInspectorMode('history');
  }
  renderHistoryVersions();
  renderRestorePoints();
  renderRestorePointSelection();
  renderHistorySelection();
}

function enterHistoryFolder(path) {
  activateHistorySection('history-archives');
  historyState.cwd = path;
  historyState.expandedFile = null;
  renderHistoryVersions();
}

function selectHistoryVersion(versionId) {
  activateHistorySection('history-archives');
  historyState.selectedId = versionId;
  restorePointState.selectedId = null;
  restorePointState.selectedManifest = null;
  restorePointState.manifestLoading = false;
  restorePointState.manifestError = '';
  restorePointState.cwd = '';
  clearRestorePointFileSelection();
  clearRestorePointPlan();
  setHistoryInspectorMode('history');
  renderHistoryVersions();
  renderRestorePoints();
  renderRestorePointSelection();
  renderHistorySelection();
}

function renderHistorySelection() {
  if (!restorePointState.selectedId) setHistoryInspectorMode('history');
  const activeJob = getActiveJob();
  if (activeJob && activeJob.historyEnabled === false) {
    setHistoryInspectorState('Unavailable', 'warning');
    setControlDisabled(els.restoreSelectedBtn, true);
    setControlDisabled(els.pickRestoreFolderBtn, true);
    setControlDisabled(els.restoreFolderPath, true);
    if (els.historySelected) {
      els.historySelected.innerHTML = renderInspectorSelectionCard({
        kind: 'archived-file',
        tone: 'warning',
        eyebrow: 'Archived file',
        title: 'File history disabled',
        subtitle: 'Enable file history in this job configuration before restoring versions.'
      });
    }
    return;
  }

  const selected = getSelectedHistoryVersion();
  const customMode = historyState.restoreMode === 'folder';
  const originalMode = historyState.restoreMode === 'original';
  const hasFolder = Boolean(historyState.restoreFolder);
  const hasOriginalSource = Boolean(selected && selected.originalSourcePath);
  const canRestore = selected && selected.available && !running && !restoreRunning && (!customMode || hasFolder) && (!originalMode || hasOriginalSource);

  setControlDisabled(els.restoreSelectedBtn, !canRestore);
  setControlDisabled(els.pickRestoreFolderBtn, running || restoreRunning || !customMode);
  setControlDisabled(els.restoreFolderPath, running || restoreRunning || !customMode);
  if (els.restoreFolderField) els.restoreFolderField.classList.toggle('hidden', !customMode);

  if (!els.historySelected) return;

  if (!selected) {
    setHistoryInspectorState('Waiting', 'neutral');
    els.historySelected.innerHTML = renderInspectorSelectionCard({
      kind: 'archived-file',
      tone: 'neutral',
      eyebrow: 'Archived file',
      title: 'No file version selected',
      subtitle: 'Refresh file history and choose a version to inspect or restore.'
    });
    return;
  }

  const destination = getRestoreDestinationPreview(selected);
  const archivedSize = selected.previous ? selected.previous.size : null;
  const currentSize = selected.current ? selected.current.size : null;
  setHistoryInspectorState(
    restoreRunning ? 'Restoring' : selected.available ? 'Ready' : 'Missing',
    restoreRunning ? 'warning' : selected.available ? 'success' : 'error'
  );

  els.historySelected.innerHTML = renderInspectorSelectionCard({
    kind: 'archived-file',
    tone: selected.available ? 'success' : 'error',
    eyebrow: 'Archived file',
    title: selected.relativePath,
    subtitle: `Archived ${formatDate(selected.createdAt)} from run ${selected.runId}${selected.jobName ? ` · ${selected.jobName}` : ''}`,
    stats: [
      { label: 'Version size', value: formatBytes(archivedSize) },
      { label: 'Current backup', value: selected.current ? formatBytes(currentSize) : 'Missing' },
      { label: 'Status', value: selected.available ? 'Ready' : 'Missing' }
    ],
    details: [
      { label: 'Reason', value: selected.reason || 'archived' },
      { label: 'Modified', value: formatDate(selected.previous ? selected.previous.mtime : null) },
      { label: 'Original source', value: selected.originalSourcePath || 'Not available for this version' },
      { label: 'Restore target', value: destination },
      { label: 'Archive file', value: selected.archivedRelativePath || '-' }
    ]
  }) + renderSelectedHistoryVersionPicker(selected);
}

function getHistoryVersionsForSelected(selected) {
  if (!selected) return [];
  const fileMap = buildHistoryFileMap();
  for (const versions of fileMap.values()) {
    if (versions.some((version) => version.id === selected.id)) return versions;
  }
  return [selected];
}

function renderSelectedHistoryVersionPicker(selected) {
  const versions = getHistoryVersionsForSelected(selected);
  if (!versions.length || versions.length <= 1) return '';

  return `
    <div class="inspector-version-list" aria-label="Archived versions for selected file">
      <div class="inspector-version-list-head">
        <strong>Archived versions</strong>
        <span>${formatNumber(versions.length)} version(s)</span>
      </div>
      <div class="inspector-version-items">
        ${versions.map((version) => {
          const active = version.id === selected.id;
          const size = version.previous && Number.isFinite(version.previous.size) ? version.previous.size : null;
          return `
            <button class="inspector-version-row${active ? ' active' : ''}${version.available ? '' : ' unavailable'}" data-inspector-version-id="${escapeAttr(version.id)}" type="button">
              <span>
                <strong>${escapeHtml(formatDate(version.createdAt))}</strong>
                <small>${escapeHtml(version.runId)} · ${escapeHtml(version.reason || 'archived')}</small>
              </span>
              <span class="mono">${escapeHtml(formatBytes(size))}</span>
              <span class="mini-pill${version.available ? '' : ' error'}">${version.available ? 'Ready' : 'Missing'}</span>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function getRestoreDestinationPreview(selected) {
  if (!selected) return '-';
  const job = getJobFromForm();
  if (historyState.restoreMode === 'folder') {
    return joinForDisplay(historyState.restoreFolder || '(choose folder)', selected.relativePath);
  }
  if (historyState.restoreMode === 'backup') {
    return joinForDisplay(selected.destinationPath || job.targetPath || '(backup target)', selected.relativePath);
  }
  return selected.originalSourcePath || 'Original source path not available';
}

function setRestoreMode(mode) {
  historyState.restoreMode = ['original', 'backup', 'folder'].includes(mode) ? mode : 'original';
  els.restoreModeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.restoreMode === historyState.restoreMode);
  });
  renderHistorySelection();
}

async function restoreSelectedVersion() {
  const selected = getSelectedHistoryVersion();
  if (!selected) {
    setHistoryResult({ ok: false, message: 'Choose a history version first.' });
    return;
  }

  if (!selected.available) {
    setHistoryResult({ ok: false, message: 'The selected archived file is missing.' });
    return;
  }

  if (historyState.restoreMode === 'folder' && !historyState.restoreFolder) {
    setHistoryResult({ ok: false, message: 'Choose another target folder first.' });
    return;
  }

  if (historyState.restoreMode === 'original' && !selected.originalSourcePath) {
    setHistoryResult({
      ok: false,
      message: 'The original source path is not available for this archived version. Use Backup target or Other target instead.'
    });
    return;
  }

  await saveJob();
  const job = getJobFromForm();
  const destination = getRestoreDestinationPreview(selected);
  const confirmed = await uiConfirm({
    title: 'Restore this version?',
    message: `${selected.relativePath}\n\nDestination:\n${destination}\n\nIf a file already exists there, Syncarr will archive it first.`,
    confirmLabel: 'Restore version',
    tone: 'question'
  });

  if (!confirmed) return;

  setHistoryBusy(true);
  appendLog(`\n--- RESTORE ${new Date().toLocaleString()} ---\n${selected.relativePath}\n`);

  const result = await window.syncarr.restoreHistory({
    targetPath: selected.destinationPath || job.targetPath,
    targetDestinations: selected.destinationPath ? [{ path: selected.destinationPath, required: true }] : job.targetDestinations,
    historyFolderName: job.historyFolderName,
    jobId: job.id,
    jobName: job.name,
    relativePath: selected.relativePath,
    archivedRelativePath: selected.archivedRelativePath,
    destinationMode: historyState.restoreMode,
    restoreFolder: historyState.restoreFolder,
    backupTargetPath: selected.destinationPath || job.targetPath,
    originalSourcePath: selected.originalSourcePath || '',
    freeSpaceCheckEnabled: job.freeSpaceCheckEnabled,
    minimumFreeGb: job.minimumFreeGb
  });

  setHistoryBusy(false);
  setHistoryResult(result);

  if (result.ok) {
    appendLog(`Restored to: ${result.destinationPath}\n`);
    if (result.archivedCurrent) {
      appendLog(`Archived current destination before overwrite: ${formatNumber(result.archivedCurrent)} file(s)\n`);
    }
    appendLog(`Restore manifest: ${result.manifestPath}\n`);
    await loadHistory({ preserveSelection: true });
  } else {
    appendLog(`Restore failed: ${result.message}\n`);
  }
}

function getSelectedHistoryVersion() {
  return historyState.versions.find((version) => version.id === historyState.selectedId) || null;
}

function getFirstAvailableVersionId(versions) {
  const available = versions.find((version) => version.available);
  return available ? available.id : versions[0] ? versions[0].id : null;
}

function setHistoryBusy(nextRunning) {
  restoreRunning = nextRunning;
  updateDisabledControls();
  if (nextRunning) setAppTrayState('syncing');
}

function setControlDisabled(control, disabled) {
  if (!control) return;
  control.disabled = disabled;
}

function updateDisabledControls() {
  const busy = running || restoreRunning;

  setControlDisabled(els.compareBtn, busy);
  updateRunButtons();
  setControlDisabled(els.saveJobBtn, busy);
  setControlDisabled(els.discardJobBtn, busy);
  setControlDisabled(els.addSourceBtn, busy);
  if (els.sourceList) {
    els.sourceList.querySelectorAll('button, input').forEach((control) => {
      control.disabled = busy;
    });
  }
  setControlDisabled(els.newJobBtn, busy);
  setControlDisabled(els.duplicateJobBtn, busy);
  setControlDisabled(els.deleteJobBtn, busy);
  setControlDisabled(els.refreshHistoryBtn, busy);
  setControlDisabled(els.historySearch, busy);
  els.restoreModeButtons.forEach((button) => {
    button.disabled = busy;
  });

  if (els.jobList) {
    els.jobList.querySelectorAll('button').forEach((button) => {
      button.disabled = busy;
    });
  }

  renderHistorySelection();
}

function setHistoryStatus(message, kind) {
  els.historyStatus.classList.remove('ok', 'error', 'warning');
  if (kind === 'success') els.historyStatus.classList.add('ok');
  if (kind === 'error') els.historyStatus.classList.add('error');
  if (kind === 'warning') els.historyStatus.classList.add('warning');

  const refreshed = historyState.lastRefreshedAt
    ? `Last refresh: ${formatDateTime(historyState.lastRefreshedAt)} (${formatRelativeAge(historyState.lastRefreshedAt)} ago)`
    : 'Last refresh: not yet run';

  els.historyStatus.innerHTML = `
    <strong>File history status</strong>
    <span>${escapeHtml(message || 'Ready.')}</span>
    <small>${escapeHtml(refreshed)}</small>
  `;
}

function setHistoryResult(result) {
  els.historyResult.classList.remove('ok', 'error', 'warning');
  els.historyResult.classList.add(result.ok ? 'ok' : 'error');
  els.historyResult.innerHTML = `
    <strong>${result.ok ? 'Restore complete' : 'Restore failed'}</strong>
    <span>${escapeHtml(result.message || '')}</span>
  `;
}

function renderTargetTest(result) {
  els.targetTestResult.classList.remove('ok', 'error');
  els.targetTestResult.classList.add(result.ok ? 'ok' : 'error');
  els.targetTestResult.innerHTML = `
    <strong>Target test</strong>
    <span>${escapeHtml(result.message)}</span>
  `;
}

function getRunsForActiveJob(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const activeJob = getActiveJob();
  const activeId = activeJob && activeJob.id ? sanitizeJobId(activeJob.id) : '';
  const activeName = String((activeJob && activeJob.name) || '').trim().toLowerCase();
  return list.filter((run) => {
    if (!run) return false;
    if (run.jobId) return sanitizeJobId(run.jobId) === activeId;
    if (run.jobName && activeName) return String(run.jobName).trim().toLowerCase() === activeName;
    return jobState.jobs.length <= 1;
  });
}

function renderRecentRuns(runs) {
  visibleRecentRuns = getRunsForActiveJob(runs);

  if (!visibleRecentRuns.length) {
    selectedRecentRunIndex = null;
    els.recentRuns.textContent = 'No previous runs for this job.';
    return;
  }

  if (selectedRecentRunIndex !== null && selectedRecentRunIndex >= visibleRecentRuns.length) {
    selectedRecentRunIndex = null;
    logMode = 'live';
  }

  els.recentRuns.innerHTML = visibleRecentRuns.slice(0, 12).map((run, index) => {
    const label = run.dryRun ? 'Compare' : 'Sync';
    const jobLabel = run.jobName ? `${label} | ${run.jobName}` : label;
    const at = formatDate(run.at);
    const status = run.status || 'unknown';
    const statsText = buildRunHistoryStatsText(run);
    const destinations = normalizeTargetDestinations(run.targetDestinations, run.targetPath);
    const skippedCount = Array.isArray(run.skippedDestinations) ? run.skippedDestinations.length : 0;
    const destinationText = destinations.length > 1
      ? `${destinations.length} destination(s)${skippedCount ? `, ${skippedCount} skipped` : ''}`
      : (destinations[0] ? destinations[0].path : '-');
    const active = logMode === 'run' && selectedRecentRunIndex === index;
    return `
      <article class="run-card${active ? ' active' : ''}">
        <button class="run-card-head" data-run-index="${index}" type="button">
          <span class="run-card-time">${escapeHtml(at)}</span>
          <span class="run-card-main">
            <strong>${escapeHtml(jobLabel)}</strong>
            <small>${escapeHtml(destinationText)}</small>
          </span>
          <span class="run-card-stats">${escapeHtml(status)} | ${escapeHtml(statsText)}</span>
          <span class="entry-arrow">${active ? '⌄' : '›'}</span>
        </button>
        ${active ? `<pre class="run-card-log">${escapeHtml(buildRunLog(run))}</pre>` : ''}
      </article>
    `;
  }).join('');
}


function setBusy(nextRunning, label) {
  running = nextRunning;
  // Defensive: cancelBtn can be null if the run overlay hasn't mounted yet or
  // if the active view doesn't include it. Without this guard, an unrelated
  // sync:event firing before the renderer is fully wired crashes the page.
  if (els.cancelBtn) els.cancelBtn.classList.toggle('hidden', !nextRunning);
  if (document.body) document.body.classList.toggle('app-busy', nextRunning);
  updateDisabledControls();

  if (nextRunning) {
    setRunState(label || 'Running', 'running');
    setAppTrayState('syncing');
  }
}

function setAppTrayState(state) {
  if (!window.syncarr || typeof window.syncarr.setTrayState !== 'function') return;
  window.syncarr.setTrayState(state).catch(() => {});
}

function setRunState(text, kind) {
  if (!els.runState) return;
  els.runState.textContent = text;
  // The run modal now keeps status in the progress/current-action areas.
  // Keep this element for compatibility, but do not show the duplicate header pill.
  els.runState.className = `pill hidden${kind ? ` ${kind}` : ''}`;
}

function setRunCurrentActionClass(kind) {
  if (!els.runCurrentAction) return;
  const normalized = String(kind || 'active').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  els.runCurrentAction.className = `run-current-action ${normalized || 'active'}`;
}

function updateSidebar() {
  upsertCurrentJobInState();
  renderSyncModeDescription();
  renderJobList();
  updateRunButtons();
}

function markDirty() {
  if (dirty) return;
  dirty = true;
  updateSaveBar();
}

function updateSaveBar() {
  els.saveBar.classList.toggle('visible', dirty);
}

function discardChanges() {
  if (!dirty || running || restoreRunning) return;
  syncJobStateFromConfig(config);
  applyConfigToForm(config);
  applyTelegramSettingsToForm(config.telegramSettings);
  renderTelegramStatus();
  renderJobList();
  dirty = false;
  updateSaveBar();
}

/* ---- Run controls: compare gating + run overlay ---- */

function setRunHint(text, kind) {
  if (!els.runHint) return;
  els.runHint.textContent = text;
  els.runHint.className = 'run-hint' + (kind ? ` ${kind}` : '');
}

function setLastScanHint() {
  const helper = window.SyncarrCompareStatus && window.SyncarrCompareStatus.buildLastScanHint;
  if (typeof helper === 'function') {
    const hint = helper({ compareDone, compareReadyAt, lastCompareScannedAt, formatRelativeAge });
    setRunHint(hint.text, hint.kind);
    return;
  }

  const scanAt = compareReadyAt || lastCompareScannedAt;
  if (!scanAt) {
    setRunHint('Never scanned', 'idle');
    return;
  }

  const ageMs = Date.now() - new Date(scanAt).getTime();
  setRunHint(`Last scanned ${formatRelativeAge(scanAt)} ago`, ageMs >= 30 * 60 * 1000 || !compareDone ? 'warning' : 'ready');
}

function updateRunButtons() {
  const busy = running || restoreRunning;
  const jobEnabled = !els.jobEnabled || els.jobEnabled.checked;
  const mode = els.syncMode ? els.syncMode.value : 'oneWay';
  const compareRunnable = isCompareModeRunnable(mode);
  const syncRunnable = isSyncModeRunnable(mode);
  setControlDisabled(els.compareBtn, busy || !jobEnabled || !compareRunnable);
  // A compare that found no copy/update/delete work should not offer a Run Sync.
  // Without this, destination-only files (left untouched in one-way mode) keep
  // the button lit and let the user repeatedly apply a plan that does nothing.
  const noChangesToSync = compareDone && syncRunnable && !previewHasActionableWork(previewState.summary, getActivePreviewMode());
  setControlDisabled(els.syncBtn, busy || !jobEnabled || !syncRunnable || !compareDone || noChangesToSync);
  updateSyncApplyButtonLabel(mode, noChangesToSync);
  if (!busy && jobEnabled && compareRunnable && !syncRunnable) {
    const info = getSyncModeInfo(mode);
    setRunHint(`${info.label}: Compare planning is available. Applying this mode is still locked for safety.`, 'stale');
  } else if (!busy && jobEnabled && !compareRunnable) {
    const info = getSyncModeInfo(mode);
    setRunHint(`${info.label} is staged for a future build.`, 'stale');
  }
}



function updateSyncApplyButtonLabel(mode, noChangesToSync = false) {
  if (!els.syncBtn) return;
  const clean = normalizeSyncMode(mode);
  const strong = els.syncBtn.querySelector('strong');
  const small = els.syncBtn.querySelector('small');
  if (noChangesToSync) {
    if (strong) strong.textContent = 'No changes to sync';
    if (small) small.textContent = 'Compare found nothing to apply';
    return;
  }
  if (strong) strong.textContent = clean === 'mirror' ? 'Run mirror sync' : 'Run update sync';
  if (small) small.textContent = clean === 'mirror' ? 'Apply mirror plan' : 'Apply changes';
}

function markCompareReady(createdAt = new Date().toISOString(), fingerprint = makeCompareFingerprint(getJobFromForm())) {
  compareDone = true;
  compareReadyAt = createdAt;
  lastCompareScannedAt = createdAt;
  compareFingerprint = fingerprint;
  const summary = previewState.summary || {};
  runPlanTotal = Number.isFinite(summary.wouldCopy) ? summary.wouldCopy : 0;
  renderCompareReadyHint();
  setPreviewAccess(Boolean(previewState.summary || previewState.files.length));
  setPreviewPanelVisible(true);
  renderPreviewStatus();
  updateRunButtons();
}

function renderCompareReadyHint() {
  setLastScanHint();
}

function startCompareAgeTicker() {
  setInterval(() => {
    if (!compareDone || !compareReadyAt) return;
    renderCompareReadyHint();
    renderPreviewStatus();
  }, 60 * 1000);
}

function invalidateCompare() {
  if (!compareDone) return;
  compareDone = false;
  compareReadyAt = null;
  compareFingerprint = null;
  runPlanTotal = 0;
  setPreviewAccess(false);
  setPreviewPanelVisible(true);
  setLastScanHint();
  updateRunButtons();
}

function setTextIfPresent(element, text) {
  if (element) element.textContent = text;
}

function getActivePreviewMode() {
  return normalizeSyncMode(previewState.syncMode || (els.syncMode && els.syncMode.value) || 'oneWay');
}

// Does the saved compare plan contain work the active mode would actually apply?
// Destination-only files are excluded in one-way (they are left untouched) and
// only count as work in mirror mode (where they are delete candidates). Mirrors
// the main-process getPlannedSyncActionCounts so the UI and engine agree.
function getCurrentRunMode(result = null) {
  return normalizeSyncMode(
    (result && result.syncMode)
    || (els.syncMode && els.syncMode.value)
    || (previewState && previewState.syncMode)
    || 'oneWay'
  );
}

function setDeleteMetricLabel(mode) {
  if (!els.metricDeletedLabel) return;
  els.metricDeletedLabel.textContent = isMirrorMode(mode) ? 'Files deleted' : 'Destination-only';
}

function applyCompareModeLabels(mode) {
  const labels = getCompareModeLabels(mode);
  const flow = els.compareOverlayPanel ? els.compareOverlayPanel.querySelector('.compare-flow b') : null;
  setTextIfPresent(flow, labels.flow);
  setDeleteMetricLabel(mode);
  return labels;
}

function resetCompareOverlay(jobName) {
  if (!els.compareOverlayPanel) return;
  const job = getJobFromForm();
  const sourceCount = Array.isArray(job.sourcePaths) ? job.sourcePaths.length : 0;
  const destinationCount = Array.isArray(job.targetDestinations) ? job.targetDestinations.length : 0;
  const labels = applyCompareModeLabels(job.syncMode);

  if (els.compareSourceStatus) els.compareSourceStatus.textContent = sourceCount === 1 ? labels.sourceTitle : `${formatNumber(sourceCount)} source folders queued`;
  if (els.compareSourceSub) els.compareSourceSub.textContent = job.sourcePaths && job.sourcePaths[0] ? job.sourcePaths[0] : 'Waiting for source inventory...';
  if (els.compareDestinationStatus) els.compareDestinationStatus.textContent = destinationCount === 1 ? labels.destinationTitle : `${formatNumber(destinationCount)} destinations queued`;
  if (els.compareDestinationSub) {
    const required = (job.targetDestinations || []).filter((target) => target.required !== false).length;
    const optional = Math.max(0, destinationCount - required);
    els.compareDestinationSub.textContent = `${formatNumber(required)} required · ${formatNumber(optional)} optional`;
  }

  setCompareOverlayCounts({ newFiles: 0, changed: 0, archive: 0, issues: 0, extra: 0 });
  if (els.compareLatestFile) els.compareLatestFile.textContent = `${labels.latestIdle} ${jobName || 'Sync job'}...`;
}

function compareDetailRow(label, value, tone = '') {
  return `<div class="${escapeAttr(tone)}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`;
}

function renderCompareLaneDetails(counts = {}, modeInput = getCurrentRunMode(), options = {}) {
  const mode = normalizeSyncMode(modeInput || 'oneWay');
  const newFiles = Number(counts.newFiles || 0);
  const changed = Number(counts.changed || 0);
  const archived = Number(counts.archive || 0);
  const issues = Number(counts.issues || 0);
  const destinationOnly = Number(counts.extra || 0);
  const actions = Number(counts.actions || newFiles + changed + (mode === 'mirror' ? destinationOnly : 0) + issues || 0);
  const writeBytes = Number(counts.copyBytes || counts.estimatedWriteBytes || 0);
  const duration = options.duration || '';

  if (els.compareSourceDetails) {
    els.compareSourceDetails.innerHTML = [
      compareDetailRow('New files', formatNumber(newFiles), 'new'),
      compareDetailRow('Changed files', formatNumber(changed), 'changed'),
      compareDetailRow('Source actions', formatNumber(newFiles + changed), newFiles + changed ? 'new' : 'neutral'),
      compareDetailRow('Estimated write', formatBytes(writeBytes), 'bytes')
    ].join('');
  }

  if (els.compareDestinationDetails) {
    const destinationLabel = mode === 'mirror' ? 'Delete candidates' : 'Kept destination-only';
    const destinationTone = mode === 'mirror' && destinationOnly ? 'delete' : 'neutral';
    els.compareDestinationDetails.innerHTML = [
      compareDetailRow('Create on destination', formatNumber(newFiles), newFiles ? 'new' : 'neutral'),
      compareDetailRow('Replace/update', formatNumber(changed), changed ? 'changed' : 'neutral'),
      compareDetailRow('Files archived', formatNumber(archived), archived ? 'archive' : 'neutral'),
      compareDetailRow(destinationLabel, formatNumber(destinationOnly), destinationTone),
      compareDetailRow('Blocked/issues', formatNumber(issues), issues ? 'issue' : 'neutral'),
      compareDetailRow('Duration', duration || (actions ? 'Running' : 'Waiting'), 'neutral')
    ].join('');
  }
}

function setCompareOverlayCounts(counts = {}, options = {}) {
  renderCompareLaneDetails(counts, getCurrentRunMode(), options);
}

function getActionableFilesFromList(files = []) {
  return (Array.isArray(files) ? files : []).filter((file) => {
    const action = String(file && file.action || '').trim();
    return action && action !== 'unchanged';
  });
}

function getCompareOverlayCounts(result = null, progress = null) {
  const preview = result && result.preview ? result.preview : null;
  const summary = (preview && preview.summary) || (result && result.history) || {};
  const files = getActionableFilesFromList((preview && preview.files) || previewState.files || []);
  const fileCounts = summarizePreviewActions(files);
  const copyChange = Number(progress && progress.copied || 0);
  const failed = Number(progress && progress.failed || 0);
  const extra = Number(progress && progress.extra || 0);

  const destinationOnly = Number(summary.destinationOnly || 0) || fileCounts.destinationOnly || extra;
  const archiveCount = Number(summary.wouldArchive || 0) || fileCounts.archive || fileCounts.changed;
  return {
    newFiles: Number(summary.newFiles || 0) || fileCounts.newFiles || (progress ? copyChange : 0),
    changed: fileCounts.changed || Math.max(0, archiveCount - destinationOnly),
    archive: archiveCount,
    issues: Number(summary.conflicts || 0) || fileCounts.issues || failed,
    extra: destinationOnly,
    actions: Number(summary.previewFiles || summary.wouldCopy || 0) || files.length || (progress ? copyChange + failed + extra : 0),
    copyBytes: Number(summary.copyBytes || summary.estimatedWriteBytes || fileCounts.copyBytes || 0)
  };
}

function updateCompareOverlayProgress(progress = {}) {
  const counts = getCompareOverlayCounts(null, progress);
  setCompareOverlayCounts(counts);

  const mode = getCurrentRunMode();
  const scanned = (Number(progress.copied) || 0) + (Number(progress.skipped) || 0) + (Number(progress.failed) || 0) + (Number(progress.extra) || 0);
  if (els.compareSourceStatus) els.compareSourceStatus.textContent = scanned ? `${formatNumber(scanned)} file records scanned` : 'Scanning source folders';
  if (els.compareDestinationStatus) els.compareDestinationStatus.textContent = counts.actions
    ? `${formatNumber(counts.newFiles)} create · ${formatNumber(counts.changed)} replace · ${formatNumber(counts.extra)} ${isMirrorMode(mode) ? 'delete' : 'kept'}`
    : 'Scanning destination state';
  if (els.compareLatestFile) {
    els.compareLatestFile.textContent = getProgressFileLine(progress, mode, true) || progress.latestText || 'Scanning source and destination differences...';
  }
}

function updateCompareOverlayFinal(result, duration) {
  if (!els.compareOverlayPanel) return;
  const counts = getCompareOverlayCounts(result);

  const mode = normalizeSyncMode((result && result.syncMode) || (els.syncMode && els.syncMode.value) || 'oneWay');
  const labels = applyCompareModeLabels(mode);
  setCompareOverlayCounts(counts, { duration: duration || '0s' });
  if (els.compareSourceStatus) els.compareSourceStatus.textContent = `${formatNumber(counts.actions)} ${isMirrorMode(mode) ? 'actionable difference(s)' : 'difference(s)'}`;
  if (els.compareSourceSub) els.compareSourceSub.textContent = `${formatNumber(counts.newFiles)} ${mode === 'twoWay' ? 'source-side' : 'new'} · ${formatNumber(counts.changed)} changed`;
  if (els.compareDestinationStatus) els.compareDestinationStatus.textContent = mode === 'mirror'
    ? `${formatNumber(counts.newFiles)} create · ${formatNumber(counts.changed)} replace · ${formatNumber(counts.extra)} delete`
    : `${formatNumber(counts.newFiles)} create · ${formatNumber(counts.changed)} replace · ${formatNumber(counts.extra)} kept`;
  if (els.compareDestinationSub) els.compareDestinationSub.textContent = `${formatNumber(counts.archive)} archived before change · ${formatNumber(counts.issues)} issue/conflict item(s) · ${formatBytes(counts.copyBytes)} estimated write`;
  if (els.compareLatestFile) els.compareLatestFile.textContent = result && result.ok
    ? `${labels.flow.charAt(0).toUpperCase()}${labels.flow.slice(1)} plan ready in ${duration || '0s'}. Open File Preview for details.`
    : ((result && result.message) || 'Compare stopped before a preview could be built.');
}

function openRunOverlay(jobName, mode = 'sync') {
  runOverlayOpen = true;
  runOverlayMode = mode === 'compare' ? 'compare' : 'sync';
  runOverlayFinished = false;
  runMinimized = false;
  runStartTime = Date.now();
  const currentJob = getJobFromForm();
  const currentMode = normalizeSyncMode(currentJob.syncMode);
  const plannedCopies = previewState.summary && Number.isFinite(Number(previewState.summary.wouldCopy))
    ? Number(previewState.summary.wouldCopy)
    : 0;
  const plannedDeletes = currentMode === 'mirror' && previewState.summary
    ? Number(previewState.summary.destinationOnly || 0)
    : 0;
  runPlanTotal = runOverlayMode === 'sync' ? plannedCopies + plannedDeletes : 0;
  beginTrayTask(currentJob, runOverlayMode === 'compare' ? 'compare' : 'sync', {
    message: runOverlayMode === 'compare' ? 'Preparing compare...' : 'Preparing sync...',
    total: runPlanTotal
  });

  const isCompare = runOverlayMode === 'compare';
  const modeInfo = getSyncModeInfo(currentJob.syncMode);
  setDeleteMetricLabel(currentMode);
  els.runJobLabel.textContent = `${isCompare ? `${modeInfo.shortLabel} plan` : 'Sync'} · ${jobName || 'Sync job'}`;
  if (els.runModal) els.runModal.classList.toggle('compare-mode', isCompare);
  if (els.runOverlay) els.runOverlay.classList.toggle('compare-mode', isCompare);
  if (els.runMetrics) els.runMetrics.classList.add('hidden');
  if (els.progressStatus) els.progressStatus.classList.toggle('hidden', isCompare);
  if (els.compareOverlayPanel) els.compareOverlayPanel.classList.toggle('hidden', !isCompare);
  if (els.runCurrentAction) els.runCurrentAction.classList.remove('hidden');
  els.runResume.classList.add('hidden');
  els.runResume.innerHTML = '';
  els.runProgress.classList.remove('hidden');
  els.runFill.setAttribute('class', 'progress-fill indeterminate');
  els.runFillBar.setAttribute('width', '0');
  els.runPct.textContent = isCompare ? 'Mapping' : (runPlanTotal ? '0%' : '—');
  els.runEta.textContent = isCompare ? `Building ${modeInfo.shortLabel.toLowerCase()} action map…` : 'Estimating time remaining…';
  els.runFile.textContent = isCompare ? `Building ${modeInfo.shortLabel.toLowerCase()} plan…` : (currentMode === 'mirror' ? 'Preparing mirror safety plan…' : 'Preparing one-way sync…');
  setRunCurrentActionClass(isCompare ? 'scan' : 'active');
  if (isCompare) resetCompareOverlay(jobName);
  els.minimizeRunBtn.classList.remove('hidden');
  els.cancelBtn.disabled = false;
  els.cancelBtn.textContent = 'Cancel';
  els.cancelBtn.classList.remove('hidden');
  els.closeRunBtn.classList.add('hidden');
  els.runMini.classList.add('hidden');
  els.runMini.classList.remove('done', 'warning', 'error');
  els.runOverlay.classList.remove('hidden');
}

function minimizeRun() {
  if (!runOverlayOpen) return;
  runMinimized = true;
  els.runOverlay.classList.add('hidden');
  els.runMiniText.textContent = running ? (runOverlayMode === 'compare' ? 'Compare running' : 'Sync running') : (runOverlayMode === 'compare' ? 'Compare finished' : 'Sync finished');
  els.runMiniSub.textContent = els.runPct.textContent;
  els.runMini.classList.remove('hidden');
}

function restoreRun() {
  runMinimized = false;
  els.runMini.classList.add('hidden');
  if (runOverlayOpen) els.runOverlay.classList.remove('hidden');
}

function closeRunOverlay() {
  runOverlayOpen = false;
  runOverlayFinished = false;
  runMinimized = false;
  els.runOverlay.classList.add('hidden');
  els.cancelBtn.disabled = false;
  els.cancelBtn.textContent = 'Cancel';
  els.runOverlay.classList.remove('compare-mode');
  if (els.runModal) els.runModal.classList.remove('compare-mode');
  if (els.progressStatus) els.progressStatus.classList.remove('hidden');
  els.runMini.classList.add('hidden');
}

function updateRunProgress(progress) {
  if (!runOverlayOpen || !progress) return;
  // Once the run has been finalized, ignore any in-flight progress events.
  // Without this guard a buffered event from before the "complete" event can
  // re-apply the .indeterminate class to the run bar, restarting the
  // animation after the run has visibly finished.
  if (runOverlayFinished) return;

  const copied = Number(progress.copied) || 0;
  const skipped = Number(progress.skipped) || 0;
  const failed = Number(progress.failed) || 0;
  const extra = Number(progress.extra) || 0;
  const scanned = copied + skipped + failed + extra;
  const mode = getCurrentRunMode();
  const isCompare = runOverlayMode === 'compare';
  const completed = getProgressCompletedCount({ copied, extra, failed }, mode);
  const actionStatus = getProgressActionStatus(progress, mode, isCompare);

  setDeleteMetricLabel(mode);
  els.metricCopied.textContent = formatNumber(copied);
  els.metricSkipped.textContent = formatNumber(skipped);
  els.metricFailed.textContent = formatNumber(failed);
  if (els.metricDeleted) els.metricDeleted.textContent = formatNumber(extra);

  if (isCompare) {
    els.runFill.classList.add('indeterminate');
    els.runPct.textContent = scanned ? `${formatNumber(scanned)} scanned` : 'Mapping';
    els.runEta.textContent = copied || failed || extra
      ? `${formatNumber(copied + failed + extra)} actionable difference(s) found`
      : 'Building source/destination action map…';
    updateCompareOverlayProgress({ ...progress, copied, skipped, failed, extra });
  } else if (runPlanTotal > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((completed / runPlanTotal) * 100)));
    els.runFill.classList.remove('indeterminate');
    els.runFillBar.setAttribute('width', String(pct));
    els.runPct.textContent = `${pct}%`;

    const elapsed = Date.now() - runStartTime;
    if (completed > 0 && elapsed > 1500) {
      const rate = completed / (elapsed / 1000);
      const remaining = Math.max(0, runPlanTotal - completed);
      const eta = remaining > 0 && rate > 0
        ? `About ${formatDuration((remaining / rate) * 1000)} remaining`
        : 'Finishing up…';
      els.runEta.textContent = progress.kind ? actionStatus : eta;
    } else {
      els.runEta.textContent = actionStatus;
    }
  } else {
    els.runPct.textContent = formatNumber(copied + (isMirrorMode(mode) ? extra : 0));
    els.runEta.textContent = actionStatus;
  }

  const fileLine = getProgressFileLine(progress, mode, isCompare);
  if (fileLine) els.runFile.textContent = fileLine;
  setRunCurrentActionClass(getProgressVisualAction(progress, mode, isCompare));

  if (runMinimized) {
    els.runMiniText.textContent = isCompare ? 'Compare running' : (isMirrorMode(mode) ? 'Mirror running' : 'Sync running');
    els.runMiniSub.textContent = els.runPct.textContent;
  }
}

function finishRunOverlay(result) {
  if (!runOverlayOpen) return;
  runOverlayFinished = true;
  const ok = Boolean(result && result.ok);
  const cancelled = isCancelledRun(result);
  const visualKind = getRunVisualKind(result);
  const duration = runStartTime ? formatDuration(Date.now() - runStartTime) : '';

  const isCompare = Boolean(result && result.dryRun) || runOverlayMode === 'compare';
  const mode = getCurrentRunMode(result);
  if (!isCompare && els.metricDeleted) {
    const files = result && result.summary && result.summary.files ? result.summary.files : {};
    const history = result && result.history ? result.history : {};
    setDeleteMetricLabel(mode);
    els.metricDeleted.textContent = formatNumber(files.extras || files.deleted || history.destinationOnly || 0);
  }
  els.runFill.setAttribute('class', `progress-fill ${cancelled ? 'warning' : (ok ? visualKind : 'error')}`);
  els.runFillBar.setAttribute('width', '100');
  els.runPct.textContent = cancelled ? 'Cancelled' : (ok ? (isCompare ? 'Plan ready' : '100%') : 'Stopped');
  const actionLabel = isCompare ? 'Compare' : 'Sync';
  els.runEta.textContent = cancelled
    ? `Cancelled after ${duration || '0s'}`
    : (ok
      ? (isCompare
        ? (visualKind === 'warning' ? `Plan ready with warnings in ${duration}` : `Plan ready in ${duration}`)
        : (visualKind === 'warning' ? `Completed with warnings in ${duration}` : `Completed in ${duration}`))
      : 'Run ended');
  const finalActionText = cancelled
    ? `${actionLabel} cancelled. Review the summary below.`
    : (ok
      ? (visualKind === 'warning' ? `${actionLabel} completed with warnings. Review the summary below.` : `${actionLabel} completed. Review the summary below.`)
      : `${actionLabel} stopped. Review the summary below.`);
  els.runFile.textContent = finalActionText;
  setRunCurrentActionClass(cancelled ? 'warning' : (ok ? (visualKind === 'warning' ? 'warning' : 'success') : 'error'));
  if (isCompare) updateCompareOverlayFinal(result, duration);

  els.minimizeRunBtn.classList.add('hidden');
  if (els.cancelBtn) {
    els.cancelBtn.disabled = false;
    els.cancelBtn.textContent = 'Cancel';
    els.cancelBtn.classList.add('hidden');
  }
  if (els.closeRunBtn) els.closeRunBtn.classList.remove('hidden');

  if (isCompare) {
    els.runResume.innerHTML = '';
    els.runResume.classList.add('hidden');
  } else {
    els.runResume.className = `run-resume ${cancelled ? 'warning' : (ok ? (visualKind === 'warning' ? 'warning' : 'ok') : 'error')}`;
    els.runResume.innerHTML = buildResume(result, duration);
    els.runResume.classList.remove('hidden');
  }

  els.runMini.classList.add(cancelled ? 'warning' : (ok ? (visualKind === 'warning' ? 'warning' : 'done') : 'error'));
  if (runMinimized) {
    if (ok && !cancelled && visualKind !== 'warning') {
      // A clean finish stays minimized — a toast + the done-state pill replace
      // the old behavior of yanking the modal back open. Problems still restore.
      els.runMiniText.textContent = isCompare ? 'Compare finished' : 'Sync finished';
      els.runMiniSub.textContent = 'Click to review';
      toast('success', isCompare ? 'Compare finished — plan ready' : `Sync finished in ${duration || '0s'}`);
    } else {
      restoreRun();
    }
  }
}

function buildResume(result, duration) {
  const isCompare = Boolean(result && result.dryRun) || runOverlayMode === 'compare';
  const files = result && result.summary && result.summary.files ? result.summary.files : {};
  const bytes = result && result.summary && result.summary.bytes ? result.summary.bytes : {};
  const history = result && result.history ? result.history : {};
  const archived = Number.isFinite(history.archived)
    ? history.archived
    : (history.wouldArchive || 0);
  const ok = Boolean(result && result.ok);
  const cancelled = isCancelledRun(result);
  const visualKind = getRunVisualKind(result);

  if (isCompare) {
    const counts = getCompareOverlayCounts(result);
    return `
      <div class="compare-finish-summary">
        <div>
          <h4>${cancelled ? 'Compare cancelled' : (ok ? (visualKind === 'warning' ? 'Compare plan ready with warnings' : 'Compare plan ready') : 'Compare finished with issues')}</h4>
          <p>${escapeHtml((result && result.message) || '')}</p>
        </div>
        <div class="compare-finish-grid">
          <span><b>${formatNumber(counts.actions)}</b><small>Total actions</small></span>
          <span class="new"><b>${formatNumber(counts.newFiles)}</b><small>New</small></span>
          <span class="changed"><b>${formatNumber(counts.changed)}</b><small>Changed</small></span>
          <span class="archive"><b>${formatNumber(counts.archive)}</b><small>Archive</small></span>
          <span class="issue"><b>${formatNumber(counts.issues)}</b><small>Issues</small></span>
          <span><b>${duration || '-'}</b><small>Duration</small></span>
        </div>
      </div>
    `;
  }

  const mode = getCurrentRunMode(result);
  const deleted = Number(files.extras || files.deleted || history.destinationOnly || 0);
  const rows = [
        ['Files copied', formatNumber(files.copied || 0)],
        ['Files archived', formatNumber(archived)],
        [isMirrorMode(mode) ? 'Files deleted' : 'Destination-only left untouched', formatNumber(deleted)],
        ['Files skipped', formatNumber(files.skipped || 0)],
        ['Failed', formatNumber(files.failed || 0)],
        ['Bytes copied', formatBytes(bytes.copied || 0)],
        ['Duration', duration || '-']
      ];

  const completeLabel = 'Sync';

  return `
    <h4>${cancelled ? `${completeLabel} cancelled` : (ok ? (visualKind === 'warning' ? `${completeLabel} complete with warnings` : `${completeLabel} complete`) : `${completeLabel} finished with issues`)}</h4>
    <ul class="run-resume-list">
      ${rows.map(([label, value]) => `<li><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></li>`).join('')}
    </ul>
    <p class="run-resume-msg">${escapeHtml((result && result.message) || '')}</p>
  `;
}

function appendLog(text) {
  if (!text) return;
  if (logMode !== 'live') {
    showLiveLog();
  }
  if (liveLogBuffer === 'Ready.') liveLogBuffer = '';
  liveLogBuffer += text;
  els.logOutput.textContent = liveLogBuffer || 'Ready.';
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function startLiveLog(title = 'Live log', subtitle = 'Current compare or sync output.') {
  logMode = 'live';
  selectedRecentRunIndex = null;
  liveLogBuffer = '';
  setLogHeader(title, subtitle);
  els.logOutput.textContent = '';
  renderRecentRuns(config && Array.isArray(config.lastRuns) ? config.lastRuns : []);
}

function showLiveLog() {
  logMode = 'live';
  selectedRecentRunIndex = null;
  setLogHeader('Live log', 'Current compare or sync output.');
  els.logOutput.textContent = liveLogBuffer || 'Ready.';
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
  renderRecentRuns(config && Array.isArray(config.lastRuns) ? config.lastRuns : []);
}

function setLogHeader(title, subtitle) {
  if (els.logTitle) els.logTitle.textContent = title || 'Live log';
  if (els.logSubtitle) els.logSubtitle.textContent = subtitle || '';
}

function showRunLog(run, index) {
  if (logMode === 'run' && selectedRecentRunIndex === index) {
    logMode = 'live';
    selectedRecentRunIndex = null;
  } else {
    logMode = 'run';
    selectedRecentRunIndex = index;
  }
  renderRecentRuns(config && Array.isArray(config.lastRuns) ? config.lastRuns : []);
}


function getExclusiveHistorySectionPeer(sectionId) {
  if (sectionId === 'history-archives') return 'history-restore-points';
  if (sectionId === 'history-restore-points') return 'history-archives';
  return '';
}

function setCollapseState(sectionId, collapsed) {
  if (!sectionId) return;
  const section = document.querySelector(`[data-collapse-section="${cssEscape(sectionId)}"]`);
  const button = document.querySelector(`[data-collapse-toggle="${cssEscape(sectionId)}"]`);
  if (!section || !button) return;
  section.classList.toggle('collapsed', collapsed === true);
  button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function activateHistorySection(sectionId) {
  if (!sectionId) return;
  setCollapseState(sectionId, false);
  const peer = getExclusiveHistorySectionPeer(sectionId);
  if (peer) setCollapseState(peer, true);
}

function toggleCollapse(sectionId) {
  if (!sectionId) return;
  const section = document.querySelector(`[data-collapse-section="${cssEscape(sectionId)}"]`);
  const button = document.querySelector(`[data-collapse-toggle="${cssEscape(sectionId)}"]`);
  if (!section || !button) return;
  const collapsed = section.classList.toggle('collapsed');
  button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  if (!collapsed) {
    const peer = getExclusiveHistorySectionPeer(sectionId);
    if (peer) setCollapseState(peer, true);
  }
}

function setPreviewAccess(enabled) {
  // The preview is always available in the collapsible File preview section.
  // The Compare button is the only way to generate or refresh it.
  setPreviewPanelVisible(true);
}

function setPreviewPanelVisible(visible, options = {}) {
  if (!els.filePreviewPanel) return;
  const shouldShow = visible || !options.forceHide;
  els.filePreviewPanel.classList.toggle('hidden', !shouldShow);
  if (shouldShow) {
    els.filePreviewPanel.classList.remove('collapsed');
    const button = document.querySelector('[data-collapse-toggle="preview"]');
    if (button) button.setAttribute('aria-expanded', 'true');
    if (options.scroll) els.filePreviewPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}


function getPendingCompareForJob(jobId = jobState.activeJobId) {
  if (!config || !config.pendingCompares || typeof config.pendingCompares !== 'object') return null;
  return config.pendingCompares[sanitizeJobId(jobId)] || null;
}

function loadPersistedCompareForActiveJob(options = {}) {
  const job = getActiveJob();
  const pending = getPendingCompareForJob(job.id);

  compareDone = false;
  compareReadyAt = null;
  lastCompareScannedAt = null;
  compareFingerprint = null;

  if (!pending || !pending.result) {
    previewState.files = [];
    previewState.summary = null;
    previewState.message = '';
    previewState.ok = null;
    // No saved plan to restore, but the run card should still show when the
    // folders were last scanned rather than reverting to "Never scanned".
    // Pending plans are cleared after a sync or when stale; lastRuns keeps the
    // history, so an hours/days/month-old scan still shows its real age.
    lastCompareScannedAt = lastScanTimeForActiveJob(job.id);
    return false;
  }

  const formJob = {
    ...job,
    sourcePaths: job.sourcePaths && job.sourcePaths.length ? job.sourcePaths : job.sourcePath,
    targetDestinations: job.targetDestinations && job.targetDestinations.length ? job.targetDestinations : [{ path: job.targetPath, required: true }]
  };
  const currentFingerprint = makeCompareFingerprint(formJob);
  if (pending.fingerprint && pending.fingerprint !== currentFingerprint) {
    previewState.files = [];
    previewState.summary = null;
    previewState.message = 'Saved compare does not match the current job settings.';
    previewState.ok = false;
    lastCompareScannedAt = pending.createdAt || null;
    if (!options.silent) setLastScanHint();
    return false;
  }

  previewState.ok = pending.result.ok === true;
  previewState.message = pending.result.message || 'Restored previous compare preview.';
  previewState.summary = pending.result.summary || null;
  previewState.files = Array.isArray(pending.result.files) ? pending.result.files : [];
  previewState.cwd = '';
  previewState.expandedFile = null;
  compareDone = previewState.ok === true && Boolean(previewState.summary || previewState.files.length);
  compareReadyAt = pending.createdAt || null;
  lastCompareScannedAt = pending.createdAt || null;
  compareFingerprint = pending.fingerprint || currentFingerprint;

  if (compareDone && !options.silent) renderCompareReadyHint();
  if (compareDone && options.silent) renderCompareReadyHint();
  return compareDone;
}

function clearComparePreviewAfterSync() {
  compareDone = false;
  compareReadyAt = null;
  compareFingerprint = null;
  previewState.files = [];
  previewState.summary = null;
  previewState.message = 'Sync completed. Run a new compare to generate the next preview.';
  previewState.ok = null;
  previewState.cwd = '';
  previewState.expandedFile = null;
  renderPreviewTable();
  renderPreviewStatus();
  setPreviewAccess(false);
  setPreviewPanelVisible(true);
  // The sync that just finished scanned the folders; refresh the hint's
  // timestamp from run history so it does not report the previous compare's age.
  lastCompareScannedAt = lastScanTimeForActiveJob(getActiveJob().id) || lastCompareScannedAt;
  setLastScanHint();
  updateRunButtons();
}
