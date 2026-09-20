const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const { createRestorePointManifest } = require('../src/main/restore-points');

async function makeTmpRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'syncarr-restore-point-scan-'));
}

async function makeDestination(root, layout) {
  const dest = path.join(root, 'dest');
  await fs.mkdir(dest, { recursive: true });
  const written = [];
  for (const [relPath, content] of Object.entries(layout)) {
    const full = path.join(dest, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
    written.push({ relPath, full, size: Buffer.byteLength(content) });
  }
  return { dest, written };
}

async function readManifest(manifestPath) {
  return JSON.parse(await fs.readFile(manifestPath, 'utf8'));
}

test('createRestorePointManifest scans every destination file with metadata-only identity', async () => {
  const root = await makeTmpRoot();
  try {
    // 8 subdirs × 25 files = 200 files, plus a few top-level files.
    const layout = {};
    for (let dir = 0; dir < 8; dir += 1) {
      for (let i = 0; i < 25; i += 1) {
        layout[`sub-${dir}/file-${String(i).padStart(2, '0')}.txt`] = `dir-${dir}-${i}-${'x'.repeat(20)}`;
      }
    }
    layout['readme.md'] = 'top-level readme';
    layout['notes.txt'] = 'top-level notes';

    const { dest, written } = await makeDestination(root, layout);

    const result = await createRestorePointManifest({
      basePath: root,
      jobId: 'job-perf',
      jobName: 'Perf job',
      runId: 'run-001',
      syncMode: 'oneWay',
      createdAt: new Date('2026-06-18T12:00:00.000Z'),
      sourcePaths: [],
      destinations: [{ path: dest, label: 'Dest', required: true }],
      excludePatterns: ['node_modules', '.git'],
      historyFolderName: '.syncarr-history',
      historySummary: null,
      robocopySummary: null,
      status: 'success',
      message: ''
    });

    assert.equal(result.ok, true);
    const manifest = await readManifest(result.manifestPath);
    assert.equal(manifest.destinations.length, 1);
    const files = manifest.destinations[0].files;
    assert.equal(files.length, written.length);

    // Every written file must be present exactly once, with a forward-slash
    // relative path that matches what the disk layout produced.
    const byPath = new Map(files.map((f) => [f.relativePath.replace(/\\/g, '/'), f]));
    for (const { relPath, size } of written) {
      const forward = relPath.replace(/\\/g, '/');
      const entry = byPath.get(forward);
      assert.ok(entry, `missing file in manifest: ${forward}`);
      assert.equal(entry.size, size);
      assert.ok(entry.modifiedAt, `missing modifiedAt for ${forward}`);
      assert.equal(entry.hashAlgorithm, 'metadata');
      assert.equal(entry.identityMode, 'metadata');
      assert.equal(entry.contentHash, '');
      assert.equal(entry.statusAtRestorePoint, 'present');
    }

    // Totals must reflect the on-disk sizes.
    const totalBytes = written.reduce((sum, w) => sum + w.size, 0);
    assert.equal(manifest.totals.filesTotal, written.length);
    assert.equal(manifest.totals.bytesTotal, totalBytes);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('createRestorePointManifest excludes the history folder and matched exclude patterns', async () => {
  const root = await makeTmpRoot();
  try {
    const layout = {
      'keep.txt': 'kept',
      'node_modules/lib.js': 'should be skipped',
      '.syncarr-history/2025-01-01T00-00-00/run-1/old.bin': 'archived',
      'sub/node_modules/dep.js': 'nested skip',
      'sub/keep.txt': 'also kept'
    };
    const { dest } = await makeDestination(root, layout);

    const result = await createRestorePointManifest({
      basePath: root,
      jobId: 'job-excludes',
      jobName: 'Excludes job',
      runId: 'run-002',
      syncMode: 'oneWay',
      createdAt: new Date(),
      sourcePaths: [],
      destinations: [{ path: dest, label: 'Dest', required: true }],
      excludePatterns: ['node_modules', '.git'],
      historyFolderName: '.syncarr-history',
      historySummary: null,
      robocopySummary: null,
      status: 'success',
      message: ''
    });

    assert.equal(result.ok, true);
    const manifest = await readManifest(result.manifestPath);
    const relativePaths = manifest.destinations[0].files.map((f) => f.relativePath.replace(/\\/g, '/')).sort();

    // Both node_modules entries and the entire .syncarr-history subtree must be
    // absent. keep.txt at the root and inside sub/ must remain.
    assert.deepEqual(relativePaths, ['keep.txt', 'sub/keep.txt']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('createRestorePointManifest reports progress at least once for a non-empty destination', async () => {
  const root = await makeTmpRoot();
  try {
    const layout = {};
    for (let i = 0; i < 40; i += 1) {
      layout[`file-${i}.bin`] = Buffer.alloc(64, i);
    }
    const { dest } = await makeDestination(root, layout);

    const progressTicks = [];
    const result = await createRestorePointManifest({
      basePath: root,
      jobId: 'job-progress',
      jobName: 'Progress job',
      runId: 'run-003',
      syncMode: 'oneWay',
      createdAt: new Date(),
      sourcePaths: [],
      destinations: [{ path: dest, label: 'Dest', required: true }],
      excludePatterns: [],
      historyFolderName: '.syncarr-history',
      historySummary: null,
      robocopySummary: null,
      status: 'success',
      message: '',
      onProgress: (progress) => {
        if (progress) progressTicks.push(progress);
      }
    });

    assert.equal(result.ok, true);
    assert.ok(progressTicks.length > 0, 'expected at least one progress tick');
    const finalTick = progressTicks[progressTicks.length - 1];
    assert.equal(finalTick.done, true);
    assert.equal(finalTick.scannedFiles, 40);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
