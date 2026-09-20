// -----------------------------------------------------------------------------
// SyncEngine interface contract
// -----------------------------------------------------------------------------
//
// Every sync engine (robocopy, rsync, future engines) must export the same
// surface so the rest of the orchestrator can be engine-agnostic. The
// interface below documents the contract; this file (robocopy-engine.js) is
// the reference implementation on Windows. The matching rsync-engine.js
// implements the same surface for Linux and macOS.
//
// Required exports:
//
//   buildArgs({
//     sourcePath,           // absolute path on the local filesystem
//     targetPath,           // absolute path on the local filesystem (or share)
//     dryRun,               // boolean — true for Compare, false for Sync
//     excludePatterns,      // string[] — glob-like patterns to skip
//     skipOlderSource,      // boolean — never overwrite a newer destination
//     copySubfolders,       // boolean — recurse into subdirectories
//     syncMode              // 'oneWay' | 'mirror' (see job-model)
//   }) -> string[]
//
//     Returns the argv that will be passed to `spawn`. Engines are
//     responsible for ensuring the source path semantics match the
//     platform's expectations (e.g. rsync needs a trailing slash on the
//     source to mean "contents of", not "create as a subdirectory").
//
//   spawn(args) -> ChildProcess
//
//     Wraps `child_process.spawn` for the engine binary. Engines should
//     pick engine-appropriate defaults (e.g. `windowsHide: true, shell:
//     false` for robocopy). The returned process must support the
//     stdio event interface ('data', 'error', 'exit', 'close').
//
//   createOutputDecoder() -> { write(chunk): string, end(): string }
//
//     Stateful decoder for the engine's stdio output. robocopy needs
//     CP850 fallback because Windows console output is OEM-encoded;
//     rsync outputs UTF-8 natively so its decoder is identity.
//
//   parseProgressLine(line: string) -> null | {
//     kind: 'copied' | 'skipped' | 'failed' | 'extra' | 'info',
//     label: string,                // engine-native verb (e.g. 'New File')
//     text: string,                 // original line, trimmed
//     file: string                  // best-effort filename hint
//   }
//
//     Classifies a single line of per-file progress output. Lines that
//     are not progress (stats blocks, separators, blank) return null.
//
//   applyProgress(state, progress) -> state
//
//     Mutates the supplied progress state with the new event. Returns
//     the next state object. State shape:
//     { copied, skipped, failed, extra, latestText, latestFile }.
//
//   parseSummary(output: string) -> {
//     dirs:  { total, copied, skipped, mismatch, failed, extras },
//     files: { total, copied, skipped, mismatch, failed, extras },
//     bytes: { total, copied, skipped, mismatch, failed, extras },
//     copied, skipped, failed, extras  // top-level convenience copies
//   }
//
//     Parses the engine's trailing summary block. robocopy emits
//     `Dirs :`, `Files :`, `Bytes :` lines; rsync with --stats emits
//     a `Number of files:` block. Engines that have no summary block
//     can return `emptySummary()` populated from accumulated progress.
//
//   emptySummary() -> summary
//
//   aggregateSummaries([summary]) -> summary
//
//     Helpers for combining multiple per-source-root summary blocks.
//
//   inferExitCodeFromOutput(output: string) -> number
//
//     Best-effort exit code from output, used as a fallback when the
//     child process exited without a numeric code.
//
//   interpretExitCode(code: number) -> {
//     ok: boolean,
//     status: 'no-change' | 'success' | 'fatal' | 'error',
//     message: string
//   }
//
//     Maps the engine's exit code to a Syncarr-level status.
//
//   getFileCounts(summary) -> { copied, skipped, failed, extras }
//
//     Extracts the file counts from a summary object for completion
//     messages.
//
// Engines should additionally export a `command` string (the binary name)
// so registry consumers can show what would actually be invoked.
// -----------------------------------------------------------------------------

const { spawn } = require('child_process');
const { normalizeSyncMode, RUN_STATUS, NO_CHANGE_MESSAGE } = require('../job-model');
const { emptyLineTotals, addLineTotals } = require('./summary-totals');

