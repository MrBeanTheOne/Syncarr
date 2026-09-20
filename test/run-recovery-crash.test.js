const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { createRunJournalStore } = require('../src/main/run-journal');
const { applyRunRollback } = require('../src/main/run-recovery');

test('a process exit leaves a discoverable journal that can roll back', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'syncarr-crash-smoke-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const targetPath = path.join(root, 'live', 'file.txt');
  const archivePath = path.join(root, 'history', 'file.txt');
  const sourcePath = path.join(root, 'source', 'file.txt');
  const childPath = path.join(__dirname, 'fixtures', 'crash-journal-child.fixture');

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [childPath, root, targetPath, archivePath, sourcePath], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(exitCode, 17);

  const store = createRunJournalStore({ basePath: root });
  const interrupted = await store.list({ incompleteOnly: true });
  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].status, 'interrupted');
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'after-crash');

  const rollback = await applyRunRollback(interrupted[0], { journalStore: store });
  assert.equal(rollback.ok, true);
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'before-crash');
  assert.equal((await store.list({ incompleteOnly: true })).length, 0);
});
