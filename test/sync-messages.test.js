const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatBytesForMessage,
  formatHistoryRunId,
  quoteForDisplay,
  makeNoOpRobocopySummary,
  buildNoOpSyncMessage,
  buildCompareCompletionMessage,
  buildSyncCompletionMessage
} = require('../src/main/sync-messages');

test('formatBytesForMessage scales units and rounds sensibly', () => {
  assert.equal(formatBytesForMessage(0), '0 B');
  assert.equal(formatBytesForMessage(512), '512 B');
  assert.equal(formatBytesForMessage(1024), '1.0 KB');
  assert.equal(formatBytesForMessage(1536), '1.5 KB');
  assert.equal(formatBytesForMessage(15 * 1024), '15 KB'); // >=10 drops the decimal
  assert.equal(formatBytesForMessage(5 * 1024 * 1024 * 1024), '5.0 GB');
  assert.equal(formatBytesForMessage('not a number'), '0 B');
});

test('formatHistoryRunId makes an ISO timestamp filesystem-safe', () => {
  const id = formatHistoryRunId(new Date('2026-06-22T01:02:03.456Z'));
  assert.equal(id, '2026-06-22T01-02-03-456Z');
  assert.ok(!/[:.]/.test(id), 'no colons or dots remain');
});

test('quoteForDisplay only quotes values containing whitespace', () => {
  assert.equal(quoteForDisplay('plain'), 'plain');
  assert.equal(quoteForDisplay('C:\\Path With Space'), '"C:\\Path With Space"');
  assert.equal(quoteForDisplay('he said "hi"'), '"he said \\"hi\\""');
});

test('makeNoOpRobocopySummary reports skipped = unchanged + skippedOlder', () => {
  const summary = makeNoOpRobocopySummary({ unchanged: 3, skippedOlder: 2 });
  assert.equal(summary.skipped, 5);
  assert.equal(summary.copied, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.files.total, 5);
  assert.equal(summary.files.skipped, 5);
  // engine-shaped: dirs/files/bytes line-total objects are present
  assert.ok(summary.dirs && summary.bytes && summary.files);
});

test('makeNoOpRobocopySummary defaults to an all-zero summary', () => {
  const summary = makeNoOpRobocopySummary();
  assert.equal(summary.skipped, 0);
  assert.equal(summary.files.total, 0);
});

test('buildNoOpSyncMessage describes one-way vs mirror no-op runs', () => {
  const oneWay = buildNoOpSyncMessage({
    syncMode: 'oneway',
    historySummary: { destinationOnly: 2, skippedOlder: 1 },
    skippedDestinations: []
  });
  assert.match(oneWay, /One-way sync skipped/);
  assert.match(oneWay, /2 destination-only file\(s\)/);
  assert.match(oneWay, /1 older source file\(s\)/);

  const mirror = buildNoOpSyncMessage({
    syncMode: 'mirror',
    historySummary: {},
    skippedDestinations: [{}, {}]
  });
  assert.match(mirror, /Mirror sync skipped/);
  assert.match(mirror, /2 optional destination\(s\) skipped/);
});

test('buildCompareCompletionMessage summarizes planned actions', () => {
  const none = buildCompareCompletionMessage({
    syncMode: 'oneway',
    previewSummary: {},
    finalStatus: { status: 'ok' }
  });
  assert.match(none, /No file changes found\./);

  const oneWay = buildCompareCompletionMessage({
    syncMode: 'oneway',
    previewSummary: { wouldCopy: 3, wouldArchive: 1, destinationOnly: 2 },
    finalStatus: { status: 'ok' }
  });
  assert.match(oneWay, /3 one-way difference\(s\) found/);
  assert.match(oneWay, /3 copy\/update action\(s\)/);

  const mirror = buildCompareCompletionMessage({
    syncMode: 'mirror',
    previewSummary: { wouldCopy: 1, destinationOnly: 3 },
    finalStatus: { status: 'warning', optionalIssueCount: 1 }
  });
  assert.match(mirror, /4 mirror action\(s\) found/);
  assert.match(mirror, /3 delete candidate\(s\)/);
  assert.match(mirror, /1 optional destination\(s\) skipped\./);
});

test('buildSyncCompletionMessage returns the error message when the run did not succeed', () => {
  assert.equal(
    buildSyncCompletionMessage({ syncMode: 'oneway', finalStatus: { ok: false, message: 'boom' } }),
    'boom'
  );
  assert.equal(
    buildSyncCompletionMessage({ syncMode: 'oneway', finalStatus: null }),
    'Sync did not complete.'
  );
});

test('buildSyncCompletionMessage uses injected getFileCounts for the success summary', () => {
  const getFileCounts = () => ({ copied: 4, skipped: 2, failed: 1, extras: 3 });

  const oneWay = buildSyncCompletionMessage({
    syncMode: 'oneway',
    finalStatus: { ok: true, status: 'ok' },
    summary: {},
    getFileCounts,
    skippedDestinations: []
  });
  assert.match(oneWay, /One-way sync completed: 4 copied, 2 skipped\./);
  assert.match(oneWay, /3 destination-only file\(s\) were left untouched\./);
  assert.match(oneWay, /1 failed\./);

  const mirror = buildSyncCompletionMessage({
    syncMode: 'mirror',
    finalStatus: { ok: true, status: 'warning' },
    summary: {},
    getFileCounts,
    skippedDestinations: [{}]
  });
  assert.match(mirror, /Mirror sync completed: 4 copied, 3 deleted, 2 skipped\./);
  assert.match(mirror, /1 optional destination\(s\) skipped\./);
});

test('buildSyncCompletionMessage reports a no-change run plainly', () => {
  const oneWay = buildSyncCompletionMessage({
    syncMode: 'oneway',
    finalStatus: { ok: true, status: 'no-change' },
    summary: {},
    getFileCounts: () => ({ copied: 0, skipped: 7, failed: 0, extras: 2 }),
    skippedDestinations: []
  });
  assert.match(oneWay, /One-way sync completed: no changes were needed\./);
  assert.match(oneWay, /2 destination-only file\(s\) were left untouched\./);
  assert.doesNotMatch(oneWay, /0 copied/);

  const mirror = buildSyncCompletionMessage({
    syncMode: 'mirror',
    finalStatus: { ok: true, status: 'no-change' },
    summary: {},
    getFileCounts: () => ({ copied: 0, skipped: 0, failed: 0, extras: 0 }),
    skippedDestinations: []
  });
  assert.match(mirror, /Mirror sync completed: no changes were needed\./);
});
