const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');

const { runTwoWayApply } = require('../src/main/two-way-apply');
const { createTwoWayHistoryManifests } = require('../src/main/two-way-history');
const { createTwoWayState } = require('../src/main/two-way-state');

const HISTORY = '.syncarr-history';

async function tmp(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}
async function write(root, rel, content) {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}
async function read(root, rel) {
  try { return await fs.readFile(path.join(root, rel), 'utf8'); } catch { return null; }
}
async function exists(root, rel) {
  try { await fs.stat(path.join(root, rel)); return true; } catch { return false; }
}

// Real recursive scanner mirroring collectSourceFiles' output shape, skipping
// the history folder so archived copies are never re-synced.
async function walk(root) {
  const out = [];
  async function rec(dir, base) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.isDirectory() && ent.name === HISTORY) continue;
      const rel = base ? `${base}/${ent.name}` : ent.name;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) await rec(abs, rel);
      else if (ent.isFile()) {
        const st = await fs.stat(abs);
        out.push({ fullPath: abs, relativePath: rel, stats: { size: st.size, mtimeMs: st.mtimeMs } });
      }
    }
  }
  await rec(root, '');
  return out;
}

async function setup(t) {
  const src = await tmp('syncarr-tw-src-');
  const dst = await tmp('syncarr-tw-dst-');
  const data = await tmp('syncarr-tw-data-');
  t.after(() => Promise.all([
    fs.rm(src, { recursive: true, force: true }),
    fs.rm(dst, { recursive: true, force: true }),
    fs.rm(data, { recursive: true, force: true })
  ]));
  const destination = { path: dst, label: '', required: true };
  return { src, dst, data, destination };
}

function runArgs({ src, dst, data, destination }, runId) {
  return {
    sourceRoots: [{ sourcePath: src, destinationPath: dst, relativePrefix: '', destination }],
    destinations: [destination],
    excludePatterns: [],
    copySubfolders: true,
    historyEnabled: true,
    historyFolderName: HISTORY,
    jobId: 'job-a',
    basePath: data,
    runId,
    conflictPolicy: 'newer',
    collectFiles: async ({ sourcePath }) => walk(sourcePath),
    openState: (opts) => createTwoWayState(opts)
  };
}

test('first run: new files copy each way, identical files seed (no deletes)', async (t) => {
  const ctx = await setup(t);
  await write(ctx.src, 'only-src.txt', 'A');
  await write(ctx.dst, 'only-dst.txt', 'B');
  await write(ctx.src, 'shared.txt', 'SAME');
  await write(ctx.dst, 'shared.txt', 'SAME');

  const r = await runTwoWayApply(runArgs(ctx, 'run1'));

  assert.equal(r.ok, true);
  assert.equal(r.copiedToDest, 1);
  assert.equal(r.copiedToSource, 1);
  assert.equal(r.deletedOnDest + r.deletedOnSource, 0, 'nothing deleted on first run');
  assert.equal(await read(ctx.dst, 'only-src.txt'), 'A');
  assert.equal(await read(ctx.src, 'only-dst.txt'), 'B');

  // Baseline now knows all three paths.
  const state = createTwoWayState({ userDataPath: ctx.data, jobId: 'job-a', destinationIndex: 0 });
  await state.ready;
  assert.equal(state.size(), 3);
  await state.close();
});

test('second run propagates a source deletion to the destination (archived)', async (t) => {
  const ctx = await setup(t);
  await write(ctx.src, 'keep.txt', 'K');
  await write(ctx.dst, 'keep.txt', 'K');
  await write(ctx.src, 'doomed.txt', 'D');
  await runTwoWayApply(runArgs(ctx, 'run1')); // seed baseline (keep + doomed on both)

  assert.equal(await exists(ctx.dst, 'doomed.txt'), true);

  // Delete on source, then sync again.
  await fs.rm(path.join(ctx.src, 'doomed.txt'));
  const r = await runTwoWayApply(runArgs(ctx, 'run2'));

  assert.equal(r.deletedOnDest, 1);
  assert.equal(await exists(ctx.dst, 'doomed.txt'), false, 'deletion propagated');
  // Archived before delete.
  assert.equal(await read(ctx.dst, `${HISTORY}/versions/run2/doomed.txt`), 'D');

  const state = createTwoWayState({ userDataPath: ctx.data, jobId: 'job-a', destinationIndex: 0 });
  await state.ready;
  assert.equal(state.getRecord('doomed.txt'), null, 'baseline forgot the deleted file');
  await state.close();
});

