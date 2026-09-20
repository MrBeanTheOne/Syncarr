const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');

const { createConfigStore } = require('../src/main/config-store');

test('config store serializes background and GUI writes', async (t) => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'syncarr-config-store-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const store = createConfigStore({ getPath: () => userData });

  const first = store.writeConfig({ jobs: [{ id: 'first', name: 'First' }], activeJobId: 'first' });
  const second = store.writeConfig({ jobs: [{ id: 'second', name: 'Second' }], activeJobId: 'second' });
  const readDuringWrites = store.readConfig();

  await Promise.all([first, second]);
  const saved = await readDuringWrites;
  assert.equal(saved.activeJobId, 'second');
  assert.equal(saved.jobs[0].name, 'Second');
});

test('config store keeps rotating backups and recovers malformed primary config', async (t) => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'syncarr-config-recovery-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const store = createConfigStore({ getPath: () => userData });

  await store.writeConfig({ jobs: [{ id: 'first', name: 'First' }], activeJobId: 'first' });
  await store.writeConfig({ jobs: [{ id: 'second', name: 'Second' }], activeJobId: 'second' });
  await fs.writeFile(store.getConfigPath(), '{not valid json', 'utf8');

  const recovered = await store.readConfig();
  assert.equal(recovered.activeJobId, 'first');
  assert.equal(store.getHealth().recovered, true);
  assert.equal(store.getHealth().source, 'backup 1');
});

test('config store prefers a valid interrupted temporary write over older backups', async (t) => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'syncarr-config-temp-recovery-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const store = createConfigStore({ getPath: () => userData });

  await store.writeConfig({ jobs: [{ id: 'first', name: 'First' }], activeJobId: 'first' });
  await fs.writeFile(store.getConfigPath(), '{broken', 'utf8');
  await fs.writeFile(store.getTempPath(), JSON.stringify({ jobs: [{ id: 'newest', name: 'Newest' }], activeJobId: 'newest' }), 'utf8');

  const recovered = await store.readConfig();
  assert.equal(recovered.activeJobId, 'newest');
  assert.equal(store.getHealth().source, 'temporary file');
});
