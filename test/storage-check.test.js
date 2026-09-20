const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checkStorageForRequest,
  checkStorageForPlan,
  checkStorageForRestore,
  checkStorageAvailability,
  getDiskSpacePathCandidates,
  ensureTrailingPathSeparator
} = require('../src/main/storage-check');

const onWindows = process.platform === 'win32';
const skipWindowsProbe = { skip: onWindows ? 'shells out to PowerShell on Windows' : false };

test('ensureTrailingPathSeparator appends a separator only when missing', () => {
  assert.equal(ensureTrailingPathSeparator('C:\\Users\\me'), 'C:\\Users\\me\\');
  assert.equal(ensureTrailingPathSeparator('C:\\Users\\me\\'), 'C:\\Users\\me\\');
  assert.equal(ensureTrailingPathSeparator('share/sub/'), 'share/sub/'); // forward slash already terminal
  assert.equal(ensureTrailingPathSeparator('C:'), 'C:\\');
  assert.equal(ensureTrailingPathSeparator(''), '');
  assert.equal(ensureTrailingPathSeparator(null), null);
});

test('getDiskSpacePathCandidates returns empty for blank input', () => {
  assert.deepEqual(getDiskSpacePathCandidates(''), []);
  assert.deepEqual(getDiskSpacePathCandidates('   '), []);
  assert.deepEqual(getDiskSpacePathCandidates(null), []);
});

test('getDiskSpacePathCandidates includes the raw path and de-dupes case-insensitively', () => {
  const candidates = getDiskSpacePathCandidates('C:\\Users\\me\\project');
  assert.ok(candidates.length > 0, 'produces probe candidates');
  assert.ok(candidates.includes('C:\\Users\\me\\project'), 'includes the raw path');

  const lowered = candidates.map((c) => c.toLowerCase());
  assert.equal(new Set(lowered).size, lowered.length, 'no case-insensitive duplicates');
});

test('getDiskSpacePathCandidates expands a bare drive letter with a root variant', () => {
  const candidates = getDiskSpacePathCandidates('D:');
  assert.ok(candidates.includes('D:'), 'keeps the bare drive');
  assert.ok(candidates.includes('D:\\'), 'adds the rooted form');
});

test('checkStorageForRequest blocks when the target path is missing', async () => {
  const result = await checkStorageForRequest({ targetPath: '   ', estimatedWriteBytes: 0, minimumFreeGb: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.checked, false);
  assert.match(result.message, /Target path is required/);
});

test('checkStorageAvailability reports unavailable (non-blocking) off Windows', skipWindowsProbe, async () => {
  const result = await checkStorageAvailability({ pathToCheck: '/tmp', estimatedWriteBytes: 1024, minimumFreeGb: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.checked, false);
  assert.equal(result.enoughSpace, true);
  assert.match(result.message, /only available on Windows/);
  // reserve is still computed and surfaced
  assert.equal(result.minFreeBytes, 1024 ** 3);
  assert.equal(result.estimatedWriteBytes, 1024);
});

test('checkStorageForPlan estimates copy + archive bytes and stays non-blocking off Windows', skipWindowsProbe, async () => {
  const result = await checkStorageForPlan({
    targetPath: '/tmp',
    historyPlan: { summary: { copyBytes: 100, archiveBytes: 50 } },
    historyEnabled: true,
    minimumFreeGb: 2
  });
  assert.equal(result.ok, true);
  assert.equal(result.checked, false);
  assert.equal(result.estimatedWriteBytes, 150);

  const noHistory = await checkStorageForPlan({
    targetPath: '/tmp',
    historyPlan: { summary: { copyBytes: 100, archiveBytes: 50 } },
    historyEnabled: false,
    minimumFreeGb: 2
  });
  assert.equal(noHistory.estimatedWriteBytes, 100, 'archive bytes excluded when history disabled');
});

test('checkStorageForRestore aggregates per-destination checks (non-blocking off Windows)', skipWindowsProbe, async () => {
  const result = await checkStorageForRestore({
    targetPath: '/tmp/target',
    destinationRoot: '/tmp/dest',
    destinationMode: 'other',
    restoreBytes: 200,
    archiveBytes: 100,
    minimumFreeGb: 1
  });
  assert.equal(result.ok, true);
  assert.equal(result.destinationMode, 'other');
  assert.ok(Array.isArray(result.checks) && result.checks.length >= 1);
  assert.equal(result.checked, false, 'unchecked off Windows so never blocks');
});
