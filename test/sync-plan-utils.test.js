const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getPlannedSyncActionCounts,
  isNoOpSyncPlan,
  reconcileNoChangeStatus,
  resolveSkipOlderSource
} = require('../src/main/sync-plan-utils');

test('resolveSkipOlderSource forces off for mirror and defaults on otherwise', () => {
  assert.equal(resolveSkipOlderSource('mirror', true), false);
  assert.equal(resolveSkipOlderSource('oneWay', undefined), true);
  assert.equal(resolveSkipOlderSource('oneWay', false), false);
  assert.equal(resolveSkipOlderSource('twoWay', true), true);
});

test('getPlannedSyncActionCounts includes mirror delete candidates', () => {
  const counts = getPlannedSyncActionCounts({ wouldCopy: 2, destinationOnly: 3 }, 'mirror');

  assert.equal(counts.copyOrUpdate, 2);
  assert.equal(counts.deleteCandidates, 3);
  assert.equal(counts.actionable, 5);
});

test('recursive and mirror plans always run so directory-only changes are applied', () => {
  const emptyPlan = { summary: { wouldCopy: 0, destinationOnly: 0, conflicts: 0 } };

  assert.equal(isNoOpSyncPlan(emptyPlan, 'oneWay', { copySubfolders: true }), false);
  assert.equal(isNoOpSyncPlan(emptyPlan, 'mirror', { copySubfolders: false }), false);
});

test('flat one-way plans can skip a truly empty file operation', () => {
  const emptyPlan = { summary: { wouldCopy: 0, destinationOnly: 4, conflicts: 0 } };
  const copyPlan = { summary: { wouldCopy: 1, destinationOnly: 0, conflicts: 0 } };

  assert.equal(isNoOpSyncPlan(emptyPlan, 'oneWay', { copySubfolders: false }), true);
  assert.equal(isNoOpSyncPlan(copyPlan, 'oneWay', { copySubfolders: false }), false);
});

test('reconcileNoChangeStatus downgrades an extras-only one-way run to no-change', () => {
  // Robocopy left destination-only files in place: copied 0, extras 1, exit 2 -> 'success'.
  const interpreted = reconcileNoChangeStatus({
    interpreted: { ok: true, status: 'success', message: 'Robocopy completed without fatal errors.' },
    fileCounts: { copied: 0, skipped: 5, failed: 0, extras: 1 },
    summary: { dirs: { copied: 0, mismatch: 0 }, files: { copied: 0, mismatch: 0 } },
    syncMode: 'oneWay'
  });

  assert.equal(interpreted.ok, true);
  assert.equal(interpreted.status, 'no-change');
});

test('reconcileNoChangeStatus keeps success when real work happened', () => {
  const copiedFiles = reconcileNoChangeStatus({
    interpreted: { ok: true, status: 'success' },
    fileCounts: { copied: 3, skipped: 0, failed: 0, extras: 1 },
    summary: { dirs: { copied: 0 }, files: { copied: 3, mismatch: 0 } },
    syncMode: 'oneWay'
  });
  assert.equal(copiedFiles.status, 'success');

  // Empty-directory-only creation must still count as work (files.copied is 0).
  const dirOnly = reconcileNoChangeStatus({
    interpreted: { ok: true, status: 'success' },
    fileCounts: { copied: 0, skipped: 0, failed: 0, extras: 0 },
    summary: { dirs: { copied: 1, mismatch: 0 }, files: { copied: 0, mismatch: 0 } },
    syncMode: 'oneWay'
  });
  assert.equal(dirOnly.status, 'success');

  // A file/dir name collision (mismatch) is a real signal, not a no-op.
  const mismatch = reconcileNoChangeStatus({
    interpreted: { ok: true, status: 'success' },
    fileCounts: { copied: 0, skipped: 0, failed: 0, extras: 0 },
    summary: { dirs: { copied: 0, mismatch: 0 }, files: { copied: 0, mismatch: 1 } },
    syncMode: 'oneWay'
  });
  assert.equal(mismatch.status, 'success');
});

test('reconcileNoChangeStatus never downgrades mirror runs or failures', () => {
  // Mirror extras are real delete actions.
  const mirror = reconcileNoChangeStatus({
    interpreted: { ok: true, status: 'success' },
    fileCounts: { copied: 0, skipped: 0, failed: 0, extras: 4 },
    summary: { dirs: { copied: 0 }, files: { copied: 0, mismatch: 0 } },
    syncMode: 'mirror'
  });
  assert.equal(mirror.status, 'success');

  // Failures pass through untouched.
  const failed = reconcileNoChangeStatus({
    interpreted: { ok: false, status: 'fatal', message: 'boom' },
    fileCounts: { copied: 0, skipped: 0, failed: 0, extras: 1 },
    summary: {},
    syncMode: 'oneWay'
  });
  assert.equal(failed.status, 'fatal');
  assert.equal(failed.ok, false);
});