const CP850_EXTENDED_CODEPOINTS = [
  199, 252, 233, 226, 228, 224, 229, 231, 234, 235, 232, 239, 238, 236, 196, 197,
  201, 230, 198, 244, 246, 242, 251, 249, 255, 214, 220, 248, 163, 216, 215, 402,
  225, 237, 243, 250, 241, 209, 170, 186, 191, 174, 172, 189, 188, 161, 171, 187,
  9617, 9618, 9619, 9474, 9508, 193, 194, 192, 169, 9571, 9553, 9559, 9565, 162, 165,
  9488, 9492, 9524, 9516, 9500, 9472, 9532, 227, 195, 9562, 9556, 9577, 9574, 9568,
  9552, 9580, 164, 240, 208, 202, 203, 200, 305, 205, 206, 207, 9496, 9484, 9608,
  9604, 166, 204, 9600, 211, 223, 212, 210, 245, 213, 181, 254, 222, 218, 219, 217,
  253, 221, 175, 180, 173, 177, 8215, 190, 182, 167, 247, 184, 176, 168, 183, 185,
  179, 178, 9632, 160
];

function spawnRobocopy(args) {
  // Keep Robocopy spawned directly so Windows receives the source, target, and
  // switches exactly as separate argv entries. Wrapping Robocopy through
  // PowerShell can drop or reinterpret /E, /L, /XO, and quoted paths, which makes
  // Robocopy print its help screen and exit with code 16.
  return spawn('robocopy', args, {
    windowsHide: true,
    shell: false
  });
}

function decodeCp850(buffer) {
  let text = '';

  for (const byte of buffer) {
    if (byte < 128) {
      text += String.fromCharCode(byte);
    } else {
      text += String.fromCodePoint(CP850_EXTENDED_CODEPOINTS[byte - 128]);
    }
  }

  return text;
}

function createRobocopyOutputDecoder() {
  return {
    write(chunk) {
      if (!chunk || !chunk.length) return '';

      const utf8Text = chunk.toString('utf8');

      // If the bytes are already valid UTF-8, keep them. If Windows emitted
      // legacy console/OEM bytes, Node replaces accented characters with �;
      // decode those chunks as CP850 instead. This preserves names such as
      // Banière.png while keeping direct Robocopy argument handling intact.
      if (!utf8Text.includes('�')) return utf8Text;

      return decodeCp850(chunk);
    },
    end() {
      return '';
    }
  };
}

function splitExcludes(excludePatterns = []) {
  const normalizedExcludes = excludePatterns
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const fileExcludes = [];
  const dirExcludes = [];

  for (const pattern of normalizedExcludes) {
    const lower = pattern.toLowerCase();
    const knownDirs = new Set(['node_modules', '.git', '.svn', '.hg', '@eadir']);
    const knownFiles = new Set(['thumbs.db', '.ds_store', 'desktop.ini']);

    if (knownDirs.has(lower)) {
      dirExcludes.push(pattern);
    } else if (knownFiles.has(lower) || pattern.includes('*')) {
      fileExcludes.push(pattern);
    } else if (pattern.includes('\\') || pattern.includes('/')) {
      dirExcludes.push(pattern);
    } else if (/\.[a-z0-9]{1,8}$/i.test(pattern)) {
      fileExcludes.push(pattern);
    } else {
      dirExcludes.push(pattern);
    }
  }

  return { fileExcludes, dirExcludes };
}

// Argument-injection guard. spawn(shell:false) blocks SHELL injection, but a
// path/exclude that begins with "/" is still swallowed by Robocopy as a
// command-line SWITCH (e.g. /MOVE, /PURGE, /MIR, /LOG:...), which can turn a
// copy into something destructive. A real Windows path never starts with "/"
// (drive letters, or "\\server\share"), and Robocopy uses only "/"-prefixed
// switches — so "-name.txt" is a legitimate file and must NOT be rejected.
function assertNotRobocopySwitch(value, kind) {
  const str = String(value == null ? '' : value);
  if (str.startsWith('/')) {
    throw new Error(`Refusing to build the Robocopy command: ${kind} "${str}" begins with "/", which Robocopy would parse as a switch rather than a path. Use a Windows path such as C:\\folder or \\\\server\\share.`);
  }
}

