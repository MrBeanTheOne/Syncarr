const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { buildSourceSyncRoots } = require('../src/main/source-sync-roots');

test('a single source copies directly into the target (no subfolder, no prefix)', () => {
  const roots = buildSourceSyncRoots({ sourcePaths: ['C:\\data\\photos'], targetPath: 'N:\\backup' });
  assert.equal(roots.length, 1);
  assert.equal(roots[0].destinationPath, 'N:\\backup');
  assert.equal(roots[0].relativePrefix, '');
  assert.equal(roots[0].index, 0);
});

test('multiple sources each get their own labelled subfolder + prefix', () => {
  const roots = buildSourceSyncRoots({
    sourcePaths: ['C:\\data\\photos', 'C:\\data\\music'],
    targetPath: 'N:\\backup'
  });
  assert.equal(roots.length, 2);
  assert.equal(roots[0].label, 'photos');
  assert.equal(roots[0].destinationPath, path.join('N:\\backup', 'photos'));
  assert.equal(roots[0].relativePrefix, 'photos');
  assert.equal(roots[1].label, 'music');
  assert.equal(roots[1].relativePrefix, 'music');
});

test('colleagues with the same basename get deduped labels', () => {
  const roots = buildSourceSyncRoots({
    sourcePaths: ['C:\\a\\reports', 'D:\\b\\reports'],
    targetPath: 'N:\\backup'
  });
  assert.equal(roots.length, 2);
  assert.notEqual(roots[0].label, roots[1].label, 'duplicate basenames must be made unique');
  assert.equal(roots[0].label, 'reports');
});
