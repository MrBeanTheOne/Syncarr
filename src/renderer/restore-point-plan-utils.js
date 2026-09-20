(() => {
  'use strict';

  const utils = window.SyncarrRendererUtils || {};
  const escapeHtml = utils.escapeHtml || ((value) => String(value ?? ''));
  const formatNumber = utils.formatNumber || ((value) => String(value || 0));
  const formatBytes = utils.formatBytes || ((value) => `${value || 0} B`);

  function renderRestorePointPlan(planState = {}) {
    if (planState.loading) {
      return renderShell('neutral', 'Checking restore readiness...', 'Syncarr is verifying indexed content against live files and protected file-history archives.');
    }

    if (planState.error) {
      return renderShell('error', 'Restore readiness check failed', planState.error);
    }

    const plan = planState.result && planState.result.plan ? planState.result.plan : planState.result;
    if (!plan) {
      return renderShell('neutral', 'Restore readiness not checked', 'Choose a restore folder and run a readiness check before restoring.');
    }

    const totals = plan.totals || {};
    const tone = plan.ready ? 'success' : totals.filesPlanned ? 'warning' : 'neutral';
    const message = plan.message || (plan.ready ? 'Selected scope has verified restore content.' : 'Selected scope needs review.');
    const missing = Array.isArray(plan.missingSample) ? plan.missingSample : [];

    return `
      <div class="restore-point-plan ${escapeHtml(tone)}">
        <strong>${escapeHtml(plan.ready ? 'Restore readiness passed' : 'Restore readiness review')}</strong>
        <span>${escapeHtml(message)}</span>
        <div class="inspector-stat-grid restore-point-plan-grid">
          <div class="inspector-stat"><span>Scope</span><strong>${escapeHtml(formatScope(plan.scope))}</strong></div>
          <div class="inspector-stat"><span>Files</span><strong>${escapeHtml(formatNumber(totals.filesPlanned || 0))}</strong></div>
          <div class="inspector-stat"><span>Live</span><strong>${escapeHtml(formatNumber(totals.availableFromLive || 0))}</strong></div>
          <div class="inspector-stat"><span>History</span><strong>${escapeHtml(formatNumber(totals.availableFromHistory || 0))}</strong></div>
          <div class="inspector-stat"><span>Missing</span><strong>${escapeHtml(formatNumber(totals.missingContent || totals.missingFromLive || 0))}</strong></div>
          <div class="inspector-stat"><span>Conflicts</span><strong>${escapeHtml(formatNumber(totals.conflicts || 0))}</strong></div>
          <div class="inspector-stat"><span>Scan issues</span><strong>${escapeHtml(formatNumber(totals.scanErrors || 0))}</strong></div>
          <div class="inspector-stat"><span>Size</span><strong>${escapeHtml(formatBytes(totals.bytesPlanned || 0))}</strong></div>
        </div>
        ${missing.length ? `
          <div class="restore-point-plan-sample">
            <strong>Missing sample</strong>
            ${missing.slice(0, 6).map((item) => `<span>${escapeHtml(item.relativePath || item.livePath || 'Unknown file')}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderShell(tone, title, message) {
    return `
      <div class="restore-point-plan ${escapeHtml(tone || 'neutral')}">
        <strong>${escapeHtml(title || '')}</strong>
        <span>${escapeHtml(message || '')}</span>
      </div>
    `;
  }

  function formatScope(scope) {
    switch (scope) {
      case 'file': return 'File';
      case 'folder': return 'Folder';
      case 'destination': return 'Destination';
      case 'restore-point': return 'Full point';
      default: return scope || 'Scope';
    }
  }

  window.SyncarrRestorePointPlanUtils = {
    renderRestorePointPlan
  };
})();
