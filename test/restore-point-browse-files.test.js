const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pickRestorePointBrowseFiles,
  shapeRestorePointManifestForRenderer
} = require('../src/main/restore-points');

function makeFiles(folder, count) {
  return Array.from({ length: count }, (_, i) => ({
    relativePath: `${folder}/file-${String(i).padStart(5, '0')}.txt`,
    size: 1
  }));
}

function topLevelFolders(files) {
  return new Set(files.map((file) => String(file.relativePath).split('/')[0]));
}

test('pickRestorePointBrowseFiles returns everything when under the limit', () => {
  const files = [...makeFiles('A', 3), ...makeFiles('B', 4)];
  const picked = pickRestorePointBrowseFiles(files, 2000);
  assert.equal(picked.length, 7);
});

test('pickRestorePointBrowseFiles keeps every source folder when truncating', () => {
  // Scan order is depth-first, so a big first source folder is listed before
  // the smaller later ones — the exact case that used to hide later folders.
  const files = [
    ...makeFiles('Photos', 5000),
    ...makeFiles('Docs', 10),
    ...makeFiles('Music', 10)
  ];
  const limit = 2000;
  const picked = pickRestorePointBrowseFiles(files, limit);

  assert.equal(picked.length, limit);
  const tops = topLevelFolders(picked);
  assert.ok(tops.has('Photos'), 'first source folder present');
  assert.ok(tops.has('Docs'), 'second source folder present');
  assert.ok(tops.has('Music'), 'third source folder present');
});

test('regression: a plain head-slice would have dropped later source folders', () => {
  const files = [...makeFiles('Photos', 5000), ...makeFiles('Docs', 10)];

  // Demonstrates the original bug: head-slicing the depth-first list drops Docs.
  const headSliceTops = topLevelFolders(files.slice(0, 2000));
  assert.ok(!headSliceTops.has('Docs'), 'head-slice hides the second folder');

  // The fix keeps it navigable.
  const pickedTops = topLevelFolders(pickRestorePointBrowseFiles(files, 2000));
  assert.ok(pickedTops.has('Docs'), 'folder-aware pick keeps the second folder');
});

test('shapeRestorePointManifestForRenderer flags truncation and keeps all folders', () => {
  const manifest = {
    destinations: [
      {
        path: 'D:/Backup',
        label: 'Backup',
        files: [...makeFiles('Photos', 60000), ...makeFiles('Docs', 5)]
      }
    ]
  };

  const shaped = shapeRestorePointManifestForRenderer({
    manifest,
    cleanJobId: 'job',
    cleanId: 'rp',
    manifestPath: 'rp.json',
    maxFilesPerDestination: 50000
  });
  const dest = shaped.destinations[0];

  assert.equal(dest.filesTotal, 60005);
  assert.equal(dest.filesReturned, 50000);
  assert.equal(dest.filesTruncated, true);

  const tops = topLevelFolders(dest.files);
  assert.ok(tops.has('Photos'), 'large source folder still listed');
  assert.ok(tops.has('Docs'), 'small source folder not dropped by truncation');
});

test('shapeRestorePointManifestForRenderer returns all files when within the limit', () => {
  const manifest = {
    destinations: [
      { path: 'D:/Backup', label: 'Backup', files: [...makeFiles('Photos', 12), ...makeFiles('Docs', 8)] }
    ]
  };

  const shaped = shapeRestorePointManifestForRenderer({
    manifest,
    cleanJobId: 'job',
    cleanId: 'rp',
    manifestPath: 'rp.json',
    maxFilesPerDestination: 10000
  });
  const dest = shaped.destinations[0];

  assert.equal(dest.filesTotal, 20);
  assert.equal(dest.filesReturned, 20);
  assert.equal(dest.filesTruncated, false);
});
