const test = require('node:test');
const assert = require('node:assert/strict');

const { applyTwoWayPlan, makeConflictName } = require('../src/main/two-way-execute');

// ---- in-memory filesystem + injected deps -------------------------------
function makeHarness(initial = {}) {
  const files = new Map(Object.entries(initial)); // absPath -> content string
  const archived = [];
  const baseline = new Map(); // relativePath -> record
  const removed = [];
  let archiveFailOn = null;

  const enoent = (msg) => { const e = new Error(msg); e.code = 'ENOENT'; return e; };

  const fileOps = {
    async ensureDir() {},
    async copyFile(src, dst) {
      if (!files.has(src)) throw enoent('copy ' + src);
      files.set(dst, files.get(src));
    },
    async removeFile(p) {
      if (!files.has(p)) throw enoent('rm ' + p);
      files.delete(p);
    },
    async rename(from, to) {
      if (!files.has(from)) throw enoent('rename ' + from);
      files.set(to, files.get(from));
      files.delete(from);
    },
    async stat(p) {
      if (!files.has(p)) throw enoent('stat ' + p);
      return { size: String(files.get(p)).length, mtimeMs: 1000 };
    }
  };

  const deps = {
    resolvePaths: (rel) => ({ sourceAbs: `/src/${rel}`, destAbs: `/dst/${rel}` }),
    fileOps,
    archive: async ({ side, absPath, relativePath }) => {
      if (archiveFailOn && absPath.includes(archiveFailOn)) throw new Error('archive failed');
      if (!files.has(absPath)) return false;
      archived.push({ side, absPath, relativePath });
      return true;
    },
    recordSynced: async ({ relativePath, sourceObs, destObs, action }) => {
      baseline.set(relativePath, { sourceObs, destObs, action });
    },
    recordRemoved: async (rel) => { baseline.delete(rel); removed.push(rel); },
    conflictTag: 'X'
  };

  return {
    files, archived, baseline, removed, deps,
    failArchiveOn: (frag) => { archiveFailOn = frag; }
  };
}

const e = (rel, extra = {}) => ({ relativePath: rel, source: null, destination: null, conflict: false, ...extra });
function emptyPlan(over = {}) {
  return { copyToDest: [], copyToSource: [], deleteOnDest: [], deleteOnSource: [], keepBoth: [], dropFromBaseline: [], ...over };
}

// ---- copies --------------------------------------------------------------

test('copyToDest (new) copies source→dest and records baseline; no archive', async (t) => {
  const h = makeHarness({ '/src/a.txt': 'A' });
  const r = await applyTwoWayPlan(emptyPlan({ copyToDest: [e('a.txt', { source: { size: 1, mtimeMs: 1 } })] }), h.deps);
  assert.equal(h.files.get('/dst/a.txt'), 'A');
  assert.equal(r.copiedToDest, 1);
  assert.equal(r.bytesCopied, 1);
  assert.equal(r.archived, 0);
  assert.ok(h.baseline.has('a.txt'));
  assert.equal(r.ok, true);
});

test('copyToDest (update) archives the existing destination first', async (t) => {
  const h = makeHarness({ '/src/a.txt': 'NEW', '/dst/a.txt': 'OLD' });
  const r = await applyTwoWayPlan(emptyPlan({
    copyToDest: [e('a.txt', { source: { size: 3, mtimeMs: 9 }, destination: { size: 3, mtimeMs: 1 } })]
  }), h.deps);
  assert.equal(h.files.get('/dst/a.txt'), 'NEW');
  assert.equal(r.archived, 1);
  assert.deepEqual(h.archived[0].side, 'destination');
});

test('copyToSource copies dest→source', async (t) => {
  const h = makeHarness({ '/dst/b.txt': 'B' });
  const r = await applyTwoWayPlan(emptyPlan({ copyToSource: [e('b.txt', { destination: { size: 1, mtimeMs: 1 } })] }), h.deps);
  assert.equal(h.files.get('/src/b.txt'), 'B');
  assert.equal(r.copiedToSource, 1);
  assert.equal(r.bytesCopied, 1);
});