test('an edit on one side overwrites the other and archives the prior version', async (t) => {
  const ctx = await setup(t);
  await write(ctx.src, 'note.txt', 'v1');
  await write(ctx.dst, 'note.txt', 'v1');
  await runTwoWayApply(runArgs(ctx, 'run1')); // seed

  // Edit source; bump its mtime well past the destination's.
  await write(ctx.src, 'note.txt', 'v2-longer');
  const future = Date.now() + 60_000;
  await fs.utimes(path.join(ctx.src, 'note.txt'), future / 1000, future / 1000);

  const r = await runTwoWayApply(runArgs(ctx, 'run2'));
  assert.equal(r.copiedToDest, 1);
  assert.equal(await read(ctx.dst, 'note.txt'), 'v2-longer');
  assert.equal(await read(ctx.dst, `${HISTORY}/versions/run2/note.txt`), 'v1', 'old destination version archived');
  assert.equal(r.archives.length, 1);
  assert.equal(r.archives[0].side, 'destination');

  const manifests = await createTwoWayHistoryManifests({
    archives: r.archives,
    runId: 'run2',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    jobId: 'job-a',
    jobName: 'Two-way job',
    sourcePaths: [ctx.src],
    targetDestinations: [ctx.destination],
    historyFolderName: HISTORY,
    status: 'success'
  });
  assert.equal(manifests.length, 1);
  const manifest = JSON.parse(await fs.readFile(manifests[0].manifestPath, 'utf8'));
  assert.equal(manifest.operation, 'two-way-sync');
  assert.equal(manifest.archivedFiles.length, 1);
  assert.equal(manifest.archivedFiles[0].relativePath, 'note.txt');
});

test('destination edits archive the prior source version on the source side', async (t) => {
  const ctx = await setup(t);
  await write(ctx.src, 'note.txt', 'v1');
  await write(ctx.dst, 'note.txt', 'v1');
  await runTwoWayApply(runArgs(ctx, 'run1'));

  await write(ctx.dst, 'note.txt', 'destination-v2');
  const future = Date.now() + 60_000;
  await fs.utimes(path.join(ctx.dst, 'note.txt'), future / 1000, future / 1000);

  const r = await runTwoWayApply(runArgs(ctx, 'run2'));
  assert.equal(r.copiedToSource, 1);
  assert.equal(await read(ctx.src, 'note.txt'), 'destination-v2');
  assert.equal(await read(ctx.src, `${HISTORY}/versions/run2/note.txt`), 'v1');
  assert.equal(r.archives.length, 1);
  assert.equal(r.archives[0].side, 'source');
  assert.equal(path.resolve(r.archives[0].rootPath), path.resolve(ctx.src));
});

test('no changes since baseline => a clean run does nothing', async (t) => {
  const ctx = await setup(t);
  await write(ctx.src, 'a.txt', 'A');
  await write(ctx.dst, 'a.txt', 'A');
  await runTwoWayApply(runArgs(ctx, 'run1'));
  const r = await runTwoWayApply(runArgs(ctx, 'run2'));
  assert.equal(r.copiedToDest, 0);
  assert.equal(r.copiedToSource, 0);
  assert.equal(r.deletedOnDest + r.deletedOnSource, 0);
  assert.equal(r.ok, true);
});

test('a destination scan FAILURE aborts the run instead of deleting the source', async (t) => {
  const ctx = await setup(t);
  await write(ctx.src, 'keep.txt', 'K');
  await write(ctx.dst, 'keep.txt', 'K');
  await write(ctx.src, 'also.txt', 'A');
  await write(ctx.dst, 'also.txt', 'A');
  await runTwoWayApply(runArgs(ctx, 'run1')); // seed baseline on both sides

  // run2: the destination scan throws (NAS dropped mid-scan). The pre-fix code
  // swallowed this to [] and the planner propagated phantom deletes to SOURCE.
  const args = runArgs(ctx, 'run2');
  args.collectFiles = async ({ sourcePath }) => {
    if (sourcePath === ctx.dst) throw Object.assign(new Error('network path not found'), { code: 'ENETUNREACH' });
    return walk(sourcePath);
  };

  await assert.rejects(runTwoWayApply(args), /aborted/i);

  // The source must be untouched — no phantom deletion from a transient blip.
  assert.equal(await read(ctx.src, 'keep.txt'), 'K');
  assert.equal(await read(ctx.src, 'also.txt'), 'A');
  assert.equal(await exists(ctx.src, 'keep.txt'), true);
  assert.equal(await exists(ctx.src, 'also.txt'), true);
});

test('a first sync to a not-yet-created destination still proceeds (missing dir, no baseline)', async (t) => {
  const ctx = await setup(t);
  await write(ctx.src, 'new.txt', 'N');
  const missingDst = path.join(ctx.dst, 'not-created-yet');
  const destination = { path: missingDst, label: '', required: true };

  const args = {
    ...runArgs(ctx, 'run1'),
    sourceRoots: [{ sourcePath: ctx.src, destinationPath: missingDst, relativePrefix: '', destination }],
    destinations: [destination],
    // Mimic production collectSourceFiles: a missing directory throws ENOENT
    // rather than returning [].
    collectFiles: async ({ sourcePath }) => {
      const st = await fs.stat(sourcePath).catch(() => null);
      if (!st) throw Object.assign(new Error('no such directory'), { code: 'ENOENT' });
      return walk(sourcePath);
    }
  };

  const r = await runTwoWayApply(args);
  assert.equal(r.ok, true, 'a genuine first sync to an absent folder is not an error');
  assert.equal(r.copiedToDest, 1);
  assert.equal(await read(missingDst, 'new.txt'), 'N');
});
