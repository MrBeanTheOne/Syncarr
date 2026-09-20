const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const { register: registerTargetIpc } = require('../src/main/ipc/target');
const { register: registerConfigIpc } = require('../src/main/ipc/config');
const { register: registerDialogIpc } = require('../src/main/ipc/dialog');
const { register: registerWatcherIpc } = require('../src/main/ipc/watcher');
const { withSafeHandle } = require('../src/main/ipc');

// Fake ipcMain that records every registered handler so tests can invoke them
// directly. Mirrors the relevant surface of electron's ipcMain without pulling
// in the runtime.
function makeFakeIpc() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) { handlers.set(channel, fn); },
    on(channel, fn) { handlers.set(channel, fn); }
  };
}

test('withSafeHandle turns a throwing handler into a structured error (no unhandled rejection)', async () => {
  const ipc = makeFakeIpc();
  const safe = withSafeHandle(ipc);
  safe.handle('boom', async () => { throw new Error('kaboom'); });

  const result = await ipc.handlers.get('boom')({}, 'arg');
  assert.equal(result.ok, false);
  assert.equal(result.status, 'error');
  assert.match(result.message, /kaboom/);
});

test('withSafeHandle passes a successful return through unchanged', async () => {
  const ipc = makeFakeIpc();
  const safe = withSafeHandle(ipc);
  safe.handle('ok', async () => ({ ok: true, value: 42 }));

  assert.deepEqual(await ipc.handlers.get('ok')({}, 'x'), { ok: true, value: 42 });
});

test('withSafeHandle forwards on() registrations without wrapping them', () => {
  const ipc = makeFakeIpc();
  const safe = withSafeHandle(ipc);
  const listener = () => {};
  safe.on('evt', listener);
  assert.equal(ipc.handlers.get('evt'), listener, 'event listeners are passed through as-is');
});

test('target:test reports an empty path without touching the disk', async () => {
  const ipc = makeFakeIpc();
  registerTargetIpc(ipc);
  const handler = ipc.handlers.get('target:test');

  const result = await handler({}, '');
  assert.equal(result.ok, false);
  assert.equal(result.message, 'Target path is empty.');

  const result2 = await handler({}, '   ');
  assert.equal(result2.ok, false);
});

