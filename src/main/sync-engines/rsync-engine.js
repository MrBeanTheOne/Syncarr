// -----------------------------------------------------------------------------
// rsync sync engine — Linux + macOS implementation of the SyncEngine
// interface documented at the top of robocopy-engine.js.
//
// This module mirrors the robocopy engine's exports so the rest of the
// orchestrator can dispatch through the engine registry without caring
// about which binary actually runs. The args builder, spawn wrapper, and
// exit-code interpreter are real implementations; the progress/summary
// parsers are minimal but produce the same shape the orchestrator expects.
//
// Notes on parity with the Robocopy engine:
//
//   * Robocopy's `/FFT` (FAT timestamp tolerance) has no direct rsync
//     equivalent. rsync compares timestamps at second precision by default
//     and tolerates slight skew between SMB clients and servers; this is
//     sufficient for the typical NAS-share use case.
//
//   * Robocopy's `/MIR` (mirror + purge) is mapped to rsync's
//     `--delete`. We do NOT add `--delete-excluded` so excluded patterns
//     in the destination are left alone, matching how Robocopy treats
//     `/XF` + `/MIR` in practice.
//
//   * `skipOlderSource` maps to rsync's `-u` flag, which is the closest
//     match to Robocopy's `/XO`. In mirror mode `-u` is omitted because
//     mirror semantics require the destination to match the source.
//
//   * Owner/group preservation is deliberately omitted (no `-o -g`). The
//     `-a` ("archive") flag would imply owner+group but requires root or
//     CAP_CHOWN; the typical desktop user does not have those, so we use
//     `-lptD` (symlinks + perms + times + devices) which works unprivileged.
//
//   * Exclude patterns are passed one-per-flag. rsync supports comma-
//     separated `--exclude={a,b}` syntax but the comma is interpreted as
//     a literal pattern char in some rsync versions; per-flag is safer.
//
//   * The source path receives a trailing slash so rsync copies the
//     source's contents into the target rather than creating target/source/.
// -----------------------------------------------------------------------------

const { spawn } = require('child_process');
const { normalizeSyncMode, RUN_STATUS, NO_CHANGE_MESSAGE } = require('../job-model');
const { emptyLineTotals, addLineTotals } = require('./summary-totals');

const COMMAND = 'rsync';

// Spawn rsync with engine-appropriate defaults. We do NOT set `shell: true`
// because rsync (like robocopy) interprets its own argv; passing through a
// shell would let special characters in paths get re-interpreted. On
// Windows the binary must be on PATH (e.g. via cwRsync or MSYS2) — this
// engine assumes rsync is available when invoked.
function spawnRsync(args, options = {}) {
  return spawn(COMMAND, args, {
    windowsHide: true,
    shell: false,
    ...options
  });
}

// ---------------------------------------------------------------------------
// buildRsyncArgs — translate a Syncarr job request into rsync argv.
// ---------------------------------------------------------------------------
function buildRsyncArgs({
  sourcePath,
  targetPath,
  dryRun = false,
  excludePatterns = [],
  skipOlderSource = false,
  copySubfolders = false,
  syncMode = 'oneWay'
} = {}) {
  if (!sourcePath || typeof sourcePath !== 'string') {
    throw new Error('buildRsyncArgs requires a sourcePath string.');
  }
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('buildRsyncArgs requires a targetPath string.');
  }

  const args = [];
  const isMirror = normalizeSyncMode(syncMode) === 'mirror';
  const recursive = isMirror || Boolean(copySubfolders);

  // Preserve symlinks, perms, modification times, and device files. We
  // intentionally do not preserve owner (-o) or group (-g) because that
  // requires CAP_CHOWN and would silently fail for the typical desktop
  // user syncing to a NAS share.
  args.push('-lptD');
  if (recursive) args.push('-r');

  // `-i`     itemize-changes (per-file action like '>f+++++++++ path')
  // `--stats` trailing totals block (file counts + bytes)
  // `-v`     human-readable verbose (helps debugging; rsync is silent
  //          otherwise, which makes the orchestrator's progress stream
  //          useless)
  args.push('-i', '--stats', '-v');

  // Skip files that are newer on the receiver (skipOlderSource safety).
  // In mirror mode this is unnecessary and would break delete semantics.
  if (skipOlderSource && !isMirror) args.push('-u');

  // Mirror mode: delete files in target that aren't in source.
  if (isMirror) args.push('--delete');

  // Dry run: rsync prints itemize-changes lines but makes no modifications.
  if (dryRun) args.push('-n');

  // Exclude patterns. rsync uses simple glob semantics; each pattern is
  // passed as a separate flag.
  for (const pattern of excludePatterns || []) {
    const trimmed = String(pattern || '').trim();
    if (trimmed) args.push(`--exclude=${trimmed}`);
  }

  // Trailing slash on source means "contents of source" (not "create
  // source as a subdirectory of target"). rsync is sensitive to this
  // distinction.
  const source = sourcePath.endsWith('/') ? sourcePath : `${sourcePath}/`;
  // End-of-options separator: everything after "--" is a positional path, so a
  // source/target beginning with "-" can't be swallowed as an rsync option
  // (argument injection). Absolute paths (leading "/") remain valid. Exclude
  // patterns are already safe because they are glued as "--exclude=<pattern>".
  args.push('--', source, targetPath);

  return args;
}

