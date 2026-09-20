const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRobocopyDryRunPreview,
  mergeDestinationPlans,
  accumulatePlanSummary,
  prefixPreviewFilesForDestination,
  robocopyActionToPreview,
  parseRobocopySizeAndName,
  parseRobocopyFileSize,
  stripRobocopySize,
  robocopyDisplaySizeToBytes,
  findRobocopyRootForPath,
  makeRelativeFromRobocopy,
  PREVIEW_FILE_LIMIT
} = require('../src/main/sync-engines/robocopy-dryrun-parser');

test('accumulatePlanSummary preserves mirror delete counts when the target omits the field', () => {
  const summary = { wouldCopy: 2 };

  accumulatePlanSummary(summary, { wouldCopy: 1, destinationOnly: 3 });

  assert.equal(summary.wouldCopy, 3);
  assert.equal(summary.destinationOnly, 3);
  assert.ok(Number.isFinite(summary.destinationOnly));
});
const {
  normalizeRelativeForManifest,
  normalizePathForCompare
} = require('../src/main/path-utils');

// ---- parseRobocopySizeAndName / size helpers -------------------------------

test('parseRobocopySizeAndName returns empty for blank input', () => {
  assert.deepEqual(parseRobocopySizeAndName(''), { sizeBytes: 0, name: '' });
  assert.deepEqual(parseRobocopySizeAndName(null), { sizeBytes: 0, name: '' });
  assert.deepEqual(parseRobocopySizeAndName('   '), { sizeBytes: 0, name: '' });
});

test('parseRobocopySizeAndName parses unit-suffixed sizes without keeping the unit letter', () => {
  // Regression: older parsing left the unit letter as a fake first character in the filename.
  assert.deepEqual(parseRobocopySizeAndName('1.2 m    File.wav'), {
    sizeBytes: Math.round(1.2 * 1024 * 1024),
    name: 'File.wav'
  });
  assert.deepEqual(parseRobocopySizeAndName('4 KB\tphoto.jpg'), {
    sizeBytes: 4 * 1024,
    name: 'photo.jpg'
  });
  assert.deepEqual(parseRobocopySizeAndName('12 gb    archive.bin'), {
    sizeBytes: 12 * 1024 ** 3,
    name: 'archive.bin'
  });
});

test('parseRobocopySizeAndName parses plain bytes separated by whitespace', () => {
  assert.deepEqual(parseRobocopySizeAndName('1234  report.pdf'), {
    sizeBytes: 1234,
    name: 'report.pdf'
  });
  assert.deepEqual(parseRobocopySizeAndName('12,345    big.zip'), {
    sizeBytes: 12345,
    name: 'big.zip'
  });
});

test('parseRobocopySizeAndName falls back to a loose match for non-tab whitespace', () => {
  assert.deepEqual(parseRobocopySizeAndName('99 notes.txt'), {
    sizeBytes: 99,
    name: 'notes.txt'
  });
});

test('parseRobocopySizeAndName keeps the raw value when no size column is present', () => {
  assert.deepEqual(parseRobocopySizeAndName('README.md'), { sizeBytes: 0, name: 'README.md' });
});

test('parseRobocopyFileSize and stripRobocopySize are thin wrappers', () => {
  assert.equal(parseRobocopyFileSize('1 k file.txt'), 1024);
  assert.equal(stripRobocopySize('1 k file.txt'), 'file.txt');
});

test('robocopyDisplaySizeToBytes handles all SI-style units and bare bytes', () => {
  assert.equal(robocopyDisplaySizeToBytes('2', 'KB'), 2 * 1024);
  assert.equal(robocopyDisplaySizeToBytes('2', 'Mb'), 2 * 1024 ** 2);
  assert.equal(robocopyDisplaySizeToBytes('2', 'gb'), 2 * 1024 ** 3);
  assert.equal(robocopyDisplaySizeToBytes('2', 'tb'), 2 * 1024 ** 4);
  assert.equal(robocopyDisplaySizeToBytes('2', 'pb'), 2 * 1024 ** 5);
  assert.equal(robocopyDisplaySizeToBytes('2', 'eb'), 2 * 1024 ** 6);
  assert.equal(robocopyDisplaySizeToBytes('7', ''), 7);
  assert.equal(robocopyDisplaySizeToBytes('7', 'bytes'), 7);
  assert.equal(robocopyDisplaySizeToBytes('bad', 'KB'), 0);
});

// ---- robocopyActionToPreview ----------------------------------------------

