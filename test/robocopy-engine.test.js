const test = require('node:test');
const assert = require('node:assert/strict');

const robocopyEngine = require('../src/main/sync-engines/robocopy-engine');
const {
  buildRobocopyArgs,
  parseRobocopyProgressLine,
  applyRobocopyProgress,
  parseRobocopySummary,
  emptyRobocopySummary,
  emptyRobocopyLineTotals,
  aggregateRobocopySummaries,
  inferRobocopyExitCodeFromOutput,
  interpretRobocopyExitCode,
  getRobocopyFileCounts,
  splitExcludes
} = robocopyEngine;

// ---------------------------------------------------------------------------
// SyncEngine interface contract — robocopy engine must expose the same
// surface as the rsync engine (documented at the top of robocopy-engine.js).
// This test is the canary for the Phase 3 orchestrator dispatch refactor:
// if any of these exports disappears, the engine is no longer drop-in.
// ---------------------------------------------------------------------------

test('robocopy engine exports the SyncEngine interface contract', () => {
  const required = [
    'command',
    'buildArgs', 'spawn', 'createOutputDecoder',
    'parseProgressLine', 'applyProgress',
    'parseSummary', 'emptySummary', 'aggregateSummaries',
    'inferExitCodeFromOutput', 'interpretExitCode', 'getFileCounts'
  ];

  for (const name of required) {
    assert.ok(robocopyEngine[name] !== undefined, `robocopy engine must export ${name}`);
  }
  assert.equal(robocopyEngine.command, 'robocopy');
});

test('parseRobocopySummary parses unit-suffixed byte totals into the correct columns', () => {
  // Robocopy prints the Bytes row with the unit as a separate token
  // ("Bytes :   1.5 m   1.2 m   300.0 k   0   0   4.0 k"), which pre-fix landed
  // in the wrong columns (total became 2, copied 0). Files/Dirs rows are plain
  // integers and must be unaffected.
  const output = [
    '               Total    Copied   Skipped  Mismatch    FAILED    Extras',
    '    Dirs :         5         0         5         0         0         0',
    '   Files :        42        10        32         0         0         3',
    '   Bytes :   1.5 m   1.2 m   300.0 k         0         0     4.0 k'
  ].join('\n');

  const summary = parseRobocopySummary(output);
  assert.equal(summary.files.copied, 10, 'file counts unchanged');
  assert.equal(summary.files.extras, 3);
  assert.equal(summary.bytes.total, Math.round(1.5 * 1024 ** 2));
  assert.equal(summary.bytes.copied, Math.round(1.2 * 1024 ** 2));
  assert.equal(summary.bytes.skipped, Math.round(300 * 1024));
  assert.equal(summary.bytes.mismatch, 0);
  assert.equal(summary.bytes.failed, 0);
  assert.equal(summary.bytes.extras, Math.round(4 * 1024));
});

test('buildRobocopyArgs refuses a path or exclude that would inject a Robocopy switch', () => {
  const base = { sourcePath: 'C:\\src', targetPath: 'D:\\dst', syncMode: 'oneWay', copySubfolders: true };

  assert.throws(() => buildRobocopyArgs({ ...base, sourcePath: '/MOVE' }), /switch/i);
  assert.throws(() => buildRobocopyArgs({ ...base, targetPath: '/PURGE' }), /switch/i);
  assert.throws(() => buildRobocopyArgs({ ...base, excludePatterns: ['ok', '/MIR'] }), /switch/i);

  // Legitimate inputs must still build — including a filename that starts with
  // "-" (Robocopy switches are "/"-prefixed, so "-draft.txt" is a real file).
  assert.doesNotThrow(() => buildRobocopyArgs({ ...base, excludePatterns: ['-draft.txt', '*.tmp', 'node_modules'] }));
  const args = buildRobocopyArgs(base);
  assert.equal(args[0], 'C:\\src', 'source stays first');
  assert.equal(args[1], 'D:\\dst', 'destination stays second');
});

// ---------------------------------------------------------------------------
// Engine-specific aliases — main.js and existing tests reference the
// robocopy-prefixed names. They must continue to work as long as anything
// still imports them directly.
// ---------------------------------------------------------------------------

