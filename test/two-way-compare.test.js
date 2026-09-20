const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTwoWayComparePreview,
  twoWayPlanToPreviewRows,
  entryToPreviewRow,
  toEntries
} = require('../src/main/two-way-compare');

// collectSourceFiles-shaped entry
function cf(relativePath, size, mtimeMs) {
  return { fullPath: `/abs/${relativePath}`, relativePath, stats: { size, mtimeMs } };
}
// baseline record
function rec(path, s, d) {
  return { path, source: s, destination: d };
}
function obs(size, mtimeMs) {
  return { size, mtimeMs, sha1: null };
}

// Build a fake collectFiles backed by a { path: [cf...] } map.
function fakeCollect(map) {
  return async ({ sourcePath }) => {
    if (!(sourcePath in map)) throw new Error(`ENOENT ${sourcePath}`);
    return map[sourcePath];
  };
}
function fakeState(records) {
  return () => ({
    ready: Promise.resolve(),
    listRecords: () => records,
    close: async () => {}
  });
}

const dest0 = { path: '/dst', label: '' };
function singleRoot() {
  return [{ sourcePath: '/src', destinationPath: '/dst', relativePrefix: '', destination: dest0 }];
}

// --- pure conversion ------------------------------------------------------

test('entryToPreviewRow labels copy directions and new vs update', () => {
  const newToDest = entryToPreviewRow({ relativePath: 'a', source: obs(5, 9), destination: null, reason: 'source-new' }, 'toDest');
  assert.equal(newToDest.action, 'copy-new');
  assert.equal(newToDest.direction, 'toDest');
  assert.equal(newToDest.copyBytes, 5);

  const updDest = entryToPreviewRow({ relativePath: 'a', source: obs(5, 9), destination: obs(3, 1), reason: 'source-modified' }, 'toDest');
  assert.equal(updDest.action, 'update-archive');
  assert.equal(updDest.label, 'Update destination');

  const toSrc = entryToPreviewRow({ relativePath: 'a', source: null, destination: obs(7, 9), reason: 'dest-new' }, 'toSource');
  assert.equal(toSrc.direction, 'toSource');
  assert.equal(toSrc.copyBytes, 7);
  assert.equal(toSrc.action, 'copy-new');
});

test('twoWayPlanToPreviewRows fans every bucket into direction rows', () => {
  const plan = {
    copyToDest: [{ relativePath: 'cd', source: obs(1, 1), destination: null }],
    copyToSource: [{ relativePath: 'cs', source: null, destination: obs(1, 1) }],
    deleteOnDest: [{ relativePath: 'dd', source: null, destination: obs(1, 1) }],
    deleteOnSource: [{ relativePath: 'ds', source: obs(1, 1), destination: null }],
    keepBoth: [{ relativePath: 'kb', source: obs(1, 2), destination: obs(1, 1), conflict: true }]
  };
  const rows = twoWayPlanToPreviewRows(plan);
  const byPath = Object.fromEntries(rows.map((r) => [r.relativePath, r]));
  assert.equal(byPath.cd.direction, 'toDest');
  assert.equal(byPath.cs.direction, 'toSource');
  assert.equal(byPath.dd.direction, 'deleteDest');
  assert.equal(byPath.dd.action, 'extra');
  assert.equal(byPath.ds.direction, 'deleteSource');
  assert.equal(byPath.kb.direction, 'keepBoth');
  assert.equal(byPath.kb.conflict, true);
});

test('toEntries prefixes paths and drops entries without usable stats', () => {
  const entries = toEntries([cf('a.txt', 5, 1), { relativePath: 'bad', stats: {} }], 'Photos');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].relativePath, 'Photos/a.txt');
});

// --- orchestration --------------------------------------------------------

test('first run, no baseline: new files copy each way', async () => {
  const preview = await buildTwoWayComparePreview({
    sourceRoots: singleRoot(),
    destinations: [dest0],
    excludePatterns: [],
    copySubfolders: true,
    historyEnabled: true,
    jobId: 'job-a',
    basePath: '/data',
    collectFiles: fakeCollect({ '/src': [cf('only-src.txt', 5, 1000)], '/dst': [cf('only-dst.txt', 7, 1000)] }),
    openState: fakeState([])
  });

  assert.equal(preview.summary.copyToDest, 1);
  assert.equal(preview.summary.copyToSource, 1);
  assert.equal(preview.summary.newFiles, 2);
  assert.equal(preview.summary.previewFiles, 2);
  assert.equal(preview.summary.twoWay, true);
  assert.equal(preview.summary.conflictPolicy, 'newer');
  const dirs = preview.files.map((f) => `${f.relativePath}:${f.direction}`).sort();
  assert.deepEqual(dirs, ['only-dst.txt:toSource', 'only-src.txt:toDest']);
});

