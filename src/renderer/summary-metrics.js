(() => {
  'use strict';

  // Single source for the run-complete summary metric VALUES (the 4 cells:
  // copied / skipped / failed / bytes). Both renderSummary and forceCompleteRunUi
  // used to inline this and had drifted — two-way once read the robocopy-shaped
  // files.copied instead of copyToDest/copyToSource (see the two-way-summary-render
  // bug). Centralizing the mapping here prevents that recurring. Returns formatted
  // strings; the DOM writes stay in app.js. It deliberately does NOT touch the
  // Deleted/History cells (those belong to renderPlanSummary / the history panel).
  const { formatNumber, formatBytes } = window.SyncarrRendererUtils;

  // Single source of truth for "how many files were copied" from a run summary.
  // Two-way result summaries carry copyToDest/copyToSource (matching the toast's
  // extractRunStats), NOT the robocopy-shaped files.copied — reading the wrong
  // one is the two-way-summary-render bug. Returns a raw number so both the
  // run-complete cells and the recent-runs history rows share one mapping.
  function extractCopiedCount(summary) {
    const s = summary || {};
    if (s.twoWay) return Number(s.copyToDest || 0) + Number(s.copyToSource || 0);
    const files = s.files || {};
    return Number(files.copied || 0);
  }

  function computeSyncSummaryMetrics(summary) {
    const s = summary || {};
    if (s.twoWay) {
      return {
        copied: formatNumber(extractCopiedCount(s)),
        skipped: formatNumber(s.unchanged || 0),
        failed: formatNumber(s.errors || 0),
        bytes: formatBytes(s.copyBytes || 0)
      };
    }
    const files = s.files || {};
    const bytes = s.bytes || {};
    return {
      copied: formatNumber(extractCopiedCount(s)),
      skipped: formatNumber(files.skipped || 0),
      failed: formatNumber(files.failed || 0),
      bytes: formatBytes(bytes.copied || 0)
    };
  }

  window.SyncarrSummaryMetrics = { computeSyncSummaryMetrics, extractCopiedCount };
})();