function buildRobocopyArgs({ sourcePath, targetPath, dryRun, excludePatterns, skipOlderSource, copySubfolders, syncMode }) {
  assertNotRobocopySwitch(sourcePath, 'source path');
  assertNotRobocopySwitch(targetPath, 'destination path');
  for (const pattern of excludePatterns || []) {
    assertNotRobocopySwitch(pattern, 'exclude pattern');
  }

  const args = [sourcePath, targetPath];
  const cleanMode = normalizeSyncMode(syncMode);

  // Mirror mode uses /MIR. During compare, /L makes destination-only files visible
  // as delete candidates without applying them; during sync, Robocopy applies them.
  if (cleanMode === 'mirror') {
    args.push('/MIR');
  } else if (copySubfolders) {
    // /E copies subdirectories including empty folders. No switch keeps the job top-level only.
    args.push('/E');
  }

  // Data, attributes, timestamps. Avoid owner/audit/ACL complexity in this prototype.
  args.push('/COPY:DAT');
  args.push('/DCOPY:DAT');

  // Better for SMB/NAS timestamp tolerance.
  args.push('/FFT');

  // Exclude junction points and symbolic links (audit M8). Without /XJ,
  // robocopy follows links during copy AND during /MIR extra-deletion — a
  // link inside the tree can read from or delete outside the intended root,
  // and none of the JS scanners (history archival, previews, watchers) see
  // through links, so anything robocopy deleted through one was never
  // archived. /XJ also matches what collectSourceFiles already scans, keeping
  // the preview/archive/copy views of the tree consistent. Trees that rely on
  // junction aliases will no longer sync those subtrees.
  args.push('/XJ');

  // Retry quickly and do not hang forever on locked files.
  args.push('/R:1');
  args.push('/W:1');

  // Safer update mode: do not overwrite a newer destination file with an older source file.
  // Mirror planning must not use /XO because the destination should match the source.
  if (cleanMode !== 'mirror' && skipOlderSource) args.push('/XO');

  // Cleaner progress output while still producing useful logs.
  args.push('/NP');
  args.push('/TEE');

  // Dry run.
  if (dryRun) args.push('/L');

  const { fileExcludes, dirExcludes } = splitExcludes(excludePatterns || []);
  if (fileExcludes.length) args.push('/XF', ...fileExcludes);
  if (dirExcludes.length) args.push('/XD', ...dirExcludes);

  return args;
}

// ---------------------------------------------------------------------------
// Progress line parser — classifies a single line of Robocopy output and
// returns the SyncEngine-agnostic progress shape. Lines that aren't per-file
// progress (table headers, summary blocks, blank lines) return null.
// ---------------------------------------------------------------------------
function parseRobocopyProgressLine(line) {
  const text = String(line || '').trim();
  if (!text || /^[-\s]+$/.test(text)) return null;

  // Ignore Robocopy table headers. They contain the word FAILED but are not failures.
  if (/^Total\s+Copied\s+Skipped\s+Mismatch\s+FAILED\s+Extras$/i.test(text)) return null;
  if (/^(Dirs|Files|Bytes|Times)\s*:/i.test(text)) return null;

  if (/\b(ERROR|FAILED)\b/i.test(text)) {
    return {
      kind: 'failed',
      label: 'Failed',
      text,
      file: extractRobocopyFileHint(text)
    };
  }

  const match = text.match(/^(\*EXTRA File|\*EXTRA Dir|New File|New Dir|Newer|Older|Changed|Tweaked|Same|Extra)\s+(.+)$/i);
  if (!match) return null;

  const action = match[1].replace(/\s+/g, ' ');
  const detail = match[2].trim();
  const isDirectoryAction = /\bDir$/i.test(action);
  let kind = 'info';

  if (!isDirectoryAction && /^(New File|Newer|Changed|Tweaked)$/i.test(action)) {
    kind = 'copied';
  } else if (/^(Older|Same)$/i.test(action)) {
    kind = 'skipped';
  } else if (!isDirectoryAction && /^\*?Extra/i.test(action)) {
    kind = 'extra';
  }

  return {
    kind,
    label: action,
    text,
    file: extractRobocopyFileHint(detail)
  };
}

