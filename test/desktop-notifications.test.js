const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldNotifyDesktop, buildDesktopNotification, buildInterruptedRunsNotification } = require('../src/main/desktop-notifications');

test('shouldNotifyDesktop defaults to on when no settings passed', () => {
  assert.equal(shouldNotifyDesktop({ settings: undefined, result: { ok: true }, dryRun: false }), true);
  assert.equal(shouldNotifyDesktop({ settings: {}, result: { ok: true }, dryRun: false }), true);
});

test('shouldNotifyDesktop respects explicit desktopNotifications: false', () => {
  assert.equal(shouldNotifyDesktop({ settings: { desktopNotifications: false }, result: { ok: true }, dryRun: false }), false);
  assert.equal(shouldNotifyDesktop({ settings: { desktopNotifications: false }, result: { ok: false }, dryRun: false }), false);
});

test('shouldNotifyDesktop fires on failure regardless of dryRun', () => {
  assert.equal(shouldNotifyDesktop({ settings: {}, result: { ok: false }, dryRun: true }), true);
  assert.equal(shouldNotifyDesktop({ settings: {}, result: { ok: false }, dryRun: false }), true);
});

test('buildInterruptedRunsNotification returns null when nothing is interrupted', () => {
  assert.equal(buildInterruptedRunsNotification([]), null);
  assert.equal(buildInterruptedRunsNotification(undefined), null);
  assert.equal(buildInterruptedRunsNotification([null, undefined]), null);
});

test('buildInterruptedRunsNotification names a single interrupted job', () => {
  const n = buildInterruptedRunsNotification([{ jobName: 'Nightly NAS backup' }]);
  assert.ok(n);
  assert.match(n.title, /an interrupted run needs review/);
  assert.match(n.body, /"Nightly NAS backup"/);
  assert.match(n.body, /resume or roll it back/);
  assert.equal(n.urgent, true);
});

test('buildInterruptedRunsNotification counts multiple interrupted runs', () => {
  const n = buildInterruptedRunsNotification([{ jobName: 'A' }, { jobId: 'b' }, { jobName: 'C' }]);
  assert.ok(n);
  assert.match(n.title, /3 interrupted runs need review/);
  assert.match(n.body, /3 job\(s\)/);
  assert.ok(n.body.length <= 240);
});

test('shouldNotifyDesktop skips successful compare (too noisy)', () => {
  assert.equal(shouldNotifyDesktop({ settings: {}, result: { ok: true }, dryRun: true }), false);
});

test('shouldNotifyDesktop fires on successful sync', () => {
  assert.equal(shouldNotifyDesktop({ settings: {}, result: { ok: true }, dryRun: false }), true);
});

test('buildDesktopNotification titles reflect status', () => {
  const success = buildDesktopNotification({ job: { name: 'Docs' }, result: { ok: true }, dryRun: false });
  assert.equal(success.title, 'Docs: Sync complete');
  assert.equal(success.urgent, false);

  const compare = buildDesktopNotification({ job: { name: 'Docs' }, result: { ok: true }, dryRun: true });
  assert.equal(compare.title, 'Docs: Compare complete');

  const failure = buildDesktopNotification({ job: { name: 'Docs' }, result: { ok: false, message: 'boom' }, dryRun: false });
  assert.equal(failure.title, 'Docs: Sync failed');
  assert.equal(failure.urgent, true);
  assert.equal(failure.body, 'boom');

  const warning = buildDesktopNotification({ job: { name: 'Docs' }, result: { ok: true, status: 'warning' }, dryRun: false });
  assert.equal(warning.title, 'Docs: Sync finished with warnings');

  const cancelled = buildDesktopNotification({ job: { name: 'Docs' }, result: { ok: false, status: 'cancelled' }, dryRun: false });
  assert.equal(cancelled.title, 'Docs: Sync cancelled');
});

test('buildDesktopNotification success body drops zero stats and reads naturally', () => {
  const n = buildDesktopNotification({
    job: { name: 'Docs' },
    result: {
      ok: true,
      summary: {
        files: { copied: 12, failed: 0 },
        bytes: { copied: 5_242_880 }
      },
      history: { archived: 3, archiveBytes: 12_345 }
    },
    dryRun: false
  });
  assert.equal(n.body, '12 files copied, 3 archived to history (5.00 MB)');
});