test('robocopy engine still exports the engine-specific named functions', () => {
  // The set of named exports main.js + the IPC layer depend on.
  const expected = [
    'buildRobocopyArgs',
    'parseRobocopyProgressLine',
    'applyRobocopyProgress',
    'parseRobocopySummary',
    'emptyRobocopySummary',
    'aggregateRobocopySummaries',
    'inferRobocopyExitCodeFromOutput',
    'interpretRobocopyExitCode',
    'getRobocopyFileCounts',
    'emptyRobocopyLineTotals',
    'splitExcludes',
    'createRobocopyOutputDecoder',
    'spawnRobocopy'
  ];
  for (const name of expected) {
    assert.ok(typeof robocopyEngine[name] === 'function', `must export ${name} as a function`);
  }
});

// ---------------------------------------------------------------------------
// Progress parser — moved out of main.js; smoke-test the moved code.
// ---------------------------------------------------------------------------

test('parseRobocopyProgressLine recognises a New File action as copied', () => {
  const result = parseRobocopyProgressLine('New File   123 photo.jpg');
  assert.ok(result);
  assert.equal(result.kind, 'copied');
  assert.equal(result.label, 'New File');
});

test('parseRobocopyProgressLine recognises an Older action as skipped', () => {
  const result = parseRobocopyProgressLine('Older   456 photo.jpg');
  assert.ok(result);
  assert.equal(result.kind, 'skipped');
});

test('parseRobocopyProgressLine recognises *EXTRA File as extra', () => {
  const result = parseRobocopyProgressLine('*EXTRA File   789 leftover.txt');
  assert.ok(result);
  assert.equal(result.kind, 'extra');
});

test('parseRobocopyProgressLine does not count directory actions as file progress', () => {
  const created = parseRobocopyProgressLine('New Dir          0    Albums');
  const deleted = parseRobocopyProgressLine('*EXTRA Dir            Old Albums');

  assert.equal(created.kind, 'info');
  assert.equal(deleted.kind, 'info');
});

test('parseRobocopyProgressLine recognises a FAILED line as failed', () => {
  const result = parseRobocopyProgressLine('2025/01/01 12:00:00 ERROR 5 (0x00000005) Copying File foo.txt');
  assert.ok(result);
  assert.equal(result.kind, 'failed');
});

test('parseRobocopyProgressLine ignores table headers and summary lines', () => {
  assert.equal(parseRobocopyProgressLine('Total    Copied   Skipped  Mismatch    FAILED    Extras'), null);
  assert.equal(parseRobocopyProgressLine('Files : 10 2 8 0 0 0'), null);
  assert.equal(parseRobocopyProgressLine('   '), null);
  assert.equal(parseRobocopyProgressLine('----------'), null);
});

// ---------------------------------------------------------------------------
// Summary parser — moved out of main.js; smoke-test the moved code.
// ---------------------------------------------------------------------------

test('parseRobocopySummary parses a Dirs/Files/Bytes block into the engine summary shape', () => {
  const sample = `
------------------------------------------------------------------------------
   Total    Copied   Skipped  Mismatch    FAILED    Extras
    Dirs :         1         1         0         0         0         0
   Files :        10         5         5         0         0         0
   Bytes :     1234       500       734         0         0         0
`;
  const summary = parseRobocopySummary(sample);

  // Dirs line: Total 1, Copied 1, Skipped 0, Mismatch 0, FAILED 0, Extras 0
  assert.equal(summary.dirs.total, 1);
  assert.equal(summary.dirs.copied, 1);
  // Files line: Total 10, Copied 5, Skipped 5, Mismatch 0, FAILED 0, Extras 0
  assert.equal(summary.files.total, 10);
  assert.equal(summary.files.copied, 5);
  assert.equal(summary.files.skipped, 5);
  // Bytes line: Total 1234, Copied 500, Skipped 734, Mismatch 0, FAILED 0, Extras 0
  assert.equal(summary.bytes.total, 1234);
  assert.equal(summary.bytes.copied, 500);
  assert.equal(summary.bytes.skipped, 734);
  // Top-level convenience copies
  assert.equal(summary.copied, 5);
  assert.equal(summary.skipped, 5);
});

