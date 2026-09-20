const test = require('node:test');
const assert = require('node:assert/strict');

const { trimSavedRunOutput, DEFAULT_MAX_SAVED_OUTPUT_CHARS } = require('../src/main/run-record-store');

test('trimSavedRunOutput leaves short output unchanged', () => {
  assert.equal(trimSavedRunOutput(''), '');
  assert.equal(trimSavedRunOutput('hello'), 'hello');
  assert.equal(trimSavedRunOutput(null), '');
  const exact = 'x'.repeat(10);
  assert.equal(trimSavedRunOutput(exact, 10), exact, 'length === max is not truncated');
});

test('trimSavedRunOutput keeps the tail and prepends an omitted-count notice', () => {
  const text = 'abcdefghij'; // 10 chars
  const result = trimSavedRunOutput(text, 4);
  assert.match(result, /^\[Saved log truncated; omitted 6 earlier character\(s\)\.\]/);
  assert.ok(result.endsWith('ghij'), 'keeps the last maxChars');
  assert.ok(!result.includes('abcdef'.slice(0, 6)) || result.indexOf('abcdef') === -1, 'drops the head');
});

test('trimSavedRunOutput uses the default cap when none is given', () => {
  assert.equal(DEFAULT_MAX_SAVED_OUTPUT_CHARS, 50000);
  const under = 'y'.repeat(DEFAULT_MAX_SAVED_OUTPUT_CHARS);
  assert.equal(trimSavedRunOutput(under), under);
  const over = 'z'.repeat(DEFAULT_MAX_SAVED_OUTPUT_CHARS + 5);
  const result = trimSavedRunOutput(over);
  assert.match(result, /omitted 5 earlier character\(s\)/);
  assert.equal(result.slice(-DEFAULT_MAX_SAVED_OUTPUT_CHARS), 'z'.repeat(DEFAULT_MAX_SAVED_OUTPUT_CHARS));
});
