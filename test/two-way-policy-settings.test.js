const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeJob,
  normalizeTwoWayConflictPolicy,
  makeCompareFingerprint
} = require('../src/main/job-model');

test('two-way conflict policy defaults to newest and accepts every supported choice', () => {
  assert.equal(normalizeJob({ syncMode: 'twoWay' }).twoWayConflictPolicy, 'newer');
  assert.equal(normalizeTwoWayConflictPolicy('newer'), 'newer');
  assert.equal(normalizeTwoWayConflictPolicy('source'), 'source');
  assert.equal(normalizeTwoWayConflictPolicy('dest'), 'dest');
  assert.equal(normalizeTwoWayConflictPolicy('keepBoth'), 'keepBoth');
  assert.equal(normalizeTwoWayConflictPolicy('unexpected'), 'newer');
});

test('changing two-way precedence invalidates a saved compare fingerprint', () => {
  const job = {
    syncMode: 'twoWay',
    sourcePaths: ['C:\\Source'],
    targetDestinations: [{ path: 'D:\\Target', required: true }]
  };
  const sourceWins = makeCompareFingerprint({ ...job, twoWayConflictPolicy: 'source' });
  const destinationWins = makeCompareFingerprint({ ...job, twoWayConflictPolicy: 'dest' });
  assert.notEqual(sourceWins, destinationWins);
});
