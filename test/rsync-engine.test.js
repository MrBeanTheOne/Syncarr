const test = require('node:test');
const assert = require('node:assert/strict');

const rsyncEngine = require('../src/main/sync-engines/rsync-engine');
const {
  buildRsyncArgs,
  parseRsyncProgressLine,
  applyRsyncProgress,
  parseRsyncSummary,
  emptyRsyncSummary,
  aggregateRsyncSummaries,
  inferRsyncExitCodeFromOutput,
  interpretRsyncExitCode,
  getRsyncFileCounts,
  createRsyncOutputDecoder,
  splitExcludes
} = rsyncEngine;

// ---------------------------------------------------------------------------
// buildRsyncArgs — argv shape parity with the robocopy engine
// ---------------------------------------------------------------------------

test('buildRsyncArgs rejects missing sourcePath', () => {
  assert.throws(() => buildRsyncArgs({ targetPath: '/dst' }), /sourcePath/);
});

test('buildRsyncArgs rejects missing targetPath', () => {
  assert.throws(() => buildRsyncArgs({ sourcePath: '/src' }), /targetPath/);
});

test('buildRsyncArgs dry-run produces a compare command with trailing-slash source', () => {
  const args = buildRsyncArgs({
    sourcePath: '/data/src',
    targetPath: '/data/dst',
    dryRun: true,
    syncMode: 'oneWay'
  });

  // Compare must not modify files; rsync uses -n for that.
  assert.ok(args.includes('-n'), 'dry-run must add -n');
  assert.ok(!args.includes('--delete'), 'one-way compare must not delete');
  assert.ok(args.includes('-lptD'), 'must preserve attrs (-lptD)');
  assert.ok(args.includes('-i'), 'must emit itemize-changes (-i)');
  assert.ok(args.includes('--stats'), 'must emit trailing stats block');
  // Source gets a trailing slash so rsync means "contents of", not "create as subdir".
  const sourceIdx = args.indexOf('/data/src/');
  const targetIdx = args.indexOf('/data/dst');
  assert.ok(sourceIdx >= 0 && targetIdx > sourceIdx);
});

test('buildRsyncArgs sync (non-dry-run) does not add -n', () => {
  const args = buildRsyncArgs({
    sourcePath: '/data/src',
    targetPath: '/data/dst',
    dryRun: false,
    syncMode: 'oneWay'
  });

  assert.ok(!args.includes('-n'), 'sync run must not include -n');
  assert.ok(!args.includes('--delete'), 'one-way sync must not delete');
});

test('buildRsyncArgs mirror mode adds --delete and drops -u', () => {
  const args = buildRsyncArgs({
    sourcePath: '/data/src',
    targetPath: '/data/dst',
    dryRun: true,
    syncMode: 'mirror',
    skipOlderSource: true   // should be ignored in mirror mode
  });

  assert.ok(args.includes('--delete'), 'mirror must include --delete');
  assert.ok(!args.includes('-u'), 'mirror must NOT include -u even if skipOlderSource=true');
});

test('buildRsyncArgs skipOlderSource adds -u in one-way mode', () => {
  const args = buildRsyncArgs({
    sourcePath: '/data/src',
    targetPath: '/data/dst',
    dryRun: false,
    syncMode: 'oneWay',
    skipOlderSource: true
  });

  assert.ok(args.includes('-u'), 'one-way sync with skipOlderSource must include -u');
});

test('buildRsyncArgs copySubfolders adds -r (and stays recursive when syncMode overrides)', () => {
  const topLevelArgs = buildRsyncArgs({
    sourcePath: '/data/src',
    targetPath: '/data/dst',
    dryRun: false,
    syncMode: 'oneWay',
    copySubfolders: false
  });
  assert.ok(!topLevelArgs.includes('-r'), 'top-level sync must not include -r');

  const recursiveArgs = buildRsyncArgs({
    sourcePath: '/data/src',
    targetPath: '/data/dst',
    dryRun: false,
    syncMode: 'oneWay',
    copySubfolders: true
  });
  assert.ok(recursiveArgs.includes('-r'), 'copySubfolders must include -r');
});

