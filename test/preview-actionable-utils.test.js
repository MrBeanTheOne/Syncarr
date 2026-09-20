const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global.window || {};
require('../src/renderer/preview-actionable-utils.js');
const { previewHasActionableWork } = global.window.SyncarrPreviewActionable;

test('no summary -> treated as actionable (preserves prior behavior)', () => {
  assert.equal(previewHasActionableWork(null, 'oneWay'), true);
  assert.equal(previewHasActionableWork(undefined, 'mirror'), true);
});

test('one-way counts wouldCopy + conflicts, ignores destination-only', () => {
  assert.equal(previewHasActionableWork({ wouldCopy: 0, conflicts: 0, destinationOnly: 5 }, 'oneWay'), false);
  assert.equal(previewHasActionableWork({ wouldCopy: 2 }, 'oneWay'), true);
  assert.equal(previewHasActionableWork({ conflicts: 1 }, 'oneWay'), true);
});

test('mirror counts destination-only as delete candidates', () => {
  assert.equal(previewHasActionableWork({ wouldCopy: 0, conflicts: 0, destinationOnly: 3 }, 'mirror'), true);
  assert.equal(previewHasActionableWork({ wouldCopy: 0, conflicts: 0, destinationOnly: 0 }, 'mirror'), false);
});

test('two-way sums direction fields; missing all fields -> actionable', () => {
  assert.equal(previewHasActionableWork({ copyToDest: 0, copyToSource: 0, deleteOnDest: 0, deleteOnSource: 0, keepBoth: 0, conflicts: 0 }, 'twoWay'), false);
  assert.equal(previewHasActionableWork({ copyToDest: 1 }, 'twoWay'), true);
  assert.equal(previewHasActionableWork({ unrelated: 9 }, 'twoWay'), true, 'no direction fields present -> cannot reason, assume actionable');
});
