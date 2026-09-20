const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');

const {
  createRestorePointManifest,
  previewRestorePointPlan,
  restoreRestorePointToFolder,
  collectProtectedArchivePathsForRestorePoints
} = require('../src/main/restore-points');

async function makeFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'syncarr-restore-point-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const basePath = path.join(root, 'user-data');
  const targetPath = path.join(root, 'target');
  const restoreFolder = path.join(root, 'restore');
  await fs.mkdir(targetPath, { recursive: true });
  await fs.mkdir(restoreFolder, { recursive: true });
  return { root, basePath, targetPath, restoreFolder };
}

async function createPoint(fixture) {
  await fs.writeFile(path.join(fixture.targetPath, 'document.txt'), 'snapshot content', 'utf8');
  return createRestorePointManifest({
    basePath: fixture.basePath,
    jobId: 'job-test',
    jobName: 'Test job',
    runId: 'point-1',
    syncMode: 'oneWay',
    createdAt: '2026-01-01T00:00:00.000Z',
    sourcePaths: [],
    destinations: [{ path: fixture.targetPath, label: 'Backup', required: true }],
    excludePatterns: [],
    historyFolderName: '.syncarr-history',
    historySummary: {},
    robocopySummary: {},
    status: 'success',
    message: 'Complete'
  });
}

async function archiveThenChangeLiveFile(fixture) {
  const historyRoot = path.join(fixture.targetPath, '.syncarr-history');
  const archivedRelativePath = 'versions/run-2/document.txt';
  const archivePath = path.join(historyRoot, ...archivedRelativePath.split('/'));
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.copyFile(path.join(fixture.targetPath, 'document.txt'), archivePath);
  await fs.writeFile(path.join(fixture.targetPath, 'document.txt'), 'newer content', 'utf8');
  const manifestsRoot = path.join(historyRoot, 'manifests');
  await fs.mkdir(manifestsRoot, { recursive: true });
  await fs.writeFile(path.join(manifestsRoot, 'run-2.json'), JSON.stringify({
    schemaVersion: 1,
    runId: 'run-2',
    jobId: 'job-test',
    createdAt: '2026-01-02T00:00:00.000Z',
    archivedFiles: [{ relativePath: 'document.txt', archivedRelativePath }]
  }), 'utf8');
  return archivedRelativePath;
}

