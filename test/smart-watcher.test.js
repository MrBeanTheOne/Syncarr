const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeConfig, normalizeWatchSettings } = require('../src/main/job-model');
const { createSmartWatcher, makeWatchExcludeMatcher } = require('../src/main/smart-watcher');

function createTimerHarness() {
  let time = 0;
  let nextId = 1;
  const timers = new Map();

  function setTimeoutFn(callback, delay) {
    const id = nextId++;
    timers.set(id, { callback, due: time + Number(delay || 0) });
    return id;
  }

  function clearTimeoutFn(id) {
    timers.delete(id);
  }

  async function advance(ms) {
    time += ms;
    let ran = true;
    while (ran) {
      ran = false;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.due <= time)
        .sort((a, b) => a[1].due - b[1].due);
      if (due.length) {
        const [id, timer] = due[0];
        timers.delete(id);
        timer.callback();
        ran = true;
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  return {
    now: () => new Date(time),
    setTimeoutFn,
    clearTimeoutFn,
    advance,
    pendingCount: () => timers.size
  };
}

function createHarness({ busy = false, watchError = null } = {}) {
  const timers = createTimerHarness();
  const watchCallbacks = new Map();
  const handles = [];
  const runs = [];
  const states = [];
  let isBusy = busy;
  const config = normalizeConfig({
    jobs: [{
      id: 'watched-job',
      name: 'Watched job',
      sourcePath: 'C:\\Source',
      sourcePaths: ['C:\\Source'],
      targetPath: 'D:\\Target',
      excludePatterns: ['.git', '*.tmp', '.syncarr-history'],
      watch: { enabled: true, mode: 'compare', settleSeconds: 2, maxWaitSeconds: 5 }
    }]
  });

  const watcher = createSmartWatcher({
    readConfig: async () => config,
    runJob: async (task) => {
      runs.push(task);
      task.onEvent({ type: 'progress', progress: { copied: 1 } });
      return { ok: true, status: 'success', code: 1, message: 'Watched run complete.' };
    },
    isBusy: () => isBusy,
    onState: (state) => states.push(state),
    watchFn: (sourcePath, options, callback) => {
      if (watchError) throw watchError;
      watchCallbacks.set(sourcePath, callback);
      const handle = {
        closed: false,
        close() { this.closed = true; },
        on() { return this; }
      };
      handles.push({ sourcePath, options, handle });
      return handle;
    },
    now: timers.now,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    busyRetryMs: 100,
    refreshRetryMs: 500
  });

  return {
    watcher,
    timers,
    runs,
    states,
    handles,
    emit: (eventType, filename) => watchCallbacks.get('C:\\Source')(eventType, filename),
    setBusy: (value) => { isBusy = value; }
  };
}

test('normalizeWatchSettings defaults safely and clamps timing', () => {
  assert.deepEqual(normalizeWatchSettings(), {
    enabled: false,
    mode: 'compare',
    settleSeconds: 10,
    maxWaitSeconds: 120
  });
  assert.deepEqual(normalizeWatchSettings({ enabled: true, mode: 'sync', settleSeconds: 1, maxWaitSeconds: 1 }), {
    enabled: true,
    mode: 'sync',
    settleSeconds: 2,
    maxWaitSeconds: 2
  });
});

test('watch exclude matcher handles directory, wildcard, and path rules', () => {
  const excluded = makeWatchExcludeMatcher(['.git', '*.tmp', 'cache/render']);
  assert.equal(excluded('.git/index'), true);
  assert.equal(excluded('draft.tmp'), true);
  assert.equal(excluded('cache/render/frame.png'), true);
  assert.equal(excluded('music/final.wav'), false);
});

test('smart watcher debounces changes and emits a compare task', async () => {
  const harness = createHarness();
  await harness.watcher.start();
  assert.equal(harness.handles.length, 1);
  assert.equal(harness.handles[0].options.recursive, true);

  harness.emit('change', 'song.wav');
  await harness.timers.advance(1999);
  assert.equal(harness.runs.length, 0);
  await harness.timers.advance(1);

  assert.equal(harness.runs.length, 1);
  assert.equal(harness.runs[0].watch.mode, 'compare');
  assert.equal(harness.runs[0].reason, 'watch');
  assert.equal(harness.runs[0].changes.count, 1);
  assert.equal(harness.states.some((state) => state.type === 'start'), true);
  assert.equal(harness.states.some((state) => state.type === 'complete'), true);
});

test('smart watcher ignores excluded changes', async () => {
  const harness = createHarness();
  await harness.watcher.start();
  harness.emit('change', '.git\\index');
  harness.emit('rename', 'scratch.tmp');
  await harness.timers.advance(5000);
  assert.equal(harness.runs.length, 0);
});

test('smart watcher waits for active work and retries when idle', async () => {
  const harness = createHarness({ busy: true });
  await harness.watcher.start();
  harness.emit('change', 'song.wav');
  await harness.timers.advance(2000);
  assert.equal(harness.runs.length, 0);
  assert.equal(harness.states.some((state) => state.type === 'waiting'), true);

  harness.setBusy(false);
  await harness.timers.advance(100);
  assert.equal(harness.runs.length, 1);
});

test('busy retry stays delayed after the max-wait deadline', async () => {
  const harness = createHarness({ busy: true });
  await harness.watcher.start();
  harness.emit('change', 'song.wav');

  await harness.timers.advance(5000);
  assert.equal(harness.runs.length, 0);
  assert.equal(harness.timers.pendingCount(), 1);

  harness.setBusy(false);
  await harness.timers.advance(100);
  assert.equal(harness.runs.length, 1);
});

test('a watched run defers at max-wait if the source is still active, then fires once it settles', async () => {
  const harness = createHarness(); // settle 2s, max-wait 5s
  await harness.watcher.start();
  harness.emit('change', 'take-1.wav');
  await harness.timers.advance(1500);
  harness.emit('change', 'take-2.wav');
  await harness.timers.advance(1500);
  harness.emit('change', 'take-3.wav');
  await harness.timers.advance(1500);
  harness.emit('change', 'take-4.wav');
  await harness.timers.advance(500); // t=5000: max-wait reached, but a change landed 500ms ago (< settle)

  // Must NOT fire mid-write — the last change was 500ms ago, well inside the 2s
  // settle window, so the run defers a quiescence tail instead of syncing a
  // half-written tree.
  assert.equal(harness.runs.length, 0, 'does not sync while the source is still being written');

  // Once the source goes quiet for a full settle window it fires exactly once,
  // batching all four changes.
  await harness.timers.advance(2000);
  assert.equal(harness.runs.length, 1);
  assert.equal(harness.runs[0].changes.count, 4);
});

test('a source that never quiesces still fires within the extension ceiling (anti-starvation)', async () => {
  const harness = createHarness(); // settle 2s, max-wait 5s, ceiling 6 extensions
  await harness.watcher.start();
  // Emit a change every second (faster than the 2s settle) for well past
  // max-wait + 6*settle. The source never goes quiet, so the run can never wait
  // for true quiescence — the extension ceiling must force it to fire anyway.
  for (let i = 0; i < 30; i += 1) {
    harness.emit('change', `frame-${i}.dat`);
    await harness.timers.advance(1000);
  }
  assert.ok(harness.runs.length >= 1, 'bounded postponement: a never-quiet source is not deferred forever');
});

test('refresh and stop close native watcher handles', async () => {
  const harness = createHarness();
  await harness.watcher.start();
  const first = harness.handles[0].handle;
  await harness.watcher.refresh();
  assert.equal(first.closed, true);
  const second = harness.handles[1].handle;
  harness.watcher.stop();
  assert.equal(second.closed, true);
  assert.equal(harness.timers.pendingCount(), 0);
});

test('refresh keeps already-queued source changes', async () => {
  const harness = createHarness();
  await harness.watcher.start();
  harness.emit('change', 'song.wav');
  await harness.timers.advance(1000);

  await harness.watcher.refresh();
  await harness.timers.advance(999);
  assert.equal(harness.runs.length, 0);
  await harness.timers.advance(1);
  assert.equal(harness.runs.length, 1);
});

test('attemptRun claims the busy lock before awaiting config (no concurrent launch)', async () => {
  const timers = createTimerHarness();
  let releaseConfig;
  const gate = new Promise((resolve) => { releaseConfig = resolve; });
  let gateActive = false; // start()/refresh() read config freely; only attemptRun waits on the gate
  const runs = [];
  const watchCallbacks = new Map();
  const config = normalizeConfig({
    jobs: [{
      id: 'watched-job',
      name: 'Watched job',
      sourcePath: 'C:\\Source',
      sourcePaths: ['C:\\Source'],
      targetPath: 'D:\\Target',
      excludePatterns: ['.syncarr-history'],
      watch: { enabled: true, mode: 'compare', settleSeconds: 2, maxWaitSeconds: 5 }
    }]
  });

  const watcher = createSmartWatcher({
    readConfig: async () => { if (gateActive) await gate; return config; }, // attemptRun waits until released
    runJob: async (task) => { runs.push(task); return { ok: true, status: 'success', code: 1 }; },
    isBusy: () => false,
    onState: () => {},
    watchFn: (sourcePath, options, callback) => {
      watchCallbacks.set(sourcePath, callback);
      return { close() {}, on() { return this; } };
    },
    now: timers.now,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    busyRetryMs: 100,
    refreshRetryMs: 500
  });

  await watcher.start();
  gateActive = true;
  watchCallbacks.get('C:\\Source')('change', 'song.wav');
  await timers.advance(2000); // fire settle timer -> attemptRun begins, blocks on the config gate

  // The lock must be claimed synchronously before `await readConfig()`, so a
  // scheduler tick during the await sees this watcher as busy and backs off.
  assert.equal(watcher.getStatus().jobs[0].running, true, 'run lock claimed before config resolved');
  assert.equal(runs.length, 0, 'the job has not started — still awaiting config');

  releaseConfig();
  await timers.advance(1);
  assert.equal(runs.length, 1);
  assert.equal(watcher.getStatus().jobs[0].running, false, 'lock released after the run finishes');
  watcher.stop();
});

test('status snapshot reports pending and unavailable sources', async () => {
  const harness = createHarness();
  await harness.watcher.start();
  harness.emit('change', 'song.wav');
  const pendingStatus = harness.watcher.getStatus();
  assert.equal(pendingStatus.watchedSources, 1);
  assert.equal(pendingStatus.jobs[0].pendingChanges, 1);
  harness.watcher.stop();

  const unavailable = createHarness({ watchError: new Error('Source offline') });
  const unavailableStatus = await unavailable.watcher.start();
  assert.equal(unavailableStatus.watchedSources, 0);
  assert.equal(unavailableStatus.unavailableSources, 1);
  assert.equal(unavailableStatus.jobs[0].unavailableSources, 1);
  unavailable.watcher.stop();
});