test('buildRsyncArgs emits one --exclude flag per pattern, trimmed', () => {
  const args = buildRsyncArgs({
    sourcePath: '/data/src',
    targetPath: '/data/dst',
    dryRun: false,
    syncMode: 'oneWay',
    excludePatterns: ['node_modules', '  .git  ', '', 'Thumbs.db']
  });

  const excludes = args.filter((arg) => arg.startsWith('--exclude='));
  assert.equal(excludes.length, 3);
  assert.ok(excludes.includes('--exclude=node_modules'));
  assert.ok(excludes.includes('--exclude=.git'));
  assert.ok(excludes.includes('--exclude=Thumbs.db'));
});

test('buildRsyncArgs places an end-of-options "--" before the positional paths', () => {
  const args = buildRsyncArgs({ sourcePath: '/data/src', targetPath: '/data/dst', syncMode: 'oneWay' });
  const sep = args.indexOf('--');
  const sourceIdx = args.indexOf('/data/src/');
  const targetIdx = args.indexOf('/data/dst');
  assert.ok(sep >= 0, 'must include the -- end-of-options separator');
  assert.ok(sep < sourceIdx && sourceIdx < targetIdx, 'paths follow -- so a leading-dash path cannot be parsed as an option');
});

test('buildRsyncArgs is idempotent on already-trailing-slash source', () => {
  const args = buildRsyncArgs({
    sourcePath: '/data/src/',
    targetPath: '/data/dst',
    dryRun: false,
    syncMode: 'oneWay'
  });

  const sourceIdx = args.indexOf('/data/src/');
  assert.ok(sourceIdx >= 0, 'trailing-slash source must be preserved');
  assert.equal(args.indexOf('/data/src//'), -1, 'must not double-up the trailing slash');
});

// ---------------------------------------------------------------------------
// parseRsyncProgressLine — same shape as parseRobocopyProgressLine
// ---------------------------------------------------------------------------

test('parseRsyncProgressLine recognises a new-file itemize change as copied', () => {
  const result = parseRsyncProgressLine('>f+++++++++ newfile.txt');
  assert.ok(result);
  assert.equal(result.kind, 'copied');
  assert.equal(result.label, '>f');
  assert.equal(result.file, 'newfile.txt');
});

test('parseRsyncProgressLine recognises an unchanged file as skipped', () => {
  const result = parseRsyncProgressLine('.f......... samefile.txt');
  assert.ok(result);
  assert.equal(result.kind, 'skipped');
  assert.equal(result.label, '.f');
  assert.equal(result.file, 'samefile.txt');
});

test('parseRsyncProgressLine recognises *deleting as extra (mirror mode)', () => {
  const result = parseRsyncProgressLine('*deleting   stale/path.txt');
  assert.ok(result);
  assert.equal(result.kind, 'extra');
  assert.equal(result.label, '*deleting');
  assert.equal(result.file, 'stale/path.txt');
});

test('parseRsyncProgressLine does not count deleted directories as files', () => {
  const result = parseRsyncProgressLine('*deleting old-albums/');

  assert.equal(result.kind, 'info');
  assert.equal(result.file, 'old-albums/');
});

test('parseRsyncProgressLine recognises rsync errors as failed', () => {
  const result = parseRsyncProgressLine('rsync error: some files could not be transferred');
  assert.ok(result);
  assert.equal(result.kind, 'failed');
  assert.equal(result.label, 'Error');
});

test('parseRsyncProgressLine recognises rsync warnings as info (not failed)', () => {
  const result = parseRsyncProgressLine('rsync warning: some files could not be transferred (code 24)');
  assert.ok(result);
  assert.equal(result.kind, 'info');
});

test('parseRsyncProgressLine returns null for blank, separator, and stats-block lines', () => {
  assert.equal(parseRsyncProgressLine(''), null);
  assert.equal(parseRsyncProgressLine('   '), null);
  assert.equal(parseRsyncProgressLine('--------'), null);
  assert.equal(parseRsyncProgressLine('Number of files: 100 (reg: 90, dir: 10)'), null);
  assert.equal(parseRsyncProgressLine('Total file size: 1,234 bytes'), null);
  assert.equal(parseRsyncProgressLine('sent 1,234 bytes  received 56 bytes'), null);
});

