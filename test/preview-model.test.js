const test = require('node:test');
const assert = require('node:assert/strict');

// Self-contained browser IIFE attaching to window; shim before require.
global.window = global.window || {};
require('../src/renderer/preview-model.js');
const { sanitizePreviewPathPart, buildPreviewFileMap, previewEntriesAt, summarizePreviewActions, getPreviewActionCounts } = global.window.SyncarrPreviewModel;

test('sanitizePreviewPathPart collapses separators/whitespace and falls back', () => {
  assert.equal(sanitizePreviewPathPart('a/b\\c'), 'a-b-c');
  assert.equal(sanitizePreviewPathPart('  x   y '), 'x y');
  assert.equal(sanitizePreviewPathPart(''), 'Destination');
  assert.equal(sanitizePreviewPathPart('///'), '-', 'separators collapse to a single dash (non-empty, no fallback)');
});

test('buildPreviewFileMap keys by normalized path and disambiguates duplicates by destination', () => {
  const map = buildPreviewFileMap([
    { relativePath: 'docs\\a.txt', destinationLabel: 'NAS' },
    { relativePath: 'docs/a.txt', destinationLabel: 'USB' }, // duplicate rawKey, different destination
    { relativePath: '' } // skipped
  ]);
  assert.equal(map.size, 2);
  assert.ok(map.has('docs/a.txt'), 'first occurrence keeps the raw key');
  assert.ok(map.has('USB/docs/a.txt'), 'duplicate is prefixed with the sanitized destination');
  assert.equal(map.get('docs/a.txt').originalRelativePath, 'docs/a.txt');
});

test('previewEntriesAt splits files and folders at the given cwd depth', () => {
  const map = buildPreviewFileMap([
    { relativePath: 'top.txt', action: 'copy-new', copyBytes: 10 },
    { relativePath: 'sub/inner.txt', action: 'update-archive', copyBytes: 20, archiveBytes: 5 },
    { relativePath: 'sub/deep/x.txt', action: 'conflict' }
  ]);
  const root = previewEntriesAt(map, '');
  assert.deepEqual(root.files.map((f) => f.name), ['top.txt']);
  assert.equal(root.folders.size, 1);
  const sub = root.folders.get('sub');
  assert.equal(sub.count, 2);
  assert.equal(sub.changed, 1);
  assert.equal(sub.copyBytes, 20);

  const inSub = previewEntriesAt(map, 'sub');
  assert.deepEqual(inSub.files.map((f) => f.name), ['inner.txt']);
  assert.equal(inSub.folders.get('deep').relPath, 'sub/deep', 'folder relPath is prefixed with cwd');
});

test('summarizePreviewActions tallies categories and bytes', () => {
  const counts = summarizePreviewActions([
    { action: 'copy-new', copyBytes: 100 },
    { action: 'update-archive', archiveBytes: 50 },
    { action: 'extra', archiveBytes: 0 },
    { action: 'conflict' },
    { action: 'skip-older-source' }
  ]);
  assert.equal(counts.newFiles, 1);
  assert.equal(counts.changed, 1);
  assert.equal(counts.destinationOnly, 1);
  assert.equal(counts.issues, 2);
  assert.equal(counts.archive, 1, 'only update-archive with archiveBytes>0 counts');
  assert.equal(counts.copyBytes, 100);
});

test('getPreviewActionCounts prefers the backend summary over the (capped) list', () => {
  const summary = { newFiles: 900, wouldCopy: 1000, destinationOnly: 30, conflicts: 2, skippedOlder: 1, wouldArchive: 80, copyBytes: 4096 };
  const fromSummary = getPreviewActionCounts([{ action: 'copy-new' }], summary);
  assert.equal(fromSummary.newFiles, 900);
  assert.equal(fromSummary.changed, 100, 'changed = wouldCopy - newFiles');
  assert.equal(fromSummary.destinationOnly, 30);
  assert.equal(fromSummary.issues, 3, 'conflicts + skippedOlder');
  assert.equal(fromSummary.archive, 80);
});

test('getPreviewActionCounts falls back to summarizing the list when no summary', () => {
  const counts = getPreviewActionCounts([{ action: 'copy-new' }, { action: 'extra' }], null);
  assert.equal(counts.newFiles, 1);
  assert.equal(counts.destinationOnly, 1);
});