// ---- deletes (archive first) --------------------------------------------

test('deleteOnDest archives then removes', async (t) => {
  const h = makeHarness({ '/dst/gone.txt': 'G' });
  const r = await applyTwoWayPlan(emptyPlan({ deleteOnDest: [e('gone.txt', { destination: { size: 1, mtimeMs: 1 } })] }), h.deps);
  assert.equal(h.files.has('/dst/gone.txt'), false);
  assert.equal(r.deletedOnDest, 1);
  assert.equal(r.archived, 1);
  assert.deepEqual(h.removed, ['gone.txt']);
});

test('deleteOnSource archives then removes', async (t) => {
  const h = makeHarness({ '/src/gone.txt': 'G' });
  const r = await applyTwoWayPlan(emptyPlan({ deleteOnSource: [e('gone.txt', { source: { size: 1, mtimeMs: 1 } })] }), h.deps);
  assert.equal(h.files.has('/src/gone.txt'), false);
  assert.equal(r.deletedOnSource, 1);
});

test('SAFETY: a failed archive aborts that delete and records an error', async (t) => {
  const h = makeHarness({ '/dst/protected.txt': 'KEEP' });
  h.failArchiveOn('protected');
  const r = await applyTwoWayPlan(emptyPlan({ deleteOnDest: [e('protected.txt', { destination: { size: 4, mtimeMs: 1 } })] }), h.deps);
  assert.equal(h.files.get('/dst/protected.txt'), 'KEEP', 'file must NOT be deleted when archive fails');
  assert.equal(r.deletedOnDest, 0);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].op, 'deleteOnDest');
});

// ---- keep-both (convergent) ---------------------------------------------

test('keepBoth: source wins the name on both sides, dest version preserved as conflicted copy', async (t) => {
  const h = makeHarness({ '/src/song.mp3': 'SRC', '/dst/song.mp3': 'DST' });
  const r = await applyTwoWayPlan(emptyPlan({
    keepBoth: [e('song.mp3', { source: { size: 3, mtimeMs: 9 }, destination: { size: 3, mtimeMs: 8 }, conflict: true })]
  }), h.deps);

  const conflict = 'song (conflicted copy X).mp3';
  assert.equal(h.files.get('/dst/song.mp3'), 'SRC', 'dest name takes source version');
  assert.equal(h.files.get('/src/song.mp3'), 'SRC', 'source name unchanged');
  assert.equal(h.files.get(`/dst/${conflict}`), 'DST', 'dest keeps its version as conflicted copy');
  assert.equal(h.files.get(`/src/${conflict}`), 'DST', 'source receives the conflicted copy');
  assert.equal(r.keptBoth, 1);
  assert.equal(r.conflicts, 1);
  assert.equal(r.bytesCopied, 6);
  assert.ok(h.baseline.has('song.mp3'));
  assert.ok(h.baseline.has(conflict), 'baseline records the conflicted copy so it will not re-conflict');
});

test('keepBoth is crash-consistent: the destination original name is never absent if the overwrite fails', async (t) => {
  const h = makeHarness({ '/src/song.mp3': 'SRC', '/dst/song.mp3': 'DST' });
  const conflict = 'song (conflicted copy X).mp3';

  // Simulate a crash AT the source→dest overwrite (after the dest version has
  // been preserved under the conflict name). With copy-then-overwrite, the
  // destination's original name must still hold its old content — with the old
  // rename-then-copy order it would be gone, and a re-run would misread that as
  // a deletion to propagate to the source.
  const realCopy = h.deps.fileOps.copyFile;
  h.deps.fileOps.copyFile = async (src, dst) => {
    if (src === '/src/song.mp3' && dst === '/dst/song.mp3') throw new Error('crash mid-overwrite');
    return realCopy(src, dst);
  };

  const r = await applyTwoWayPlan(emptyPlan({
    keepBoth: [e('song.mp3', { source: { size: 3, mtimeMs: 9 }, destination: { size: 3, mtimeMs: 8 }, conflict: true })]
  }), h.deps);

  assert.equal(r.ok, false, 'the failed keep-both is reported');
  assert.equal(h.files.get('/dst/song.mp3'), 'DST', 'destination original name is never absent');
  assert.equal(h.files.get(`/dst/${conflict}`), 'DST', 'dest version was preserved before the overwrite');
});

