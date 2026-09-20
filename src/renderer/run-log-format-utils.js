(() => {
  'use strict';

  // Pure run-log text builders: the per-section log lines (storage/retention/
  // restore-point) and the full expandable run log. formatDate/Number/Bytes come
  // from renderer-utils (loaded first); the job-model normalizers are injected via
  // configure so this module does not depend on the mirror's load order. Defaults
  // are safe standalone fallbacks for tests and before configure() runs.
  const { formatDate, formatNumber, formatBytes } = window.SyncarrRendererUtils;

  let normalizeSourcePaths = (input) => (Array.isArray(input) ? input : (input ? [input] : [])).filter(Boolean);
  let normalizeTargetDestinations = (input, fallback = '') => (Array.isArray(input) && input.length ? input : (fallback ? [{ path: fallback, required: true }] : []));
  let normalizeSyncMode = (value) => String(value || 'oneWay');

  function configure(deps) {
    if (!deps) return;
    if (typeof deps.normalizeSourcePaths === 'function') normalizeSourcePaths = deps.normalizeSourcePaths;
    if (typeof deps.normalizeTargetDestinations === 'function') normalizeTargetDestinations = deps.normalizeTargetDestinations;
    if (typeof deps.normalizeSyncMode === 'function') normalizeSyncMode = deps.normalizeSyncMode;
  }

  function formatStorageLog(storage) {
    if (!storage) return '';
    const state = storage.checked
      ? storage.enoughSpace ? 'ok' : 'low'
      : 'unknown';
    return `Storage check (${state}): ${storage.message || ''}\n`;
  }

  function formatRetentionLog(retention) {
    if (!retention) return '';
    const summary = retention.summary || {};
    return `Retention: ${retention.message || ''} Candidates ${formatNumber(summary.candidateFiles || 0)}, deleted ${formatNumber(summary.deletedFiles || 0)}, freed ${formatBytes(summary.freedBytes || 0)}.\n`;
  }

  function formatRestorePointLog(restorePoint) {
    if (!restorePoint) return '';
    if (restorePoint.ok === false) {
      return `Restore point failed: ${restorePoint.message || 'Could not create restore point manifest.'}\n`;
    }
    const totals = restorePoint.totals || {};
    return `Restore point created: ${formatNumber(totals.filesTotal || 0)} file(s), ${formatBytes(totals.bytesTotal || 0)} indexed${restorePoint.manifestPath || restorePoint.path ? ` at ${restorePoint.manifestPath || restorePoint.path}` : ''}.\n`;
  }

  function buildRunLog(run) {
    if (!run) return 'No run selected.';
    const sourceLines = normalizeSourcePaths(run.sourcePaths && run.sourcePaths.length ? run.sourcePaths : run.sourcePath)
      .map((source, index) => `  ${index + 1}. ${source}`)
      .join('\n');
    const destinationLines = normalizeTargetDestinations(run.targetDestinations, run.targetPath)
      .map((destination, index) => `  ${index + 1}. ${destination.required ? 'Required' : 'Optional'} | ${destination.path}`)
      .join('\n');
    const skippedDestinationLines = Array.isArray(run.skippedDestinations) && run.skippedDestinations.length
      ? run.skippedDestinations.map((destination) => `  - ${destination.label || 'Optional'} (${destination.path})${destination.reason ? ` | ${destination.reason}` : ''}`).join('\n')
      : '';
    const destinationResultLines = Array.isArray(run.destinationResults) && run.destinationResults.length
      ? run.destinationResults.map((result) => `  - ${result.destinationRole || (result.destinationRequired ? 'required' : 'optional')} | ${result.destinationLabel || result.destinationPath || 'Destination'} | ${result.status || 'unknown'} | code ${result.code ?? 'n/a'}${result.message ? ` | ${result.message}` : ''}`).join('\n')
      : '';
    const files = run.summary && run.summary.files ? run.summary.files : {};
    const bytes = run.summary && run.summary.bytes ? run.summary.bytes : {};
    const history = run.history || {};
    const storage = run.storage || null;
    const retention = run.retention || null;
    const restorePoint = run.restorePoint || null;
    const output = run.output || run.log || '';

    const mode = normalizeSyncMode(run.syncMode || 'oneWay');
    const extraCount = Number(files.extras || files.deleted || history.destinationOnly || 0);
    const parts = [
      `--- ${run.dryRun ? 'COMPARE DRY RUN' : (mode === 'mirror' ? 'MIRROR SYNC' : 'UPDATE SYNC')} ${formatDate(run.at)} ---`,
      `Job: ${run.jobName || run.jobId || 'Current job'}`,
      `Status: ${run.status || 'unknown'} | Exit code: ${run.code ?? 'n/a'}`,
      destinationLines ? `Destinations:\n${destinationLines}` : `Target: ${run.targetPath || '-'}`,
      destinationResultLines ? `Destination results:\n${destinationResultLines}` : '',
      skippedDestinationLines ? `Skipped optional destinations:\n${skippedDestinationLines}` : '',
      sourceLines ? `Sources:\n${sourceLines}` : 'Sources: -',
      '',
      `Files copied: ${formatNumber(files.copied || 0)}`,
      `${mode === 'mirror' ? 'Files deleted' : 'Destination-only left untouched'}: ${formatNumber(extraCount)}`,
      `Files skipped: ${formatNumber(files.skipped || 0)}`,
      `Failed: ${formatNumber(files.failed || 0)}`,
      `Bytes copied: ${formatBytes(bytes.copied || 0)}`,
      `Files archived: ${formatNumber(history.archived ?? history.wouldArchive ?? 0)}`,
      restorePoint ? `Restore point: ${restorePoint.ok === false ? 'failed' : 'created'}${restorePoint.manifestPath || restorePoint.path ? ` | ${restorePoint.manifestPath || restorePoint.path}` : ''}` : ''
    ];

    if (storage) parts.push(formatStorageLog(storage).trim());
    if (retention) parts.push(formatRetentionLog(retention).trim());
    parts.push('', output ? output.trimEnd() : 'No saved Robocopy output for this run. New runs will save logs here.');

    return parts.filter((part) => part !== '').join('\n');
  }

  window.SyncarrRunLogFormat = {
    configure,
    formatStorageLog,
    formatRetentionLog,
    formatRestorePointLog,
    buildRunLog
  };
})();
