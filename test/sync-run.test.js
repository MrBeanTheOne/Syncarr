const test = require('node:test');
const assert = require('node:assert/strict');

const { createSyncRun } = require('../src/main/sync-run');

// A full fake deps bundle for the extracted executeSyncRun. Defaults drive a
// successful one-way sync; individual tests override to reach other branches.
// `calls` records the lifecycle-significant operations so tests can assert order.
function makeDeps(overrides = {}) {
  const calls = [];
  const state = { runId: undefined, proc: undefined, cancel: undefined, cleared: 0 };

  const journalStore = {
    createRun: async (opts) => { calls.push(`createRun:${opts.syncMode}`); return { id: 'journal-1' }; },
    plan: async (_j, ops) => { calls.push(`plan:${Array.isArray(ops) ? ops.length : 'x'}`); },
    recordOperation: async (_j, _id, patch) => { calls.push(`recordOperation:${patch.status}`); }
  };

  const iface = {
    interpretExitCode: (code) => ({ ok: code < 8, status: code < 8 ? 'success' : 'failed', message: 'engine result' }),
    parseSummary: () => ({ files: { copied: 1, skipped: 0, failed: 0 }, bytes: { copied: 10 } }),
    getFileCounts: () => ({ copied: 1, skipped: 0, failed: 0, extras: 0 })
  };

  const base = {
    // guards
    assertCompareModeRunnable: () => '',
    assertSyncModeRunnable: () => '',
    isOperationSupported: () => true,
    buildUnsupportedOperationResult: () => ({ ok: false, status: 'unsupported' }),
    getSyncEngine: () => ({ id: 'robocopy', interface: iface }),
    isOperationBusy: () => false,
    BUSY_MESSAGE: 'busy',
    parseRunRequest: () => ({
      cleanSourcePaths: ['C:/src'],
      cleanDestinations: [{ path: 'D:/dst', label: 'dst', required: true }],
      jobId: 'job1',
      jobName: 'Job 1',
      cleanHistoryFolderName: '.syncarr-history',
      cleanTwoWayConflictPolicy: 'newer',
      cleanExcludePatterns: []
    }),
    pathIsDirectory: async () => true,
    PATH_CHECK_TIMEOUT_MS: 2500,
    normalizeSyncMode: (m) => m || 'oneWay',
    runTwoWaySyncRun: async () => { calls.push('runTwoWaySyncRun'); return { ok: true, status: 'success', syncMode: 'twoWay' }; },
    resolveDestinationAvailability: async (dests) => ({
      available: dests.map((d) => ({ ...d, available: true, creatable: false })),
      skipped: [],
      missingRequired: []
    }),
    formatHistoryRunId: () => '20260630-000000',
    createEngineProgressState: () => ({ copied: 0, skipped: 0, failed: 0, extra: 0, latestText: '', latestFile: '' }),
    emitSyncEvent: (e) => { calls.push(`emit:${e.type}`); },
    appendSkippedDestinationLog: () => '',
    throwIfRunCancelled: () => {},
    buildDestinationSourceRoots: ({ sourcePaths, destinations }) => destinations.map((d, i) => ({
      sourcePath: sourcePaths[0], destinationPath: d.path, destination: d, index: i, relativePrefix: ''
    })),
    runSyncEngineSequence: async () => { calls.push('engine'); return { output: 'robocopy done\n', code: 1, canceled: false }; },
    isActiveRunCancelled: () => false,
    makeCancelledRunResult: () => ({ ok: false, status: 'cancelled', message: 'cancelled' }),
    makeJobFingerprint: () => 'fp',
    clearActiveRunState: () => { state.cleared += 1; calls.push('clearActiveRunState'); },
    reconcileNoChangeStatus: ({ interpreted }) => interpreted,
    applyDestinationWarningStatus: (interpreted) => interpreted,
    buildRobocopyDryRunPreview: () => ({ summary: {}, files: [] }),
    buildInternalComparePreview: () => ({ summary: {}, files: [] }),
    resolveSkipOlderSource: () => true,
    makeSkippedOptionalPreviewSummary: () => ({}),
    buildCompareCompletionMessage: () => 'Compare complete.',
    readConfig: async () => ({ lastRuns: [], pendingCompares: {} }),
    writeConfig: async (c) => c,
    trimSavedRunOutput: (s) => s,
    makePendingCompare: () => ({}),
    notifyJobRunIfNeeded: async () => {},
    analyzeMultiDestinationHistoryPlan: async () => ({
      destinationPlans: [{
        destination: { path: 'D:/dst', label: 'dst', required: true },
        plan: { archiveFiles: [], newFiles: [] },
        sourceRoots: [{ sourcePath: 'C:/src', destinationPath: 'D:/dst', index: 0, relativePrefix: '' }]
      }],
      summary: { archived: 0, previewFiles: 1, wouldCopy: 1, copyBytes: 10 },
      previewFiles: 1
    }),
    checkStorageForDestinationPlans: async () => ({ checked: false, enoughSpace: true }),
    isNoOpSyncPlan: () => false,
    makeNoOpRobocopySummary: () => ({}),
    buildNoOpSyncMessage: () => 'No changes.',
    getRunJournalStore: () => journalStore,
    getRunTrigger: () => 'manual',
    makeJournalJobSnapshot: () => ({}),
    buildOneWayJournalOperations: () => [{ id: 'op-1', action: 'overwrite' }],
    createHistorySnapshot: async () => { calls.push('createHistorySnapshot'); return { manifestPath: 'D:/dst/.syncarr-history/manifests/r.json', summary: { archived: 0 } }; },
    isCancellationError: () => false,
    finishRunJournal: async (_j, status) => { calls.push(`finishRunJournal:${status}`); },
    mergeEngineExitCodes: (_engine, a, b) => (b || a),
    buildSyncCompletionMessage: () => 'Sync complete.',
    finalizeHistoryManifest: async () => {},
    runRetentionPolicy: async () => ({ ok: true, summary: {} }),
    emptyRetentionSummary: () => ({}),
    aggregateRetentionResults: (r) => (Array.isArray(r) ? r[0] : r) || { ok: true, summary: {} },
    createRestorePointManifest: async () => ({ ok: true }),
    app: { getPath: () => 'C:/userData' },
    setActiveRunId: (v) => { state.runId = v; calls.push(`setActiveRunId:${v === null ? 'null' : 'runId'}`); },
    setActiveProcess: (v) => { state.proc = v; },
    setActiveCancellationRequest: (v) => { state.cancel = v; }
  };

  return { deps: { ...base, ...overrides }, calls, state, journalStore };
}