test('makeConflictName keeps the extension', () => {
  assert.equal(makeConflictName('dir/a.txt', 'TAG'), 'dir/a (conflicted copy TAG).txt');
  assert.equal(makeConflictName('noext', 'TAG'), 'noext (conflicted copy TAG)');
});

// ---- robustness ----------------------------------------------------------

test('per-file errors are isolated; other files still apply', async (t) => {
  const h = makeHarness({ '/src/ok.txt': 'OK' }); // missing.txt has no source -> copy throws
  const r = await applyTwoWayPlan(emptyPlan({
    copyToDest: [e('missing.txt', { source: { size: 1, mtimeMs: 1 } }), e('ok.txt', { source: { size: 2, mtimeMs: 1 } })]
  }), h.deps);
  assert.equal(h.files.get('/dst/ok.txt'), 'OK');
  assert.equal(r.copiedToDest, 1);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].relativePath, 'missing.txt');
});

test('cancellation stops further work and reports cancelled', async (t) => {
  const h = makeHarness({ '/src/a.txt': 'A', '/src/b.txt': 'B' });
  let calls = 0;
  const deps = { ...h.deps, isCancelled: () => (calls++ > 0) }; // allow first, cancel before second
  const r = await applyTwoWayPlan(emptyPlan({
    copyToDest: [e('a.txt', { source: { size: 1, mtimeMs: 1 } }), e('b.txt', { source: { size: 1, mtimeMs: 1 } })]
  }), deps);
  assert.equal(r.status, 'cancelled');
  assert.equal(r.copiedToDest, 1);
  assert.equal(h.files.has('/dst/b.txt'), false);
});

test('dropFromBaseline forgets paths gone on both sides', async (t) => {
  const h = makeHarness();
  const r = await applyTwoWayPlan(emptyPlan({ dropFromBaseline: ['x.txt', 'y.txt'] }), h.deps);
  assert.deepEqual(h.removed.sort(), ['x.txt', 'y.txt']);
  assert.equal(r.ok, true);
});

test('a full mixed plan reports correct totals', async (t) => {
  const h = makeHarness({
    '/src/new.txt': 'N',
    '/src/up.txt': 'U2', '/dst/up.txt': 'U1',
    '/dst/incoming.txt': 'I',
    '/dst/del.txt': 'D'
  });
  const r = await applyTwoWayPlan(emptyPlan({
    copyToDest: [e('new.txt', { source: { size: 1, mtimeMs: 1 } }), e('up.txt', { source: { size: 2, mtimeMs: 9 }, destination: { size: 2, mtimeMs: 1 } })],
    copyToSource: [e('incoming.txt', { destination: { size: 1, mtimeMs: 1 } })],
    deleteOnDest: [e('del.txt', { destination: { size: 1, mtimeMs: 1 } })]
  }), h.deps);

  assert.equal(r.copiedToDest, 2);
  assert.equal(r.copiedToSource, 1);
  assert.equal(r.deletedOnDest, 1);
  assert.equal(r.archived, 2); // up.txt overwrite + del.txt delete
  assert.equal(r.ok, true);
  assert.equal(h.files.get('/dst/new.txt'), 'N');
  assert.equal(h.files.get('/dst/up.txt'), 'U2');
  assert.equal(h.files.get('/src/incoming.txt'), 'I');
  assert.equal(h.files.has('/dst/del.txt'), false);
});