test('buildDesktopNotification says "No changes" when nothing happened', () => {
  const idle = buildDesktopNotification({
    job: { name: 'Docs' },
    result: { ok: true, summary: { files: { copied: 0, skipped: 0, failed: 0 } } },
    dryRun: false
  });
  assert.equal(idle.body, 'No changes — everything already up to date');

  const skipped = buildDesktopNotification({
    job: { name: 'Docs' },
    result: { ok: true, summary: { files: { copied: 0, skipped: 34, failed: 0 } } },
    dryRun: false
  });
  assert.equal(skipped.body, 'No changes — 34 files already up to date');
});

test('buildDesktopNotification compare body shows planned change count', () => {
  const n = buildDesktopNotification({
    job: { name: 'Docs' },
    result: {
      ok: true,
      history: { wouldCopy: 17, copyBytes: 1_048_576 }
    },
    dryRun: true
  });
  assert.equal(n.body, '17 changes planned (1.00 MB to copy)');
});

test('buildDesktopNotification shows mirror delete counts', () => {
  const n = buildDesktopNotification({
    job: { name: 'Mirror', syncMode: 'mirror' },
    result: {
      ok: true,
      syncMode: 'mirror',
      summary: { files: { copied: 4, skipped: 1, failed: 0, extras: 3 }, bytes: { copied: 2048 } },
      history: { archived: 3 }
    },
    dryRun: false
  });
  assert.equal(n.body, '4 files copied, 3 removed from destination, 3 archived to history (2.00 KB)');
});

test('buildDesktopNotification reads flat two-way operation stats', () => {
  const n = buildDesktopNotification({
    job: { name: 'Two-way', syncMode: 'twoWay' },
    result: {
      ok: true,
      syncMode: 'twoWay',
      summary: {
        twoWay: true,
        copyToDest: 2,
        copyToSource: 3,
        deleteOnDest: 1,
        deleteOnSource: 2,
        errors: 0,
        copyBytes: 4096
      },
      history: { archived: 3 }
    },
    dryRun: false
  });
  assert.equal(n.body, '5 files copied, 3 deleted, 3 archived to history (4.00 KB)');
});

test('buildDesktopNotification leads with the failure on partial runs', () => {
  const n = buildDesktopNotification({
    job: { name: 'Two-way', syncMode: 'twoWay' },
    result: {
      ok: false,
      syncMode: 'twoWay',
      message: 'Completed with errors.',
      summary: { twoWay: true, copyToDest: 2, copyToSource: 0, deleteOnDest: 1, deleteOnSource: 0, errors: 1 }
    },
    dryRun: false
  });
  assert.equal(n.body, 'Completed with errors. 1 file failed (2 copied before the error). Click to review.');
});

test('buildDesktopNotification warning body points at the run log', () => {
  const n = buildDesktopNotification({
    job: { name: 'Docs' },
    result: {
      ok: true,
      status: 'warning',
      summary: { files: { copied: 2, failed: 0 } }
    },
    dryRun: false
  });
  assert.equal(n.body, '2 files copied — finished with warnings. Click to review.');

  const bare = buildDesktopNotification({
    job: { name: 'Docs' },
    result: { ok: true, status: 'warning' },
    dryRun: false
  });
  assert.equal(bare.body, 'Finished with warnings. Click to review.');
});

test('buildDesktopNotification maps silent: quiet successes, audible failures/warnings', () => {
  const success = buildDesktopNotification({ job: { name: 'Docs' }, result: { ok: true }, dryRun: false });
  assert.equal(success.silent, true);

  const warning = buildDesktopNotification({ job: { name: 'Docs' }, result: { ok: true, status: 'warning' }, dryRun: false });
  assert.equal(warning.silent, false);

  const failure = buildDesktopNotification({ job: { name: 'Docs' }, result: { ok: false }, dryRun: false });
  assert.equal(failure.silent, false);
});

test('buildDesktopNotification passes the job id through for click-through', () => {
  const fromJob = buildDesktopNotification({ job: { id: 'job-1', name: 'Docs' }, result: { ok: true }, dryRun: false });
  assert.equal(fromJob.jobId, 'job-1');

  const fromResult = buildDesktopNotification({ result: { ok: true, jobId: 'job-2' }, dryRun: false });
  assert.equal(fromResult.jobId, 'job-2');

  const none = buildDesktopNotification({ result: { ok: true }, dryRun: false });
  assert.equal(none.jobId, null);
});

test('buildDesktopNotification truncates oversize title and body', () => {
  const hugeJob = { name: 'x'.repeat(500) };
  const n = buildDesktopNotification({
    job: hugeJob,
    result: { ok: false, message: 'y'.repeat(1000) },
    dryRun: false
  });
  assert.ok(n.title.length <= 120, `title was ${n.title.length}`);
  assert.ok(n.body.length <= 240, `body was ${n.body.length}`);
});