test('robocopyActionToPreview classifies one-way actions', () => {
  assert.deepEqual(robocopyActionToPreview('New File', 'oneWay'), {
    action: 'copy-new', label: 'New file', reason: 'robocopy-new-file'
  });
  assert.deepEqual(robocopyActionToPreview('Newer', 'oneWay'), {
    action: 'update-archive', label: 'Update', reason: 'robocopy-newer'
  });
  assert.deepEqual(robocopyActionToPreview('Changed', 'oneWay'), {
    action: 'update-archive', label: 'Update', reason: 'robocopy-changed'
  });
  assert.deepEqual(robocopyActionToPreview('Tweaked', 'oneWay'), {
    action: 'update-archive', label: 'Update', reason: 'robocopy-tweaked'
  });
  assert.deepEqual(robocopyActionToPreview('Older', 'oneWay'), {
    action: 'skip-older-source', label: 'Skip older source', reason: 'robocopy-older-source'
  });
  assert.deepEqual(robocopyActionToPreview('Same', 'oneWay'), {
    action: 'unchanged', label: 'Unchanged', reason: 'robocopy-same'
  });
});

test('robocopyActionToPreview classifies mirror actions', () => {
  assert.deepEqual(robocopyActionToPreview('Older', 'mirror'), {
    action: 'update-archive', label: 'Mirror replace', reason: 'robocopy-older-source-mirror'
  });
  assert.deepEqual(robocopyActionToPreview('*EXTRA File', 'mirror'), {
    action: 'extra', label: 'Mirror delete candidate', reason: 'robocopy-extra-mirror'
  });
});

test('robocopyActionToPreview classifies destination-only files in one-way mode', () => {
  assert.deepEqual(robocopyActionToPreview('*EXTRA File', 'oneWay'), {
    action: 'extra', label: 'Destination-only', reason: 'robocopy-extra-one-way'
  });
});

test('robocopyActionToPreview normalizes whitespace and is case-insensitive', () => {
  assert.equal(robocopyActionToPreview('  NEW\nFILE ', 'oneWay').action, 'copy-new');
  assert.equal(robocopyActionToPreview('SAME', 'mirror').action, 'unchanged');
});

test('robocopyActionToPreview returns a copy-new fallback for unknown actions', () => {
  const fallback = robocopyActionToPreview('Something Else', 'oneWay');
  assert.equal(fallback.action, 'copy-new');
  assert.equal(fallback.label, 'Something Else');
});

// ---- path utilities -------------------------------------------------------

test('normalizeRelativeForManifest collapses separators and strips leading slashes', () => {
  assert.equal(normalizeRelativeForManifest('foo\\bar/baz'), 'foo/bar/baz');
  assert.equal(normalizeRelativeForManifest('\\\\foo\\\\bar'), 'foo/bar');
  assert.equal(normalizeRelativeForManifest('/leading/slash'), 'leading/slash');
  assert.equal(normalizeRelativeForManifest(''), '');
  assert.equal(normalizeRelativeForManifest(null), '');
});

test('normalizePathForCompare lowercases and trims trailing slashes (Windows-style identity)', () => {
  // normalizePathForCompare always uses Windows-style identity — robocopy only
  // runs on Windows, so it never needs to preserve case like pathIdentityKey does.
  assert.equal(normalizePathForCompare('C:/Photos/RAW/'), 'c:/photos/raw');
  assert.equal(normalizePathForCompare('C:\\Photos\\RAW'), 'c:\\photos\\raw');
  assert.equal(normalizePathForCompare('/Photos/RAW/'), '/photos/raw');
});

// ---- findRobocopyRootForPath ---------------------------------------------

test('findRobocopyRootForPath picks the most specific matching root', () => {
  const roots = [
    { sourcePath: 'C:\\Photos', destinationPath: '\\\\NAS\\Photos' },
    { sourcePath: 'C:\\Photos\\RAW', destinationPath: '\\\\NAS\\Photos\\RAW' }
  ];
  const match = findRobocopyRootForPath(roots, 'C:\\Photos\\RAW', '\\\\NAS\\Photos\\RAW');
  assert.equal(match.sourcePath, 'C:\\Photos\\RAW');
});

test('findRobocopyRootForPath matches by source only when destination is omitted', () => {
  const roots = [{ sourcePath: 'C:\\Photos', destinationPath: '\\\\NAS\\Photos' }];
  const match = findRobocopyRootForPath(roots, 'C:\\Photos\\sub\\file.jpg', '');
  assert.equal(match.sourcePath, 'C:\\Photos');
});

