(() => {
  'use strict';

  // Pure preview formatters: path display, size transitions, action/tone class
  // maps, and the two-way side-metadata builder. No DOM and no preview state —
  // the state-coupled renderers (previewSideMeta, previewToneLabel,
  // twoWayDirectionBadge, isTwoWayPreview) stay in app.js for a later phase.
  const { formatBytes } = window.SyncarrRendererUtils;

  function previewSidePathLabel(file, side) {
    const relativePath = String(file.originalRelativePath || file.relativePath || '').replace(/\\/g, '/');
    const parentPath = relativePath.includes('/') ? relativePath.split('/').slice(0, -1).join('\\') : '';

    if (side === 'source') {
      return joinPreviewDisplayPath(file.sourceRoot || file.sourceLabel || 'Source', parentPath, { compact: true });
    }

    return joinPreviewDisplayPath(file.destinationLabel || file.destinationPath || 'Destination', parentPath, { compact: false });
  }

  function joinPreviewDisplayPath(root, child, options = {}) {
    const cleanRoot = String(root || '').trim();
    const cleanChild = String(child || '').replace(/[\\/]+/g, '\\').replace(/^\\+|\\+$/g, '');
    const joined = cleanChild
      ? `${cleanRoot.replace(/[\\/]+$/g, '')}\\${cleanChild}`
      : cleanRoot;
    return options.compact ? compactPreviewPath(joined) : joined;
  }

  function compactPreviewPath(input, maxParts = 3) {
    const clean = String(input || '').replace(/[\\/]+/g, '\\');
    const parts = clean.split('\\').filter(Boolean);
    if (parts.length <= maxParts) return clean;
    return `…\\${parts.slice(-maxParts).join('\\')}`;
  }

  function previewFileSize(file, side) {
    const record = side === 'source' ? file.source : file.target;
    return record && Number.isFinite(record.size) ? Number(record.size) : null;
  }

  function formatSizeTransition(beforeBytes, afterBytes) {
    const before = Number.isFinite(beforeBytes) ? formatBytes(beforeBytes) : '-';
    const after = Number.isFinite(afterBytes) ? formatBytes(afterBytes) : '-';
    if (before === '-' && after === '-') return '-';
    if (before === '-') return after;
    if (after === '-') return before;
    if (before === after) return before;
    return `${before} → ${after}`;
  }

  function twoWaySideMeta(file, side) {
    const isSource = side === 'source';
    const sourceBytes = previewFileSize(file, 'source');
    const targetBytes = previewFileSize(file, 'destination');
    const reason = String(file.reason || '');
    const conflictNote = reason.includes('source-wins')
      ? 'Both sides changed; the source precedence rule wins.'
      : reason.includes('dest-wins')
        ? 'Both sides changed; the destination precedence rule wins.'
        : reason.includes('newer-source')
          ? 'Both sides changed; source is newer.'
          : reason.includes('newer-dest')
            ? 'Both sides changed; destination is newer.'
            : 'Both sides changed; the selected conflict rule applies.';
    switch (file.direction) {
      case 'toDest':
        return isSource
          ? { action: 'Send to destination', size: formatBytes(sourceBytes), state: 'Sending', tone: 'new' }
          : { action: file.target ? 'Replace from source' : 'Create from source', size: formatSizeTransition(targetBytes, sourceBytes), state: file.conflict ? 'Conflict' : (file.target ? 'Replace' : 'New'), tone: file.conflict ? 'issue' : (file.target ? 'changed' : 'new'), note: file.conflict ? conflictNote : '' };
      case 'toSource':
        return isSource
          ? { action: file.source ? 'Replace from destination' : 'Create from destination', size: formatSizeTransition(sourceBytes, targetBytes), state: file.conflict ? 'Conflict' : (file.source ? 'Replace' : 'New'), tone: file.conflict ? 'issue' : (file.source ? 'changed' : 'new'), note: file.conflict ? conflictNote : '' }
          : { action: 'Send to source', size: formatBytes(targetBytes), state: 'Sending', tone: 'new' };
      case 'deleteDest':
        return isSource
          ? { action: 'Removed here', size: '-', state: 'Removed', tone: 'delete' }
          : { action: 'Delete from destination', size: formatBytes(targetBytes), state: 'Delete', tone: 'delete', note: file.conflict ? 'Source precedence makes the source-side deletion win over the destination edit.' : 'Removed on the source since last sync.' };
      case 'deleteSource':
        return isSource
          ? { action: 'Delete from source', size: formatBytes(sourceBytes), state: 'Delete', tone: 'delete', note: file.conflict ? 'Destination precedence makes the destination-side deletion win over the source edit.' : 'Removed on the destination since last sync.' }
          : { action: 'Removed here', size: '-', state: 'Removed', tone: 'delete' };
      case 'keepBoth':
        return { action: 'Keep both versions', size: formatSizeTransition(sourceBytes, targetBytes), state: 'Conflict', tone: 'issue', note: 'Both sides changed since last sync; both versions are kept.' };
      default:
        return { action: file.label || 'Two-way action', size: formatBytes(isSource ? sourceBytes : targetBytes), state: 'Two-way' };
    }
  }

  function previewFolderTone(folder) {
    if (folder.issues || folder.conflicts) return 'issue';
    if (folder.destinationOnly) return 'delete';
    if (folder.changed) return 'changed';
    if (folder.newFiles) return 'new';
    return 'copy';
  }

  function previewActionClass(action) {
    if (action === 'copy-new') return 'new';
    if (action === 'update-archive') return 'changed';
    if (action === 'extra') return 'delete';
    if (action === 'conflict') return 'issue';
    if (action === 'skip-older-source') return 'issue';
    if (action === 'unchanged') return 'unchanged';
    return 'copy';
  }

  window.SyncarrPreviewFormat = {
    previewSidePathLabel,
    joinPreviewDisplayPath,
    compactPreviewPath,
    previewFileSize,
    formatSizeTransition,
    twoWaySideMeta,
    previewFolderTone,
    previewActionClass
  };
})();
