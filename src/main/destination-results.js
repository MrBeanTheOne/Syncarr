'use strict';

// Pure shapers for optional-destination outcomes: count skipped optional
// destinations, downgrade an otherwise-OK run to a warning when some optional
// destinations were skipped, and annotate a preview summary with the skipped
// list. No I/O.

function countOptionalDestinationIssues(skippedDestinations) {
  return (Array.isArray(skippedDestinations) ? skippedDestinations : [])
    .filter((destination) => destination && destination.required === false)
    .length;
}

function applyDestinationWarningStatus(interpreted, skippedDestinations) {
  const base = interpreted && typeof interpreted === 'object'
    ? interpreted
    : { ok: false, status: 'error', message: 'Run status could not be interpreted.' };

  const optionalIssueCount = countOptionalDestinationIssues(skippedDestinations);
  if (!base.ok || optionalIssueCount <= 0) return base;

  const suffix = `${optionalIssueCount} optional destination(s) skipped.`;
  return {
    ...base,
    ok: true,
    status: 'warning',
    warning: true,
    optionalIssueCount,
    message: base.message ? `${base.message} ${suffix}` : suffix
  };
}

function makeSkippedOptionalPreviewSummary(summary, skippedDestinations) {
  const optionalIssueCount = countOptionalDestinationIssues(skippedDestinations);
  if (!summary || optionalIssueCount <= 0) return summary;
  return {
    ...summary,
    skippedDestinationCount: optionalIssueCount,
    skippedDestinations: (Array.isArray(skippedDestinations) ? skippedDestinations : []).map((destination) => ({
      path: destination.path,
      label: destination.label,
      required: destination.required !== false,
      reason: destination.reason || 'optional-destination-skipped'
    }))
  };
}

module.exports = { countOptionalDestinationIssues, applyDestinationWarningStatus, makeSkippedOptionalPreviewSummary };
