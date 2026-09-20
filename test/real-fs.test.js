'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// In the test runner (plain Node) real-fs falls back to plain fs; in Electron it
// resolves to original-fs. Either way it must expose the full fs surface and
// actually read files. The asar-specific behavior (treating `.asar` as a regular
// file) only manifests under Electron and is verified there, not here.
const realFs = require('../src/main/real-fs');

test('real-fs exposes the Node fs surface (sync + promises)', () => {
  assert.equal(typeof realFs.stat, 'function');
  assert.equal(typeof realFs.copyFile, 'function');
  assert.equal(typeof realFs.createReadStream, 'function');
  assert.ok(realFs.promises, 'has a promises API');
  assert.equal(typeof realFs.promises.stat, 'function');
  assert.equal(typeof realFs.promises.copyFile, 'function');
  assert.equal(typeof realFs.promises.readdir, 'function');
});

test('real-fs actually stats real files', async () => {
  const stats = await realFs.promises.stat(__filename);
  assert.ok(stats.isFile());
  assert.ok(stats.size > 0);
});