const oneWayRequest = {
  id: 'job1', name: 'Job 1', syncMode: 'oneWay', dryRun: false,
  sourcePaths: ['C:/src'], targetDestinations: [{ path: 'D:/dst' }],
  historyEnabled: true, copySubfolders: true, skipOlderSource: true,
  retentionEnabled: false, restorePointsEnabled: false
};

test('createSyncRun exposes executeSyncRun', () => {
  const { deps } = makeDeps();
  const runner = createSyncRun(deps);
  assert.equal(typeof runner.executeSyncRun, 'function');
});

test('a full one-way sync drives the journal lifecycle in order and returns ok', async () => {
  const { deps, calls } = makeDeps();
  const { executeSyncRun } = createSyncRun(deps);

  const result = await executeSyncRun(oneWayRequest);

  assert.equal(result.ok, true, 'a successful engine run yields ok:true');

  // The claimed run lock is set before any await, and cleared at the end.
  assert.equal(calls[0], 'setActiveRunId:runId', 'run lock claimed first');
  assert.equal(calls.filter((c) => c === 'clearActiveRunState').length >= 1, true, 'run state cleared at the end');

  // Journal lifecycle ordering: createRun -> plan -> engine -> finishRunJournal(completed).
  const seq = calls.filter((c) => /^(createRun|plan|engine|finishRunJournal)/.test(c));
  const createRunAt = seq.indexOf('createRun:oneWay');
  const planAt = seq.findIndex((c) => c.startsWith('plan:'));
  const engineAt = seq.indexOf('engine');
  const finishAt = seq.indexOf('finishRunJournal:completed');

  assert.ok(createRunAt >= 0, 'journal createRun was called for the one-way run');
  assert.ok(planAt > createRunAt, 'plan follows createRun');
  assert.ok(engineAt > planAt, 'the engine runs after the plan is journaled');
  assert.ok(finishAt > engineAt, 'the journal is finished (completed) after the engine run');
});

