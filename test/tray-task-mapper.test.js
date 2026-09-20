const test = require('node:test');
const assert = require('node:assert/strict');

const { createTrayTaskMapper } = require('../src/main/tray-task-mapper');

// Inject a simple isCancelledRun stub (the real one lives in main.js).
const { scheduledTaskToTrayTask, trayStatusForResult } = createTrayTaskMapper({
  isCancelledRun: (result) => Boolean(result && (result.canceled || String(result.status || '').toLowerCase() === 'cancelled'))
});

test('scheduledTaskToTrayTask maps a scheduled sync task', () => {
  const task = {
    job: { id: 'job1', name: 'Nightly' },
    schedule: { mode: 'sync' },
    dueAt: 123,
    stats: { changes: 4 }
  };
  const tray = scheduledTaskToTrayTask(task, 1, 3);
  assert.equal(tray.id, 'job1');
  assert.equal(tray.name, 'Nightly');
  assert.equal(tray.kind, 'sync');
  assert.equal(tray.label, 'Sync');
  assert.equal(tray.scheduled, true);
  assert.equal(tray.watchTriggered, false);
  assert.equal(tray.queuePosition, 2);
  assert.equal(tray.queueTotal, 3);
  assert.equal(tray.progress.total, 4);
});

test('scheduledTaskToTrayTask marks watch-triggered tasks and zeroes their total', () => {
  const tray = scheduledTaskToTrayTask({ job: { id: 'j', name: 'J' }, schedule: { mode: 'compare' }, reason: 'watch', stats: { changes: 9 } });
  assert.equal(tray.kind, 'compare');
  assert.equal(tray.label, 'Watch compare');
  assert.equal(tray.scheduled, false);
  assert.equal(tray.watchTriggered, true);
  assert.equal(tray.progress.total, 0, 'watch tasks do not report a change total');
});

test('scheduledTaskToTrayTask defaults the name and derives schedule from job when absent', () => {
  const tray = scheduledTaskToTrayTask({ job: {} });
  assert.equal(tray.name, 'Sync job');
  assert.ok(tray.kind === 'sync' || tray.kind === 'compare');
});

test('trayStatusForResult classifies cancelled/conflict/error/warning/success', () => {
  assert.equal(trayStatusForResult({ canceled: true }), 'cancelled');
  assert.equal(trayStatusForResult({ status: 'cancelled' }), 'cancelled');
  assert.equal(trayStatusForResult({ ok: true, status: 'conflicts' }), 'warning');
  assert.equal(trayStatusForResult(null), 'error');
  assert.equal(trayStatusForResult({ ok: false }), 'error');
  assert.equal(trayStatusForResult({ ok: true, warning: true }), 'warning');
  assert.equal(trayStatusForResult({ ok: true }), 'success');
});
