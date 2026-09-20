const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTwoWayPlan, sameContent } = require('../src/main/two-way-plan');

// --- tiny fixture helpers -------------------------------------------------
// file entry as collectSourceFiles-style (size/mtimeMs on the entry)
function f(relativePath, size, mtimeMs, sha1 = null) {
  return { relativePath, size, mtimeMs, sha1 };
}
// baseline observation
function o(size, mtimeMs, sha1 = null) {
  return { size, mtimeMs, sha1 };
}
// baseline record (source + destination as last synced)
function rec(relativePath, sourceObs, destObs) {
  return { path: relativePath, source: sourceObs, destination: destObs };
}
function onlyPath(list) {
  return list.map((e) => e.relativePath);
}

// --- new files (no baseline) ---------------------------------------------

test('new file on source only is copied to dest', () => {
  const plan = buildTwoWayPlan({ sourceFiles: [f('a.txt', 10, 1000)], destFiles: [], baseline: [] });
  assert.deepEqual(onlyPath(plan.copyToDest), ['a.txt']);
  assert.equal(plan.copyToDest[0].reason, 'source-new');
  assert.equal(plan.copyToDest[0].baselineUpdate, true);
  assert.equal(plan.deleteOnDest.length, 0);
  assert.equal(plan.deleteOnSource.length, 0);
});

test('new file on dest only is copied to source', () => {
  const plan = buildTwoWayPlan({ sourceFiles: [], destFiles: [f('a.txt', 10, 1000)], baseline: [] });
  assert.deepEqual(onlyPath(plan.copyToSource), ['a.txt']);
  assert.equal(plan.copyToSource[0].reason, 'dest-new');
});

// --- one-sided modifications ---------------------------------------------

test('source modified, dest unchanged -> copy to dest', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 20, 5000)],
    destFiles: [f('a.txt', 10, 1000)],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))]
  });
  assert.deepEqual(onlyPath(plan.copyToDest), ['a.txt']);
  assert.equal(plan.copyToDest[0].reason, 'source-modified');
  assert.equal(plan.conflicts.length, 0);
});

test('dest modified, source unchanged -> copy to source', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 10, 1000)],
    destFiles: [f('a.txt', 20, 5000)],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))]
  });
  assert.deepEqual(onlyPath(plan.copyToSource), ['a.txt']);
  assert.equal(plan.copyToSource[0].reason, 'dest-modified');
});

test('both unchanged -> no-op, no baseline rewrite', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 10, 1000)],
    destFiles: [f('a.txt', 10, 1000)],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))]
  });
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.unchanged[0].reason, 'unchanged');
  assert.equal(plan.unchanged[0].baselineUpdate, false);
  assert.equal(plan.copyToDest.length + plan.copyToSource.length, 0);
});

test('both changed to identical content -> converged, refresh baseline', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 20, 9000)],
    destFiles: [f('a.txt', 20, 9000)],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))]
  });
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.unchanged[0].reason, 'converged');
  assert.equal(plan.unchanged[0].baselineUpdate, true);
  assert.equal(plan.conflicts.length, 0);
});

// --- conflicts (both changed, different content) -------------------------

test('both modified differently, newer policy, source newer -> copy to dest (conflict)', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 20, 9000)],
    destFiles: [f('a.txt', 30, 4000)],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))]
  });
  assert.deepEqual(onlyPath(plan.copyToDest), ['a.txt']);
  assert.equal(plan.copyToDest[0].conflict, true);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].reason, 'both-modified-newer-source');
});

test('both modified differently, newer policy, dest newer -> copy to source (conflict)', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 20, 4000)],
    destFiles: [f('a.txt', 30, 9000)],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))]
  });
  assert.deepEqual(onlyPath(plan.copyToSource), ['a.txt']);
  assert.equal(plan.copyToSource[0].conflict, true);
});

test('both modified differently within clock tolerance -> keep both (tie)', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 20, 9000)],
    destFiles: [f('a.txt', 30, 9500)], // 500ms apart, < 2100 tolerance
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))]
  });
  assert.deepEqual(onlyPath(plan.keepBoth), ['a.txt']);
  assert.equal(plan.keepBoth[0].conflict, true);
});