test('target:test writes and removes a probe file when the target is writable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'syncarr-ipc-target-'));
  try {
    const ipc = makeFakeIpc();
    registerTargetIpc(ipc);
    const handler = ipc.handlers.get('target:test');

    const result = await handler({}, root);
    assert.equal(result.ok, true);
    assert.equal(result.message, 'Target is reachable and writable.');

    // The probe file must be gone after the test.
    const entries = await fs.readdir(root);
    assert.deepEqual(entries, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('target:test reports a clean error when the path does not exist', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'syncarr-ipc-target-'));
  const missing = path.join(root, 'no-such-folder');
  try {
    const ipc = makeFakeIpc();
    registerTargetIpc(ipc);
    const handler = ipc.handlers.get('target:test');

    const result = await handler({}, missing);
    assert.equal(result.ok, false);
    assert.ok(result.message, 'expected an error message');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('config:load delegates to readConfig and returns whatever the store gives', async () => {
  const ipc = makeFakeIpc();
  const calls = { read: 0 };
  const fakeConfig = { activeJobId: 'job-test', jobs: [{ id: 'job-test', name: 'Test' }] };
  registerConfigIpc(ipc, {
    readConfig: async () => { calls.read += 1; return fakeConfig; },
    writeConfig: async () => fakeConfig,
    refreshBackgroundScheduler: async () => {}
  });
  const handler = ipc.handlers.get('config:load');

  const result = await handler({});
  assert.equal(result.activeJobId, 'job-test');
  assert.equal(calls.read, 1);
});

test('config:save preserves the active job across jobs[] + job{} merge', async () => {
  const ipc = makeFakeIpc();
  let savedConfig = null;
  let schedulerRefreshes = 0;
  let watcherRefreshes = 0;
  registerConfigIpc(ipc, {
    readConfig: async () => ({
      activeJobId: 'job-current',
      jobs: [{ id: 'job-current', name: 'Current' }],
      job: { id: 'job-current', name: 'Current' }
    }),
    writeConfig: async (next) => { savedConfig = next; return next; },
    refreshBackgroundScheduler: async () => { schedulerRefreshes += 1; },
    refreshSmartWatcher: async () => { watcherRefreshes += 1; }
  });
  const handler = ipc.handlers.get('config:save');

  // Provide a job patch for the active job plus a brand-new job to append.
  await handler({}, {
    activeJobId: 'job-current',
    job: { name: 'Renamed Current' },
    jobs: [
      { id: 'job-current', name: 'Renamed Current' },
      { id: 'job-new', name: 'Brand new' }
    ]
  });

  assert.ok(savedConfig, 'writeConfig should be called');
  assert.equal(savedConfig.activeJobId, 'job-current');
  assert.equal(savedConfig.jobs.length, 2);
  assert.equal(savedConfig.jobs.find((job) => job.id === 'job-current').name, 'Renamed Current');
  assert.equal(savedConfig.jobs.find((job) => job.id === 'job-new').name, 'Brand new');
  assert.equal(schedulerRefreshes, 1);
  assert.equal(watcherRefreshes, 1);
});

test('config:save does not let a stale renderer save revert the scheduler nextRunAt', async () => {
  const ipc = makeFakeIpc();
  let savedConfig = null;
  const backendSchedule = {
    enabled: true, mode: 'sync', frequency: 'weekly', intervalValue: 1, intervalUnit: 'hours',
    time: '03:30', days: ['TU'],
    nextRunAt: '2026-07-14T07:30:00.000Z',                 // scheduler already advanced it
    lastRun: { at: '2026-07-07T13:21:48.965Z', ok: true, status: 'no-change' }
  };
  registerConfigIpc(ipc, {
    readConfig: async () => ({
      activeJobId: 'job-a',
      jobs: [{ id: 'job-a', name: 'A', schedule: backendSchedule }],
      job: { id: 'job-a', name: 'A', schedule: backendSchedule }
    }),
    writeConfig: async (next) => { savedConfig = next; return next; },
    refreshBackgroundScheduler: async () => {},
    refreshSmartWatcher: async () => {}
  });
  const handler = ipc.handlers.get('config:save');

  // Renderer round-trips a STALE schedule (nextRunAt back in the past, no lastRun)
  // while the timing config is unchanged.
  await handler({}, {
    activeJobId: 'job-a',
    jobs: [{ id: 'job-a', name: 'A', schedule: {
      enabled: true, mode: 'sync', frequency: 'weekly', intervalValue: 1, intervalUnit: 'hours',
      time: '03:30', days: ['TU'], nextRunAt: '2026-06-30T07:30:00.000Z', lastRun: null
    } }]
  });

  const saved = savedConfig.jobs.find((job) => job.id === 'job-a');
  assert.equal(saved.schedule.nextRunAt, '2026-07-14T07:30:00.000Z', 'nextRunAt must not be reverted');
  assert.ok(saved.schedule.lastRun, 'lastRun bookkeeping must be preserved');
});

test('config:save clears nextRunAt when the schedule timing actually changes', async () => {
  const ipc = makeFakeIpc();
  let savedConfig = null;
  const backendSchedule = {
    enabled: true, mode: 'sync', frequency: 'weekly', intervalValue: 1, intervalUnit: 'hours',
    time: '03:30', days: ['TU'], nextRunAt: '2026-07-14T07:30:00.000Z', lastRun: null
  };
  registerConfigIpc(ipc, {
    readConfig: async () => ({
      activeJobId: 'job-a',
      jobs: [{ id: 'job-a', name: 'A', schedule: backendSchedule }],
      job: { id: 'job-a', name: 'A', schedule: backendSchedule }
    }),
    writeConfig: async (next) => { savedConfig = next; return next; },
    refreshBackgroundScheduler: async () => {},
    refreshSmartWatcher: async () => {}
  });
  const handler = ipc.handlers.get('config:save');

  await handler({}, {
    activeJobId: 'job-a',
    jobs: [{ id: 'job-a', name: 'A', schedule: { ...backendSchedule, time: '05:00' } }]
  });

  const saved = savedConfig.jobs.find((job) => job.id === 'job-a');
  assert.equal(saved.schedule.nextRunAt, null, 'a timing change must force a recompute');
  assert.equal(saved.schedule.time, '05:00');
});

test('watcher:getStatus returns the current main-process snapshot', async () => {
  const ipc = makeFakeIpc();
  const snapshot = {
    enabledJobs: 1,
    watchedSources: 2,
    unavailableSources: 0,
    jobs: [{ id: 'job-current', mode: 'compare', watchedSources: 2 }]
  };
  registerWatcherIpc(ipc, { getSmartWatcherStatus: () => snapshot });

  const handler = ipc.handlers.get('watcher:getStatus');
  assert.deepEqual(await handler({}), snapshot);
});

test('dialog:pickSource uses the provided mainWindow as parent', async () => {
  const ipc = makeFakeIpc();
  const fakeMainWindow = { id: 'main-window' };
  const dialogCalls = [];
  registerDialogIpc(ipc, {
    dialog: {
      showOpenDialog: async (parent, options) => {
        dialogCalls.push({ parent, options });
        return { canceled: true, filePaths: [] };
      }
    },
    getMainWindow: () => fakeMainWindow
  });

  const pickSource = ipc.handlers.get('dialog:pickSource');
  const pickRestore = ipc.handlers.get('dialog:pickRestoreFolder');

  assert.equal(await pickSource({}), null);
  assert.equal(await pickRestore({}), null);
  assert.equal(dialogCalls.length, 2);
  assert.equal(dialogCalls[0].parent, fakeMainWindow);
  assert.equal(dialogCalls[1].parent, fakeMainWindow);
  assert.deepEqual(dialogCalls[0].options.properties, ['openDirectory']);
  assert.deepEqual(dialogCalls[1].options.properties, ['openDirectory', 'createDirectory']);
});

// --- M3: recovery:resume supersede gate --------------------------------------

const { register: registerRecoveryIpc } = require('../src/main/ipc/recovery');

function makeRecoveryHarness(executeResult) {
  const ipc = makeFakeIpc();
  const finished = [];
  registerRecoveryIpc(ipc, {
    getRunJournalStore: () => ({
      get: async () => ({ jobId: 'j1', runId: 'r1', job: { id: 'j1', name: 'Job' }, syncMode: 'oneWay' }),
      finish: async (_run, status) => { finished.push(status); },
      list: async () => []
    }),
    getConfigHealth: () => ({ ok: true }),
    readConfig: async () => ({}),
    executeSyncRun: async () => executeResult,
    resetTwoWayStateForRecovery: async () => {},
    isOperationBusy: () => false,
    setActiveRunId: () => {},
    clearActiveRunId: () => {}
  });
  return { ipc, finished };
}

test('recovery:resume supersedes the old journal when the resume genuinely ran (even failed)', async () => {
  const { ipc, finished } = makeRecoveryHarness({ ok: false, jobId: 'j1', syncMode: 'oneWay', status: 'failed', message: 'engine failed' });
  await ipc.handlers.get('recovery:resume')({}, { jobId: 'j1', runId: 'r1' });
  assert.deepEqual(finished, ['superseded'], 'a failed-but-ran resume has its own journal; the old one is superseded');
});

test('recovery:resume leaves the original journal interrupted when the resume was cancelled', async () => {
  const { ipc, finished } = makeRecoveryHarness({ ok: false, jobId: 'j1', syncMode: 'oneWay', status: 'cancelled', canceled: true, message: 'Sync cancelled by user.' });
  await ipc.handlers.get('recovery:resume')({}, { jobId: 'j1', runId: 'r1' });
  assert.deepEqual(finished, [], 'a cancelled resume reconciled nothing — rollback must stay available');
});

test('recovery:resume does not supersede when the run was rejected by a guard', async () => {
  const { ipc, finished } = makeRecoveryHarness({ ok: false, status: 'busy', message: 'busy' });
  await ipc.handlers.get('recovery:resume')({}, { jobId: 'j1', runId: 'r1' });
  assert.deepEqual(finished, [], 'a guard rejection (no jobId/syncMode) never supersedes');
});

// --- M5: restore-into-live-sync-root guards ----------------------------------

const { register: registerRestorePointsIpc } = require('../src/main/ipc/restore-points');
const { register: registerHistoryIpc } = require('../src/main/ipc/history');

// Allowlist fake: everything under C:/configured is a configured sync root.
const fakeAllowlist = {
  isRootAllowed: async (p) => String(p).toLowerCase().replace(/\\/g, '/').startsWith('c:/configured')
};

test('restorePoints:restoreToFolder rejects a folder inside a configured sync root', async () => {
  const ipc = makeFakeIpc();
  let restored = 0;
  registerRestorePointsIpc(ipc, {
    app: { getPath: () => 'C:/userData' },
    listRestorePoints: async () => ({ ok: true }),
    readRestorePointManifest: async () => ({ ok: true }),
    previewRestorePointPlan: async () => ({ ok: true, plan: { ready: true, totals: {} } }),
    restoreRestorePointToFolder: async () => { restored += 1; return { ok: true }; },
    checkStorageForRequest: async () => ({ ok: true, checked: false }),
    isOperationBusy: () => false,
    setActiveRunId: () => {},
    clearActiveRunId: () => {},
    formatHistoryRunId: () => '20260702-000000',
    emitSyncEvent: () => {},
    pathAllowlist: fakeAllowlist
  });

  const result = await ipc.handlers.get('restorePoints:restoreToFolder')({}, {
    jobId: 'j1', restorePointId: 'rp1', restoreFolder: 'C:/configured\source\sub'
  });

  assert.equal(result.status, 'unsafe-target');
  assert.match(result.message, /outside your configured sync sources and destinations/);
  assert.equal(restored, 0, 'the restore never ran');
});

test('restorePoints:restoreToFolder allows a neutral folder outside every sync root', async () => {
  const ipc = makeFakeIpc();
  let restored = 0;
  registerRestorePointsIpc(ipc, {
    app: { getPath: () => 'C:/userData' },
    listRestorePoints: async () => ({ ok: true }),
    readRestorePointManifest: async () => ({ ok: true }),
    previewRestorePointPlan: async () => ({ ok: true, plan: { ready: true, totals: {} } }),
    restoreRestorePointToFolder: async () => { restored += 1; return { ok: true }; },
    checkStorageForRequest: async () => ({ ok: true, checked: false }),
    isOperationBusy: () => false,
    setActiveRunId: () => {},
    clearActiveRunId: () => {},
    formatHistoryRunId: () => '20260702-000000',
    emitSyncEvent: () => {},
    pathAllowlist: fakeAllowlist
  });

  const result = await ipc.handlers.get('restorePoints:restoreToFolder')({}, {
    jobId: 'j1', restorePointId: 'rp1', restoreFolder: 'C:/neutral\out'
  });

  assert.equal(result.ok, true);
  assert.equal(restored, 1);
});

function makeHistoryHarness() {
  const ipc = makeFakeIpc();
  const calls = { restore: 0 };
  registerHistoryIpc(ipc, {
    app: { getPath: () => 'C:/userData' },
    listHistoryVersions: async () => ({ ok: true, versions: [] }),
    restoreHistoryVersion: async () => { calls.restore += 1; return { ok: true, status: 'success' }; },
    deleteHistoryCacheForJob: async () => ({}),
    emptyJobHistoryDeleteSummary: () => ({}),
    aggregateJobHistoryDeleteSummaries: () => ({}),
    formatHistoryRunId: () => '20260702-000000',
    isOperationBusy: () => false,
    setActiveRunId: () => {},
    clearActiveRunId: () => {},
    deleteRestorePointsForJob: async () => ({}),
    pathAllowlist: fakeAllowlist
  });
  return { ipc, calls };
}

test('history:restore rejects an "Other target" folder inside a configured sync root', async () => {
  const { ipc, calls } = makeHistoryHarness();
  const result = await ipc.handlers.get('history:restore')({}, {
    destinationMode: 'folder', restoreFolder: 'C:/configured\dest\deep', targetPath: 'C:/configured\dest'
  });
  assert.equal(result.status, 'unsafe-target');
  assert.equal(calls.restore, 0, 'restoreHistoryVersion is never reached');
});

test('history:restore leaves original/backup modes to the H12 gate (no inverse check)', async () => {
  const { ipc, calls } = makeHistoryHarness();
  const result = await ipc.handlers.get('history:restore')({}, {
    destinationMode: 'original', targetPath: 'C:/configured\dest'
  });
  assert.equal(result.ok, true, 'original-mode restores flow through (H12 gates them inside the orchestrator)');
  assert.equal(calls.restore, 1);
});

test('history:restore allows an "Other target" folder outside every sync root', async () => {
  const { ipc, calls } = makeHistoryHarness();
  const result = await ipc.handlers.get('history:restore')({}, {
    destinationMode: 'folder', restoreFolder: 'C:/neutral\out', targetPath: 'C:/configured\dest'
  });
  assert.equal(result.ok, true);
  assert.equal(calls.restore, 1);
});

// --- M1: token redaction + empty-preserves over the config IPC ---------------

const { createTelegramTokenCodec } = require('../src/main/telegram-token');
const { register: registerTelegramIpc } = require('../src/main/ipc/telegram');
const { normalizeTelegramSettings: normalizeTgSettings } = require('../src/services/telegram');

function makeTokenCodecForTests() {
  return createTelegramTokenCodec({
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
      decryptString: (buf) => Buffer.from(buf).toString('utf8').slice(4)
    }
  });
}

// In-memory config store wrapped exactly like main.js wraps the real one:
// seal on write, open on read.
function makeConfigHarness(initialConfig) {
  const codec = makeTokenCodecForTests();
  let stored = codec.sealTelegramSettings(initialConfig);
  const readConfig = async () => codec.openTelegramSettings(stored);
  const writeConfig = async (config) => {
    stored = codec.sealTelegramSettings(config);
    return codec.openTelegramSettings(stored);
  };
  const ipc = makeFakeIpc();
  registerConfigIpc(ipc, {
    readConfig,
    writeConfig,
    redactTelegramSettings: codec.redactTelegramSettings
  });
  return { ipc, readConfig, getStored: () => stored, codec };
}

const TG_CONFIG = {
  job: { id: 'j1' },
  jobs: [{ id: 'j1' }],
  activeJobId: 'j1',
  telegramSettings: { enabled: true, botToken: '123:secret-token', chatId: '42' }
};

test('config:load never returns the token or its ciphertext to the renderer', async () => {
  const { ipc } = makeConfigHarness(TG_CONFIG);
  const loaded = await ipc.handlers.get('config:load')({});
  assert.equal(loaded.telegramSettings.botToken, '');
  assert.equal('botTokenEncrypted' in loaded.telegramSettings, false);
  assert.equal(loaded.telegramSettings.botTokenConfigured, true);
});

test('config:save with an empty token preserves the stored one (redaction round-trip)', async () => {
  const { ipc, readConfig, getStored } = makeConfigHarness(TG_CONFIG);

  // The renderer round-trips the redacted shape: empty botToken.
  const saved = await ipc.handlers.get('config:save')({}, {
    telegramSettings: { enabled: true, botToken: '', chatId: '42' }
  });

  assert.equal(saved.telegramSettings.botToken, '', 'the save response is redacted too');
  const inMemory = await readConfig();
  assert.equal(inMemory.telegramSettings.botToken, '123:secret-token', 'the stored token survived the save');
  assert.ok(!JSON.stringify(getStored()).includes('secret-token'), 'the persisted config holds only ciphertext');
});

test('config:save with a new token replaces the stored one', async () => {
  const { ipc, readConfig } = makeConfigHarness(TG_CONFIG);
  await ipc.handlers.get('config:save')({}, {
    telegramSettings: { enabled: true, botToken: '999:replacement', chatId: '42' }
  });
  const inMemory = await readConfig();
  assert.equal(inMemory.telegramSettings.botToken, '999:replacement');
});

test('telegram:test falls back to the stored token when the renderer sends a blank one', async () => {
  const codec = makeTokenCodecForTests();
  const stored = codec.sealTelegramSettings(TG_CONFIG);
  const sent = [];
  const ipc = makeFakeIpc();
  registerTelegramIpc(ipc, {
    normalizeTelegramSettings: normalizeTgSettings,
    sendTelegramMessage: async (settings) => { sent.push(settings); return { ok: true, message: 'sent' }; },
    readConfig: async () => codec.openTelegramSettings(stored)
  });

  const result = await ipc.handlers.get('telegram:test')({}, { enabled: true, botToken: '', chatId: '42' });
  assert.equal(result.ok, true);
  assert.equal(sent[0].botToken, '123:secret-token', 'the stored token was used for the test send');

  // A renderer-typed token still wins over the stored one.
  await ipc.handlers.get('telegram:test')({}, { enabled: true, botToken: 'typed:token', chatId: '42' });
  assert.equal(sent[1].botToken, 'typed:token');
});
