(() => {
  'use strict';

  const utils = window.SyncarrRendererUtils || {};
  const escapeHtml = utils.escapeHtml || ((value) => String(value ?? ''));

  function normalizeTone(tone) {
    const value = String(tone || '').toLowerCase();
    if (value === 'ok') return 'success';
    if (['success', 'warning', 'error'].includes(value)) return value;
    return 'neutral';
  }

  function renderStatGrid(stats) {
    const items = Array.isArray(stats) ? stats.filter(Boolean) : [];
    if (!items.length) return '';

    return `
      <div class="inspector-stat-grid">
        ${items.map((item) => `
          <div class="inspector-stat">
            <span>${escapeHtml(item.label || '')}</span>
            <strong>${escapeHtml(item.value ?? '-')}</strong>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderDetailGrid(details) {
    const items = Array.isArray(details) ? details.filter(Boolean) : [];
    if (!items.length) return '';

    return `
      <dl class="detail-grid inspector-detail-grid">
        ${items.map((item) => `
          <dt>${escapeHtml(item.label || '')}</dt>
          <dd>${escapeHtml(item.value ?? '-')}</dd>
        `).join('')}
      </dl>
    `;
  }

  function renderSelectionCard(options = {}) {
    const tone = normalizeTone(options.tone);
    const kind = options.kind ? String(options.kind) : 'selection';
    const eyebrow = options.eyebrow ? `<small class="inspector-eyebrow">${escapeHtml(options.eyebrow)}</small>` : '';
    const subtitle = options.subtitle ? `<span>${escapeHtml(options.subtitle)}</span>` : '';

    return `
      <div class="result-card inspector-selection-card ${escapeHtml(tone)}" data-inspector-kind="${escapeHtml(kind)}">
        ${eyebrow}
        <strong>${escapeHtml(options.title || 'No selection')}</strong>
        ${subtitle}
        ${renderStatGrid(options.stats)}
        ${renderDetailGrid(options.details)}
      </div>
    `;
  }

  function renderActionNote(options = {}) {
    const tone = normalizeTone(options.tone);
    const actions = Array.isArray(options.actions) ? options.actions.filter(Boolean) : [];
    return `
      <div class="inspector-action-note ${escapeHtml(tone)}">
        <div class="inspector-action-heading">
          <small>${escapeHtml(options.eyebrow || 'Restore action')}</small>
          <strong>${escapeHtml(options.title || 'Actions')}</strong>
          <span>${escapeHtml(options.message || '')}</span>
        </div>
        ${actions.length ? `
          <div class="button-stack inspector-disabled-actions">
            ${actions.map((action) => `
              <button class="secondary" type="button" disabled>${escapeHtml(action)}</button>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  window.SyncarrHistoryInspectorUtils = {
    renderSelectionCard,
    renderActionNote,
    renderDetailGrid,
    renderStatGrid
  };
})();
