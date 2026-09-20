const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeConfig } = require('../src/main/job-model');
const { createBackgroundScheduler } = require('../src/main/background-scheduler');

function makeHarness() {
  const currentTime = new Date('2026-06-18T12:00:00.000Z');
  let config = normalizeConfig({
    activeJobId: 'job-later',
    jobs: [
      {
        id: 'job-later',
        name: 'Later job',
        sourcePath: 'C:\\Source',
        targetPath: 'D:\\Later',
        schedule: { enabled: true, mode: 'compare', frequency: 'daily', time: '23:00', nextRunAt: '2026-06-18T23:00:00.000Z' }
      },
      {
        id: 'job-next',
        name: 'Next job',
        sourcePath: 'C:\\Source',
        targetPath: 'D:\\Next',
        schedule: { enabled: true, mode: 'sync', frequency: 'daily', time: '18:00', nextRunAt: '2026-06-18T18:00:00.000Z' }
      }
    ]
  });
  const runs = [];
  const states = [];
  const scheduler = createBackgroundScheduler({
    readConfig: async () => config,
    writeConfig: async (next) => {
      config = normalizeConfig(next);
      return config;
    },
    runJob: async (task) => {
      runs.push(task);
      task.onEvent({ type: 'progress', progress: { copied: 1 } });
      return { ok: true, status: 'success', message: 'Complete', code: 1 };
    },
    onState: (state) => states.push(state),
    now: () => new Date(currentTime)
  });
  return { scheduler, runs, states, getConfig: () => config };
}

test('automatic background tick leaves future schedules untouched', async () => {
  const harness = makeHarness();
  const result = await harness.scheduler.tick();
  assert.equal(result.tasksRun, 0);
  assert.equal(harness.runs.length, 0);
  assert.equal(harness.states.at(-1).type, 'queue');
  assert.equal(harness.states.at(-1).tasks.length, 2);
});

test('start() surfaces a throwing tick as an error state instead of swallowing it', async () => {
  const states = [];
  let intervalCb = null;
  const scheduler = createBackgroundScheduler({
    readConfig: async () => { throw new Error('config is locked'); },
    writeConfig: async (c) => c,
    runJob: async () => ({ ok: true }),
    onState: (s) => states.push(s),
    now: () => new Date('2026-06-18T12:00:00.000Z'),
    setIntervalFn: (fn) => { intervalCb = fn; return 1; },
    clearIntervalFn: () => {},
    setTimeoutFn: () => 2, // suppress the initial-delay tick for a deterministic run
    clearTimeoutFn: () => {}
  });

  scheduler.start();
  await intervalCb(); // fire one interval tick; readConfig throws inside tick()

  assert.ok(
    states.some((s) => s.type === 'error' && /config is locked/.test(s.message)),
    'a scheduler failure must be reported, not silently swallowed'
  );
});

test('runNext executes the earliest future schedule without a renderer', async () => {
  const harness = makeHarness();
  const result = await harness.scheduler.runNext();
  assert.equal(result.forced, true);
  assert.equal(result.tasksRun, 1);
  assert.equal(harness.runs[0].job.id, 'job-next');
  assert.equal(harness.runs[0].reason, 'manual-scheduled');
  assert.equal(harness.states.some((state) => state.type === 'event'), true);

  const savedJob = harness.getConfig().jobs.find((job) => job.id === 'job-next');
  assert.equal(savedJob.schedule.lastRun.reason, 'manual-scheduled');
  assert.equal(savedJob.schedule.lastRun.action, 'sync');
  // The daily 18:00 job re-arms for its next local-time occurrence. Assert on
  // local clock fields so the test is timezone-independent (the prior hard-coded
  // UTC value only held on a UTC-4 host).
  const nextRun = new Date(savedJob.schedule.nextRunAt);
  assert.equal(nextRun.getHours(), 18);
  assert.equal(nextRun.getMinutes(), 0);
  assert.ok(nextRun.getTime() > Date.parse('2026-06-18T12:00:00.000Z'));
});

test('running task keeps other pending schedules in the tray queue (no disappear/reappear)', async () => {
  const harness = makeHarness();
  await harness.scheduler.runNext(); // forces the 18:00 job-next to run

  const startState = harness.states.find((state) => state.type === 'start');
  assert.ok(startState, 'a start state is emitted');
  const startQueueIds = startState.queue.map((task) => task.job.id);
  assert.deepEqual(startQueueIds, ['job-later'], 'the still-pending future job stays in the start queue');

  const completeState = harness.states.find((state) => state.type === 'complete');
  assert.ok(completeState, 'a complete state is emitted');
  assert.deepEqual(
    completeState.queue.map((task) => task.job.id),
    ['job-later'],
    'the future job is still pending while the run completes'
  );

  // The running job itself must never appear in its own pending queue.
  assert.equal(startQueueIds.includes('job-next'), false);
});

test('background scheduler refuses to overlap an active operation', async () => {
  const harness = makeHarness();
  const scheduler = createBackgroundScheduler({
    readConfig: async () => harness.getConfig(),
    writeConfig: async (next) => next,
    runJob: async () => ({ ok: true }),
    isBusy: () => true
  });
  assert.deepEqual(await scheduler.runNext(), { ok: false, status: 'busy', tasksRun: 0 });
});

test('paused scheduler holds automatic work but still permits an explicit run', async () => {
  const harness = makeHarness();
  const pausedConfig = harness.getConfig();
  pausedConfig.backgroundSettings.schedulerPaused = true;

  const automatic = await harness.scheduler.tick();
  assert.equal(automatic.status, 'paused');
  assert.equal(automatic.tasksRun, 0);
  assert.equal(harness.runs.length, 0);
  assert.equal(harness.states.at(-1).type, 'paused');

  const manual = await harness.scheduler.runNext();
  assert.equal(manual.tasksRun, 1);
  assert.equal(harness.runs[0].job.id, 'job-next');
});
