const test = require('node:test');
const assert = require('node:assert/strict');
const realFs = require('fs/promises');
const os = require('os');
const path = require('path');

const { createHistoryPlan } = require('../src/main/history-plan');

// --- Q2: mirror-delete archival + plan decisions, driven with injected fakes ---
//
// analyzeFileHistoryPlan is the single-source/-target plan builder. It uses the
// injected collectSourceFiles to list BOTH the source tree and (in mirror mode,
// via addMirrorDeleteCandidatesToHistoryPlan) the target tree, and the injected
// fs.stat to probe whether each source file already exists on the target. The
// real shouldSourceReplaceTarget / fileMetadata (required inside the module) run
// unmocked, so the fake stats below carry the exact shape they consume.

const SRC = 'C:/src';
const TGT = 'D:/dst';
const TOLERANCE = 2100; // FILE_MTIME_TOLERANCE_MS

function makeStat({ size, mtimeMs, isFile = true }) {
  return {
    size,
    mtimeMs,
    mtime: new Date(mtimeMs),
    birthtime: new Date(mtimeMs),
    birthtimeMs: mtimeMs,
    isFile: () => isFile
  };
}

// collectSourceFiles fake that returns a source listing for SRC and a target
// listing for TGT (the two roots analyzeFileHistoryPlan + the mirror step ask for).
function makeCollect({ source = [], target = [], throwForTarget = false }) {
  return async ({ sourcePath }) => {
    if (sourcePath === SRC) return source;
    if (sourcePath === TGT) {
      if (throwForTarget) throw new Error('EIO: target listing failed');
      return target;
    }
    return [];
  };
}

// fs.stat fake keyed by the target-relative path (analyzeFileHistoryPlan stats
// path.join(TGT, relativePath) for each source file).
function makeFs(targetStatsByRel = {}) {
  return {
    stat: async (p) => {
      for (const [rel, st] of Object.entries(targetStatsByRel)) {
        if (p === path.join(TGT, rel)) return st;
      }
      const err = new Error(`ENOENT: ${p}`);
      err.code = 'ENOENT';
      throw err;
    }
  };
}

function makePlanner(deps) {
  return createHistoryPlan({
    throwIfRunCancelled: () => {},
    collectSourceFiles: makeCollect({ source: [], target: [] }),
    fs: makeFs({}),
    ...deps
  });
}

const BASE_ARGS = {
  sourcePath: SRC,
  targetPath: TGT,
  displayPrefix: '',
  sourceLabel: '',
  excludePatterns: [],
  skipOlderSource: true,
  copySubfolders: true,
  historyEnabled: true,
  historyFolderName: '.syncarr-history'
};

test('createHistoryPlan exposes the full subsystem surface', () => {
  const planner = makePlanner();
  for (const fn of [
    'analyzeMultiDestinationHistoryPlan', 'analyzeMultiSourceHistoryPlan', 'mergeHistoryPlans',
    'analyzeFileHistoryPlan', 'addMirrorDeleteCandidatesToHistoryPlan', 'addPreviewFile',
    'createHistorySnapshot', 'finalizeHistoryManifest'
  ]) {
    assert.equal(typeof planner[fn], 'function', `${fn} is exposed`);
  }
});

test('Q2: mirror mode archives destination-only files as mirror-delete candidates', async () => {
  const source = [{ relativePath: 'a.txt', fullPath: `${SRC}/a.txt`, stats: makeStat({ size: 10, mtimeMs: 1000 }) }];
  const target = [
    { relativePath: 'a.txt', fullPath: `${TGT}/a.txt`, stats: makeStat({ size: 10, mtimeMs: 1000 }) },
    { relativePath: 'old.txt', fullPath: `${TGT}/old.txt`, stats: makeStat({ size: 20, mtimeMs: 500 }) }
  ];
  const planner = makePlanner({
    collectSourceFiles: makeCollect({ source, target }),
    // a.txt exists on target, unchanged (same size+mtime) -> not archived.
    fs: makeFs({ 'a.txt': makeStat({ size: 10, mtimeMs: 1000 }) })
  });

  const plan = await planner.analyzeFileHistoryPlan({ ...BASE_ARGS, syncMode: 'mirror' });

  assert.equal(plan.summary.destinationOnly, 1, 'the target-only file is counted');
  assert.equal(plan.summary.wouldArchive, 1, 'it would be archived (history on)');
  assert.equal(plan.summary.archiveBytes, 20, 'its bytes are reserved for archival');

  const candidate = plan.archiveFiles.find((f) => f.relativePath === 'old.txt');
  assert.ok(candidate, 'old.txt is queued for archival before the mirror purge');
  assert.equal(candidate.reason, 'mirror-delete-candidate');
  assert.equal(candidate.sourcePath, null, 'a mirror-delete candidate has no source');
  assert.equal(candidate.previous.size, 20, 'the destination version metadata is captured');

  const preview = plan.previewFiles.find((f) => f.relativePath === 'old.txt');
  assert.ok(preview && preview.action === 'extra' && preview.reason === 'mirror-destination-only');

  // The unchanged, still-present source file is NOT a delete candidate.
  assert.ok(!plan.archiveFiles.some((f) => f.relativePath === 'a.txt'));
});

