const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pickNextScheduledTask,
  selectSchedulerRunTasks
} = require('../src/main/scheduler-policy');

test('explicit scheduler command picks the earliest future task', () => {
  const later = { job: { id: 'later' }, dueAt: '2026-06-19T12:00:00.000Z', jobIndex: 0 };
  const next = { job: { id: 'next' }, dueAt: '2026-06-19T00:00:00.000Z', jobIndex: 1 };
  assert.equal(pickNextScheduledTask([later, next]), next);

  const selection = selectSchedulerRunTasks({ futureTasks: [later, next], forceNext: true });
  assert.equal(selection.forced, true);
  assert.equal(selection.tasks.length, 1);
  assert.equal(selection.tasks[0].job.id, 'next');
  assert.equal(selection.tasks[0].reason, 'manual-scheduled');
});

test('automatic scheduler ticks do not run future tasks', () => {
  const futureTask = { job: { id: 'future' }, dueAt: '2026-06-19T00:00:00.000Z' };
  assert.deepEqual(selectSchedulerRunTasks({ futureTasks: [futureTask] }), {
    tasks: [],
    forced: false
  });
});

test('already-due tasks take priority over forcing a future task', () => {
  const dueTask = { job: { id: 'due' }, dueAt: '2026-06-18T00:00:00.000Z' };
  const futureTask = { job: { id: 'future' }, dueAt: '2026-06-19T00:00:00.000Z' };
  const selection = selectSchedulerRunTasks({ dueTasks: [dueTask], futureTasks: [futureTask], forceNext: true });
  assert.equal(selection.forced, false);
  assert.deepEqual(selection.tasks, [dueTask]);
});

test('equal schedule times retain configured job order', () => {
  const first = { job: { id: 'first' }, dueAt: '2026-06-19T00:00:00.000Z', jobIndex: 1 };
  const second = { job: { id: 'second' }, dueAt: '2026-06-19T00:00:00.000Z', jobIndex: 2 };
  assert.equal(pickNextScheduledTask([second, first]), first);
});

// --- M10: warned-schedule-key pruning --------------------------------------

const { pruneWarnedScheduleKeys } = require('../src/main/scheduler-policy');

test('pruneWarnedScheduleKeys drops past-due and malformed keys, keeps future ones', () => {
  const now = 1_000_000;
  const keys = new Set([
    `job-a:${now - 1}`,        // past due -> pruned
    `job-b:${now}`,            // exactly now -> pruned (can never match again)
    `job-c:${now + 60_000}`,   // future -> kept (active dedupe entry)
    'job-d:not-a-number',      // malformed -> pruned
    `job:with:colons:${now + 5_000}` // jobId containing ':' -> parsed via lastIndexOf, kept
  ]);

  pruneWarnedScheduleKeys(keys, now);

  assert.deepEqual([...keys].sort(), [`job-c:${now + 60_000}`, `job:with:colons:${now + 5_000}`].sort());
});

test('pruneWarnedScheduleKeys tolerates a non-Set input', () => {
  assert.equal(pruneWarnedScheduleKeys(null, 1), null);
});
