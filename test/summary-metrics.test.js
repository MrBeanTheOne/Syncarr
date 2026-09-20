const test = require('node:test');
const assert = require('node:assert/strict');

// summary-metrics.js destructures window.SyncarrRendererUtils at load.
global.window = global.window || {};
require('../src/renderer/renderer-utils.js');
require('../src/renderer/summary-metrics.js');
const { computeSyncSummaryMetrics } = global.window.SyncarrSummaryMetrics;

test('non-two-way maps robocopy files/bytes counts', () => {
  const m = computeSyncSummaryMetrics({ files: { copied: 12, skipped: 3, failed: 1 }, bytes: { copied: 2048 } });
  assert.deepEqual(m, { copied: '12', skipped: '3', failed: '1', bytes: '2.0 KB' });
});

test('two-way sums copyToDest+copyToSource and uses unchanged/errors/copyBytes (the past-bug mapping)', () => {
  const m = computeSyncSummaryMetrics({ twoWay: true, copyToDest: 5, copyToSource: 4, unchanged: 7, errors: 2, copyBytes: 1024 });
  assert.equal(m.copied, '9', 'copied is copyToDest + copyToSource, NOT files.copied');
  assert.equal(m.skipped, '7');
  assert.equal(m.failed, '2');
  assert.equal(m.bytes, '1.0 KB');
});

test('returns only the 4 run-complete cells — never Deleted/History', () => {
  const m = computeSyncSummaryMetrics({ files: { copied: 1 } });
  assert.deepEqual(Object.keys(m).sort(), ['bytes', 'copied', 'failed', 'skipped']);
});

test('missing counts render as 0 (unified, internally consistent)', () => {
  const m = computeSyncSummaryMetrics({ files: {}, bytes: {} });
  assert.deepEqual(m, { copied: '0', skipped: '0', failed: '0', bytes: '0 B' });
  const tw = computeSyncSummaryMetrics({ twoWay: true });
  assert.deepEqual(tw, { copied: '0', skipped: '0', failed: '0', bytes: '0 B' });
});

test('handles an empty/missing summary without throwing', () => {
  assert.deepEqual(computeSyncSummaryMetrics(undefined), { copied: '0', skipped: '0', failed: '0', bytes: '0 B' });
  assert.deepEqual(computeSyncSummaryMetrics({}), { copied: '0', skipped: '0', failed: '0', bytes: '0 B' });
});

test('extractCopiedCount is the shared, two-way-aware raw count', () => {
  const { extractCopiedCount } = global.window.SyncarrSummaryMetrics;
  assert.equal(extractCopiedCount({ files: { copied: 12 } }), 12);
  assert.equal(extractCopiedCount({ twoWay: true, copyToDest: 5, copyToSource: 4 }), 9);
  assert.equal(extractCopiedCount(undefined), 0);
});
