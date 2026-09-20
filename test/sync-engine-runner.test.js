const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { EventEmitter } = require('events');

const { createSyncEngineRunner } = require('../src/main/sync-engine-runner');

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

// A minimal SyncEngine interface good enough for runSingleEngineInvocation.
function makeFakeEngine(child) {
  const engine = { label: 'FakeEngine', command: 'fake' };
  const iface = {
    spawn: () => child,
    createOutputDecoder: () => ({ write: (chunk) => chunk.toString(), end: () => '' }),
    inferExitCodeFromOutput: () => 0
  };
  return { engine, iface };
}

function makeRunner(overrides = {}) {
  const events = [];
  let activeProcess = null;
  const runner = createSyncEngineRunner({
    emitSyncEvent: (e) => events.push(e),
    isActiveRunCancelled: () => false,
    cancelMessageFor: (dryRun) => (dryRun ? 'Compare cancelled by user.' : 'Sync cancelled by user.'),
    requestProcessTreeKill: (c) => c && c.kill(),
    setActiveProcess: (c) => { activeProcess = c; },
    ...overrides
  });
  return { runner, events, getActiveProcess: () => activeProcess };
}

test('createEngineProgressState returns a zeroed accumulator', () => {
  const { runner } = makeRunner();
  assert.deepEqual(runner.createEngineProgressState(), {
    copied: 0, skipped: 0, failed: 0, extra: 0, latestText: '', latestFile: ''
  });
});

test('runSingleEngineInvocation streams output, registers the child, and resolves on close', async () => {
  const child = makeFakeChild();
  const { engine, iface } = makeFakeEngine(child);
  const { runner, events, getActiveProcess } = makeRunner();

  const collected = [];
  const promise = runner.runSingleEngineInvocation({
    engine, iface, args: [], runId: 'r1', dryRun: false,
    readProgress: (text) => collected.push(text), timeoutMs: 0
  });

  assert.equal(getActiveProcess(), child, 'the live child is registered for cancellation');

  child.stdout.emit('data', Buffer.from('copying file A\n'));
  child.emit('close', 0);

  const result = await promise;
  assert.equal(result.code, 0);
  assert.match(result.output, /copying file A/);
  assert.ok(!result.canceled);
  assert.equal(getActiveProcess(), null, 'the child is cleared once the run settles');
  assert.ok(collected.join('').includes('copying file A'), 'readProgress saw the output');
  assert.ok(events.some((e) => e.type === 'stdout'), 'a stdout sync event was emitted');
});

test('runSingleEngineInvocation reports a cancelled run when cancellation is active', async () => {
  const child = makeFakeChild();
  const { engine, iface } = makeFakeEngine(child);
  const { runner } = makeRunner({ isActiveRunCancelled: () => true });

  const promise = runner.runSingleEngineInvocation({
    engine, iface, args: [], runId: 'r1', dryRun: true, readProgress: () => {}, timeoutMs: 0
  });

  assert.equal(child.killed, true, 'an already-cancelled run kills the freshly spawned child');

  child.emit('close', 0);
  const result = await promise;
  assert.equal(result.canceled, true);
  assert.equal(result.code, 16);
  assert.match(result.output, /Compare cancelled by user/);
});

test('runSingleEngineInvocation infers an exit code when close carries none', async () => {
  const child = makeFakeChild();
  const { engine, iface } = makeFakeEngine(child);
  iface.inferExitCodeFromOutput = () => 3;
  const { runner } = makeRunner();

  const promise = runner.runSingleEngineInvocation({
    engine, iface, args: [], runId: 'r1', dryRun: false, readProgress: () => {}, timeoutMs: 0
  });
  child.emit('close', null); // no numeric code -> infer from output
  const result = await promise;
  assert.equal(result.code, 3);
});

test('runSyncEngineSequence reports a destination-prep failure as fatal instead of rejecting', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'syncarr-runner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  // Put a FILE where a parent directory is expected so fs.mkdir(recursive)
  // rejects — the same shape as a NAS/dest that vanished mid-run. The engine is
  // never spawned because the prep fails first.
  const blocker = path.join(root, 'blocker');
  await fs.writeFile(blocker, 'x');
  const destinationPath = path.join(blocker, 'sub');

  const { runner, events } = makeRunner();
  let result;
  await assert.doesNotReject(async () => {
    result = await runner.runSyncEngineSequence({
      runId: 'r1',
      dryRun: false,
      sourceRoots: [{ index: 0, sourcePath: root, destinationPath }],
      excludePatterns: [],
      skipOlderSource: true,
      copySubfolders: true,
      syncMode: 'mirror',
      progressState: runner.createEngineProgressState()
    });
  });

  assert.equal(result.code, 16, 'a prep failure surfaces as a fatal exit code');
  assert.ok(!result.canceled);
  assert.match(result.output, /Could not prepare destination/);
  assert.ok(events.some((e) => e.type === 'error'), 'an error event was emitted');
});

test('runSyncEngineSequence contains a buildArgs injection rejection as a fatal result', {
  skip: process.platform !== 'win32' ? 'exercises the robocopy engine argv validation' : false
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'syncarr-inject-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  // A source that begins with "/" would be swallowed by robocopy as a switch;
  // buildArgs throws, and the runner must contain it (not reject) so active-run
  // state is still cleared. The destination exists so mkdir succeeds first.
  const { runner, events } = makeRunner();
  let result;
  await assert.doesNotReject(async () => {
    result = await runner.runSyncEngineSequence({
      runId: 'r1',
      dryRun: false,
      sourceRoots: [{ index: 0, sourcePath: '/MOVE', destinationPath: root }],
      excludePatterns: [],
      skipOlderSource: true,
      copySubfolders: true,
      syncMode: 'oneWay',
      progressState: runner.createEngineProgressState()
    });
  });

  assert.equal(result.code, 16);
  assert.match(result.output, /switch/i);
  assert.ok(events.some((e) => e.type === 'error'));
});
