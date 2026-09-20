const test = require('node:test');
const assert = require('node:assert/strict');

// run-log-format-utils.js destructures window.SyncarrRendererUtils at load, so
// renderer-utils.js must be required first (after shimming window).
global.window = global.window || {};
require('../src/renderer/renderer-utils.js');
require('../src/renderer/run-log-format-utils.js');
const { configure, formatStorageLog, formatRetentionLog, formatRestorePointLog, buildRunLog } = global.window.SyncarrRunLogFormat;

// Inject normalizers matching the canonical app behavior.
configure({
  normalizeSourcePaths: (input) => (Array.isArray(input) ? input : (input ? [input] : [])).filter(Boolean),
  normalizeTargetDestinations: (input, fallback = '') => (Array.isArray(input) && input.length ? input : (fallback ? [{ path: fallback, required: true }] : [])),
  normalizeSyncMode: (value) => String(value || 'oneWay')
});

test('formatStorageLog reflects checked/enoughSpace state', () => {
  assert.equal(formatStorageLog(null), '');
  assert.equal(formatStorageLog({ checked: true, enoughSpace: true, message: 'plenty' }), 'Storage check (ok): plenty\n');
  assert.equal(formatStorageLog({ checked: true, enoughSpace: false, message: 'low!' }), 'Storage check (low): low!\n');
  assert.equal(formatStorageLog({ checked: false, message: 'skip' }), 'Storage check (unknown): skip\n');
});

test('formatRetentionLog summarizes candidate/deleted/freed', () => {
  assert.equal(formatRetentionLog(null), '');
  const line = formatRetentionLog({ message: 'Trimmed.', summary: { candidateFiles: 5, deletedFiles: 2, freedBytes: 2048 } });
  assert.equal(line, 'Retention: Trimmed. Candidates 5, deleted 2, freed 2.0 KB.\n');
});

test('formatRestorePointLog handles success and failure', () => {
  assert.equal(formatRestorePointLog(null), '');
  assert.match(formatRestorePointLog({ ok: false, message: 'nope' }), /^Restore point failed: nope/);
  const ok = formatRestorePointLog({ totals: { filesTotal: 10, bytesTotal: 1024 }, manifestPath: 'N:\\m.json' });
  assert.equal(ok, 'Restore point created: 10 file(s), 1.0 KB indexed at N:\\m.json.\n');
});

test('buildRunLog returns a placeholder when no run is given', () => {
  assert.equal(buildRunLog(null), 'No run selected.');
});

test('buildRunLog renders sources, destinations, metrics, and output', () => {
  const log = buildRunLog({
    at: '2026-06-25T12:00:00Z',
    dryRun: false,
    syncMode: 'mirror',
    jobName: 'Nightly',
    status: 'success',
    code: 0,
    sourcePaths: ['C:\\a', 'C:\\b'],
    targetDestinations: [{ path: 'N:\\backup', required: true }],
    summary: { files: { copied: 3, skipped: 1, failed: 0, extras: 2 }, bytes: { copied: 1024 } },
    history: { archived: 4 },
    output: 'robocopy output here'
  });
  assert.match(log, /--- MIRROR SYNC .* ---/);
  assert.match(log, /Job: Nightly/);
  assert.match(log, /Sources:\n {2}1\. C:\\a\n {2}2\. C:\\b/);
  assert.match(log, /Destinations:\n {2}1\. Required \| N:\\backup/);
  assert.match(log, /Files copied: 3/);
  assert.match(log, /Files deleted: 2/, 'mirror mode labels extras as deleted');
  assert.match(log, /Bytes copied: 1\.0 KB/);
  assert.match(log, /robocopy output here$/);
});

test('buildRunLog labels non-mirror extras as destination-only left untouched', () => {
  const log = buildRunLog({ syncMode: 'oneWay', summary: { files: { extras: 7 } } });
  assert.match(log, /Destination-only left untouched: 7/);
});
