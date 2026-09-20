const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  copyFilePreservingTimes,
  statFileOrNull,
  statAnyOrNull,
  collectSourceFiles,
  shouldSourceReplaceTarget,
  fileMetadata,
  makeExcludeMatcher,
  wildcardToRegExp,
  normalizeRelativeForMatch,
  assertRelativePath,
  resolveInside,
  isPathInside,
  pathsShareStorageRoot
} = require('../src/main/fs-utils');

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'syncarr-fsutils-'));
}

test('normalizeRelativeForMatch lowercases and normalizes separators', () => {
  assert.equal(normalizeRelativeForMatch('\\Foo\\Bar'), 'foo/bar');
  assert.equal(normalizeRelativeForMatch('/A//B/'), 'a/b/');
  assert.equal(normalizeRelativeForMatch(null), '');
});

test('wildcardToRegExp matches case-insensitively with * and ?', () => {
  const re = wildcardToRegExp('*.ffs_db');
  assert.ok(re.test('sync.FFS_DB'));
  assert.ok(!re.test('sync.txt'));
  assert.ok(wildcardToRegExp('a?c').test('aXc'));
});

test('makeExcludeMatcher matches bare names, path prefixes, and wildcards', () => {
  const matcher = makeExcludeMatcher(['node_modules', 'dist/bundle', '*.tmp']);
  assert.ok(matcher('node_modules'), 'bare name anywhere');
  assert.ok(matcher('src/node_modules/x.js'), 'bare name as a segment');
  assert.ok(matcher('dist/bundle'), 'exact slash-path match');
  assert.ok(matcher('dist/bundle/app.js'), 'slash-path prefix match');
  assert.ok(matcher('cache.tmp'), 'wildcard on basename');
  assert.ok(!matcher('src/app.js'), 'unrelated path not matched');
  assert.ok(!matcher('dist/other.js'), 'different slash-path not matched');
});

test('makeExcludeMatcher with empty/blank patterns matches nothing', () => {
  const matcher = makeExcludeMatcher(['', '   ', null]);
  assert.ok(!matcher('anything'));
});

test('shouldSourceReplaceTarget honors the skip-older safety rule and size/time', () => {
  const older = { size: 10, mtimeMs: 1_000 };
  const newer = { size: 10, mtimeMs: 10_000 };

  assert.deepEqual(
    shouldSourceReplaceTarget(older, newer, true),
    { copy: false, reason: 'older-source' }
  );
  assert.deepEqual(
    shouldSourceReplaceTarget(newer, older, true),
    { copy: true, reason: 'newer-source' }
  );
  assert.deepEqual(
    shouldSourceReplaceTarget({ size: 20, mtimeMs: 1_000 }, { size: 10, mtimeMs: 1_000 }, true),
    { copy: true, reason: 'changed-size' }
  );
  assert.deepEqual(
    shouldSourceReplaceTarget(older, newer, false),
    { copy: true, reason: 'older-source-allowed' }
  );
  assert.deepEqual(
    shouldSourceReplaceTarget({ size: 10, mtimeMs: 5_000 }, { size: 10, mtimeMs: 5_000 }, true),
    { copy: false, reason: 'unchanged' }
  );
});

test('shouldSourceReplaceTarget treats sub-tolerance time drift as unchanged', () => {
  const a = { size: 10, mtimeMs: 5_000 };
  const b = { size: 10, mtimeMs: 6_000 }; // 1s < 2.1s tolerance
  assert.equal(shouldSourceReplaceTarget(a, b, true).copy, false);
});

test('assertRelativePath rejects absolute and traversal paths', () => {
  assert.equal(assertRelativePath('foo/bar.txt', 'x'), 'foo/bar.txt');
  assert.equal(assertRelativePath('a\\b', 'x'), 'a/b');
  assert.throws(() => assertRelativePath('../escape', 'thing'), /Invalid thing/);
  assert.throws(() => assertRelativePath('a/../../b', 'thing'), /Invalid thing/);
  assert.throws(() => assertRelativePath('', 'thing'), /Invalid thing/);
  assert.throws(() => assertRelativePath(path.resolve('/abs'), 'thing'), /Invalid thing/);
});