test('policy=source forces source to win a conflict', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 20, 4000)],
    destFiles: [f('a.txt', 30, 9000)],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))],
    policy: 'source'
  });
  assert.deepEqual(onlyPath(plan.copyToDest), ['a.txt']);
  assert.equal(plan.copyToDest[0].reason, 'both-modified-source-wins');
});

test('policy=dest forces dest to win a conflict', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 20, 9000)],
    destFiles: [f('a.txt', 30, 4000)],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))],
    policy: 'dest'
  });
  assert.deepEqual(onlyPath(plan.copyToSource), ['a.txt']);
  assert.equal(plan.copyToSource[0].reason, 'both-modified-dest-wins');
});

test('policy=keepBoth always keeps both on conflict', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 20, 9000)],
    destFiles: [f('a.txt', 30, 4000)],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))],
    policy: 'keepBoth'
  });
  assert.deepEqual(onlyPath(plan.keepBoth), ['a.txt']);
});

// --- deletions (baseline-gated) ------------------------------------------

test('source deleted, dest unchanged -> delete on dest', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [],
    destFiles: [f('a.txt', 10, 1000)],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))]
  });
  assert.deepEqual(onlyPath(plan.deleteOnDest), ['a.txt']);
  assert.equal(plan.deleteOnDest[0].reason, 'source-deleted');
});

test('dest deleted, source unchanged -> delete on source', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 10, 1000)],
    destFiles: [],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))]
  });
  assert.deepEqual(onlyPath(plan.deleteOnSource), ['a.txt']);
  assert.equal(plan.deleteOnSource[0].reason, 'dest-deleted');
});

test('both deleted -> drop from baseline only', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [],
    destFiles: [],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))]
  });
  assert.deepEqual(plan.dropFromBaseline, ['a.txt']);
  assert.equal(plan.deleteOnDest.length + plan.deleteOnSource.length, 0);
});

test('SAFETY: file present one side with no baseline is copied, never deleted', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('only.txt', 10, 1000)],
    destFiles: [],
    baseline: [] // never synced before
  });
  assert.deepEqual(onlyPath(plan.copyToDest), ['only.txt']);
  assert.equal(plan.deleteOnDest.length, 0);
  assert.equal(plan.deleteOnSource.length, 0);
});

// --- delete vs edit conflicts --------------------------------------------

test('source edited while dest deleted, newer policy -> resurrect (copy to dest)', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 20, 9000)], // edited since baseline
    destFiles: [],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))]
  });
  assert.deepEqual(onlyPath(plan.copyToDest), ['a.txt']);
  assert.equal(plan.copyToDest[0].conflict, true);
  assert.equal(plan.copyToDest[0].reason, 'conflict-source-edit-vs-dest-delete');
});

test('source edited while dest deleted, policy=dest -> deletion wins', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 20, 9000)],
    destFiles: [],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))],
    policy: 'dest'
  });
  assert.deepEqual(onlyPath(plan.deleteOnSource), ['a.txt']);
  assert.equal(plan.deleteOnSource[0].conflict, true);
});

// --- comparison nuances ---------------------------------------------------

test('clock skew within tolerance counts as unchanged', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 10, 3000)], // 2000ms after baseline, < 2100 tolerance
    destFiles: [f('a.txt', 10, 1000)],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))]
  });
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.copyToDest.length, 0);
});

test('sha1 mismatch is detected even when size+mtime match', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 10, 1000, 'NEWHASH')],
    destFiles: [f('a.txt', 10, 1000, 'oldhash')],
    baseline: [rec('a.txt', o(10, 1000, 'oldhash'), o(10, 1000, 'oldhash'))]
  });
  assert.deepEqual(onlyPath(plan.copyToDest), ['a.txt']);
  assert.equal(plan.copyToDest[0].reason, 'source-modified');
});

test('sameContent prefers sha1 then falls back to size+mtime', () => {
  assert.equal(sameContent(o(1, 1000, 'x'), o(1, 9999, 'x')), true); // sha1 equal wins
  assert.equal(sameContent(o(1, 1000, 'x'), o(1, 1000, 'y')), false); // sha1 differs
  assert.equal(sameContent(o(1, 1000), o(1, 2000)), true); // no sha1, within tolerance
  assert.equal(sameContent(o(1, 1000), o(2, 1000)), false); // size differs
});

