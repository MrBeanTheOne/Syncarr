const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAutomaticPreviewSummary,
  getAutomaticPreviewFailure
} = require('../src/main/automatic-run-safety');

test('automatic preview prefers the two-way plan over the engine summary', () => {
  const history = { twoWay: true, conflicts: 2 };
  const preview = { ok: true, summary: { conflicts: 0 }, history };

  assert.equal(getAutomaticPreviewSummary(preview), history);
  const failure = getAutomaticPreviewFailure(preview, 'Watched');
  assert.equal(failure.status, 'conflicts');
  assert.equal(failure.summary, history);
  assert.match(failure.message, /^Watched sync skipped/);
});

test('automatic preview blocks failed and low-space plans', () => {
  assert.equal(getAutomaticPreviewFailure({ ok: false, message: 'Compare failed.' }).status, 'preview-failed');
  assert.equal(getAutomaticPreviewFailure({
    ok: true,
    history: { conflicts: 0 },
    storage: { checked: true, enoughSpace: false, message: 'Disk full.' }
  }).status, 'space');
});

test('automatic preview allows a successful conflict-free plan', () => {
  assert.equal(getAutomaticPreviewFailure({
    ok: true,
    history: { conflicts: 0 },
    storage: { checked: true, enoughSpace: true }
  }), null);
});

test('automatic preview allows conflicts resolved by an explicit precedence policy', () => {
  const preview = {
    ok: true,
    history: { twoWay: true, conflictPolicy: 'source', conflicts: 2 },
    storage: { checked: true, enoughSpace: true }
  };
  assert.equal(getAutomaticPreviewFailure(preview, 'Watched', { allowResolvedConflicts: true }), null);
  assert.equal(getAutomaticPreviewFailure(preview, 'Watched').status, 'conflicts');
  assert.equal(getAutomaticPreviewFailure({ ...preview, history: { ...preview.history, conflictPolicy: 'newer' } }, 'Watched', { allowResolvedConflicts: true }).status, 'conflicts');
});

test('automatic mirror is blocked when the source scanned empty but the destination has files', () => {
  // Realistic shape: an empty source in mirror mode lists every destination file
  // as an extra, so `scanned` (= previewFiles) EQUALS destinationOnly and is
  // never 0. The guard must key on sourceFiles, which is 0 here.
  const preview = {
    ok: true,
    summary: { conflicts: 0, sourceFiles: 0, scanned: 2785, destinationOnly: 2785 },
    storage: { checked: true, enoughSpace: true }
  };
  // Without the mode hint the guard cannot know it is a mirror, so it would pass.
  assert.equal(getAutomaticPreviewFailure(preview, 'Scheduled'), null);
  const failure = getAutomaticPreviewFailure(preview, 'Scheduled', { mode: 'mirror' });
  assert.equal(failure.status, 'empty-source-mirror');
  assert.match(failure.message, /delete all 2785 destination file/);
});

test('automatic mirror still runs when the source scanned files', () => {
  const preview = {
    ok: true,
    summary: { conflicts: 0, sourceFiles: 2782, scanned: 2785, destinationOnly: 3 },
    storage: { checked: true, enoughSpace: true }
  };
  // A populated source legitimately pruning a few destination-only files is fine.
  assert.equal(getAutomaticPreviewFailure(preview, 'Scheduled', { mode: 'mirror' }), null);
});

test('empty-source guard does not fire for an empty source with an empty destination', () => {
  const preview = {
    ok: true,
    summary: { conflicts: 0, sourceFiles: 0, scanned: 0, destinationOnly: 0 },
    storage: { checked: true, enoughSpace: true }
  };
  // Nothing to delete -> nothing to guard against.
  assert.equal(getAutomaticPreviewFailure(preview, 'Scheduled', { mode: 'mirror' }), null);
});

test('empty-source guard does not fire when the source-file count is unknown (never false-block)', () => {
  // A summary that never tracked sourceFiles must not be treated as "empty".
  const preview = {
    ok: true,
    summary: { conflicts: 0, scanned: 2785, destinationOnly: 2785 },
    storage: { checked: true, enoughSpace: true }
  };
  assert.equal(getAutomaticPreviewFailure(preview, 'Scheduled', { mode: 'mirror' }), null);
});

test('empty-source guard is mirror-only (one-way leaves destination-only files untouched)', () => {
  const preview = {
    ok: true,
    summary: { conflicts: 0, sourceFiles: 0, scanned: 2785, destinationOnly: 2785 },
    storage: { checked: true, enoughSpace: true }
  };
  // One-way never deletes destination-only files, so an empty source is harmless.
  assert.equal(getAutomaticPreviewFailure(preview, 'Scheduled', { mode: 'oneWay' }), null);
});

test('automatic preview can require a completed free-space check', () => {
  const preview = {
    ok: true,
    history: { twoWay: true, conflicts: 0 },
    storage: { checked: false, skipped: true }
  };

  assert.equal(getAutomaticPreviewFailure(preview, 'Watched'), null);
  const failure = getAutomaticPreviewFailure(preview, 'Watched', { requireStorageCheck: true });
  assert.equal(failure.status, 'space-unchecked');
  assert.match(failure.message, /free-space preflight/);
});