test('findRobocopyRootForPath returns null when nothing matches', () => {
  const roots = [{ sourcePath: 'C:\\Photos', destinationPath: '\\\\NAS\\Photos' }];
  assert.equal(findRobocopyRootForPath(roots, 'D:\\Other', '\\\\NAS\\Photos'), null);
});

// ---- makeRelativeFromRobocopy ---------------------------------------------

test('makeRelativeFromRobocopy joins a directory and filename then makes it relative', () => {
  const root = { sourcePath: 'C:\\Photos', destinationPath: '\\\\NAS\\Photos', destinationCount: 1 };
  const rel = makeRelativeFromRobocopy({ root, currentDirectory: 'C:\\Photos\\2024', detail: '1 k IMG_0001.jpg' });
  assert.equal(rel, '2024/IMG_0001.jpg');
});

test('makeRelativeFromRobocopy prepends destinationLabel when multiple destinations exist', () => {
  const root = {
    sourcePath: 'C:\\Photos',
    destinationPath: '\\\\NAS\\Photos',
    destinationLabel: 'NAS-Primary',
    destinationCount: 2
  };
  const rel = makeRelativeFromRobocopy({ root, currentDirectory: 'C:\\Photos', detail: '   file.jpg' });
  assert.equal(rel, 'NAS-Primary/file.jpg');
});

test('makeRelativeFromRobocopy prepends relativePrefix for multi-source jobs', () => {
  const root = { sourcePath: 'C:\\A', destinationPath: '\\\\NAS\\Backup', relativePrefix: 'A', destinationCount: 1 };
  const rel = makeRelativeFromRobocopy({ root, currentDirectory: 'C:\\A', detail: '   a.txt' });
  assert.equal(rel, 'A/a.txt');
});

// ---- buildRobocopyDryRunPreview (end-to-end) -------------------------------

const SAMPLE_OUTPUT = [
  '-------------------------------------------------------------------------------',
  '   ROBOCOPY     ::     Robust File Copy for Windows',
  '-------------------------------------------------------------------------------',
  '',
  '  Source : C:\\Photos\\',
  '    Dest : \\\\NAS\\Photos\\',
  '',
  '*EXTRA File    12.0 k  leftovers.bin',
  'New File          2.5 m   fresh.jpg',
  'Newer             4 KB    updated.txt',
  'Same                 99      report.pdf',
  '',
  '-------------------------------------------------------------------------------'
].join('\r\n');

function sampleRoots() {
  return [{ sourcePath: 'C:\\Photos', destinationPath: '\\\\NAS\\Photos', destinationCount: 1, label: 'Photos' }];
}

test('buildRobocopyDryRunPreview tallies each Robocopy action into the right summary bucket', () => {
  const { summary, files } = buildRobocopyDryRunPreview({
    output: SAMPLE_OUTPUT,
    sourceRoots: sampleRoots(),
    destinations: [{ path: '\\\\NAS\\Photos', label: 'Photos', required: true }],
    historyEnabled: true,
    historyFolderName: '.syncarr-history',
    syncMode: 'oneWay'
  });

  assert.equal(summary.newFiles, 1);
  assert.equal(summary.wouldCopy, 2);
  assert.equal(summary.destinationOnly, 1);
  assert.equal(summary.unchanged, 1);
  // Unchanged rows are tallied into summary.unchanged but skipped from previewFiles.
  assert.equal(summary.scanned, 3);
  assert.equal(summary.copyBytes, 2.5 * 1024 * 1024 + 4 * 1024);
  assert.equal(summary.sourceCount, 1);
  assert.equal(summary.destinationCount, 1);
  assert.equal(summary.previewFiles, 3);
  assert.equal(summary.previewTruncated, false);
  assert.equal(files.length, 3);
});

test('buildRobocopyDryRunPreview keeps Mirror destination-only files as archive candidates', () => {
  const { summary, files } = buildRobocopyDryRunPreview({
    output: SAMPLE_OUTPUT,
    sourceRoots: sampleRoots(),
    destinations: [{ path: '\\\\NAS\\Photos', label: 'Photos', required: true }],
    historyEnabled: true,
    historyFolderName: '.syncarr-history',
    syncMode: 'mirror'
  });

  // In Mirror mode, *EXTRA File should be classified as a mirror delete
  // candidate and become an archive candidate (since history is enabled).
  const extras = files.filter((f) => f.action === 'extra');
  assert.equal(extras.length, 1);
  assert.equal(extras[0].label, 'Mirror delete candidate');
  assert.equal(extras[0].reason, 'robocopy-extra-mirror');
  // Mirror archive candidates = mirror extras + update-archive (Newer) rows.
  assert.equal(summary.wouldArchive, 2);
  assert.equal(summary.archiveBytes, 12 * 1024);
  assert.equal(summary.destinationOnly, 1);
});

