const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTelegramRunMessage, formatBytes, formatDuration, syncModeLabel, humanizeReason } = require('../src/services/telegram');

test('formatBytes picks the right unit', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.00 KB');
  assert.equal(formatBytes(1_572_864), '1.50 MB');
  assert.equal(formatBytes(2 * 1024 ** 3), '2.00 GB');
  // Big numbers collapse to no decimals
  assert.equal(formatBytes(150 * 1024 * 1024), '150 MB');
});

test('formatDuration handles sub-minute, minute, and hour ranges', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(45_000), '45s');
  assert.equal(formatDuration(60_000), '1m');
  assert.equal(formatDuration(125_000), '2m 5s');
  assert.equal(formatDuration(3_600_000), '1h');
  assert.equal(formatDuration(3_900_000), '1h 5m');
});

test('syncModeLabel maps known and unknown modes', () => {
  assert.equal(syncModeLabel('oneWay'), 'One-way backup');
  assert.equal(syncModeLabel('mirror'), 'Mirror');
  assert.equal(syncModeLabel('twoWay'), 'Two-way');
  assert.equal(syncModeLabel('something-else'), 'One-way backup');
  assert.equal(syncModeLabel(null), 'One-way backup');
});

test('humanizeReason translates known machine reasons to friendlier text', () => {
  assert.equal(humanizeReason('not-connected-or-unreadable'), 'not reachable');
  assert.equal(humanizeReason('compare-timed-out'), 'timed out');
  assert.equal(humanizeReason('mystery-reason'), 'mystery reason');
});

test('buildTelegramRunMessage escapes HTML in user-controlled fields', () => {
  const msg = buildTelegramRunMessage({
    job: { name: '<script>alert(1)</script>' },
    result: {
      ok: true,
      syncMode: 'oneWay',
      message: 'has & ampersand <b>bold</b>'
    },
    dryRun: true
  });
  assert.ok(!msg.includes('<script>'), 'raw <script> should be escaped');
  assert.ok(msg.includes('&lt;script&gt;'), 'escaped <script> should appear');
  assert.ok(msg.includes('has &amp; ampersand'));
  assert.ok(msg.includes('&lt;b&gt;bold&lt;/b&gt;'));
});

test('buildTelegramRunMessage compare message shows plan + estimated bytes', () => {
  const msg = buildTelegramRunMessage({
    job: { name: 'Docs' },
    result: {
      ok: true,
      syncMode: 'mirror',
      history: {
        wouldCopy: 10,
        newFiles: 4,
        wouldArchive: 2,
        copyBytes: 1_572_864,
        archiveBytes: 4096,
        conflicts: 1,
        destinationOnly: 3
      },
      compareCreatedAt: new Date(Date.now() - 65_000).toISOString()
    },
    dryRun: true,
    now: new Date()
  });
  assert.match(msg, /13 file action\(s\)/);
  assert.match(msg, /4 new · 6 changed/);
  assert.match(msg, /2 to archive/);
  assert.match(msg, /1 conflict/);
  assert.match(msg, /3 delete action\(s\)/);
  assert.match(msg, /1\.50 MB to copy/);
  assert.match(msg, /4\.00 KB history/);
  assert.match(msg, /took 1m 5s/);
  assert.match(msg, /Mirror/);
});

test('buildTelegramRunMessage sync message shows files + bytes + retention', () => {
  const msg = buildTelegramRunMessage({
    job: { name: 'Photos' },
    result: {
      ok: true,
      syncMode: 'oneWay',
      summary: { files: { copied: 5, skipped: 2, failed: 0, extras: 0 }, bytes: { copied: 2048 } },
      history: { archived: 1, archiveBytes: 1024 },
      retention: { summary: { deletedFiles: 7, freedBytes: 4096 } },
      restorePoint: { ok: true }
    },
    dryRun: false
  });
  assert.match(msg, /5 copied · 0 deleted · 2 skipped · 0 failed/);
  assert.match(msg, /2\.00 KB copied/);
  assert.match(msg, /1 version\(s\) archived/);
  assert.match(msg, /7 old version\(s\) removed/);
  assert.match(msg, /Restore point created/);
});

test('buildTelegramRunMessage shows two-way copied and deleted counts', () => {
  const msg = buildTelegramRunMessage({
    job: { name: 'Two-way', syncMode: 'twoWay' },
    result: {
      ok: true,
      syncMode: 'twoWay',
      summary: {
        twoWay: true,
        copyToDest: 2,
        copyToSource: 1,
        deleteOnDest: 1,
        deleteOnSource: 2,
        errors: 0,
        copyBytes: 3072
      },
      history: { archived: 3, archiveBytes: 1024 }
    },
    dryRun: false
  });
  assert.match(msg, /3 copied · 3 deleted · 0 skipped · 0 failed/);
  assert.match(msg, /3\.00 KB copied/);
  assert.match(msg, /3 version\(s\) archived/);
});

test('buildTelegramRunMessage warning status uses warning header', () => {
  const msg = buildTelegramRunMessage({
    job: { name: 'X' },
    result: { ok: true, status: 'warning' },
    dryRun: false
  });
  assert.match(msg, /⚠️/);
  assert.match(msg, /finished with warnings/);
});

test('buildTelegramRunMessage failure surfaces the error message', () => {
  const msg = buildTelegramRunMessage({
    job: { name: 'X' },
    result: { ok: false, message: 'Network share offline' },
    dryRun: false
  });
  assert.match(msg, /❌/);
  assert.match(msg, /Sync failed/);
  assert.match(msg, /Network share offline/);
});

test('buildTelegramRunMessage lists per-destination results, capped at 6', () => {
  const destinations = Array.from({ length: 8 }, (_, i) => ({
    destinationLabel: `Dest ${i}`,
    destinationRequired: i % 2 === 0,
    status: i === 0 ? 'success' : 'failed',
    message: i === 0 ? '' : 'oh no'
  }));
  const msg = buildTelegramRunMessage({
    job: { name: 'X' },
    result: { ok: false, destinationResults: destinations },
    dryRun: false
  });
  assert.ok(msg.includes('Dest 0'), 'first dest shows');
  assert.ok(msg.includes('Dest 5'), 'sixth dest shows');
  assert.ok(!msg.includes('Dest 6'), 'seventh dest is dropped');
  assert.match(msg, /Dest 1.*oh no/);
  // optional marker
  assert.match(msg, /Dest 1 \(optional\)/);
});
