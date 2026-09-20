const test = require('node:test');
const assert = require('node:assert/strict');

const { emptyLineTotals, addLineTotals } = require('../src/main/sync-engines/summary-totals');

test('emptyLineTotals returns a fresh all-zero skeleton', () => {
  const a = emptyLineTotals();
  assert.deepEqual(a, { total: 0, copied: 0, skipped: 0, mismatch: 0, failed: 0, extras: 0 });
  // Must be a fresh object each call (engines mutate it).
  const b = emptyLineTotals();
  assert.notEqual(a, b);
  a.copied = 5;
  assert.equal(b.copied, 0);
});

test('addLineTotals accumulates each field into the target in place', () => {
  const target = emptyLineTotals();
  addLineTotals(target, { total: 3, copied: 2, skipped: 1, mismatch: 0, failed: 0, extras: 4 });
  addLineTotals(target, { total: 1, copied: 1, extras: 1 });
  assert.deepEqual(target, { total: 4, copied: 3, skipped: 1, mismatch: 0, failed: 0, extras: 5 });
});

test('addLineTotals defaults missing fields to 0, coerces numeric strings, and is a no-op on falsy source', () => {
  const target = emptyLineTotals();
  addLineTotals(target, null);
  addLineTotals(target, undefined);
  // Missing fields fall through `|| 0`; numeric strings coerce via Number().
  addLineTotals(target, { copied: '7' });
  assert.deepEqual(target, { total: 0, copied: 7, skipped: 0, mismatch: 0, failed: 0, extras: 0 });
});