test('parseRobocopySummary returns empty summary on blank input', () => {
  const summary = parseRobocopySummary('');
  assert.deepEqual(summary, emptyRobocopySummary());
});

test('emptyRobocopyLineTotals returns the canonical totals object', () => {
  assert.deepEqual(emptyRobocopyLineTotals(), {
    total: 0,
    copied: 0,
    skipped: 0,
    mismatch: 0,
    failed: 0,
    extras: 0
  });
});

// ---------------------------------------------------------------------------
// Exit-code mapping
// ---------------------------------------------------------------------------

test('interpretRobocopyExitCode maps 0 to no-change success', () => {
  const result = interpretRobocopyExitCode(0);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'no-change');
});

test('interpretRobocopyExitCode maps 1-7 to success (non-fatal bitmask)', () => {
  assert.equal(interpretRobocopyExitCode(1).ok, true);
  assert.equal(interpretRobocopyExitCode(3).ok, true);
  assert.equal(interpretRobocopyExitCode(7).ok, true);
});

test('interpretRobocopyExitCode maps 16 to fatal', () => {
  const result = interpretRobocopyExitCode(16);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'fatal');
});

test('interpretRobocopyExitCode maps other codes to error', () => {
  const result = interpretRobocopyExitCode(99);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'error');
  assert.ok(/error code 99/.test(result.message));
});

test('inferRobocopyExitCodeFromOutput reconstructs the bitmask from summary counts', () => {
  const sample = `
Files :    10    5    5    0    0    0
Bytes :   1000   500   500   0   0   0
`;
  // 5 copied files → bit 0 (1). No extras/mismatch/failed.
  assert.equal(inferRobocopyExitCodeFromOutput(sample), 1);
});

test('inferRobocopyExitCodeFromOutput combines bits when summary has multiple signals', () => {
  const sample = `
Files :    10    5    3    1    1    2
Bytes :   1000   500   500   0   0   0
`;
  // copied=5 (bit 0), extras=2 (bit 1), mismatch=1 (bit 2), failed=1 (bit 3) → 1|2|4|8 = 15
  assert.equal(inferRobocopyExitCodeFromOutput(sample), 15);
});

// ---------------------------------------------------------------------------
// getRobocopyFileCounts — convenience over the summary shape
// ---------------------------------------------------------------------------

test('getRobocopyFileCounts extracts counts from a parsed summary', () => {
  const sample = `
Files :    10    5    5    0    0    2
`;
  const summary = parseRobocopySummary(sample);
  const counts = getRobocopyFileCounts(summary);
  assert.equal(counts.copied, 5);
  assert.equal(counts.skipped, 5);
  assert.equal(counts.extras, 2);
  assert.equal(counts.failed, 0);
});

test('getRobocopyFileCounts handles missing summary gracefully', () => {
  assert.deepEqual(getRobocopyFileCounts({}), { copied: 0, skipped: 0, failed: 0, extras: 0 });
});

// ---------------------------------------------------------------------------
// buildRobocopyArgs — verify the engine-specific builder still produces the
// expected argv. The existing robocopy-dryrun-parser tests cover the
// downstream parser; this just locks the arg shape so a future change to
// the builder surfaces as a test diff.
// ---------------------------------------------------------------------------

test('buildRobocopyArgs includes /FFT, /COPY:DAT, and /L for dry-run', () => {
  const args = buildRobocopyArgs({
    sourcePath: 'C:\\src',
    targetPath: 'D:\\dst',
    dryRun: true,
    syncMode: 'oneWay'
  });
  assert.ok(args.includes('/FFT'));
  assert.ok(args.includes('/COPY:DAT'));
  assert.ok(args.includes('/L'));
  assert.ok(!args.includes('/MIR'), 'one-way sync must not use /MIR');
});

