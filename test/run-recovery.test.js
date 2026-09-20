const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { previewRunRollback, applyRunRollback } = require('../src/main/run-recovery');

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'syncarr-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function write(root, name, content) {
  const target = path.join(root, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  const stats = await fs.stat(target);
  return { path: target, meta: { size: stats.size, mtimeMs: stats.mtimeMs } };
}

test('rollback restores archived overwrites and removes matching new files', async (t) => {
  const root = await setup(t);
  const archive = await write(root, 'archive/changed.txt', 'before');
  const changed = await write(root, 'live/changed.txt', 'after-content');
  const created = await write(root, 'live/new.txt', 'new');
  const changedSource = await write(root, 'source/changed.txt', 'after-content');
  const createdSource = await write(root, 'source/new.txt', 'new');
  const journal = {
    operations: [
      { id: 'overwrite', targetPath: changed.path, sourcePath: changedSource.path, archivePath: archive.path, before: archive.meta, expectedAfter: changed.meta },
      { id: 'new', targetPath: created.path, sourcePath: createdSource.path, before: null, expectedAfter: created.meta }
    ]
  };

  const preview = await previewRunRollback(journal);
  assert.equal(preview.ready, true);
  assert.deepEqual(preview.totals, { restore: 1, remove: 1, unchanged: 0, manual: 0 });
  const result = await applyRunRollback(journal);
  assert.equal(result.ok, true);
  assert.equal(await fs.readFile(changed.path, 'utf8'), 'before');
  await assert.rejects(fs.stat(created.path), { code: 'ENOENT' });
});

test('rollback refuses every mutation when a live file drifted', async (t) => {
  const root = await setup(t);
  const archive = await write(root, 'archive/a.txt', 'old');
  const live = await write(root, 'live/a.txt', 'expected');
  const expected = live.meta;
  await fs.writeFile(live.path, 'user changed this afterward');
  const journal = { operations: [{ id: 'a', targetPath: live.path, archivePath: archive.path, before: archive.meta, expectedAfter: expected }] };

  const result = await applyRunRollback(journal);
  assert.equal(result.ok, false);
  assert.equal(result.applied, false);
  assert.equal(await fs.readFile(live.path, 'utf8'), 'user changed this afterward');
});

test('a planned overwrite that never started needs no archive to be safe', async (t) => {
  const root = await setup(t);
  const live = await write(root, 'live/a.txt', 'original');
  const journal = { operations: [{ id: 'a', status: 'planned', targetPath: live.path, before: live.meta, expectedAfter: { size: 999, mtimeMs: live.meta.mtimeMs + 10000 } }] };
  const preview = await previewRunRollback(journal);
  assert.equal(preview.ready, true);
  assert.deepEqual(preview.totals, { restore: 0, remove: 0, unchanged: 1, manual: 0 });
});

test('matching size and timestamp cannot bypass content verification', async (t) => {
  const root = await setup(t);
  const archive = await write(root, 'archive/a.txt', 'old!');
  const source = await write(root, 'source/a.txt', 'good');
  const live = await write(root, 'live/a.txt', 'good');
  await fs.writeFile(live.path, 'evil');
  await fs.utimes(live.path, live.meta.mtimeMs / 1000, live.meta.mtimeMs / 1000);
  const journal = { operations: [{
    id: 'a',
    targetPath: live.path,
    sourcePath: source.path,
    archivePath: archive.path,
    before: archive.meta,
    expectedAfter: live.meta,
    sourceExpected: source.meta
  }] };
  const preview = await previewRunRollback(journal);
  assert.equal(preview.ready, false);
  assert.equal(preview.totals.manual, 1);
});

test('a deleted file can be restored when its archive exists', async (t) => {
  const root = await setup(t);
  const archive = await write(root, 'archive/deleted.txt', 'restore me');
  const targetPath = path.join(root, 'live/deleted.txt');
  const journal = { operations: [{ id: 'delete', targetPath, archivePath: archive.path, before: archive.meta, expectedAfter: null }] };
  const result = await applyRunRollback(journal);
  assert.equal(result.ok, true);
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'restore me');
});

test('rollback handles synced .asar files like any other file (asar-virtualization guard)', async (t) => {
  // A synced Electron app's app.asar is a real file the user backs up. Under
  // Electron's patched fs it would stat as a 0-byte virtual directory, so
  // classifyOperation would flag it 'manual' and block the whole rollback.
  // run-recovery.js routes through ./real-fs (original-fs) so .asar is the
  // ordinary file it is. The node --test runner applies no asar patch, so this
  // exercises the rollback paths against .asar-named files to lock in that no
  // code path special-cases the extension; real-fs.test.js is the contract guard
  // that the handle itself un-virtualizes .asar under Electron.
  const root = await setup(t);
  const archive = await write(root, 'archive/resources/app.asar', 'archived-asar-bytes');
  const changed = await write(root, 'live/resources/app.asar', 'overwritten-asar-bytes');
  const created = await write(root, 'live/resources/new.asar', 'created-asar');
  const changedSource = await write(root, 'source/resources/app.asar', 'overwritten-asar-bytes');
  const createdSource = await write(root, 'source/resources/new.asar', 'created-asar');
  const journal = {
    operations: [
      { id: 'overwrite', targetPath: changed.path, sourcePath: changedSource.path, archivePath: archive.path, before: archive.meta, expectedAfter: changed.meta },
      { id: 'new', targetPath: created.path, sourcePath: createdSource.path, before: null, expectedAfter: created.meta }
    ]
  };

  const preview = await previewRunRollback(journal);
  assert.equal(preview.ready, true, 'a .asar target must not be misclassified as manual');
  assert.deepEqual(preview.totals, { restore: 1, remove: 1, unchanged: 0, manual: 0 });
  const result = await applyRunRollback(journal);
  assert.equal(result.ok, true);
  assert.equal(await fs.readFile(changed.path, 'utf8'), 'archived-asar-bytes');
  await assert.rejects(fs.stat(created.path), { code: 'ENOENT' });
});