test('buildRobocopyDryRunPreview counts source-side files in sourceFiles (extras excluded)', () => {
  const { summary } = buildRobocopyDryRunPreview({
    output: SAMPLE_OUTPUT,
    sourceRoots: sampleRoots(),
    destinations: [{ path: '\\\\NAS\\Photos', label: 'Photos', required: true }],
    historyEnabled: true,
    historyFolderName: '.syncarr-history',
    syncMode: 'mirror'
  });
  // New File + Newer + Same = 3 source-side files; the *EXTRA is destination-only.
  assert.equal(summary.sourceFiles, 3);
  assert.equal(summary.destinationOnly, 1);
});

test('buildRobocopyDryRunPreview reports sourceFiles: 0 for an empty source in mirror mode', () => {
  // An empty source in mirror mode lists every destination file as an extra, so
  // scanned/previewFiles equal the delete count and are never 0 — only
  // sourceFiles distinguishes "empty source" from "pruning a few extras".
  const emptySourceMirror = [
    '  Source : C:\\Photos\\',
    '    Dest : \\\\NAS\\Photos\\',
    '',
    '*EXTRA File    12.0 k  leftovers.bin',
    '*EXTRA File     3.0 k  old.txt',
    ''
  ].join('\r\n');

  const { summary } = buildRobocopyDryRunPreview({
    output: emptySourceMirror,
    sourceRoots: sampleRoots(),
    destinations: [{ path: '\\\\NAS\\Photos', label: 'Photos', required: true }],
    historyEnabled: true,
    historyFolderName: '.syncarr-history',
    syncMode: 'mirror'
  });

  assert.equal(summary.sourceFiles, 0, 'no source-side files');
  assert.equal(summary.destinationOnly, 2, 'both destination files are delete candidates');
  assert.equal(summary.scanned, 2, 'scanned counts the extras — this is why the guard cannot use it');
});

test('buildRobocopyDryRunPreview does not count archive candidates when history is disabled', () => {
  const { summary } = buildRobocopyDryRunPreview({
    output: SAMPLE_OUTPUT,
    sourceRoots: sampleRoots(),
    destinations: [{ path: '\\\\NAS\\Photos', label: 'Photos', required: true }],
    historyEnabled: false,
    historyFolderName: '.syncarr-history',
    syncMode: 'oneWay'
  });

  assert.equal(summary.wouldArchive, 0);
  assert.equal(summary.estimatedWriteBytes, summary.copyBytes);
});

test('buildRobocopyDryRunPreview records an Older source as skipped in one-way mode', () => {
  const olderOutput = '  Source : C:\\A\r\n    Dest : \\\\NAS\\A\r\nOlder                 100      stale.bin\r\n';
  const { summary, files } = buildRobocopyDryRunPreview({
    output: olderOutput,
    sourceRoots: [{ sourcePath: 'C:\\A', destinationPath: '\\\\NAS\\A', destinationCount: 1, label: 'A' }],
    destinations: [{ path: '\\\\NAS\\A', label: 'A', required: true }],
    historyEnabled: true,
    historyFolderName: '.syncarr-history',
    syncMode: 'oneWay'
  });

  assert.equal(summary.skippedOlder, 1);
  // skip-older-source files are surfaced in the preview list (rendered as
  // "Skip older source") so users can see what was skipped; they are not
  // counted in wouldCopy or wouldArchive.
  const skipped = files.filter((f) => f.action === 'skip-older-source');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].label, 'Skip older source');
  assert.equal(summary.wouldCopy, 0);
  assert.equal(summary.wouldArchive, 0);
});

test('buildRobocopyDryRunPreview marks the preview truncated past the 1000 file limit', () => {
  const bigOutput = [
    '  Source : C:\\A',
    '    Dest : \\\\NAS\\A',
    ...Array.from({ length: PREVIEW_FILE_LIMIT + 5 }, (_, i) => `New File          10      file-${i}.txt`)
  ].join('\r\n');

  const { summary, files } = buildRobocopyDryRunPreview({
    output: bigOutput,
    sourceRoots: [{ sourcePath: 'C:\\A', destinationPath: '\\\\NAS\\A', destinationCount: 1, label: 'A' }],
    destinations: [{ path: '\\\\NAS\\A', label: 'A', required: true }],
    historyEnabled: false,
    historyFolderName: '.syncarr-history',
    syncMode: 'oneWay'
  });

  assert.equal(files.length, PREVIEW_FILE_LIMIT);
  assert.equal(summary.previewTruncated, true);
  assert.equal(summary.scanned, PREVIEW_FILE_LIMIT + 5);
});

