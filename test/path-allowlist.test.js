const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createPathAllowlist } = require('../src/main/path-allowlist');

// path.resolve so the expected roots normalize the same way the module does
// (resolve + case-fold on win32), keeping the test cross-platform.
function fakeConfig() {
  return {
    jobs: [
      { id: 'a', sourcePaths: [path.resolve('/data/src')], targetDestinations: [{ path: path.resolve('/mnt/nas/backup') }] },
      { id: 'b', sourcePath: path.resolve('/other/src'), targetPath: path.resolve('/other/dst') }
    ]
  };
}

test('isRootAllowed accepts configured sources/destinations and their subpaths', async () => {
  const al = createPathAllowlist({ readConfig: async () => fakeConfig() });
  assert.equal(await al.isRootAllowed(path.resolve('/data/src')), true);
  assert.equal(await al.isRootAllowed(path.resolve('/data/src/sub/dir')), true, 'a subpath of a configured source is allowed');
  assert.equal(await al.isRootAllowed(path.resolve('/mnt/nas/backup')), true);
  assert.equal(await al.isRootAllowed(path.resolve('/other/src')), true);
  assert.equal(await al.isRootAllowed(path.resolve('/other/dst')), true);
});

test('isRootAllowed rejects unrelated roots and parents of configured roots', async () => {
  const al = createPathAllowlist({ readConfig: async () => fakeConfig() });
  assert.equal(await al.isRootAllowed(path.resolve('/somewhere/else')), false);
  assert.equal(await al.isRootAllowed(path.resolve('/data')), false, 'a PARENT of a configured source is not allowed');
  assert.equal(await al.isRootAllowed(''), false);
  assert.equal(await al.isRootAllowed(null), false);
});

test('an ad-hoc (non-configured) folder is not allowed — restore-to-folder is gated by containment, not this list', async () => {
  const al = createPathAllowlist({ readConfig: async () => fakeConfig() });
  assert.equal(await al.isRootAllowed(path.resolve('/tmp/restore-here')), false);
});

test('assertRootAllowed throws a clear error for a disallowed root, passes for an allowed one', async () => {
  const al = createPathAllowlist({ readConfig: async () => fakeConfig() });
  await assert.rejects(al.assertRootAllowed(path.resolve('/evil/startup'), 'restore destination'), /not an allowed location/);
  await assert.doesNotReject(al.assertRootAllowed(path.resolve('/data/src'), 'restore destination'));
});

test('a readConfig failure fails closed — nothing is allowed', async () => {
  const al = createPathAllowlist({ readConfig: async () => { throw new Error('config unreadable'); } });
  assert.equal(await al.isRootAllowed(path.resolve('/data/src')), false);
});

test('createPathAllowlist requires a readConfig function', () => {
  assert.throws(() => createPathAllowlist({}), /readConfig/);
});