test('rollback runs post-apply state repair before closing the journal', async (t) => {
  const root = await setup(t);
  const archive = await write(root, 'archive/a.txt', 'old');
  const live = await write(root, 'live/a.txt', 'new');
  const source = await write(root, 'source/a.txt', 'new');
  const calls = [];
  const journalStore = {
    async recordOperation() { calls.push('record'); },
    async finish() { calls.push('finish'); }
  };
  const journal = { operations: [{ id: 'a', targetPath: live.path, sourcePath: source.path, archivePath: archive.path, before: archive.meta, expectedAfter: live.meta }] };
  const result = await applyRunRollback(journal, {
    journalStore,
    afterApply: async () => { calls.push('repair'); }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['record', 'repair', 'finish']);
});

// --- M6: degraded journals refuse automatic rollback -------------------------

test('a journal with damaged lines refuses automatic rollback', async (t) => {
  const root = await setup(t);
  const archive = await write(root, 'archive/a.txt', 'old');
  const live = await write(root, 'live/a.txt', 'new');
  const journal = {
    corruptLines: 2,
    operations: [{ id: 'a', targetPath: live.path, archivePath: archive.path, before: archive.meta, expectedAfter: live.meta }]
  };

  const preview = await previewRunRollback(journal);
  assert.equal(preview.ready, false, 'a degraded journal is never auto-rollback ready');
  assert.equal(preview.degraded, true);
  assert.match(preview.message, /2 damaged line/);
  assert.equal(preview.operations.length, 0);

  const result = await applyRunRollback(journal);
  assert.equal(result.applied, false, 'apply refuses via the degraded preview');
  assert.equal(await fs.readFile(live.path, 'utf8'), 'new', 'no file was touched');
});

// --- M7: mid-list apply failure stops cleanly and reports what was applied ---

test('a mid-list apply failure reports the applied prefix instead of rejecting', async (t) => {
  const root = await setup(t);
  // Op A (applied second — journal ops are processed in reverse): a restore of
  // a "deleted" file whose target path runs THROUGH a plain file, so the
  // mkdir inside restoreArchive throws EEXIST at apply time (stat of the same
  // path yields ENOENT, so the confirm pass classifies it as a clean restore).
  const blocker = await write(root, 'live/block.txt', 'i am a file, not a folder');
  const blockedTarget = path.join(blocker.path, 'nested.txt');
  const blockedArchive = await write(root, 'archive/nested.txt', 'restore me');
  // Op B (applied first): a normal restorable overwrite.
  const archive = await write(root, 'archive/b.txt', 'before');
  const changed = await write(root, 'live/b.txt', 'after-content');
  const changedSource = await write(root, 'source/b.txt', 'after-content');

  const journal = {
    operations: [
      { id: 'blocked', targetPath: blockedTarget, archivePath: blockedArchive.path, before: blockedArchive.meta, expectedAfter: null },
      { id: 'restore-b', targetPath: changed.path, sourcePath: changedSource.path, archivePath: archive.path, before: archive.meta, expectedAfter: changed.meta }
    ]
  };

  const recorded = [];
  const journalStore = {
    recordOperation: async (_j, id, patch) => { recorded.push({ id, ...patch }); },
    finish: async (_j, status) => { recorded.push({ finish: status }); }
  };

  const result = await applyRunRollback(journal, { journalStore });

  assert.equal(result.ok, false);
  assert.equal(result.partial, true, 'the failure is reported as partial, not thrown');
  assert.equal(result.applied, true, 'work WAS applied before the failure');
  assert.deepEqual(result.appliedOperations, [{ id: 'restore-b', action: 'restore' }]);
  assert.equal(result.failedOperation.id, 'blocked');
  assert.equal(await fs.readFile(changed.path, 'utf8'), 'before', 'the first op really was applied (temp+rename restore)');
  assert.ok(recorded.some((r) => r.id === 'blocked' && r.rollbackStatus === 'rollback-failed'), 'the failed op is journaled');
  assert.ok(!recorded.some((r) => r.finish), 'the journal is NOT finalized — a retry can resume');
  // The temp file from the atomic restore was cleaned up.
  await assert.rejects(fs.stat(`${changed.path}.syncarr-rollback-tmp`), { code: 'ENOENT' });
});
