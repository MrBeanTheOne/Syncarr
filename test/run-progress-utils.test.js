const test = require('node:test');
const assert = require('node:assert/strict');

// Browser IIFE attaching to window; shim before require (see renderer-utils.test.js).
global.window = global.window || {};
require('../src/renderer/run-progress-utils.js');
const {
  configure,
  getProgressVisualAction,
  getProgressActionStatus,
  getProgressFileLine,
  getProgressCompletedCount
} = global.window.SyncarrRunProgress;

// The default mirror predicate treats only the literal 'mirror' mode as mirror.
test('getProgressVisualAction maps each kind to a visual token', () => {
  assert.equal(getProgressVisualAction({ kind: 'cancelled' }), 'warning');
  assert.equal(getProgressVisualAction({ kind: 'failed' }), 'error');
  assert.equal(getProgressVisualAction({ kind: 'deleted' }), 'delete');
  assert.equal(getProgressVisualAction({ kind: 'skipped' }), 'skip');
  assert.equal(getProgressVisualAction({ kind: 'copied', label: 'new file' }), 'copy');
  assert.equal(getProgressVisualAction({ kind: 'copied', label: 'changed file' }), 'replace');
  assert.equal(getProgressVisualAction({ kind: 'scanning' }, 'sync', true), 'scan');
  assert.equal(getProgressVisualAction({ kind: 'scanning' }, 'sync', false), 'active');
});

test('getProgressVisualAction: extra is delete in mirror, warning otherwise', () => {
  assert.equal(getProgressVisualAction({ kind: 'extra' }, 'mirror'), 'delete');
  assert.equal(getProgressVisualAction({ kind: 'extra' }, 'sync'), 'warning');
});

test('getProgressActionStatus produces human status lines per kind/mode', () => {
  assert.equal(getProgressActionStatus({ kind: 'phase', latestText: 'Scanning…' }), 'Scanning…');
  assert.equal(getProgressActionStatus({ kind: 'failed' }), 'Handling file issue…');
  assert.equal(getProgressActionStatus({ kind: 'copied', label: 'new' }), 'Copying new file…');
  assert.equal(getProgressActionStatus({ kind: 'copied', label: 'changed' }), 'Replacing changed file…');
  assert.equal(getProgressActionStatus({ kind: 'skipped', label: 'older copy' }), 'Skipping older source file…');
  assert.equal(getProgressActionStatus({ kind: 'extra' }, 'mirror', true), 'Found delete candidate…');
  assert.equal(getProgressActionStatus({ kind: 'extra' }, 'sync', true), 'Found destination-only file…');
  assert.equal(getProgressActionStatus({ kind: 'extra' }, 'mirror', false), 'Deleting destination-only file…');
});

test('getProgressFileLine appends the file path to the de-ellipsised action', () => {
  assert.equal(getProgressFileLine({ kind: 'copied', label: 'new', latestFile: 'a/b.txt' }), 'Copying new file: a/b.txt');
  // With no file, the de-ellipsised action is returned as-is.
  assert.equal(getProgressFileLine({ kind: 'copied', label: 'new' }), 'Copying new file');
});

test('getProgressCompletedCount counts extras only in mirror mode', () => {
  assert.equal(getProgressCompletedCount({ copied: 3, extra: 2, failed: 1 }, 'sync'), 4);
  assert.equal(getProgressCompletedCount({ copied: 3, extra: 2, failed: 1 }, 'mirror'), 6);
});

test('configure swaps the injected isMirrorMode predicate', () => {
  configure({ isMirrorMode: (mode) => mode === 'two-way' });
  assert.equal(getProgressCompletedCount({ copied: 1, extra: 5, failed: 0 }, 'two-way'), 6);
  configure({ isMirrorMode: (mode) => String(mode || '').toLowerCase() === 'mirror' }); // restore default
});
