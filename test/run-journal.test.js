const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createRunJournalStore } = require('../src/main/run-journal');

async function setup(t) {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'syncarr-run-journal-'));
  t.after(() => fs.rm(basePath, { recursive: true, force: true }));
  return createRunJournalStore({ basePath, now: () => new Date('2026-06-20T12:00:00.000Z') });
}

test('run journal records plans and operation progress', async (t) => {
  const store = await setup(t);
  const run = await store.createRun({ runId: 'run-1', jobId: 'job-a', jobName: 'A', syncMode: 'mirror' });
  await store.plan(run, [{ id: 'copy:file.txt', type: 'copy', relativePath: 'file.txt' }]);
  await store.recordOperation(run, 'copy:file.txt', { status: 'completed', targetPath: 'D:\\file.txt' });

  const journal = await store.get('job-a', 'run-1');
  assert.equal(journal.status, 'interrupted');
  assert.equal(journal.operations.length, 1);
  assert.equal(journal.operations[0].status, 'completed');
  assert.equal((await store.list({ incompleteOnly: true })).length, 1);
});

test('terminal journal is no longer reported as incomplete', async (t) => {
  const store = await setup(t);
  const run = await store.createRun({ runId: 'run-2', jobId: 'job-a' });
  await store.finish(run, 'completed', { ok: true });
  assert.equal((await store.get('job-a', 'run-2')).status, 'completed');
  assert.equal((await store.list({ incompleteOnly: true })).length, 0);
});

test('journal replay skips a corrupt torn line', async (t) => {
  const store = await setup(t);
  const run = await store.createRun({ runId: 'run-3', jobId: 'job-a' });
  await fs.appendFile(run.path, '{torn final event', 'utf8');
  const journal = await store.get('job-a', 'run-3');
  assert.equal(journal.status, 'interrupted');
  assert.equal(journal.corruptLines, 1);
});
