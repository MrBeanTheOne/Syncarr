const test = require('node:test');
const assert = require('node:assert/strict');

// preview-format.js destructures window.SyncarrRendererUtils at load, so
// renderer-utils.js must be required first (after shimming window).
global.window = global.window || {};
require('../src/renderer/renderer-utils.js');
require('../src/renderer/preview-format.js');
const {
  previewSidePathLabel,
  joinPreviewDisplayPath,
  compactPreviewPath,
  previewFileSize,
  formatSizeTransition,
  twoWaySideMeta,
  previewFolderTone,
  previewActionClass
} = global.window.SyncarrPreviewFormat;

test('compactPreviewPath keeps short paths and trims long ones to the tail', () => {
  assert.equal(compactPreviewPath('a\\b'), 'a\\b');
  assert.equal(compactPreviewPath('a/b/c'), 'a\\b\\c');
  assert.equal(compactPreviewPath('a\\b\\c\\d\\e'), '…\\c\\d\\e');
});

test('joinPreviewDisplayPath joins root + child and honours compact', () => {
  assert.equal(joinPreviewDisplayPath('C:\\root', 'sub/file'), 'C:\\root\\sub\\file');
  assert.equal(joinPreviewDisplayPath('C:\\root\\', ''), 'C:\\root\\');
  assert.equal(joinPreviewDisplayPath('a\\b\\c\\d', 'e\\f', { compact: true }), '…\\d\\e\\f');
});

test('previewSidePathLabel derives the parent path per side', () => {
  const file = { relativePath: 'docs\\readme.txt', sourceRoot: 'C:\\src', destinationLabel: 'NAS' };
  assert.equal(previewSidePathLabel(file, 'source'), 'C:\\src\\docs');
  assert.equal(previewSidePathLabel(file, 'destination'), 'NAS\\docs');
});

test('previewFileSize reads the right side and guards non-finite', () => {
  const file = { source: { size: 100 }, target: { size: 250 } };
  assert.equal(previewFileSize(file, 'source'), 100);
  assert.equal(previewFileSize(file, 'destination'), 250);
  assert.equal(previewFileSize({ source: {} }, 'source'), null);
});

test('formatSizeTransition shows arrow only when both sides present and differ', () => {
  assert.equal(formatSizeTransition(NaN, NaN), '-');
  assert.equal(formatSizeTransition(NaN, 1024), '1.0 KB');
  assert.equal(formatSizeTransition(1024, NaN), '1.0 KB');
  assert.equal(formatSizeTransition(1024, 1024), '1.0 KB');
  assert.equal(formatSizeTransition(1024, 2048), '1.0 KB → 2.0 KB');
});

test('previewActionClass and previewFolderTone map to tone tokens', () => {
  assert.equal(previewActionClass('copy-new'), 'new');
  assert.equal(previewActionClass('update-archive'), 'changed');
  assert.equal(previewActionClass('extra'), 'delete');
  assert.equal(previewActionClass('conflict'), 'issue');
  assert.equal(previewActionClass('whatever'), 'copy');
  assert.equal(previewFolderTone({ conflicts: 1 }), 'issue');
  assert.equal(previewFolderTone({ destinationOnly: 1 }), 'delete');
  assert.equal(previewFolderTone({ changed: 1 }), 'changed');
  assert.equal(previewFolderTone({ newFiles: 1 }), 'new');
  assert.equal(previewFolderTone({}), 'copy');
});

test('twoWaySideMeta describes each direction for the given side', () => {
  const toDest = { direction: 'toDest', source: { size: 2048 }, target: { size: 1024 } };
  assert.deepEqual(twoWaySideMeta(toDest, 'source'), { action: 'Send to destination', size: '2.0 KB', state: 'Sending', tone: 'new' });
  const destSide = twoWaySideMeta(toDest, 'destination');
  assert.equal(destSide.action, 'Replace from source');
  assert.equal(destSide.size, '1.0 KB → 2.0 KB');
  assert.equal(destSide.state, 'Replace');

  const keepBoth = twoWaySideMeta({ direction: 'keepBoth', source: { size: 1 }, target: { size: 2 } }, 'source');
  assert.equal(keepBoth.state, 'Conflict');
  assert.equal(keepBoth.tone, 'issue');
});