test('buildRobocopyArgs uses /MIR for mirror mode', () => {
  const args = buildRobocopyArgs({
    sourcePath: 'C:\\src',
    targetPath: 'D:\\dst',
    dryRun: false,
    syncMode: 'mirror'
  });
  assert.ok(args.includes('/MIR'));
});

// ---------------------------------------------------------------------------
// aggregateSummaries — locks the helper that was previously buried in
// main.js. The cross-source-root combination logic is exercised here so
// future refactors don't regress it.
// ---------------------------------------------------------------------------

test('aggregateRobocopySummaries sums totals across per-source-root summaries', () => {
  const a = emptyRobocopySummary();
  a.dirs = { ...emptyRobocopyLineTotals(), total: 1, copied: 1 };
  a.files = { ...emptyRobocopyLineTotals(), total: 5, copied: 3, skipped: 2 };
  a.bytes = { ...emptyRobocopyLineTotals(), total: 1000, copied: 600 };
  a.copied = 3;
  a.skipped = 2;

  const b = emptyRobocopySummary();
  b.dirs = { ...emptyRobocopyLineTotals(), total: 2, copied: 2 };
  b.files = { ...emptyRobocopyLineTotals(), total: 7, copied: 4, skipped: 3 };
  b.bytes = { ...emptyRobocopyLineTotals(), total: 2000, copied: 800 };
  b.copied = 4;
  b.skipped = 3;

  const combined = aggregateRobocopySummaries([a, b]);

  assert.equal(combined.dirs.total, 3);
  assert.equal(combined.dirs.copied, 3);
  assert.equal(combined.files.total, 12);
  assert.equal(combined.files.copied, 7);
  assert.equal(combined.files.skipped, 5);
  assert.equal(combined.bytes.total, 3000);
  assert.equal(combined.copied, 7);
  assert.equal(combined.skipped, 5);
});

// ---------------------------------------------------------------------------
// Sanity: the interface aliases point at the engine-specific functions.
// ---------------------------------------------------------------------------

test('interface aliases (buildArgs, parseProgressLine, ...) point at the engine implementations', () => {
  assert.equal(robocopyEngine.buildArgs, robocopyEngine.buildRobocopyArgs);
  assert.equal(robocopyEngine.parseProgressLine, robocopyEngine.parseRobocopyProgressLine);
  assert.equal(robocopyEngine.applyProgress, robocopyEngine.applyRobocopyProgress);
  assert.equal(robocopyEngine.parseSummary, robocopyEngine.parseRobocopySummary);
  assert.equal(robocopyEngine.emptySummary, robocopyEngine.emptyRobocopySummary);
  assert.equal(robocopyEngine.aggregateSummaries, robocopyEngine.aggregateRobocopySummaries);
  assert.equal(robocopyEngine.inferExitCodeFromOutput, robocopyEngine.inferRobocopyExitCodeFromOutput);
  assert.equal(robocopyEngine.interpretExitCode, robocopyEngine.interpretRobocopyExitCode);
  assert.equal(robocopyEngine.getFileCounts, robocopyEngine.getRobocopyFileCounts);
  assert.equal(robocopyEngine.spawn, robocopyEngine.spawnRobocopy);
  assert.equal(robocopyEngine.createOutputDecoder, robocopyEngine.createRobocopyOutputDecoder);
});

// --- M8: junction/symlink exclusion ----------------------------------------

test('buildRobocopyArgs always excludes junctions and symlinks with /XJ', () => {
  const syncArgs = buildRobocopyArgs({
    sourcePath: 'C:\src', targetPath: 'D:\dst', dryRun: false,
    excludePatterns: [], skipOlderSource: true, copySubfolders: true, syncMode: 'oneWay'
  });
  assert.ok(syncArgs.includes('/XJ'), 'sync run excludes links');

  const mirrorArgs = buildRobocopyArgs({
    sourcePath: 'C:\src', targetPath: 'D:\dst', dryRun: true,
    excludePatterns: [], skipOlderSource: false, copySubfolders: true, syncMode: 'mirror'
  });
  assert.ok(mirrorArgs.includes('/XJ'), 'mirror (and its /L compare) excludes links so /MIR cannot delete through a junction');
});
