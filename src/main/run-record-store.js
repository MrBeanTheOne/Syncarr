'use strict';

// Helpers for persisting run records into config. This module starts as the
// home for the pure trimSavedRunOutput; the larger persistRunRecord
// consolidation (the readConfig -> lastRuns/pendingCompares -> writeConfig block
// copy-pasted across the run paths) is deferred until a live-sync verification
// matrix (one-way / mirror / two-way+conflict / cancel-mid-run) can be run.

// 50 KB keeps the last chunk of a robocopy/rsync log for diagnosis while keeping
// config small: 20 saved runs cap the file near ~1 MB, not the ~9 MB that the old
// 750 KB cap produced (which parsed/rewrote on every config read/write and was
// the likely OOM/hang behind the 2026-07-07 crash).
const DEFAULT_MAX_SAVED_OUTPUT_CHARS = 50000;

// Cap the saved run output so a huge robocopy/rsync log cannot bloat config.
// Keeps the most recent maxChars and prepends a notice about what was dropped.
function trimSavedRunOutput(output, maxChars = DEFAULT_MAX_SAVED_OUTPUT_CHARS) {
  const text = String(output || '');
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `[Saved log truncated; omitted ${omitted.toLocaleString()} earlier character(s).]\n\n${text.slice(-maxChars)}`;
}

module.exports = { trimSavedRunOutput, DEFAULT_MAX_SAVED_OUTPUT_CHARS };
