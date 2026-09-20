const test = require('node:test');
const assert = require('node:assert/strict');

// run-history-utils.js and summary-metrics.js are renderer IIFEs that publish
// onto window; load their dependency (renderer-utils) first, same as the app.
global.window = global.window || {};
require('../src/renderer/renderer-utils.js');
require('../src/renderer/summary-metrics.js');
require('../src/renderer/run-history-utils.js');
const { getCopiedCount, buildRunHistoryStatsText } = global.window.SyncarrRunHistoryUtils;

test('getCopiedCount reads files.copied for a one-way run', () => {
  assert.equal(getCopiedCount({ summary: { files: { copied: 7 } } }), 7);
});

test('getCopiedCount sums copyToDest + copyToSource for a two-way run (not files.copied)', () => {
  // Regression for the two-way "Copied = 0" bug re-appearing in the recent-runs
  // history rows: a two-way summary has no files.copied, only copy{To…} fields.
  assert.equal(getCopiedCount({ summary: { twoWay: true, copyToDest: 5, copyToSource: 4 } }), 9);
});

test('getCopiedCount returns null when there is no summary', () => {
  assert.equal(getCopiedCount({}), null);
  assert.equal(getCopiedCount(null), null);
});

test('buildRunHistoryStatsText surfaces the two-way copied count', () => {
  const text = buildRunHistoryStatsText({ summary: { twoWay: true, copyToDest: 5, copyToSource: 4 } });
  assert.match(text, /9 copied/);
});
