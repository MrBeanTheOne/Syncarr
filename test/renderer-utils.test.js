const test = require('node:test');
const assert = require('node:assert/strict');

// renderer-utils.js is a browser IIFE that attaches its API to `window`. To
// unit-test the pure helpers under `node --test`, shim a minimal `window`
// (carrying the timer functions withTimeout uses) before requiring it. This is
// the established pattern for testing extracted renderer logic in Node.
global.window = Object.assign(global.window || {}, {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args)
});
require('../src/renderer/renderer-utils.js');
const { formatDateTime, formatDuration, formatRelativeAge, withTimeout } = global.window.SyncarrRendererUtils;

test('formatDuration renders seconds, minutes, and hours', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(5000), '5s');
  assert.equal(formatDuration(125000), '2m 5s');
  assert.equal(formatDuration(3_725_000), '1h 2m');
  assert.equal(formatDuration(-1000), '0s', 'negative durations clamp to 0');
});

test('formatDateTime returns "-" for empty/invalid and a string otherwise', () => {
  assert.equal(formatDateTime(''), '-');
  assert.equal(formatDateTime(null), '-');
  assert.equal(formatDateTime('not a date'), '-');
  assert.equal(typeof formatDateTime('2026-06-25T12:00:00Z'), 'string');
  assert.notEqual(formatDateTime('2026-06-25T12:00:00Z'), '-');
});

test('formatRelativeAge buckets seconds/minutes/hours/days', () => {
  const now = Date.now();
  assert.equal(formatRelativeAge('not a date'), 'unknown time');
  assert.equal(formatRelativeAge(new Date(now - 10_000).toISOString()), 'less than 1 minute');
  assert.equal(formatRelativeAge(new Date(now - 60_000).toISOString()), '1 minute');
  assert.equal(formatRelativeAge(new Date(now - 120_000).toISOString()), '2 minutes');
  assert.equal(formatRelativeAge(new Date(now - 3_600_000).toISOString()), '1 hour');
  assert.equal(formatRelativeAge(new Date(now - 5_400_000).toISOString()), '1h 30m');
  assert.equal(formatRelativeAge(new Date(now - 172_800_000).toISOString()), '2 days');
});

test('withTimeout resolves when the promise wins and rejects when the timer wins', async () => {
  const fast = withTimeout(Promise.resolve('ok'), 50, 'too slow');
  assert.equal(await fast, 'ok');

  const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 50));
  await assert.rejects(withTimeout(slow, 5, 'too slow'), /too slow/);
});
