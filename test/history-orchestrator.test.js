const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { createHistoryOrchestrator } = require('../src/main/history-orchestrator');

const HISTORY_FOLDER = '.syncarr-history';

// Real pathIsDirectory so listing/retention can probe the temp target.
async function realPathIsDirectory(inputPath) {
  try {
    return (await fs.stat(inputPath)).isDirectory();
  } catch {
    return false;
  }
}

function makeOrchestrator(userDataPath = os.tmpdir()) {
  return createHistoryOrchestrator({
    getUserDataPath: () => userDataPath,
    pathIsDirectory: realPathIsDirectory
  });
}

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'syncarr-history-'));
}

// Write a manifest + its archived payload files into <target>/.syncarr-history.
async function writeRun(targetPath, { runId, jobId, createdAt, files }) {
  const historyRoot = path.join(targetPath, HISTORY_FOLDER);
  const archivedFiles = [];
  for (const file of files) {
    const archivedRelativePath = path.posix.join('versions', runId, file.relativePath);
    const archivedPath = path.join(historyRoot, 'versions', runId, file.relativePath);
    await fs.mkdir(path.dirname(archivedPath), { recursive: true });
    await fs.writeFile(archivedPath, file.content || 'x');
    archivedFiles.push({
      relativePath: file.relativePath,
      archivedRelativePath,
      previous: { size: file.size != null ? file.size : (file.content || 'x').length }
    });
  }
  const manifest = { runId, createdAt, archivedFiles };
  if (jobId) manifest.jobId = jobId;
  const manifestsRoot = path.join(historyRoot, 'manifests');
  await fs.mkdir(manifestsRoot, { recursive: true });
  await fs.writeFile(path.join(manifestsRoot, `${runId}.json`), JSON.stringify(manifest));
}

test('normalizeRetentionPolicy clamps and maps fields', () => {
  const o = makeOrchestrator();
  assert.deepEqual(
    o.normalizeRetentionPolicy({ retentionMaxVersions: 5, retentionMaxAgeDays: 30, retentionKeepLatest: true }),
    { maxVersionsPerFile: 5, maxAgeDays: 30, keepLatest: true }
  );
  // out-of-range values clamp to the documented bounds
  const clamped = o.normalizeRetentionPolicy({ retentionMaxVersions: 0, retentionMaxAgeDays: 0, retentionKeepLatest: false });
  assert.ok(clamped.maxVersionsPerFile >= 1);
  assert.ok(clamped.maxAgeDays >= 1);
  assert.equal(clamped.keepLatest, false);
});

test('emptyRetentionSummary and emptyJobHistoryDeleteSummary start zeroed', () => {
  const o = makeOrchestrator();
  const r = o.emptyRetentionSummary();
  assert.equal(r.candidateFiles, 0);
  assert.equal(r.deletedFiles, 0);
  assert.equal(r.freedBytes, 0);

  const d = o.emptyJobHistoryDeleteSummary();
  assert.equal(d.manifestsRead, 0);
  assert.equal(d.archivedFilesDeleted, 0);
  assert.equal(d.freedBytes, 0);
});

test('aggregateRetentionResults sums child summaries', () => {
  const o = makeOrchestrator();
  const merged = o.aggregateRetentionResults([
    { summary: { candidateFiles: 2, deletedFiles: 1, freedBytes: 100, manifestsRead: 1 } },
    { summary: { candidateFiles: 3, deletedFiles: 3, freedBytes: 250, manifestsRead: 2 } }
  ]);
  assert.equal(merged.summary.candidateFiles, 5);
  assert.equal(merged.summary.deletedFiles, 4);
  assert.equal(merged.summary.freedBytes, 350);
  assert.equal(merged.summary.manifestsRead, 3);
});

test('aggregateJobHistoryDeleteSummaries sums every numeric field', () => {
  const o = makeOrchestrator();
  const total = o.aggregateJobHistoryDeleteSummaries([
    { manifestsRead: 1, archivedFilesDeleted: 2, freedBytes: 10 },
    { manifestsRead: 1, archivedFilesDeleted: 5, freedBytes: 40, emptyFoldersRemoved: 2 }
  ]);
  assert.equal(total.manifestsRead, 2);
  assert.equal(total.archivedFilesDeleted, 7);
  assert.equal(total.freedBytes, 50);
  assert.equal(total.emptyFoldersRemoved, 2);
});

