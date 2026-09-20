const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { getRunTrigger, makeJournalJobSnapshot, buildOneWayJournalOperations } = require('../src/main/run-journal-operations');

test('getRunTrigger maps request flags to a trigger label', () => {
  assert.equal(getRunTrigger({ recoveryResume: true }), 'recovery-resume');
  assert.equal(getRunTrigger({ backgroundWatched: true }), 'smart-watcher');
  assert.equal(getRunTrigger({ backgroundScheduled: true }), 'scheduled');
  assert.equal(getRunTrigger({}), 'manual');
  assert.equal(getRunTrigger(null), 'manual');
});

test('makeJournalJobSnapshot prefers normalized fields and forces dryRun/enabled', () => {
  const snap = makeJournalJobSnapshot(
    { id: 'raw', name: 'Raw', extra: 'keep', dryRun: true, enabled: false },
    { jobId: 'norm', jobName: 'Norm', sourcePaths: ['s'], targetDestinations: ['d'] }
  );
  assert.equal(snap.id, 'norm');
  assert.equal(snap.name, 'Norm');
  assert.deepEqual(snap.sourcePaths, ['s']);
  assert.deepEqual(snap.targetDestinations, ['d']);
  assert.equal(snap.extra, 'keep', 'unrelated request fields are preserved');
  assert.equal(snap.dryRun, false);
  assert.equal(snap.enabled, true);
});

test('buildOneWayJournalOperations classifies archive/delete/new operations', () => {
  const historyPlan = {
    summary: { enabled: true },
    destinationPlans: [
      {
        destination: { path: 'N:\\backup' },
        sourceRoots: [{ sourcePath: 'C:\\data', relativePrefix: '' }],
        plan: {
          archiveFiles: [
            { relativePath: 'docs\\a.txt', sourcePath: 'C:\\data\\docs\\a.txt', targetPath: 'N:\\backup\\docs\\a.txt', previous: { size: 1 }, source: { size: 2 } },
            { relativePath: 'old.txt', targetPath: 'N:\\backup\\old.txt', previous: { size: 5 }, reason: 'mirror-delete-candidate' }
          ],
          newFiles: [
            { relativePath: 'new.txt', source: { size: 3 } }
          ]
        }
      }
    ]
  };

  const ops = buildOneWayJournalOperations(historyPlan);
  assert.equal(ops.length, 3);

  const overwrite = ops[0];
  assert.equal(overwrite.id, 'destination-1-archive-1');
  assert.equal(overwrite.action, 'overwrite');
  assert.equal(overwrite.relativePath, 'docs/a.txt');
  assert.deepEqual(overwrite.before, { size: 1 });
  assert.deepEqual(overwrite.expectedAfter, { size: 2 });
  assert.equal(overwrite.recoverable, true);

  const del = ops[1];
  assert.equal(del.id, 'destination-1-archive-2');
  assert.equal(del.action, 'mirror-delete');
  assert.equal(del.sourcePath, null);
  assert.equal(del.expectedAfter, null);

  const created = ops[2];
  assert.equal(created.id, 'destination-1-new-1');
  assert.equal(created.action, 'copy-new');
  assert.equal(created.relativePath, 'new.txt');
  assert.equal(created.sourcePath, path.join('C:\\data', 'new.txt'));
  assert.equal(created.targetPath, path.join('N:\\backup', 'new.txt'));
  assert.deepEqual(created.expectedAfter, { size: 3 });
});

test('buildOneWayJournalOperations marks overwrites unrecoverable when history is disabled', () => {
  const ops = buildOneWayJournalOperations({
    summary: { enabled: false },
    destinationPlans: [
      {
        destination: { path: 'N:\\b' },
        sourceRoots: [],
        plan: { archiveFiles: [{ relativePath: 'x.txt', sourcePath: 'C:\\x.txt', targetPath: 'N:\\b\\x.txt', source: { size: 1 } }], newFiles: [] }
      }
    ]
  });
  assert.equal(ops[0].recoverable, false);
});