// ---------------------------------------------------------------------------
// Output decoder — rsync writes UTF-8 natively, so this is identity.
// ---------------------------------------------------------------------------
function createRsyncOutputDecoder() {
  return {
    write(chunk) {
      if (!chunk || !chunk.length) return '';
      return chunk.toString('utf8');
    },
    end() {
      return '';
    }
  };
}

// ---------------------------------------------------------------------------
// splitExcludes — kept for parity with robocopy-engine so the registry
// callers can use a uniform shape. rsync does not need a directory/file
// split the way robocopy does (rsync --exclude handles both), but we
// expose the same return shape to keep the interface symmetric.
// ---------------------------------------------------------------------------
function splitExcludes(excludePatterns = []) {
  const normalized = (excludePatterns || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  // rsync doesn't distinguish file vs dir excludes the way robocopy does
  // (/XF vs /XD). We split only as a convenience for callers that want
  // to log the partition; everything flows through --exclude either way.
  const fileExcludes = normalized.filter((pattern) => /\.[a-z0-9]{1,8}$/i.test(pattern));
  const dirExcludes = normalized.filter((pattern) => !fileExcludes.includes(pattern));
  return { fileExcludes, dirExcludes };
}

// ---------------------------------------------------------------------------
// Progress line parser — classifies a single line of rsync -i output.
//
// Recognised shapes (from `man rsync`, --itemize-changes section):
//   >f+++++++++  path/to/new     (new file, will be created)
//   >f..t....    path/to/modified (file updated, only timestamp changed)
//   .f.........  path/to/same     (unchanged, just listed)
//   *deleting    path/to/extra    (mirror mode only: would be deleted)
//   cd+++++++++  path/to/newdir/  (new directory)
//   rsync warning: ...            (warning; not a hard failure)
//   rsync error: ...              (hard failure)
//
// We intentionally keep this minimal: the orchestrator only uses `kind`
// for the live progress counter and `file` for the "latest file" hint,
// so a coarse classification is sufficient. The summary parser handles
// the totals.
// ---------------------------------------------------------------------------
function parseRsyncProgressLine(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  if (/^[-=\s]+$/.test(text)) return null;

  // Stats block lines are emitted AFTER the per-file listing. The
  // orchestrator's readProgress splits on newline so the trailing
  // summary will pass through here too; filter it out.
  if (/^(Number of |Total |Literal data|Matched data|File list|sent |received |total size)/i.test(text)) {
    return null;
  }

  // Hard errors
  if (/^rsync error:/i.test(text)) {
    return {
      kind: 'failed',
      label: 'Error',
      text,
      file: ''
    };
  }

  // Warnings (soft; we still surface them as info so they show in the
  // run log without bumping the failed counter)
  if (/^rsync warning:/i.test(text)) {
    return {
      kind: 'info',
      label: 'Warning',
      text,
      file: ''
    };
  }

  // Mirror-mode delete candidates
  const deleteMatch = text.match(/^\*deleting\s+(.+)$/i);
  if (deleteMatch) {
    const deletedPath = deleteMatch[1].trim();
    return {
      kind: deletedPath.endsWith('/') ? 'info' : 'extra',
      label: '*deleting',
      text,
      file: deletedPath
    };
  }

  // Itemize-changes: YX... PATH where Y is the update type and X is the
  // file type (f/d/L/D/S). Flags cstpoguax follow.
  const itemMatch = text.match(/^([<>*.+-?])(\S+)\s+(.+)$/);
  if (!itemMatch) return null;

  const updateType = itemMatch[1];
  const flags = itemMatch[2];
  const path = itemMatch[3].trim();

  let kind = 'info';
  if (updateType === '>') {
    // File or directory being sent (new or modified). Both count as
    // "copied" from the user's perspective.
    kind = 'copied';
  } else if (updateType === '.') {
    kind = 'skipped';
  } else if (updateType === '+' || updateType === '-') {
    kind = 'info';
  } else if (updateType === '*') {
    // Local-side change (mirror with --delete)
    kind = 'info';
  } else if (updateType === '?') {
    kind = 'info';
  }

  return {
    kind,
    label: `${updateType}${flags.charAt(0)}`,
    text,
    file: path
  };
}

// extractRsyncFileHint — return the path portion of an itemize-changes
// line. Kept for parity with robocopy's extractRobocopyFileHint.
function extractRsyncFileHint(line) {
  const match = String(line || '').match(/^([<>*.+-?])\S*\s+(.+)$/);
  return match ? match[2].trim() : String(line || '').trim();
}

// applyRsyncProgress — same shape as applyRobocopyProgress so the
// orchestrator can swap engines without rewriting state handling.
function applyRsyncProgress(state, progress) {
  if (!state || !progress) return state;
  if (progress.kind === 'copied') state.copied = (state.copied || 0) + 1;
  if (progress.kind === 'skipped') state.skipped = (state.skipped || 0) + 1;
  if (progress.kind === 'failed') state.failed = (state.failed || 0) + 1;
  if (progress.kind === 'extra') state.extra = (state.extra || 0) + 1;
  state.latestText = progress.text;
  state.latestFile = progress.file || state.latestFile;
  return {
    ...state,
    ...progress
  };
}

// ---------------------------------------------------------------------------
// Summary helpers — rsync with --stats emits a "Number of files" block
// rather than Robocopy's Dirs:/Files:/Bytes: lines. We parse the rsync
// block and adapt it to the same shape the orchestrator already expects.
// ---------------------------------------------------------------------------
function emptyRsyncLineTotals() {
  return emptyLineTotals();
}

function emptyRsyncSummary() {
  return {
    dirs: emptyRsyncLineTotals(),
    files: emptyRsyncLineTotals(),
    bytes: emptyRsyncLineTotals(),
    failed: 0,
    extras: 0,
    copied: 0,
    skipped: 0
  };
}

function addRsyncLineTotals(target, source) {
  addLineTotals(target, source);
}

function aggregateRsyncSummaries(summaries) {
  const aggregate = emptyRsyncSummary();
  aggregate.dirs = emptyRsyncLineTotals();
  aggregate.files = emptyRsyncLineTotals();
  aggregate.bytes = emptyRsyncLineTotals();

  for (const summary of summaries || []) {
    addRsyncLineTotals(aggregate.dirs, summary.dirs);
    addRsyncLineTotals(aggregate.files, summary.files);
    addRsyncLineTotals(aggregate.bytes, summary.bytes);
  }

  aggregate.copied = aggregate.files.copied;
  aggregate.skipped = aggregate.files.skipped;
  aggregate.failed = aggregate.files.failed;
  aggregate.extras = aggregate.files.extras;
  return aggregate;
}

// parseRsyncSummary — best-effort extraction of totals from a `--stats`
// block. We accept either the rsync-native stats block or a previously
// accumulated progress state. If neither is present we return an empty
// summary populated with whatever progress is in the output.
function parseRsyncSummary(output) {
  const text = String(output || '');
  const summary = emptyRsyncSummary();

  if (!text.trim()) return summary;

  // Number of files: 100 (reg: 90, dir: 10)
  const totalMatch = text.match(/Number of files:\s+([0-9,]+)/i);
  if (totalMatch) summary.files.total = Number(totalMatch[1].replace(/,/g, '')) || 0;

  // Number of created files: 5 (reg: 4, dir: 1)
  const createdMatch = text.match(/Number of created files:\s+([0-9,]+)/i);
  if (createdMatch) summary.files.copied = Number(createdMatch[1].replace(/,/g, '')) || 0;

  // Number of deleted files: 2 (reg: 1, dir: 1)
  const deletedMatch = text.match(/Number of deleted files:\s+([0-9,]+)/i);
  if (deletedMatch) summary.files.extras = Number(deletedMatch[1].replace(/,/g, '')) || 0;

  // Number of regular files transferred: 5
  const transferredMatch = text.match(/Number of regular files transferred:\s+([0-9,]+)/i);
  if (transferredMatch) summary.files.copied = Number(transferredMatch[1].replace(/,/g, '')) || 0;

  // Total file size: 1,234 bytes
  const sizeMatch = text.match(/Total file size:\s+([0-9,]+)/i);
  if (sizeMatch) summary.bytes.total = Number(sizeMatch[1].replace(/,/g, '')) || 0;

  // Total transferred file size: 1,000 bytes
  const transferredSizeMatch = text.match(/Total transferred file size:\s+([0-9,]+)/i);
  if (transferredSizeMatch) summary.bytes.copied = Number(transferredSizeMatch[1].replace(/,/g, '')) || 0;

  // Mirror-mode fallback: count "*deleting" lines if stats block missed them
  if (summary.files.extras === 0) {
    const deleteLines = text.match(/^\*deleting\s+/gm) || [];
    if (deleteLines.length) summary.files.extras = deleteLines.length;
  }

  // Top-level convenience copies (mirror the robocopy summary shape)
  summary.copied = summary.files.copied;
  summary.skipped = summary.files.skipped;
  summary.failed = summary.files.failed;
  summary.extras = summary.files.extras;

  return summary;
}

// ---------------------------------------------------------------------------
// Exit-code mapping. rsync uses simple non-zero-on-error semantics:
//   0    success
//   23   partial transfer (some files failed but the run completed)
//   24   partial transfer due to vanished source files
//   any other non-zero is treated as a hard failure.
// ---------------------------------------------------------------------------
function inferRsyncExitCodeFromOutput(_output) {
  // rsync never returns a bitmask; the orchestrator falls back to the
  // actual exit code if the process exits cleanly. We return 0 here as
  // a "no signal of error from the output itself" default; the real exit
  // code is taken from the process when available.
  return 0;
}

function interpretRsyncExitCode(code) {
  if (code === 0) {
    return { ok: true, status: RUN_STATUS.NO_CHANGE, message: NO_CHANGE_MESSAGE };
  }
  if (code === 23 || code === 24) {
    return {
      ok: true,
      status: RUN_STATUS.SUCCESS,
      message: 'Rsync completed with some files skipped (partial transfer).'
    };
  }
  return {
    ok: false,
    status: RUN_STATUS.ERROR,
    message: `Rsync completed with error code ${code}.`
  };
}

function getRsyncFileCounts(summary = {}) {
  const files = summary && summary.files ? summary.files : {};
  return {
    copied: Number(files.copied || summary.copied || 0),
    skipped: Number(files.skipped || summary.skipped || 0),
    failed: Number(files.failed || summary.failed || 0),
    extras: Number(files.extras || summary.extras || 0)
  };
}

module.exports = {
  command: COMMAND,
  // SyncEngine interface — keep names matching robocopy-engine.js where
  // possible so the orchestrator can dispatch through either engine
  // without renaming.
  buildArgs: buildRsyncArgs,
  spawn: spawnRsync,
  createOutputDecoder: createRsyncOutputDecoder,
  parseProgressLine: parseRsyncProgressLine,
  applyProgress: applyRsyncProgress,
  parseSummary: parseRsyncSummary,
  emptySummary: emptyRsyncSummary,
  aggregateSummaries: aggregateRsyncSummaries,
  inferExitCodeFromOutput: inferRsyncExitCodeFromOutput,
  interpretExitCode: interpretRsyncExitCode,
  getFileCounts: getRsyncFileCounts,
  // Engine-specific named exports (for direct tests / advanced callers).
  buildRsyncArgs,
  spawnRsync,
  createRsyncOutputDecoder,
  splitExcludes,
  parseRsyncProgressLine,
  applyRsyncProgress,
  emptyRsyncSummary,
  aggregateRsyncSummaries,
  parseRsyncSummary,
  inferRsyncExitCodeFromOutput,
  interpretRsyncExitCode,
  getRsyncFileCounts
};
