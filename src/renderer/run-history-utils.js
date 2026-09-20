(() => {
  'use strict';

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function getRunFiles(run) {
    return run && run.summary && run.summary.files && typeof run.summary.files === 'object'
      ? run.summary.files
      : null;
  }

  function getCopiedCount(run) {
    const summary = run && run.summary && typeof run.summary === 'object' ? run.summary : null;
    if (!summary) return null;
    // Delegate to the shared extractor so two-way runs (copyToDest/copyToSource)
    // aren't under-reported as 0 here the way renderSummary once was. Fall back to
    // a two-way-aware inline read if summary-metrics.js hasn't loaded yet.
    const metrics = window.SyncarrSummaryMetrics;
    if (metrics && typeof metrics.extractCopiedCount === 'function') {
      return numberOrNull(metrics.extractCopiedCount(summary));
    }
    if (summary.twoWay) return numberOrNull(Number(summary.copyToDest || 0) + Number(summary.copyToSource || 0));
    const files = getRunFiles(run);
    return files ? numberOrNull(files.copied) : null;
  }

  function getArchivedCount(run) {
    const history = run && run.history && typeof run.history === 'object' ? run.history : null;
    if (!history) return null;
    return numberOrNull(history.archived ?? history.wouldArchive);
  }

  function getDeletedCount(run) {
    const files = getRunFiles(run);
    const history = run && run.history && typeof run.history === 'object' ? run.history : null;
    if (!files && !history) return null;
    return numberOrNull(
      (files && (files.deleted ?? files.extras))
      ?? (history && history.destinationOnly)
      ?? 0
    );
  }

  function formatRunCount(value, label) {
    const formatNumber = window.SyncarrRendererUtils && window.SyncarrRendererUtils.formatNumber
      ? window.SyncarrRendererUtils.formatNumber
      : (input) => String(input);
    if (value === null || value === undefined) return null;
    return `${formatNumber(value)} ${label}`;
  }

  function isMirrorRun(run) {
    return String(run && run.syncMode || '').trim() === 'mirror';
  }

  function buildRunHistoryStatsText(run) {
    const extraLabel = isMirrorRun(run) ? 'deleted' : 'destination-only';
    const segments = [
      formatRunCount(getCopiedCount(run), 'copied'),
      formatRunCount(getArchivedCount(run), 'archived'),
      formatRunCount(getDeletedCount(run), extraLabel)
    ].filter(Boolean);

    return segments.length ? segments.join(' | ') : '-';
  }

  window.SyncarrRunHistoryUtils = {
    getCopiedCount,
    getArchivedCount,
    getDeletedCount,
    isMirrorRun,
    buildRunHistoryStatsText
  };
})();
