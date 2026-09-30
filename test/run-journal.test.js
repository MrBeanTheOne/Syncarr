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

test('finishing a run prunes old terminal journals but never interrupted ones', async (t) => {
  const store = await setup(t);
  // 22 terminal runs + 1 old interrupted run; retention keeps the newest 20
  // terminal-or-not and only deletes terminal journals beyond that.
  const interrupted = await store.createRun({ runId: '2026-01-01T00-00-00-000Z', jobId: 'job-a' });
  for (let i = 0; i < 22; i += 1) {
    const runId = `2026-02-01T00-00-${String(i).padStart(2, '0')}-000Z`;
    const run = await store.createRun({ runId, jobId: 'job-a' });
    await store.finish(run, 'completed', { ok: true });
  }

  const names = (await fs.readdir(path.dirname(interrupted.path))).sort();
  assert.equal(names.length, 21);
  // The interrupted journal is the oldest yet survives; the two oldest
  // terminal journals were pruned.
  assert.ok(names.includes('2026-01-01T00-00-00-000Z.jsonl'));
  assert.ok(!names.includes('2026-02-01T00-00-00-000Z.jsonl'));
  assert.ok(!names.includes('2026-02-01T00-00-01-000Z.jsonl'));
  assert.ok(names.includes('2026-02-01T00-00-02-000Z.jsonl'));
  assert.equal((await store.list({ incompleteOnly: true })).length, 1);
});

test('journal replay skips a corrupt torn line', async (t) => {
  const store = await setup(t);
  const run = await store.createRun({ runId: 'run-3', jobId: 'job-a' });
  await fs.appendFile(run.path, '{torn final event', 'utf8');
  const journal = await store.get('job-a', 'run-3');
  assert.equal(journal.status, 'interrupted');
  assert.equal(journal.corruptLines, 1);
});
