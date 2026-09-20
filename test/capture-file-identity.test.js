'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { captureFileIdentity } = require('../src/main/restore-points');

// Minimal fs.Stats stand-in. `kind` decides isFile()/isDirectory().
function fakeStats(kind, { size = 0, mtimeMs = 1000 } = {}) {
  return {
    size,
    mtimeMs,
    mtime: new Date(mtimeMs),
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir'
  };
}

// statFn that yields a scripted sequence of results. Each entry is either a
// stats object (resolve) or an Error (reject). Records how many times called.
function scriptedStat(sequence) {
  const calls = { count: 0 };
  const statFn = async () => {
    const next = sequence[Math.min(calls.count, sequence.length - 1)];
    calls.count += 1;
    if (next instanceof Error) throw next;
    return next;
  };
  return { statFn, calls };
}

const fastOpts = (extra) => ({ retryAttempts: 5, retryDelayMs: 0, sleepFn: async () => {}, ...extra });

test('captureFileIdentity returns identity on the first stat for a real file', async () => {
  const { statFn, calls } = scriptedStat([fakeStats('file', { size: 42, mtimeMs: 1700000000123 })]);
  const identity = await captureFileIdentity('whatever', fastOpts({ statFn }));
  assert.equal(calls.count, 1, 'should not retry when the first stat is a file');
  assert.equal(identity.size, 42);
  assert.equal(identity.modifiedMs, 1700000000123);
  assert.equal(identity.identityMode, 'metadata');
  assert.equal(identity.contentHash, '');
});

test('captureFileIdentity retries through the transient non-file window then succeeds', async () => {
  // Mimics a freshly-copied file: stats as a non-regular file twice, then settles.
  const { statFn, calls } = scriptedStat([
    fakeStats('other'),
    fakeStats('other'),
    fakeStats('file', { size: 3591863 })
  ]);
  const identity = await captureFileIdentity('app.asar', fastOpts({ statFn }));
  assert.equal(calls.count, 3, 'should retry until the file settles');
  assert.equal(identity.size, 3591863);
});

test('captureFileIdentity retries through a transient stat error then succeeds', async () => {
  const busy = Object.assign(new Error('locked'), { code: 'EBUSY' });
  const { statFn, calls } = scriptedStat([busy, fakeStats('file', { size: 7 })]);
  const identity = await captureFileIdentity('Setup.exe', fastOpts({ statFn }));
  assert.equal(calls.count, 2);
  assert.equal(identity.size, 7);
});

test('captureFileIdentity fails fast on a real directory without burning retries', async () => {
  // .asar files no longer reach here as fake directories (original-fs is used in
  // production), so a directory result genuinely means a directory — fail fast.
  let sleeps = 0;
  const { statFn, calls } = scriptedStat([fakeStats('dir')]);
  await assert.rejects(
    () => captureFileIdentity('somedir', fastOpts({ statFn, sleepFn: async () => { sleeps += 1; } })),
    (err) => /Cannot snapshot non-file path/.test(err.message) && /directory/.test(err.message)
  );
  assert.equal(calls.count, 1, 'a directory must not be retried');
  assert.equal(sleeps, 0, 'a directory must not trigger any backoff sleep');
});

test('captureFileIdentity surfaces a non-transient stat error immediately', async () => {
  const fatal = Object.assign(new Error('nope'), { code: 'EINVAL' });
  const { statFn, calls } = scriptedStat([fatal]);
  await assert.rejects(() => captureFileIdentity('x', fastOpts({ statFn })), /nope/);
  assert.equal(calls.count, 1, 'a non-transient error must not be retried');
});

test('captureFileIdentity treats ENOENT as a genuine delete and fails fast (no retry)', async () => {
  // A file readdir just listed that then stats ENOENT is almost always really
  // gone, not finalizing — it must surface immediately, not burn the retry budget.
  const gone = Object.assign(new Error('missing'), { code: 'ENOENT' });
  const { statFn, calls } = scriptedStat([gone]);
  await assert.rejects(() => captureFileIdentity('vanished', fastOpts({ statFn })), /missing/);
  assert.equal(calls.count, 1, 'ENOENT must not be retried');
});

test('captureFileIdentity with zero/negative retryAttempts still throws a real Error, not undefined', async () => {
  const { statFn } = scriptedStat([fakeStats('other')]); // never a file
  await assert.rejects(
    () => captureFileIdentity('stuck', fastOpts({ retryAttempts: -3, statFn })),
    (err) => err instanceof Error && /Cannot snapshot non-file path/.test(err.message)
  );
});

test('captureFileIdentity surfaces non-file after exhausting all retries', async () => {
  const { statFn, calls } = scriptedStat([fakeStats('other')]); // never settles
  await assert.rejects(
    () => captureFileIdentity('stuck', fastOpts({ retryAttempts: 3, statFn })),
    /Cannot snapshot non-file path/
  );
  assert.equal(calls.count, 4, 'initial attempt + 3 retries');
});

test('captureFileIdentity surfaces a diagnostic noting the transient error after exhausting retries', async () => {
  const busy = Object.assign(new Error('still locked'), { code: 'EBUSY' });
  const { statFn, calls } = scriptedStat([busy]); // always EBUSY
  await assert.rejects(
    () => captureFileIdentity('locked', fastOpts({ retryAttempts: 2, statFn })),
    (err) => /Cannot snapshot non-file path/.test(err.message) && /stat error EBUSY/.test(err.message)
  );
  assert.equal(calls.count, 3, 'initial attempt + 2 retries');
});
