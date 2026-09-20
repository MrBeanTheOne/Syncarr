(() => {
  'use strict';

  let runtimePlatform = 'win32';

  function configurePlatform(platform) {
    runtimePlatform = ['win32', 'darwin', 'linux'].includes(platform) ? platform : runtimePlatform;
  }

  function renderFileIcon(filePath) {
    if (window.SyncarrFileBrowser && typeof window.SyncarrFileBrowser.fileIconHtml === 'function') {
      return window.SyncarrFileBrowser.fileIconHtml(filePath);
    }
    return '<svg class="entry-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  }

  function renderFolderIcon() {
    if (window.SyncarrFileBrowser && typeof window.SyncarrFileBrowser.folderIconHtml === 'function') {
      return window.SyncarrFileBrowser.folderIconHtml();
    }
    return '<svg class="entry-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h6l2-2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2"/></svg>';
  }

  function fileKindLabel(filePath) {
    if (window.SyncarrFileBrowser && typeof window.SyncarrFileBrowser.fileKindLabel === 'function') {
      return window.SyncarrFileBrowser.fileKindLabel(filePath);
    }
    return 'File';
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function joinForDisplay(root, relativePath) {
    if (!root) return relativePath;
    const pathSeparator = runtimePlatform === 'win32' ? '\\' : '/';
    const separator = root.endsWith('\\') || root.endsWith('/') ? '' : pathSeparator;
    return `${root}${separator}${String(relativePath || '').replace(/[\\/]/g, pathSeparator)}`;
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  }

  function readNumberInput(input, fallback) {
    const value = Number(input.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function formatNumber(value) {
    if (value === null || value === undefined) return '-';
    return Number(value).toLocaleString();
  }

  function formatBytes(value) {
    if (value === null || value === undefined) return '-';
    if (!value) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let amount = value;
    let unitIndex = 0;
    while (amount >= 1024 && unitIndex < units.length - 1) {
      amount /= 1024;
      unitIndex += 1;
    }
    return `${amount.toFixed(amount >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  function escapeAttr(input) {
    return escapeHtml(input);
  }

  function escapeHtml(input) {
    return String(input)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDateTime(input) {
    if (!input) return '-';
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  function formatRelativeAge(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'unknown time';
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return 'less than 1 minute';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.floor(minutes / 60);
    const remainderMinutes = minutes % 60;
    if (hours < 24) return remainderMinutes ? `${hours}h ${remainderMinutes}m` : `${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  function withTimeout(promise, ms, timeoutMessage) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(timeoutMessage)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) window.clearTimeout(timer);
    });
  }

  window.SyncarrRendererUtils = {
    configurePlatform,
    renderFileIcon,
    renderFolderIcon,
    fileKindLabel,
    cssEscape,
    joinForDisplay,
    formatDate,
    readNumberInput,
    formatNumber,
    formatBytes,
    escapeAttr,
    escapeHtml,
    formatDateTime,
    formatDuration,
    formatRelativeAge,
    withTimeout
  };
})();