test('Q2: with history disabled, mirror-delete candidates are still recorded but reserve no bytes', async () => {
  const source = [];
  const target = [{ relativePath: 'gone.txt', fullPath: `${TGT}/gone.txt`, stats: makeStat({ size: 99, mtimeMs: 100 }) }];
  const planner = makePlanner({ collectSourceFiles: makeCollect({ source, target }) });

  const plan = await planner.analyzeFileHistoryPlan({ ...BASE_ARGS, historyEnabled: false, syncMode: 'mirror' });

  assert.equal(plan.summary.destinationOnly, 1, 'still counted as destination-only');
  assert.equal(plan.summary.wouldArchive, 0, 'but not counted toward would-archive');
  assert.equal(plan.summary.archiveBytes, 0, 'and reserves no archive bytes');
  assert.equal(plan.archiveFiles.length, 1, 'the candidate is still queued (archival gated downstream)');
  assert.equal(plan.archiveFiles[0].relativePath, 'gone.txt');
});

test('Q2: non-mirror mode never produces mirror-delete candidates', async () => {
  const source = [];
  const target = [{ relativePath: 'orphan.txt', fullPath: `${TGT}/orphan.txt`, stats: makeStat({ size: 5, mtimeMs: 1 }) }];
  const planner = makePlanner({ collectSourceFiles: makeCollect({ source, target }) });

  const plan = await planner.analyzeFileHistoryPlan({ ...BASE_ARGS, syncMode: 'oneWay' });

  assert.equal(plan.summary.destinationOnly, 0, 'one-way sync leaves destination-only files alone');
  assert.equal(plan.archiveFiles.length, 0);
});

test('Q2: a failure listing the target tree is swallowed (no candidates, no throw)', async () => {
  const source = [];
  const planner = makePlanner({ collectSourceFiles: makeCollect({ source, target: [], throwForTarget: true }) });

  const plan = await planner.analyzeFileHistoryPlan({ ...BASE_ARGS, syncMode: 'mirror' });

  assert.equal(plan.summary.destinationOnly, 0, 'a target-scan error yields no delete candidates');
  assert.equal(plan.archiveFiles.length, 0);
});

test('Q2: a changed source file is queued for update-with-history, capturing the prior version', async () => {
  const source = [{ relativePath: 'doc.txt', fullPath: `${SRC}/doc.txt`, stats: makeStat({ size: 50, mtimeMs: 100000 }) }];
  const planner = makePlanner({
    collectSourceFiles: makeCollect({ source, target: [] }),
    fs: makeFs({ 'doc.txt': makeStat({ size: 30, mtimeMs: 90000 }) }) // different size -> changed
  });

  const plan = await planner.analyzeFileHistoryPlan({ ...BASE_ARGS, syncMode: 'oneWay' });

  assert.equal(plan.summary.wouldCopy, 1);
  assert.equal(plan.summary.wouldArchive, 1);
  assert.equal(plan.summary.copyBytes, 50, 'new source bytes to copy');
  assert.equal(plan.summary.archiveBytes, 30, 'prior target bytes to archive');
  const archived = plan.archiveFiles.find((f) => f.relativePath === 'doc.txt');
  assert.ok(archived);
  assert.equal(archived.reason, 'changed-size');
  assert.equal(archived.previous.size, 30);
  assert.equal(archived.source.size, 50);
});

