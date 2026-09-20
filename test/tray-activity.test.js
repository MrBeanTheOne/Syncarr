const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createInitialTrayActivity,
  mergeTrayActivity,
  normalizeProgress,
  getScheduledConflictWarnings,
  getTrayVisualState
} = require('../src/main/tray-activity');

test('tray activity merges partial active progress without losing queue state', () => {
  const now = new Date('2026-06-18T12:00:00.000Z');
  const initial = mergeTrayActivity(createInitialTrayActivity(now), {
    status: 'running',
    active: {
      id: 'job-a',
      name: 'Photos',
      kind: 'sync',
      progress: { copied: 2, total: 10, percent: 20 }
    },
    queue: [{ id: 'job-b', name: 'Music', kind: 'compare', dueAt: now }]
  }, now);

  const updated = mergeTrayActivity(initial, {
    active: { progress: { copied: 5, percent: 50, label: 'Copying files' } }
  }, new Date('2026-06-18T12:00:05.000Z'));

  assert.equal(updated.active.name, 'Photos');
  assert.equal(updated.active.progress.copied, 5);
  assert.equal(updated.active.progress.total, 10);
  assert.equal(updated.active.progress.percent, 50);
  assert.equal(updated.queue.length, 1);
  assert.equal(updated.queue[0].name, 'Music');
});

test('tray activity preserves scheduler pause state across unrelated updates', () => {
  const paused = mergeTrayActivity(createInitialTrayActivity(), { schedulerPaused: true });
  const updated = mergeTrayActivity(paused, { queue: [{ name: 'Later job' }] });
  assert.equal(updated.schedulerPaused, true);
});

test('scheduled conflict warnings are derived from persisted schedule results', () => {
  const warnings = getScheduledConflictWarnings([{
    job: { id: 'job-a', name: 'Photos' },
    schedule: { lastRun: { status: 'conflicts', message: 'Skipped due to conflicts.', at: '2026-06-18T12:00:00.000Z' } }
  }, {
    job: { id: 'job-b', name: 'Music' },
    schedule: { lastRun: { status: 'success' } }
  }]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].name, 'Photos');
  assert.equal(warnings[0].message, 'Skipped due to conflicts.');
});

test('acknowledged scheduled conflicts no longer produce tray warnings', () => {
  const warnings = getScheduledConflictWarnings([{
    job: { id: 'job-a', name: 'Photos' },
    schedule: { lastRun: { status: 'conflicts', conflictAcknowledgedAt: '2026-06-18T12:05:00.000Z' } }
  }]);
  assert.deepEqual(warnings, []);
});

test('a newer successful compare acknowledges an older scheduled conflict', () => {
  const tasks = [{
    job: { id: 'job-a', name: 'Photos' },
    schedule: { lastRun: { status: 'conflicts', at: '2026-06-18T12:00:00.000Z' } }
  }];
  const recentRuns = [{ jobId: 'job-a', dryRun: true, ok: true, at: '2026-06-18T12:05:00.000Z' }];
  assert.deepEqual(getScheduledConflictWarnings(tasks, recentRuns), []);
});

test('tray activity normalizes unsafe progress and limits queue size', () => {
  const progress = normalizeProgress({ percent: 140, copied: -2, failed: '3', file: '  folder/file.txt  ' });
  assert.equal(progress.percent, 100);
  assert.equal(progress.copied, 0);
  assert.equal(progress.failed, 3);
  assert.equal(progress.file, 'folder/file.txt');
  assert.equal(normalizeProgress({ percent: null }).percent, null);
  assert.equal(normalizeProgress({ percent: null }).indeterminate, true);

  const activity = mergeTrayActivity(null, {
    status: 'not-a-status',
    queue: Array.from({ length: 20 }, (_, index) => ({ name: `Job ${index + 1}` }))
  });
  assert.equal(activity.status, 'idle');
  assert.equal(activity.queue.length, 12);
});

test('tray visual state maps activity status to available icon states', () => {
  assert.equal(getTrayVisualState({ status: 'running' }), 'syncing');
  assert.equal(getTrayVisualState({ status: 'cancelled' }), 'warning');
  assert.equal(getTrayVisualState({ status: 'error' }), 'error');
  assert.equal(getTrayVisualState({ status: 'unknown' }), 'idle');
});