test('schema-v2 restore resolves changed live content from file history', async (t) => {
  const fixture = await makeFixture(t);
  const point = await createPoint(fixture);
  assert.equal(point.ok, true);
  await archiveThenChangeLiveFile(fixture);

  const preview = await previewRestorePointPlan({
    basePath: fixture.basePath,
    jobId: 'job-test',
    restorePointId: 'point-1',
    restoreFolder: fixture.restoreFolder
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.plan.ready, true);
  assert.equal(preview.plan.totals.availableFromHistory, 1);
  assert.equal(preview.plan.totals.availableFromLive, 0);

  const restored = await restoreRestorePointToFolder({
    basePath: fixture.basePath,
    jobId: 'job-test',
    restorePointId: 'point-1',
    restoreFolder: fixture.restoreFolder
  });
  assert.equal(restored.ok, true);
  assert.equal(await fs.readFile(path.join(fixture.restoreFolder, 'document.txt'), 'utf8'), 'snapshot content');
});

test('two-way restore points report propagated deletes as deletes', async (t) => {
  const fixture = await makeFixture(t);
  await fs.writeFile(path.join(fixture.targetPath, 'document.txt'), 'content', 'utf8');
  const point = await createRestorePointManifest({
    basePath: fixture.basePath,
    jobId: 'job-two-way',
    jobName: 'Two-way job',
    runId: 'two-way-point',
    syncMode: 'twoWay',
    createdAt: '2026-01-01T00:00:00.000Z',
    sourcePaths: [],
    destinations: [{ path: fixture.targetPath, label: 'Backup', required: true }],
    excludePatterns: [],
    historyFolderName: '.syncarr-history',
    historySummary: { destinationOnly: 2 },
    robocopySummary: { files: { copied: 1, extras: 2 } },
    status: 'success',
    message: 'Complete'
  });

  assert.equal(point.totals.deletedFiles, 2);
  assert.equal(point.totals.destinationOnlyFiles, 0);
});

test('restore refuses to overwrite an existing file', async (t) => {
  const fixture = await makeFixture(t);
  await createPoint(fixture);
  await fs.writeFile(path.join(fixture.restoreFolder, 'document.txt'), 'keep me', 'utf8');

  const preview = await previewRestorePointPlan({
    basePath: fixture.basePath,
    jobId: 'job-test',
    restorePointId: 'point-1',
    restoreFolder: fixture.restoreFolder
  });
  assert.equal(preview.plan.ready, false);
  assert.equal(preview.plan.totals.conflicts, 1);

  const restored = await restoreRestorePointToFolder({
    basePath: fixture.basePath,
    jobId: 'job-test',
    restorePointId: 'point-1',
    restoreFolder: fixture.restoreFolder
  });
  assert.equal(restored.ok, false);
  assert.equal(await fs.readFile(path.join(fixture.restoreFolder, 'document.txt'), 'utf8'), 'keep me');
});

test('full restore keeps multiple destinations in distinct folders', async (t) => {
  const fixture = await makeFixture(t);
  const secondTarget = path.join(fixture.root, 'target-two');
  await fs.mkdir(secondTarget, { recursive: true });
  await fs.writeFile(path.join(fixture.targetPath, 'shared.txt'), 'first', 'utf8');
  await fs.writeFile(path.join(secondTarget, 'shared.txt'), 'second', 'utf8');
  await createRestorePointManifest({
    basePath: fixture.basePath,
    jobId: 'job-test',
    runId: 'multi',
    createdAt: '2026-01-01T00:00:00.000Z',
    destinations: [
      { path: fixture.targetPath, label: 'Backup', required: true },
      { path: secondTarget, label: 'Backup', required: true }
    ],
    historyFolderName: '.syncarr-history'
  });

  const restored = await restoreRestorePointToFolder({
    basePath: fixture.basePath,
    jobId: 'job-test',
    restorePointId: 'multi',
    restoreFolder: fixture.restoreFolder
  });
  assert.equal(restored.ok, true);
  assert.equal(await fs.readFile(path.join(fixture.restoreFolder, '1-Backup', 'shared.txt'), 'utf8'), 'first');
  assert.equal(await fs.readFile(path.join(fixture.restoreFolder, '2-Backup', 'shared.txt'), 'utf8'), 'second');
});

test('retention protection reports history payloads used by restore points', async (t) => {
  const fixture = await makeFixture(t);
  await createPoint(fixture);
  const archivedRelativePath = await archiveThenChangeLiveFile(fixture);

  const protection = await collectProtectedArchivePathsForRestorePoints({
    basePath: fixture.basePath,
    jobId: 'job-test',
    targetPath: fixture.targetPath,
    historyFolderName: '.syncarr-history'
  });
  assert.equal(protection.protectedPaths.has(archivedRelativePath.toLowerCase()), true);
  assert.equal(protection.degradedPoints.length, 0);
});

test('legacy restore points without hashes remain browse-only', async (t) => {
  const fixture = await makeFixture(t);
  await fs.writeFile(path.join(fixture.targetPath, 'legacy.txt'), 'legacy', 'utf8');
  const manifestDir = path.join(fixture.basePath, 'restore-points', 'jobs', 'job-test');
  await fs.mkdir(manifestDir, { recursive: true });
  await fs.writeFile(path.join(manifestDir, 'legacy.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'syncarr-restore-point',
    id: 'legacy',
    jobId: 'job-test',
    createdAt: '2025-01-01T00:00:00.000Z',
    destinations: [{
      path: fixture.targetPath,
      label: 'Backup',
      files: [{ relativePath: 'legacy.txt', size: 6, livePath: path.join(fixture.targetPath, 'legacy.txt') }]
    }]
  }), 'utf8');

  const preview = await previewRestorePointPlan({
    basePath: fixture.basePath,
    jobId: 'job-test',
    restorePointId: 'legacy',
    restoreFolder: fixture.restoreFolder
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.plan.schemaSupported, false);
  assert.equal(preview.plan.ready, false);
  assert.equal(preview.plan.totals.missingContent, 1);
});

test('zero-byte files resolve from live and do not count as missing', async (t) => {
  const fixture = await makeFixture(t);
  // An empty log and an empty placeholder alongside a normal file: exactly the
  // shape that made restore report "missing" files after a clean sync.
  await fs.writeFile(path.join(fixture.targetPath, 'document.txt'), 'snapshot content', 'utf8');
  await fs.writeFile(path.join(fixture.targetPath, 'server.out.log'), '', 'utf8');
  await fs.mkdir(path.join(fixture.targetPath, 'data'), { recursive: true });
  await fs.writeFile(path.join(fixture.targetPath, 'data', '.gitkeep'), '', 'utf8');

  const point = await createRestorePointManifest({
    basePath: fixture.basePath,
    jobId: 'job-test',
    jobName: 'Test job',
    runId: 'empties',
    syncMode: 'oneWay',
    createdAt: '2026-01-01T00:00:00.000Z',
    sourcePaths: [],
    destinations: [{ path: fixture.targetPath, label: 'Backup', required: true }],
    excludePatterns: [],
    historyFolderName: '.syncarr-history',
    historySummary: {},
    robocopySummary: {},
    status: 'success',
    message: 'Complete'
  });
  assert.equal(point.ok, true);

  const preview = await previewRestorePointPlan({
    basePath: fixture.basePath,
    jobId: 'job-test',
    restorePointId: 'empties',
    restoreFolder: fixture.restoreFolder
  });
  assert.equal(preview.ok, true);
  // All three files (1 normal + 2 empty) are present on disk and unchanged, so
  // none should be missing and the scope should be ready to restore.
  assert.equal(preview.plan.totals.filesPlanned, 3);
  assert.equal(preview.plan.totals.missingContent, 0);
  assert.equal(preview.plan.totals.availableFromLive, 3);
  assert.equal(preview.plan.ready, true);

  const restored = await restoreRestorePointToFolder({
    basePath: fixture.basePath,
    jobId: 'job-test',
    restorePointId: 'empties',
    restoreFolder: fixture.restoreFolder
  });
  assert.equal(restored.ok, true);
  assert.equal(await fs.readFile(path.join(fixture.restoreFolder, 'server.out.log'), 'utf8'), '');
  assert.equal(await fs.readFile(path.join(fixture.restoreFolder, 'data', '.gitkeep'), 'utf8'), '');
});

test('empty file whose mtime drifts past tolerance still resolves from live', async (t) => {
  const fixture = await makeFixture(t);
  await fs.writeFile(path.join(fixture.targetPath, 'active.log'), '', 'utf8');
  await createRestorePointManifest({
    basePath: fixture.basePath,
    jobId: 'job-test',
    runId: 'drift',
    createdAt: '2026-01-01T00:00:00.000Z',
    destinations: [{ path: fixture.targetPath, label: 'Backup', required: true }],
    historyFolderName: '.syncarr-history'
  });

  // Simulate an active empty log being touched long after the snapshot: mtime
  // moves well past RESTORE_POINT_MTIME_TOLERANCE_MS but the file stays empty.
  const drifted = new Date('2026-02-01T00:00:00.000Z');
  await fs.utimes(path.join(fixture.targetPath, 'active.log'), drifted, drifted);

  const preview = await previewRestorePointPlan({
    basePath: fixture.basePath,
    jobId: 'job-test',
    restorePointId: 'drift',
    restoreFolder: fixture.restoreFolder
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.plan.totals.missingContent, 0);
  assert.equal(preview.plan.totals.availableFromLive, 1);
  assert.equal(preview.plan.ready, true);
});