test('buildRobocopyDryRunPreview handles empty output gracefully', () => {
  const { summary, files } = buildRobocopyDryRunPreview({
    output: '',
    sourceRoots: sampleRoots(),
    destinations: [{ path: '\\\\NAS\\Photos', label: 'Photos', required: true }],
    historyEnabled: true,
    historyFolderName: '.syncarr-history',
    syncMode: 'oneWay'
  });

  assert.equal(summary.previewFiles, 0);
  assert.equal(summary.scanned, 0);
  assert.equal(summary.wouldCopy, 0);
  assert.equal(files.length, 0);
  assert.equal(summary.previewTruncated, false);
});

// ---- prefixPreviewFilesForDestination / mergeDestinationPlans -------------

test('prefixPreviewFilesForDestination prefixes with destination label only when multiple destinations are configured', () => {
  const files = [{ relativePath: 'a.txt' }, { relativePath: 'sub/b.txt' }];
  const dest = { path: '\\\\NAS\\A', label: 'Primary', required: true };

  const single = prefixPreviewFilesForDestination(files, dest, 1);
  assert.deepEqual(single.map((f) => f.relativePath), ['a.txt', 'sub/b.txt']);
  assert.equal(single[0].destinationLabel, 'Primary');

  const multi = prefixPreviewFilesForDestination(files, dest, 2);
  assert.deepEqual(multi.map((f) => f.relativePath), ['Primary/a.txt', 'Primary/sub/b.txt']);
});

test('mergeDestinationPlans aggregates summary counts and prefixes file lists', () => {
  const planA = {
    summary: {
      scanned: 3, wouldCopy: 2, wouldArchive: 1, archived: 0, newFiles: 2,
      skippedOlder: 0, unchanged: 1, conflicts: 0, destinationOnly: 1,
      copyBytes: 100, archiveBytes: 50, previewFiles: 3
    },
    previewFiles: [{ relativePath: 'a.txt' }],
    archiveFiles: [{ relativePath: 'old.bin' }],
    newFiles: [{ relativePath: 'new.bin' }],
    sourcePaths: ['C:\\A'],
    sourceRoots: [{ sourcePath: 'C:\\A' }]
  };
  const planB = {
    summary: {
      scanned: 5, wouldCopy: 4, wouldArchive: 0, archived: 0, newFiles: 3,
      skippedOlder: 1, unchanged: 1, conflicts: 0, destinationOnly: 0,
      copyBytes: 200, archiveBytes: 0, previewFiles: 4
    },
    previewFiles: [{ relativePath: 'b.txt' }],
    archiveFiles: [],
    newFiles: [{ relativePath: 'fresh.bin' }],
    sourcePaths: ['C:\\A'],
    sourceRoots: [{ sourcePath: 'C:\\A' }]
  };

  const destinations = [
    { path: '\\\\NAS\\A', label: 'Primary', required: true },
    { path: '\\\\NAS\\B', label: 'Backup', required: false }
  ];
  const skipped = [{ path: '\\\\NAS\\Offline', label: 'Offline', required: false, reason: 'not-connected-or-unreadable' }];

  const aggregate = mergeDestinationPlans(
    [
      { destination: destinations[0], plan: planA },
      { destination: destinations[1], plan: planB }
    ],
    destinations,
    skipped,
    '.syncarr-history',
    true
  );

  assert.equal(aggregate.summary.scanned, 8);
  assert.equal(aggregate.summary.wouldCopy, 6);
  assert.equal(aggregate.summary.wouldArchive, 1);
  assert.equal(aggregate.summary.unchanged, 2);
  assert.equal(aggregate.summary.skippedDestinationCount, 1);
  assert.equal(aggregate.summary.skippedDestinations.length, 1);
  assert.equal(aggregate.summary.estimatedWriteBytes, 300 + 50);
  // Both files should be prefixed with their destination label since destinationCount > 1.
  assert.deepEqual(aggregate.previewFiles.map((f) => f.relativePath), ['Primary/a.txt', 'Backup/b.txt']);
  assert.equal(aggregate.archiveFiles.length, 1);
  assert.equal(aggregate.newFiles.length, 2);
});