test('applyRsyncProgress accumulates state and returns merged snapshot', () => {
  const state = { copied: 0, skipped: 0, failed: 0, extra: 0, latestText: '', latestFile: '' };
  const next = applyRsyncProgress(state, { kind: 'copied', text: '>f+++++++++ a.txt', file: 'a.txt' });
  assert.equal(next.copied, 1);
  assert.equal(next.skipped, 0);
  assert.equal(next.latestFile, 'a.txt');

  applyRsyncProgress(next, { kind: 'skipped', text: '.f......... b.txt', file: 'b.txt' });
  applyRsyncProgress(next, { kind: 'extra', text: '*deleting c.txt', file: 'c.txt' });
  applyRsyncProgress(next, { kind: 'failed', text: 'rsync error: x', file: '' });

  assert.equal(next.copied, 1);
  assert.equal(next.skipped, 1);
  assert.equal(next.extra, 1);
  assert.equal(next.failed, 1);
  assert.equal(next.latestFile, 'c.txt');
});

// ---------------------------------------------------------------------------
// parseRsyncSummary — totals block shape (rsync --stats)
// ---------------------------------------------------------------------------

test('parseRsyncSummary returns empty summary on empty input', () => {
  const summary = parseRsyncSummary('');
  assert.deepEqual(summary, emptyRsyncSummary());
  assert.equal(summary.copied, 0);
  assert.equal(summary.extras, 0);
});

test('parseRsyncSummary parses the rsync --stats block', () => {
  const statsOutput = `
Number of files: 100 (reg: 90, dir: 10)
Number of created files: 5 (reg: 4, dir: 1)
Number of deleted files: 2 (reg: 1, dir: 1)
Number of regular files transferred: 5
Total file size: 1,234 bytes
Total transferred file size: 1,000 bytes
`;
  const summary = parseRsyncSummary(statsOutput);

  assert.equal(summary.files.total, 100);
  assert.equal(summary.files.copied, 5);
  assert.equal(summary.files.extras, 2);
  assert.equal(summary.bytes.total, 1234);
  assert.equal(summary.bytes.copied, 1000);
  // Top-level convenience copies
  assert.equal(summary.copied, 5);
  assert.equal(summary.extras, 2);
});

test('parseRsyncSummary falls back to *deleting line count when stats block is absent', () => {
  const output = `
*deleting   a.txt
*deleting   b/c.txt
>f+++++++++ new.txt
`;
  const summary = parseRsyncSummary(output);
  assert.equal(summary.files.extras, 2, 'must count *deleting lines');
});

test('aggregateRsyncSummaries sums multiple per-source-root blocks', () => {
  const a = parseRsyncSummary('Number of files: 10\nNumber of created files: 3');
  const b = parseRsyncSummary('Number of files: 20\nNumber of created files: 7');
  const combined = aggregateRsyncSummaries([a, b]);

  assert.equal(combined.files.total, 30);
  assert.equal(combined.files.copied, 10);
  assert.equal(combined.copied, 10);
});

// ---------------------------------------------------------------------------
// Exit-code mapping
// ---------------------------------------------------------------------------

test('inferRsyncExitCodeFromOutput returns 0 (rsync uses real exit codes; this is a fallback)', () => {
  assert.equal(inferRsyncExitCodeFromOutput('arbitrary output'), 0);
  assert.equal(inferRsyncExitCodeFromOutput(''), 0);
});

test('interpretRsyncExitCode maps 0 to no-change success', () => {
  const result = interpretRsyncExitCode(0);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'no-change');
});

test('interpretRsyncExitCode maps 23/24 to partial-success', () => {
  assert.equal(interpretRsyncExitCode(23).ok, true);
  assert.equal(interpretRsyncExitCode(23).status, 'success');
  assert.equal(interpretRsyncExitCode(24).ok, true);
  assert.equal(interpretRsyncExitCode(24).status, 'success');
});