test('compare reports and applies the selected source precedence policy', async () => {
  const preview = await buildTwoWayComparePreview({
    sourceRoots: singleRoot(),
    destinations: [dest0],
    excludePatterns: [],
    copySubfolders: true,
    historyEnabled: true,
    jobId: 'job-a',
    basePath: '/data',
    conflictPolicy: 'source',
    collectFiles: fakeCollect({ '/src': [cf('conflict.txt', 5, 9000)], '/dst': [cf('conflict.txt', 7, 8000)] }),
    openState: fakeState([])
  });

  assert.equal(preview.summary.conflictPolicy, 'source');
  assert.equal(preview.summary.conflicts, 1);
  assert.equal(preview.summary.copyToDest, 1);
  assert.equal(preview.files[0].direction, 'toDest');
  assert.match(preview.files[0].reason, /source-wins/);
});

test('with baseline: source modified -> update destination', async () => {
  const preview = await buildTwoWayComparePreview({
    sourceRoots: singleRoot(),
    destinations: [dest0],
    excludePatterns: [],
    copySubfolders: true,
    historyEnabled: true,
    jobId: 'job-a',
    basePath: '/data',
    collectFiles: fakeCollect({
      '/src': [cf('shared.txt', 20, 9000)],
      '/dst': [cf('shared.txt', 10, 1000)]
    }),
    openState: fakeState([rec('shared.txt', obs(10, 1000), obs(10, 1000))])
  });

  assert.equal(preview.summary.copyToDest, 1);
  assert.equal(preview.summary.copyToSource, 0);
  assert.equal(preview.files[0].direction, 'toDest');
  assert.equal(preview.files[0].action, 'update-archive');
  assert.equal(preview.files[0].reason, 'source-modified');
});

test('baseline-backed deletion: source removed -> delete on destination', async () => {
  const preview = await buildTwoWayComparePreview({
    sourceRoots: singleRoot(),
    destinations: [dest0],
    excludePatterns: [],
    copySubfolders: true,
    historyEnabled: true,
    jobId: 'job-a',
    basePath: '/data',
    collectFiles: fakeCollect({ '/src': [], '/dst': [cf('gone.txt', 10, 1000)] }),
    openState: fakeState([rec('gone.txt', obs(10, 1000), obs(10, 1000))])
  });

  assert.equal(preview.summary.deleteOnDest, 1);
  assert.equal(preview.files[0].direction, 'deleteDest');
  assert.equal(preview.files[0].label, 'Delete on destination');
});

test('multi-source roots are prefixed and reconciled under one destination', async () => {
  const roots = [
    { sourcePath: '/srcA', destinationPath: '/dst/PhotosA', relativePrefix: 'PhotosA', destination: dest0 },
    { sourcePath: '/srcB', destinationPath: '/dst/DocsB', relativePrefix: 'DocsB', destination: dest0 }
  ];
  const preview = await buildTwoWayComparePreview({
    sourceRoots: roots,
    destinations: [dest0],
    excludePatterns: [],
    copySubfolders: true,
    historyEnabled: true,
    jobId: 'job-a',
    basePath: '/data',
    collectFiles: fakeCollect({
      '/srcA': [cf('p.jpg', 5, 1000)],
      '/dst/PhotosA': [],
      '/srcB': [],
      '/dst/DocsB': [cf('d.txt', 9, 1000)]
    }),
    openState: fakeState([])
  });

  const dirs = preview.files.map((f) => `${f.relativePath}:${f.direction}`).sort();
  assert.deepEqual(dirs, ['DocsB/d.txt:toSource', 'PhotosA/p.jpg:toDest']);
});

test('missing destination folder is treated as empty, not an error', async () => {
  const preview = await buildTwoWayComparePreview({
    sourceRoots: singleRoot(),
    destinations: [dest0],
    excludePatterns: [],
    copySubfolders: true,
    historyEnabled: true,
    jobId: 'job-a',
    basePath: '/data',
    // '/dst' intentionally absent from the map -> collectFiles throws ENOENT
    collectFiles: fakeCollect({ '/src': [cf('a.txt', 5, 1000)] }),
    openState: fakeState([])
  });

  assert.equal(preview.summary.copyToDest, 1);
  assert.equal(preview.files[0].direction, 'toDest');
});

test('identical files on both sides with no baseline are seeded, not copied', async () => {
  const preview = await buildTwoWayComparePreview({
    sourceRoots: singleRoot(),
    destinations: [dest0],
    excludePatterns: [],
    copySubfolders: true,
    historyEnabled: true,
    jobId: 'job-a',
    basePath: '/data',
    collectFiles: fakeCollect({ '/src': [cf('same.txt', 10, 1000)], '/dst': [cf('same.txt', 10, 1000)] }),
    openState: fakeState([])
  });

  assert.equal(preview.summary.previewFiles, 0);
  assert.equal(preview.summary.unchanged, 1);
  assert.equal(preview.files.length, 0);
});