// --- first run (no baseline, both present) -------------------------------

test('first run, identical content both sides -> seed baseline, no copy', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 10, 1000)],
    destFiles: [f('a.txt', 10, 1000)],
    baseline: []
  });
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.unchanged[0].reason, 'first-run-equal');
  assert.equal(plan.unchanged[0].baselineUpdate, true);
  assert.equal(plan.copyToDest.length + plan.copyToSource.length, 0);
});

test('first run, differing content both sides -> conflict', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 10, 9000)],
    destFiles: [f('a.txt', 99, 1000)],
    baseline: []
  });
  assert.equal(plan.conflicts.length, 1);
  assert.match(plan.conflicts[0].reason, /^first-run-diff/);
});

// --- mixed scenario + summary --------------------------------------------

test('mixed tree produces correct buckets and summary counts', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [
      f('new-source.txt', 5, 1000),       // -> copyToDest (new)
      f('keep.txt', 5, 1000),             // unchanged
      f('edited-source.txt', 9, 8000),    // -> copyToDest (modified)
      f('dest-gone.txt', 5, 1000)         // dest deleted -> deleteOnSource
    ],
    destFiles: [
      f('new-dest.txt', 5, 1000),         // -> copyToSource (new)
      f('keep.txt', 5, 1000),             // unchanged
      f('edited-source.txt', 5, 1000)     // dest still at baseline
    ],
    baseline: [
      rec('keep.txt', o(5, 1000), o(5, 1000)),
      rec('edited-source.txt', o(5, 1000), o(5, 1000)),
      rec('dest-gone.txt', o(5, 1000), o(5, 1000))
    ]
  });

  assert.deepEqual(onlyPath(plan.copyToDest).sort(), ['edited-source.txt', 'new-source.txt']);
  assert.deepEqual(onlyPath(plan.copyToSource), ['new-dest.txt']);
  assert.deepEqual(onlyPath(plan.deleteOnSource), ['dest-gone.txt']);
  assert.equal(plan.deleteOnDest.length, 0);
  assert.equal(plan.summary.copyToDest, 2);
  assert.equal(plan.summary.copyToSource, 1);
  assert.equal(plan.summary.deleteOnSource, 1);
  assert.equal(plan.summary.unchanged, 1);
  assert.equal(plan.summary.conflicts, 0);
});

test('relative paths are normalized so backslash and forward slash match', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('sub\\a.txt', 20, 9000)],
    destFiles: [f('sub/a.txt', 10, 1000)],
    baseline: [rec('sub/a.txt', o(10, 1000), o(10, 1000))]
  });
  assert.deepEqual(onlyPath(plan.copyToDest), ['sub/a.txt']);
  assert.equal(plan.copyToSource.length, 0);
});

// --- M4: clock-skew visibility on 'newer' resolutions ----------------------

test('newer-policy conflict resolutions carry mtimeDeltaMs (skew signal)', () => {
  // Both sides changed vs baseline; source is 30s newer.
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 20, 100_000)],
    destFiles: [f('a.txt', 30, 70_000)],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))],
    policy: 'newer'
  });

  assert.equal(plan.copyToDest.length, 1);
  assert.equal(plan.copyToDest[0].conflict, true);
  assert.equal(plan.copyToDest[0].mtimeDeltaMs, 30_000, 'the margin of the newer-wins call is exposed');
});

test('a tie within tolerance keeps both and stamps the small delta', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 20, 100_000)],
    destFiles: [f('a.txt', 30, 100_500)],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))],
    policy: 'newer'
  });

  assert.equal(plan.keepBoth.length, 1, 'sub-tolerance skew resolves to keep-both, not a guess');
  assert.equal(plan.keepBoth[0].mtimeDeltaMs, 500);
});

test('explicit source/dest policies do not stamp mtimeDeltaMs', () => {
  const plan = buildTwoWayPlan({
    sourceFiles: [f('a.txt', 20, 100_000)],
    destFiles: [f('a.txt', 30, 70_000)],
    baseline: [rec('a.txt', o(10, 1000), o(10, 1000))],
    policy: 'source'
  });
  assert.equal(plan.copyToDest.length, 1);
  assert.equal('mtimeDeltaMs' in plan.copyToDest[0], false, 'delta is a newer-policy signal only');
});
