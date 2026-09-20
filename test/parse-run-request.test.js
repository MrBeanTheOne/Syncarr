'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  parseRunRequest,
  normalizeSourcePaths,
  normalizeTargetDestinations,
  sanitizeJobId,
  sanitizeHistoryFolderName,
  normalizeTwoWayConflictPolicy,
  withHistoryExclude
} = require('../src/main/job-model');

// parseRunRequest is the de-duplicated prologue shared by runCompareOnly,
// executeSyncRun, runTwoWaySyncRun, and buildSyncPreview. Lock it to the exact
// per-field normalizers it replaced so the extraction stays behavior-preserving.
test('parseRunRequest matches the individual job-model normalizers field-for-field', () => {
  const request = {
    id: 'My Job!!',
    name: '  Music to NAS  ',
    sourcePath: 'C:/fallback',
    sourcePaths: ['C:/a', 'C:/a', 'C:/b'],
    targetPath: 'C:/dest',
    targetDestinations: [{ path: 'C:/dest', required: true }],
    historyFolderName: '.custom-history',
    twoWayConflictPolicy: 'source',
    excludePatterns: ['logs', '*.tmp']
  };

  const out = parseRunRequest(request);
  const expectedHistory = sanitizeHistoryFolderName(request.historyFolderName);

  assert.equal(out.jobId, sanitizeJobId(request.id));
  assert.equal(out.jobName, String(request.name || '').trim());
  assert.deepEqual(out.cleanSourcePaths, normalizeSourcePaths(request.sourcePaths));
  assert.deepEqual(out.cleanDestinations, normalizeTargetDestinations(request.targetDestinations, request.targetPath));
  assert.equal(out.cleanHistoryFolderName, expectedHistory);
  assert.equal(out.cleanTwoWayConflictPolicy, normalizeTwoWayConflictPolicy(request.twoWayConflictPolicy));
  assert.deepEqual(
    out.cleanExcludePatterns,
    withHistoryExclude(Array.isArray(request.excludePatterns) ? request.excludePatterns : [], expectedHistory)
  );
});

test('parseRunRequest falls back from empty sourcePaths to sourcePath', () => {
  const out = parseRunRequest({ sourcePath: 'C:/only' });
  assert.deepEqual(out.cleanSourcePaths, normalizeSourcePaths('C:/only'));
});

test('parseRunRequest tolerates a missing/empty request', () => {
  for (const input of [undefined, null, {}, 'nonsense']) {
    const out = parseRunRequest(input);
    assert.deepEqual(out.cleanSourcePaths, []);
    assert.deepEqual(out.cleanDestinations, []);
    assert.equal(out.jobName, '');
    assert.equal(out.cleanTwoWayConflictPolicy, normalizeTwoWayConflictPolicy(undefined));
    assert.ok(Array.isArray(out.cleanExcludePatterns));
  }
});