test('Q2: a source file missing on the target is a new-file copy, not an archive', async () => {
  const source = [{ relativePath: 'fresh.txt', fullPath: `${SRC}/fresh.txt`, stats: makeStat({ size: 7, mtimeMs: 5 }) }];
  const planner = makePlanner({ collectSourceFiles: makeCollect({ source, target: [] }), fs: makeFs({}) });

  const plan = await planner.analyzeFileHistoryPlan({ ...BASE_ARGS, syncMode: 'oneWay' });

  assert.equal(plan.summary.wouldCopy, 1);
  assert.equal(plan.summary.newFiles, 1);
  assert.equal(plan.summary.archiveBytes, 0);
  assert.equal(plan.archiveFiles.length, 0, 'nothing to archive for a brand-new file');
  assert.equal(plan.newFiles.length, 1);
  assert.equal(plan.newFiles[0].relativePath, 'fresh.txt');
});

// --- Q3: createHistorySnapshot manifest producer, against a real temp dir ---
//
// This is the producer the entire restore feature reads back. The existing
// restore/history tests all consume hand-written manifests; nothing exercised
// the writer until now. Uses real fs so the archived payload, timestamps, and
// manifest JSON are all observed on disk.

async function makeTmp() {
  return realFs.mkdtemp(path.join(os.tmpdir(), 'syncarr-history-plan-'));
}

function realPlanner() {
  return createHistoryPlan({
    fs: realFs,
    collectSourceFiles: async () => [],
    throwIfRunCancelled: () => {}
  });
}

const FIXED_DATE = new Date('2026-06-30T12:00:00.000Z');