function applyRobocopyProgress(state, progress) {
  if (!state || !progress) return state;
  if (progress.kind === 'copied') state.copied += 1;
  if (progress.kind === 'skipped') state.skipped += 1;
  if (progress.kind === 'failed') state.failed += 1;
  if (progress.kind === 'extra') state.extra += 1;

  state.latestText = progress.text;
  state.latestFile = progress.file || state.latestFile;

  return {
    ...state,
    ...progress
  };
}

function extractRobocopyFileHint(text) {
  return String(text || '')
    .replace(/^[0-9.,]+\s*[kmgtpe]?\s+/i, '')
    .replace(/^.*\b(?:File|Dir)\s+/i, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Summary parser — handles Robocopy's trailing Dirs:/Files:/Bytes: block.
// Mirrors the shape the rsync engine emits so the orchestrator can consume
// either engine's output through a single summary contract.
// ---------------------------------------------------------------------------
function emptyRobocopyLineTotals() {
  return emptyLineTotals();
}

function emptyRobocopySummary() {
  return {
    dirs: null,
    files: null,
    bytes: null,
    failed: null,
    extras: null,
    copied: null,
    skipped: null
  };
}

function addSummaryLineTotals(target, source) {
  addLineTotals(target, source);
}

function aggregateRobocopySummaries(summaries) {
  const aggregate = emptyRobocopySummary();
  aggregate.dirs = emptyRobocopyLineTotals();
  aggregate.files = emptyRobocopyLineTotals();
  aggregate.bytes = emptyRobocopyLineTotals();

  for (const summary of summaries) {
    addSummaryLineTotals(aggregate.dirs, summary.dirs);
    addSummaryLineTotals(aggregate.files, summary.files);
    addSummaryLineTotals(aggregate.bytes, summary.bytes);
  }

  aggregate.copied = aggregate.files.copied;
  aggregate.skipped = aggregate.files.skipped;
  aggregate.failed = aggregate.files.failed;
  aggregate.extras = aggregate.files.extras;
  return aggregate;
}

function parseSummaryLine(line, allowUnits = false) {
  const clean = line.replace(/,/g, '');
  const parts = clean.split(/\s+/);
  // Example: Files : 10 2 8 0 0 0
  // indexes after ':' are Total, Copied, Skipped, Mismatch, FAILED, Extras
  const colonIndex = parts.indexOf(':');
  let values = parts.slice(colonIndex >= 0 ? colonIndex + 1 : 2);

  if (allowUnits) {
    // Robocopy's Bytes row space-separates a size's unit suffix from its number
    // ("Bytes :   1.5 m   0   1.5 m   0   0   0"), which otherwise splits into an
    // extra token and shifts every value into the wrong column. Re-attach a lone
    // unit token (k/m/g/t/e) to the preceding number so the 6 columns line up.
    const merged = [];
    for (const token of values) {
      if (/^[kmgte]$/i.test(token) && merged.length) {
        merged[merged.length - 1] += token;
      } else {
        merged.push(token);
      }
    }
    values = merged;
  }

  const parsed = values.map((value) => parseRobocopyNumber(value, allowUnits));
  if (parsed.length < 6) return null;

  return {
    total: parsed[0],
    copied: parsed[1],
    skipped: parsed[2],
    mismatch: parsed[3],
    failed: parsed[4],
    extras: parsed[5]
  };
}

function parseRobocopyNumber(value, allowUnits) {
  if (!allowUnits) return Number(value) || 0;

  const match = String(value).match(/^([0-9.]+)([kmgte]?)/i);
  if (!match) return 0;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;

  const unit = match[2].toLowerCase();
  const multiplier = {
    k: 1024,
    m: 1024 ** 2,
    g: 1024 ** 3,
    t: 1024 ** 4,
    e: 1024 ** 5
  }[unit] || 1;

  return Math.round(amount * multiplier);
}

function parseRobocopySummary(output) {
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const summaries = [];
  let current = emptyRobocopySummary();

  for (const line of lines) {
    if (/^Dirs\s*:/i.test(line)) {
      if (current.dirs || current.files || current.bytes) {
        summaries.push(current);
        current = emptyRobocopySummary();
      }
      current.dirs = parseSummaryLine(line);
    } else if (/^Files\s*:/i.test(line)) {
      current.files = parseSummaryLine(line);
      if (current.files) {
        current.copied = current.files.copied;
        current.skipped = current.files.skipped;
        current.failed = current.files.failed;
        current.extras = current.files.extras;
      }
    } else if (/^Bytes\s*:/i.test(line)) {
      current.bytes = parseSummaryLine(line, true);
      summaries.push(current);
      current = emptyRobocopySummary();
    }
  }

  if (current.dirs || current.files || current.bytes) summaries.push(current);
  if (!summaries.length) return emptyRobocopySummary();
  if (summaries.length === 1) return summaries[0];

  return aggregateRobocopySummaries(summaries);
}

// ---------------------------------------------------------------------------
// Exit-code mapping. Robocopy uses a bitmask where bits 0-3 are non-fatal
// signals (copied/extras/mismatch/failed) and bit 4 (value 16) is fatal.
// ---------------------------------------------------------------------------
function inferRobocopyExitCodeFromOutput(output) {
  const summary = parseRobocopySummary(output || '');
  let code = 0;
  const files = summary.files || {};
  const dirs = summary.dirs || {};
  const copied = Number(files.copied || 0) + Number(dirs.copied || 0);
  const extras = Number(files.extras || 0) + Number(dirs.extras || 0);
  const mismatch = Number(files.mismatch || 0) + Number(dirs.mismatch || 0);
  const failed = Number(files.failed || 0) + Number(dirs.failed || 0);
  if (copied > 0) code |= 1;
  if (extras > 0) code |= 2;
  if (mismatch > 0) code |= 4;
  if (failed > 0) code |= 8;
  return code;
}

function interpretRobocopyExitCode(code) {
  // Robocopy uses bitmask exit codes. Values below 8 are generally success/non-fatal.
  if (code === 0) {
    return { ok: true, status: RUN_STATUS.NO_CHANGE, message: NO_CHANGE_MESSAGE };
  }
  if (code >= 1 && code < 8) {
    return { ok: true, status: RUN_STATUS.SUCCESS, message: 'Robocopy completed without fatal errors.' };
  }
  if (code === 16) {
    return { ok: false, status: RUN_STATUS.FATAL, message: 'Robocopy reported a serious error.' };
  }
  return { ok: false, status: RUN_STATUS.ERROR, message: `Robocopy completed with error code ${code}.` };
}

function getRobocopyFileCounts(summary = {}) {
  const files = summary && summary.files ? summary.files : {};
  return {
    copied: Number(files.copied || summary.copied || 0),
    skipped: Number(files.skipped || summary.skipped || 0),
    failed: Number(files.failed || summary.failed || 0),
    extras: Number(files.extras || summary.extras || 0)
  };
}

module.exports = {
  command: 'robocopy',
  // SyncEngine interface — same surface as rsync-engine.js so the
  // orchestrator can dispatch through either engine in Phase 3.
  buildArgs: buildRobocopyArgs,
  spawn: spawnRobocopy,
  createOutputDecoder: createRobocopyOutputDecoder,
  parseProgressLine: parseRobocopyProgressLine,
  applyProgress: applyRobocopyProgress,
  parseSummary: parseRobocopySummary,
  emptySummary: emptyRobocopySummary,
  aggregateSummaries: aggregateRobocopySummaries,
  inferExitCodeFromOutput: inferRobocopyExitCodeFromOutput,
  interpretExitCode: interpretRobocopyExitCode,
  getFileCounts: getRobocopyFileCounts,
  // Engine-specific named exports (kept for tests that reference them directly).
  buildRobocopyArgs,
  createRobocopyOutputDecoder,
  spawnRobocopy,
  splitExcludes,
  parseRobocopyProgressLine,
  applyRobocopyProgress,
  parseRobocopySummary,
  emptyRobocopyLineTotals,
  emptyRobocopySummary,
  aggregateRobocopySummaries,
  inferRobocopyExitCodeFromOutput,
  interpretRobocopyExitCode,
  getRobocopyFileCounts
};