test('makeHistoryEntryKey is stable and distinguishes index + path', () => {
  const o = makeOrchestrator();
  const a = o.makeHistoryEntryKey('/m/run.json', 'versions/run/A.txt', 0);
  const aAgain = o.makeHistoryEntryKey('/m/run.json', 'versions/run/A.txt', 0);
  const b = o.makeHistoryEntryKey('/m/run.json', 'versions/run/A.txt', 1);
  assert.equal(a, aAgain);
  assert.notEqual(a, b);
  // case/separator-insensitive on the archived path portion
  assert.equal(a, o.makeHistoryEntryKey('/m/run.json', 'versions\\run\\a.txt', 0));
});

test('dedupeRetentionCandidates collapses by key', () => {
  const o = makeOrchestrator();
  const out = o.dedupeRetentionCandidates([
    { key: 'k1', size: 1 },
    { key: 'k1', size: 1 },
    { key: 'k2', size: 2 },
    { manifestPath: '/m', archivedRelativePath: 'v/x', size: 3 }
  ]);
  assert.equal(out.length, 3);
});

test('readHistoryManifests parses manifests and honors the job filter', async () => {
  const target = await makeTmpDir();
  await writeRun(target, { runId: 'run-1', jobId: 'job-A', createdAt: '2026-06-01T00:00:00.000Z', files: [{ relativePath: 'a.txt' }] });
  await writeRun(target, { runId: 'run-2', jobId: 'job-B', createdAt: '2026-06-02T00:00:00.000Z', files: [{ relativePath: 'b.txt' }] });
  await writeRun(target, { runId: 'run-3', createdAt: '2026-06-03T00:00:00.000Z', files: [{ relativePath: 'c.txt' }] }); // legacy (no jobId)

  const o = makeOrchestrator();
  const all = await o.readHistoryManifests(target, HISTORY_FOLDER);
  assert.equal(all.length, 3, 'reads every manifest when no job filter');

  const jobAWithLegacy = await o.readHistoryManifests(target, HISTORY_FOLDER, { jobId: 'job-A' });
  const runIds = jobAWithLegacy.map((m) => m.runId).sort();
  assert.deepEqual(runIds, ['run-1', 'run-3'], 'job-A plus legacy manifests by default');

  const jobAStrict = await o.readHistoryManifests(target, HISTORY_FOLDER, { jobId: 'job-A', includeLegacy: false });
  assert.deepEqual(jobAStrict.map((m) => m.runId), ['run-1'], 'legacy excluded when includeLegacy is false');

  const missing = await o.readHistoryManifests(path.join(target, 'nope'), HISTORY_FOLDER);
  assert.deepEqual(missing, [], 'missing history folder yields no manifests');

  await fs.rm(target, { recursive: true, force: true });
});

test('buildRetentionPlan flags older versions beyond the per-file keep count', async () => {
  const target = await makeTmpDir();
  // Three archived versions of the same file across three runs.
  await writeRun(target, { runId: 'run-1', createdAt: '2026-06-01T00:00:00.000Z', files: [{ relativePath: 'docs/file.txt', size: 100 }] });
  await writeRun(target, { runId: 'run-2', createdAt: '2026-06-02T00:00:00.000Z', files: [{ relativePath: 'docs/file.txt', size: 100 }] });
  await writeRun(target, { runId: 'run-3', createdAt: '2026-06-03T00:00:00.000Z', files: [{ relativePath: 'docs/file.txt', size: 100 }] });

  const o = makeOrchestrator();
  // No jobId -> restore-point protection is skipped, so every stale version is removable.
  const plan = await o.buildRetentionPlan({
    targetPath: target,
    historyFolderName: HISTORY_FOLDER,
    retentionMaxVersions: 1,
    retentionMaxAgeDays: 3650,
    retentionKeepLatest: true
  });

  assert.equal(plan.summary.filesWithHistory, 1, 'one logical file has history');
  assert.equal(plan.summary.manifestsRead, 3);
  assert.equal(plan.candidates.length, 2, 'newest kept, two older versions are candidates');
  // The newest run (run-3) must never be a candidate.
  assert.ok(plan.candidates.every((c) => c.runId !== 'run-3'), 'latest version is protected by keepLatest');
  assert.equal(plan.summary.candidateBytes, 200, 'two 100-byte versions');

  await fs.rm(target, { recursive: true, force: true });
});