test('interpretRsyncExitCode maps other non-zero codes to error', () => {
  assert.equal(interpretRsyncExitCode(1).ok, false);
  assert.equal(interpretRsyncExitCode(1).status, 'error');
  assert.equal(interpretRsyncExitCode(12).ok, false);
  assert.equal(interpretRsyncExitCode(12).status, 'error');
});

// ---------------------------------------------------------------------------
// getFileCounts — convenience over the summary shape
// ---------------------------------------------------------------------------

test('getRsyncFileCounts extracts counts from a summary', () => {
  const summary = parseRsyncSummary('Number of created files: 7\nNumber of deleted files: 2');
  const counts = getRsyncFileCounts(summary);
  assert.equal(counts.copied, 7);
  assert.equal(counts.extras, 2);
  assert.equal(counts.skipped, 0);
  assert.equal(counts.failed, 0);
});

test('getRsyncFileCounts handles missing summary gracefully', () => {
  const counts = getRsyncFileCounts({});
  assert.deepEqual(counts, { copied: 0, skipped: 0, failed: 0, extras: 0 });
});

// ---------------------------------------------------------------------------
// createRsyncOutputDecoder — identity for UTF-8 input
// ---------------------------------------------------------------------------

test('createRsyncOutputDecoder decodes UTF-8 chunks without modification', () => {
  const decoder = createRsyncOutputDecoder();
  // rsync outputs UTF-8 directly; decoder is identity.
  assert.equal(decoder.write(Buffer.from('Banière.png')), 'Banière.png');
  assert.equal(decoder.write(Buffer.from('')), '');
  assert.equal(decoder.end(), '');
});

test('createRsyncOutputDecoder handles null/empty buffers', () => {
  const decoder = createRsyncOutputDecoder();
  assert.equal(decoder.write(null), '');
  assert.equal(decoder.write(Buffer.alloc(0)), '');
});

// ---------------------------------------------------------------------------
// splitExcludes — interface parity with robocopy-engine
// ---------------------------------------------------------------------------

test('splitExcludes partitions file-like and dir-like patterns', () => {
  // The split is heuristic: patterns ending in a dotted lowercase extension
  // (matching /\.[a-z0-9]{1,8}$/i) go to fileExcludes. rsync doesn't
  // actually distinguish file vs dir excludes the way robocopy does — the
  // partition here is just a convenience for callers that want to log it.
  // Anything matching the extension regex (including .git, Thumbs.db,
  // *.tmp) goes to fileExcludes; unadorned names like 'node_modules' go
  // to dirExcludes.
  const { fileExcludes, dirExcludes } = splitExcludes(['node_modules', '.git', 'Thumbs.db', '*.tmp']);
  assert.deepEqual(fileExcludes.sort(), ['*.tmp', '.git', 'Thumbs.db']);
  assert.deepEqual(dirExcludes, ['node_modules']);
});

test('splitExcludes ignores blank and non-string patterns', () => {
  const { fileExcludes, dirExcludes } = splitExcludes(['', null, undefined, '   ', '*.tmp']);
  assert.deepEqual(fileExcludes, ['*.tmp']);
  assert.deepEqual(dirExcludes, []);
});

// ---------------------------------------------------------------------------
// Module-level sanity: the rsync engine exposes the SyncEngine interface
// documented in robocopy-engine.js. The orchestrator will dispatch through
// these named exports in Phase B; verifying they're present here keeps the
// contract honest.
// ---------------------------------------------------------------------------

test('rsync engine exports the SyncEngine interface contract', () => {
  const required = [
    'command',
    'buildArgs', 'spawn', 'createOutputDecoder',
    'parseProgressLine', 'applyProgress',
    'parseSummary', 'emptySummary', 'aggregateSummaries',
    'inferExitCodeFromOutput', 'interpretExitCode', 'getFileCounts'
  ];

  for (const name of required) {
    assert.ok(rsyncEngine[name] !== undefined, `rsync engine must export ${name}`);
  }
  assert.equal(rsyncEngine.command, 'rsync');
});