test('isPathInside distinguishes contained vs escaping paths', () => {
  const root = path.resolve('/data/root');
  assert.ok(isPathInside(root, path.join(root, 'a/b')));
  assert.ok(isPathInside(root, root));
  assert.ok(!isPathInside(root, path.resolve('/data/other')));
});

test('resolveInside returns a contained absolute path and blocks traversal', async () => {
  const root = await makeTmpDir();
  const resolved = resolveInside(root, 'sub/file.txt', 'output');
  assert.ok(resolved.startsWith(path.resolve(root)));
  assert.throws(() => resolveInside(root, '../escape.txt', 'output'), /Invalid output/);
  await fs.rm(root, { recursive: true, force: true });
});

test('pathsShareStorageRoot compares filesystem roots', () => {
  const a = path.resolve('/x/y');
  const b = path.resolve('/x/z');
  assert.ok(pathsShareStorageRoot(a, b));
});

test('statAnyOrNull / statFileOrNull return null for missing paths', async () => {
  const missing = path.join(os.tmpdir(), 'syncarr-does-not-exist-xyz');
  assert.equal(await statAnyOrNull(missing), null);
  assert.equal(await statFileOrNull(missing), null);
});

test('copyFilePreservingTimes copies content and mtime, fileMetadata reflects it', async () => {
  const dir = await makeTmpDir();
  const src = path.join(dir, 'src.txt');
  const dest = path.join(dir, 'nested', 'dest.txt');
  await fs.writeFile(src, 'hello');
  const srcStats = await fs.stat(src);

  await copyFilePreservingTimes(src, dest, srcStats);

  assert.equal(await fs.readFile(dest, 'utf8'), 'hello');
  const destStats = await fs.stat(dest);
  assert.ok(Math.abs(destStats.mtimeMs - srcStats.mtimeMs) < 2000, 'mtime preserved');

  const meta = fileMetadata(destStats);
  assert.equal(meta.size, 5);
  assert.equal(typeof meta.mtime, 'string');
  assert.equal(typeof meta.mtimeMs, 'number');

  await fs.rm(dir, { recursive: true, force: true });
});

test('collectSourceFiles walks recursively, applies excludes, and threads cancellation', async () => {
  const dir = await makeTmpDir();
  await fs.mkdir(path.join(dir, 'sub'), { recursive: true });
  await fs.writeFile(path.join(dir, 'keep.txt'), 'a');
  await fs.writeFile(path.join(dir, 'skip.tmp'), 'b');
  await fs.writeFile(path.join(dir, 'sub', 'deep.txt'), 'c');

  const recursive = await collectSourceFiles({
    sourcePath: dir,
    copySubfolders: true,
    excludePatterns: ['*.tmp']
  });
  const relPaths = recursive.map((f) => normalizeRelativeForMatch(f.relativePath)).sort();
  assert.deepEqual(relPaths, ['keep.txt', 'sub/deep.txt']);
  assert.ok(recursive.every((f) => f.stats && typeof f.stats.size === 'number'), 'each entry is stat-ed');

  const flat = await collectSourceFiles({
    sourcePath: dir,
    copySubfolders: false,
    excludePatterns: ['*.tmp']
  });
  assert.deepEqual(flat.map((f) => f.relativePath), ['keep.txt']);

  let calls = 0;
  await assert.rejects(
    collectSourceFiles({
      sourcePath: dir,
      copySubfolders: true,
      excludePatterns: [],
      throwIfCancelled: () => {
        calls += 1;
        if (calls > 1) throw new Error('cancelled');
      }
    }),
    /cancelled/
  );

  await fs.rm(dir, { recursive: true, force: true });
});
