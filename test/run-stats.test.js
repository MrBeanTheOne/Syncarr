const test = require('node:test');
const assert = require('node:assert/strict');

const { extractRunStats } = require('../src/main/run-stats');

test('extractRunStats normalizes Robocopy mirror results', () => {
  const stats = extractRunStats({
    job: { syncMode: 'mirror' },
    result: {
      syncMode: 'mirror',
      summary: { files: { copied: 7, skipped: 2, failed: 1, extras: 4 }, bytes: { copied: 8192 } },
      history: { archived: 4 }
    },
    dryRun: false
  });
  assert.deepEqual(
    { copied: stats.copied, deleted: stats.deleted, skipped: stats.skipped, failed: stats.failed, archived: stats.archived, copyBytes: stats.copyBytes },
    { copied: 7, deleted: 4, skipped: 2, failed: 1, archived: 4, copyBytes: 8192 }
  );
});

test('extractRunStats normalizes flat two-way results', () => {
  const stats = extractRunStats({
    result: {
      syncMode: 'twoWay',
      summary: { copyToDest: 3, copyToSource: 2, deleteOnDest: 1, deleteOnSource: 2, errors: 1, copyBytes: 4096 },
      history: { archived: 3, archiveBytes: 1024 }
    },
    dryRun: false
  });
  assert.equal(stats.copied, 5);
  assert.equal(stats.deleted, 3);
  assert.equal(stats.failed, 1);
  assert.equal(stats.copyBytes, 4096);
  assert.equal(stats.archiveBytes, 1024);
});

test('extractRunStats includes mirror deletes in compare actions', () => {
  const stats = extractRunStats({
    result: { syncMode: 'mirror', history: { wouldCopy: 10, destinationOnly: 3, conflicts: 1 } },
    dryRun: true
  });
  assert.equal(stats.plannedCopies, 10);
  assert.equal(stats.plannedDeletes, 3);
  assert.equal(stats.plannedActions, 13);
  assert.equal(stats.conflicts, 1);
});