test('Q3: createHistorySnapshot archives files, writes the manifest, returns its path', async () => {
  const tmp = await makeTmp();
  try {
    // A real target file that will be overwritten by the sync and must be archived first.
    const targetFile = path.join(tmp, 'reports', 'q2.txt');
    await realFs.mkdir(path.dirname(targetFile), { recursive: true });
    await realFs.writeFile(targetFile, 'original destination content');

    const planner = realPlanner();
    const plan = {
      enabled: true,
      archiveFiles: [{
        relativePath: 'reports/q2.txt',
        sourcePath: 'C:/src/reports/q2.txt',
        sourceRoot: 'C:/src',
        sourceLabel: 'Primary',
        targetPath: targetFile,
        reason: 'changed-size',
        source: { size: 40 },
        previous: { size: 28 }
      }],
      newFiles: [{ relativePath: 'reports/new.txt', source: { size: 5 } }],
      summary: { archived: 0, wouldArchive: 1, wouldCopy: 2 }
    };

    const archivedItems = [];
    const result = await planner.createHistorySnapshot({
      plan,
      runId: '20260630-120000',
      createdAt: FIXED_DATE,
      sourcePath: 'C:/src',
      sourcePaths: ['C:/src'],
      sourceRoots: [{ sourcePath: 'C:/src', label: 'Primary', destinationPath: tmp, relativePrefix: '' }],
      targetPath: tmp,
      historyFolderName: '.syncarr-history',
      jobId: 'job-1',
      jobName: 'Nightly',
      targetDestination: { path: tmp, label: 'NAS', required: true },
      targetDestinations: [{ path: tmp, label: 'NAS', required: true }],
      onArchived: (item, meta) => archivedItems.push({ rel: item.relativePath, index: meta.index })
    });

    // The archived payload physically exists under versions/<runId>/.
    const archivedPath = path.join(tmp, '.syncarr-history', 'versions', '20260630-120000', 'reports', 'q2.txt');
    assert.equal(await realFs.readFile(archivedPath, 'utf8'), 'original destination content');

    // The return value points at the written manifest.
    assert.equal(result.summary.archived, 1);
    assert.ok(result.manifestPath && result.manifestPath.endsWith('20260630-120000.json'));
    assert.equal(result.summary.manifestPath, result.manifestPath);

    // The onArchived hook fired once, in order.
    assert.deepEqual(archivedItems, [{ rel: 'reports/q2.txt', index: 0 }]);

    // The manifest on disk carries the restore-critical fields.
    const manifest = JSON.parse(await realFs.readFile(result.manifestPath, 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.status, 'prepared');
    assert.equal(manifest.completedAt, null);
    assert.equal(manifest.runId, '20260630-120000');
    assert.equal(manifest.jobId, 'job-1');
    assert.equal(manifest.createdAt, FIXED_DATE.toISOString());
    assert.equal(manifest.summary.archived, 1);
    assert.equal(manifest.archivedFiles.length, 1);
    const entry = manifest.archivedFiles[0];
    assert.equal(entry.relativePath, 'reports/q2.txt');
    assert.equal(entry.archivedRelativePath, 'versions/20260630-120000/reports/q2.txt');
    assert.equal(entry.reason, 'changed-size');
    assert.equal(entry.originalSourcePath, 'C:/src/reports/q2.txt');
    assert.equal(entry.previous.size, 28);
    assert.equal(manifest.newFiles.length, 1);
  } finally {
    await realFs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

test('Q3: archiving a non-file target rejects', async () => {
  const tmp = await makeTmp();
  try {
    // The "target" is a directory, not a file.
    const targetDir = path.join(tmp, 'a-directory');
    await realFs.mkdir(targetDir, { recursive: true });

    const planner = realPlanner();
    const plan = {
      enabled: true,
      archiveFiles: [{ relativePath: 'a-directory', targetPath: targetDir, reason: 'changed-size', previous: null }],
      newFiles: [],
      summary: { archived: 0 }
    };

    await assert.rejects(
      () => planner.createHistorySnapshot({
        plan, runId: 'r1', createdAt: FIXED_DATE, sourcePath: 'C:/src', sourcePaths: ['C:/src'],
        sourceRoots: [], targetPath: tmp, historyFolderName: '.syncarr-history', jobId: 'j', jobName: 'n'
      }),
      /Cannot archive non-file target/
    );
  } finally {
    await realFs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

test('Q3: an empty plan writes no manifest and creates no history folder', async () => {
  const tmp = await makeTmp();
  try {
    const planner = realPlanner();
    const result = await planner.createHistorySnapshot({
      plan: { enabled: true, archiveFiles: [], newFiles: [], summary: { archived: 0 } },
      runId: 'empty', createdAt: FIXED_DATE, sourcePath: 'C:/src', sourcePaths: ['C:/src'],
      sourceRoots: [], targetPath: tmp, historyFolderName: '.syncarr-history', jobId: 'j', jobName: 'n'
    });

    assert.equal(result.manifestPath, null, 'no manifest for a no-op plan');
    assert.equal(result.summary.archived, 0);
    await assert.rejects(() => realFs.stat(path.join(tmp, '.syncarr-history')), 'no history folder is created');
  } finally {
    await realFs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

test('Q3: finalizeHistoryManifest flips a prepared manifest to complete with the engine result', async () => {
  const tmp = await makeTmp();
  try {
    const targetFile = path.join(tmp, 'x.bin');
    await realFs.writeFile(targetFile, 'payload');

    const planner = realPlanner();
    const snapshot = await planner.createHistorySnapshot({
      plan: {
        enabled: true,
        archiveFiles: [{ relativePath: 'x.bin', targetPath: targetFile, reason: 'changed-size', previous: { size: 7 } }],
        newFiles: [], summary: { archived: 0 }
      },
      runId: 'final-1', createdAt: FIXED_DATE, sourcePath: 'C:/src', sourcePaths: ['C:/src'],
      sourceRoots: [], targetPath: tmp, historyFolderName: '.syncarr-history', jobId: 'j', jobName: 'n'
    });

    await planner.finalizeHistoryManifest(snapshot.manifestPath, {
      robocopyOk: true,
      completedAt: '2026-06-30T12:05:00.000Z',
      robocopyCode: 1,
      robocopyStatus: 'success',
      robocopySummary: { files: { copied: 3 } }
    });

    const manifest = JSON.parse(await realFs.readFile(snapshot.manifestPath, 'utf8'));
    assert.equal(manifest.status, 'complete');
    assert.equal(manifest.completedAt, '2026-06-30T12:05:00.000Z');
    assert.equal(manifest.robocopy.ok, true);
    assert.equal(manifest.robocopy.code, 1);
    assert.equal(manifest.robocopy.summary.files.copied, 3);
  } finally {
    await realFs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

test('Q3: finalizeHistoryManifest marks an unsuccessful engine run incomplete', async () => {
  const tmp = await makeTmp();
  try {
    const targetFile = path.join(tmp, 'y.bin');
    await realFs.writeFile(targetFile, 'payload');

    const planner = realPlanner();
    const snapshot = await planner.createHistorySnapshot({
      plan: {
        enabled: true,
        archiveFiles: [{ relativePath: 'y.bin', targetPath: targetFile, reason: 'changed-size', previous: { size: 7 } }],
        newFiles: [], summary: { archived: 0 }
      },
      runId: 'final-2', createdAt: FIXED_DATE, sourcePath: 'C:/src', sourcePaths: ['C:/src'],
      sourceRoots: [], targetPath: tmp, historyFolderName: '.syncarr-history', jobId: 'j', jobName: 'n'
    });

    await planner.finalizeHistoryManifest(snapshot.manifestPath, {
      robocopyOk: false,
      completedAt: '2026-06-30T12:06:00.000Z',
      robocopyCode: 16,
      robocopyStatus: 'failed',
      robocopySummary: null
    });

    const manifest = JSON.parse(await realFs.readFile(snapshot.manifestPath, 'utf8'));
    assert.equal(manifest.status, 'incomplete');
    assert.equal(manifest.robocopy.ok, false);
    assert.equal(manifest.robocopy.code, 16);
  } finally {
    await realFs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// --- Fan-out orchestration: analyzeMultiDestinationHistoryPlan (a re-exposed
// main.js entry point) -> analyzeMultiSourceHistoryPlan -> mergeHistoryPlans ->
// mergeDestinationPlans. The single-function tests above never drive the merge
// path; these pin the summary accumulation the whole preview/storage flow reads. ---

test('fan-out: one source across two destinations aggregates per-destination plans', async () => {
  const dstA = 'D:/dstA';
  const dstB = 'D:/dstB';
  const srcFile = { relativePath: 'a.txt', fullPath: `${SRC}/a.txt`, stats: makeStat({ size: 10, mtimeMs: 1000 }) };
  const collectSourceFiles = async ({ sourcePath }) => (sourcePath === SRC ? [srcFile] : []);
  const fsFake = {
    stat: async (p) => {
      if (p === path.join(dstA, 'a.txt')) return makeStat({ size: 10, mtimeMs: 1000 }); // unchanged on A
      const err = new Error(`ENOENT: ${p}`); err.code = 'ENOENT'; throw err; // missing on B -> new
    }
  };
  const planner = createHistoryPlan({ fs: fsFake, collectSourceFiles, throwIfRunCancelled: () => {} });

  const result = await planner.analyzeMultiDestinationHistoryPlan({
    sourcePaths: [SRC],
    destinations: [{ path: dstA, label: 'A', required: true }, { path: dstB, label: 'B', required: false }],
    skippedDestinations: [],
    excludePatterns: [], skipOlderSource: true, copySubfolders: true,
    historyEnabled: true, historyFolderName: '.syncarr-history', syncMode: 'oneWay'
  });

  assert.equal(result.destinationPlans.length, 2, 'one plan per destination');
  assert.equal(result.summary.destinationCount, 2);
  assert.equal(result.summary.sourceCount, 1);
  assert.equal(result.summary.scanned, 2, 'the one source file is scanned against each destination');
  assert.equal(result.summary.wouldCopy, 1, 'only the destination missing the file copies');
  assert.equal(result.summary.newFiles, 1);
  assert.equal(result.summary.unchanged, 1, 'the destination that already has the identical file is unchanged');
  assert.equal(result.summary.copyBytes, 10);
  assert.equal(result.summary.estimatedWriteBytes, 10, 'estimatedWriteBytes = copyBytes + archiveBytes(0)');
  assert.equal(result.previewFiles.length, 2, 'both destinations contribute a preview row');
});

test('fan-out: multiple sources each map into their own destination subfolder', async () => {
  const A = 'C:/alpha';
  const B = 'C:/beta';
  const collectSourceFiles = async ({ sourcePath }) => {
    if (sourcePath === A) return [{ relativePath: 'x.txt', fullPath: `${A}/x.txt`, stats: makeStat({ size: 3, mtimeMs: 1 }) }];
    if (sourcePath === B) return [{ relativePath: 'y.txt', fullPath: `${B}/y.txt`, stats: makeStat({ size: 4, mtimeMs: 1 }) }];
    return [];
  };
  const fsFake = { stat: async (p) => { const err = new Error(`ENOENT: ${p}`); err.code = 'ENOENT'; throw err; } }; // all new
  const planner = createHistoryPlan({ fs: fsFake, collectSourceFiles, throwIfRunCancelled: () => {} });

  const result = await planner.analyzeMultiDestinationHistoryPlan({
    sourcePaths: [A, B],
    destinations: [{ path: TGT, label: 'NAS', required: true }],
    skippedDestinations: [],
    excludePatterns: [], skipOlderSource: true, copySubfolders: true,
    historyEnabled: true, historyFolderName: '.syncarr-history', syncMode: 'oneWay'
  });

  assert.equal(result.summary.sourceCount, 2, 'both sources are folded into the merged plan');
  assert.equal(result.summary.scanned, 2);
  assert.equal(result.summary.wouldCopy, 2);
  assert.equal(result.summary.newFiles, 2);
  // The per-destination merged plan (consumed by the free-space check) totals both
  // sources' bytes: 3 + 4 copy, 0 archive -> estimatedWriteBytes 7.
  assert.equal(result.destinationPlans[0].plan.summary.estimatedWriteBytes, 7);
  // With >1 source, each file lands under its source's deduped-basename subfolder.
  const rels = result.previewFiles.map((f) => f.relativePath).sort();
  assert.deepEqual(rels, ['alpha/x.txt', 'beta/y.txt']);
});

test('branch: skipOlderSource skips a source older than the target', async () => {
  const source = [{ relativePath: 'stale.txt', fullPath: `${SRC}/stale.txt`, stats: makeStat({ size: 10, mtimeMs: 1000 }) }];
  const planner = makePlanner({
    collectSourceFiles: makeCollect({ source, target: [] }),
    fs: makeFs({ 'stale.txt': makeStat({ size: 10, mtimeMs: 1000 + 10000 }) }) // target newer by 10s
  });

  const plan = await planner.analyzeFileHistoryPlan({ ...BASE_ARGS, skipOlderSource: true, syncMode: 'oneWay' });

  assert.equal(plan.summary.skippedOlder, 1);
  assert.equal(plan.summary.wouldCopy, 0, 'an older source is not copied when skipOlderSource is on');
  assert.equal(plan.archiveFiles.length, 0);
  const preview = plan.previewFiles.find((f) => f.relativePath === 'stale.txt');
  assert.ok(preview && preview.action === 'skip-older-source');
});

test('branch: a source whose target path is a non-file is a conflict, not a copy', async () => {
  const source = [{ relativePath: 'weird', fullPath: `${SRC}/weird`, stats: makeStat({ size: 10, mtimeMs: 1000 }) }];
  const planner = makePlanner({
    collectSourceFiles: makeCollect({ source, target: [] }),
    fs: makeFs({ weird: makeStat({ size: 0, mtimeMs: 1000, isFile: false }) }) // target exists but is a directory
  });

  const plan = await planner.analyzeFileHistoryPlan({ ...BASE_ARGS, syncMode: 'oneWay' });

  assert.equal(plan.summary.conflicts, 1);
  assert.equal(plan.summary.wouldCopy, 0);
  const preview = plan.previewFiles.find((f) => f.relativePath === 'weird');
  assert.ok(preview && preview.action === 'conflict' && preview.reason === 'target-not-file');
});

test('addPreviewFile caps the preview list at PREVIEW_FILE_LIMIT and flags truncation', async () => {
  const N = 1001; // PREVIEW_FILE_LIMIT is 1000
  const source = Array.from({ length: N }, (_, i) => ({
    relativePath: `f${i}.txt`, fullPath: `${SRC}/f${i}.txt`, stats: makeStat({ size: 1, mtimeMs: 1 })
  }));
  const planner = makePlanner({ collectSourceFiles: makeCollect({ source, target: [] }), fs: makeFs({}) });

  const plan = await planner.analyzeFileHistoryPlan({ ...BASE_ARGS, syncMode: 'oneWay' });

  assert.equal(plan.summary.newFiles, N, 'every file is still counted');
  assert.equal(plan.summary.previewFiles, N, 'the preview counter counts all files');
  assert.equal(plan.previewFiles.length, 1000, 'but the preview list itself is capped');
  assert.equal(plan.summary.previewTruncated, true);
});

test('Q3: createHistorySnapshot preserves the archived file mtime', async () => {
  const tmp = await makeTmp();
  try {
    const targetFile = path.join(tmp, 'ts.txt');
    await realFs.writeFile(targetFile, 'content');
    const past = new Date('2020-01-02T03:04:05.000Z');
    await realFs.utimes(targetFile, past, past);

    const planner = realPlanner();
    await planner.createHistorySnapshot({
      plan: {
        enabled: true,
        archiveFiles: [{ relativePath: 'ts.txt', targetPath: targetFile, reason: 'changed-size', previous: { size: 7 } }],
        newFiles: [], summary: { archived: 0 }
      },
      runId: 'ts-1', createdAt: FIXED_DATE, sourcePath: 'C:/src', sourcePaths: ['C:/src'],
      sourceRoots: [], targetPath: tmp, historyFolderName: '.syncarr-history', jobId: 'j', jobName: 'n'
    });

    const archivedPath = path.join(tmp, '.syncarr-history', 'versions', 'ts-1', 'ts.txt');
    const st = await realFs.stat(archivedPath);
    assert.ok(Math.abs(st.mtime.getTime() - past.getTime()) < 2000, 'the archived copy keeps the original mtime');
  } finally {
    await realFs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
