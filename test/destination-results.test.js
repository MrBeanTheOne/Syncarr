const test = require('node:test');
const assert = require('node:assert/strict');

const { countOptionalDestinationIssues, applyDestinationWarningStatus, makeSkippedOptionalPreviewSummary } = require('../src/main/destination-results');

test('countOptionalDestinationIssues counts only required:false entries', () => {
  assert.equal(countOptionalDestinationIssues(null), 0);
  assert.equal(countOptionalDestinationIssues([]), 0);
  assert.equal(countOptionalDestinationIssues([{ required: false }, { required: true }, { required: false }]), 2);
  assert.equal(countOptionalDestinationIssues([{ required: true }]), 0, 'required destinations are not counted');
});

test('applyDestinationWarningStatus downgrades an OK run to warning when optionals were skipped', () => {
  const ok = { ok: true, status: 'success', message: 'Done.' };
  const warned = applyDestinationWarningStatus(ok, [{ required: false }]);
  assert.equal(warned.ok, true);
  assert.equal(warned.status, 'warning');
  assert.equal(warned.warning, true);
  assert.equal(warned.optionalIssueCount, 1);
  assert.match(warned.message, /Done\. 1 optional destination\(s\) skipped\./);
});

test('applyDestinationWarningStatus leaves failed runs and clean runs untouched', () => {
  const failed = { ok: false, status: 'error', message: 'Boom' };
  assert.equal(applyDestinationWarningStatus(failed, [{ required: false }]), failed, 'failed runs pass through unchanged');
  const ok = { ok: true, status: 'success' };
  assert.equal(applyDestinationWarningStatus(ok, [{ required: true }]), ok, 'no optional skips -> unchanged');
});

test('applyDestinationWarningStatus synthesizes a base when interpreted is missing', () => {
  const result = applyDestinationWarningStatus(null, [{ required: false }]);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'error');
});

test('makeSkippedOptionalPreviewSummary annotates the summary with the skipped list', () => {
  assert.equal(makeSkippedOptionalPreviewSummary(null, [{ required: false }]), null);
  const summary = { scanned: 10 };
  assert.equal(makeSkippedOptionalPreviewSummary(summary, [{ required: true }]), summary, 'no optional skips -> same object');

  const annotated = makeSkippedOptionalPreviewSummary(summary, [{ path: 'N:\\x', label: 'X', required: false }]);
  assert.equal(annotated.scanned, 10);
  assert.equal(annotated.skippedDestinationCount, 1);
  assert.deepEqual(annotated.skippedDestinations, [{ path: 'N:\\x', label: 'X', required: false, reason: 'optional-destination-skipped' }]);
});