test('a two-way sync request delegates to runTwoWaySyncRun', async () => {
  const { deps, calls } = makeDeps();
  const { executeSyncRun } = createSyncRun(deps);

  const result = await executeSyncRun({ ...oneWayRequest, syncMode: 'twoWay' });

  assert.equal(result.syncMode, 'twoWay');
  assert.ok(calls.includes('runTwoWaySyncRun'), 'non-dry-run two-way delegates entirely');
  // Delegation happens before any journal is created here.
  assert.ok(!calls.some((c) => c.startsWith('createRun')), 'no one-way journal for a delegated two-way run');
});

test('a disabled job returns status:disabled without touching run state', async () => {
  const { deps, calls } = makeDeps();
  const { executeSyncRun } = createSyncRun(deps);

  const result = await executeSyncRun({ ...oneWayRequest, enabled: false });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'disabled');
  assert.equal(calls.length, 0, 'guard returns before any run-state mutation');
});

test('a busy operation is rejected with status:busy', async () => {
  const { deps } = makeDeps({ isOperationBusy: () => true });
  const { executeSyncRun } = createSyncRun(deps);

  const result = await executeSyncRun(oneWayRequest);
  assert.equal(result.status, 'busy');
});

test('an engine failure (exit >= 8) yields ok:false but still finalizes the journal', async () => {
  const { deps, calls } = makeDeps({
    runSyncEngineSequence: async () => ({ output: 'fatal\n', code: 16, canceled: false })
  });
  const { executeSyncRun } = createSyncRun(deps);

  const result = await executeSyncRun(oneWayRequest);
  assert.equal(result.ok, false, 'a fatal engine exit is not ok');
  assert.ok(calls.some((c) => c.startsWith('finishRunJournal')), 'the journal is still finalized on failure');
  assert.ok(calls.includes('clearActiveRunState'), 'run state is cleared even on failure');
});

// --- M9: mid-run destination-offline detection ------------------------------

test('an engine failure against a vanished destination is reported as offline', async () => {
  const { deps } = makeDeps({
    runSyncEngineSequence: async () => ({ output: 'fatal\n', code: 16, canceled: false }),
    // Sources still exist; the destination no longer resolves (NAS dropped mid-run).
    pathIsDirectory: async (p) => p !== 'D:/dst'
  });
  const { executeSyncRun } = createSyncRun(deps);

  const result = await executeSyncRun(oneWayRequest);

  assert.equal(result.ok, false);
  const dest = (result.destinationResults || []).find((d) => d.destinationPath === 'D:/dst');
  assert.ok(dest, 'the failed destination is reported');
  assert.equal(dest.offline, true, 'the re-probe flags the destination as offline');
  assert.match(dest.message, /offline or unreachable/i);
});

test('an engine failure with the destination still reachable is NOT flagged offline', async () => {
  const { deps } = makeDeps({
    runSyncEngineSequence: async () => ({ output: 'fatal\n', code: 16, canceled: false })
    // default pathIsDirectory: always true
  });
  const { executeSyncRun } = createSyncRun(deps);

  const result = await executeSyncRun(oneWayRequest);

  const dest = (result.destinationResults || []).find((d) => d.destinationPath === 'D:/dst');
  assert.ok(dest);
  assert.notEqual(dest.offline, true, 'a reachable destination failing is a genuine engine failure');
  assert.doesNotMatch(String(dest.message || ''), /offline or unreachable/i);
});
