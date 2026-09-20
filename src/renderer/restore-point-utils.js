(function () {
  const utils = window.SyncarrRendererUtils || {};
  const formatNumber = utils.formatNumber || ((value) => String(value || 0));
  const formatBytes = utils.formatBytes || ((value) => `${value || 0} B`);

  function modeLabel(syncMode) {
    const value = String(syncMode || '').toLowerCase();
    if (value === 'mirror') return 'Mirror';
    if (value === 'twoway' || value === 'two-way') return 'Two-way';
    if (value === 'oneway' || value === 'one-way') return 'One-way';
    return syncMode || 'Sync';
  }

  function restorePointTypeLabel(type) {
    const value = String(type || '').toLowerCase();
    if (value === 'incremental-manifest') return 'Incremental manifest';
    if (value === 'full-snapshot') return 'Full snapshot';
    if (value === 'manifest-only') return 'Manifest only';
    return type || 'Restore point';
  }

  function restorePointSummaryText(point) {
    const totals = point && point.totals ? point.totals : {};
    const pieces = [
      `${formatNumber(totals.filesTotal || 0)} files`,
      `${formatBytes(totals.bytesTotal || 0)}`
    ];
    const isMirror = String(point && point.syncMode || '').toLowerCase() === 'mirror';
    const destinationOnly = Number(totals.destinationOnlyFiles || 0) || (!isMirror ? Number(totals.deletedFiles || 0) : 0);
    const deleted = isMirror ? Number(totals.deletedFiles || 0) : 0;
    if (Number(totals.copiedFiles || 0) > 0) pieces.push(`${formatNumber(totals.copiedFiles)} copied`);
    if (Number(totals.archivedVersions || 0) > 0) pieces.push(`${formatNumber(totals.archivedVersions)} archived`);
    if (deleted > 0) pieces.push(`${formatNumber(deleted)} deleted`);
    if (destinationOnly > 0) pieces.push(`${formatNumber(destinationOnly)} destination-only`);
    if (Number(totals.scanErrors || 0) > 0) pieces.push(`${formatNumber(totals.scanErrors)} scan issue(s)`);
    return pieces.join(' | ');
  }

  function restorePointStatusTone(point) {
    const totals = point && point.totals ? point.totals : {};
    if (String(point && point.status || '').toLowerCase() === 'failed') return 'error';
    if (Number(totals.scanErrors || 0) > 0) return 'warning';
    return 'success';
  }

  window.SyncarrRestorePointUtils = {
    modeLabel,
    restorePointTypeLabel,
    restorePointSummaryText,
    restorePointStatusTone
  };
})();
