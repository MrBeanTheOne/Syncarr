(function () {
  const utils = window.SyncarrRendererUtils || {};
  const escapeHtml = utils.escapeHtml || ((value) => String(value ?? ''));
  const formatNumber = utils.formatNumber || ((value) => String(value || 0));
  const formatBytes = utils.formatBytes || ((value) => `${value || 0} B`);

  function renderManifestOverview(manifest) {
    if (!manifest) return '';
    const destinations = Array.isArray(manifest.destinations) ? manifest.destinations : [];
    const sourcePaths = Array.isArray(manifest.sourcePaths) ? manifest.sourcePaths : [];
    const errors = Array.isArray(manifest.errors) ? manifest.errors : [];

    return `
      <div class="restore-point-manifest-overview">
        ${sourcePaths.length ? `
          <div class="manifest-section">
            <strong>Source route overview</strong>
            <div class="manifest-path-list">
              ${sourcePaths.slice(0, 6).map((sourcePath) => `<code>${escapeHtml(sourcePath)}</code>`).join('')}
            </div>
          </div>
        ` : ''}
        <div class="manifest-section">
          <strong>Destination snapshots</strong>
          <span>${escapeHtml(formatNumber(destinations.length))} destination snapshot${destinations.length === 1 ? '' : 's'} indexed. Browse files in the Restore points section on the left.</span>
          <div class="manifest-destination-summary-list">
            ${destinations.map(renderDestinationSummary).join('')}
          </div>
        </div>
        ${errors.length ? renderErrorBlock(errors) : ''}
        <div class="manifest-section muted-note">
          <strong>Restore status</strong>
          <span>Verified file, folder, destination, and full-point restores can be written to another folder without overwriting existing files.</span>
        </div>
      </div>
    `;
  }

  function renderDestinationSummary(destination) {
    const summary = destination && destination.summary ? destination.summary : {};
    const filesTotal = Number(destination && destination.filesTotal || summary.filesTotal || 0);
    const scanErrors = Number(summary.scanErrors || (Array.isArray(destination && destination.errors) ? destination.errors.length : 0) || 0);
    return `
      <div class="manifest-destination-summary">
        <span>
          <strong>${escapeHtml(destination && destination.label || 'Destination')}</strong>
          <small>${escapeHtml(destination && destination.path || '')}</small>
        </span>
        <span class="mini-pill">${escapeHtml(formatNumber(filesTotal))} files</span>
        <span class="mini-pill">${escapeHtml(formatBytes(summary.bytesTotal || 0))}</span>
        ${scanErrors ? `<span class="mini-pill warning">${escapeHtml(formatNumber(scanErrors))} issue(s)</span>` : ''}
      </div>
    `;
  }

  function renderErrorBlock(errors) {
    return `
      <div class="manifest-section manifest-errors">
        <strong>Manifest issues</strong>
        ${errors.slice(0, 6).map((error) => `<span>${escapeHtml(error.message || String(error))}</span>`).join('')}
      </div>
    `;
  }

  window.SyncarrRestorePointDetailsUtils = {
    renderManifestOverview
  };
})();
