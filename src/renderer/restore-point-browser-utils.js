(() => {
  'use strict';

  const utils = window.SyncarrRendererUtils || {};
  const escapeHtml = utils.escapeHtml || ((value) => String(value ?? ''));
  const escapeAttr = utils.escapeAttr || escapeHtml;
  const formatNumber = utils.formatNumber || ((value) => String(value || 0));
  const formatBytes = utils.formatBytes || ((value) => `${value || 0} B`);
  const formatDate = utils.formatDate || ((value) => value || '-');
  const fileKindLabel = utils.fileKindLabel || (() => 'File');
  const renderFileIcon = utils.renderFileIcon || (() => '');
  const renderFolderIcon = utils.renderFolderIcon || (() => '');

  const DEST_PREFIX = 'dest:';

  function normalizeRel(input) {
    return String(input || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/g, '');
  }

  function baseName(input) {
    const normalized = normalizeRel(input);
    if (!normalized) return '';
    return normalized.split('/').filter(Boolean).pop() || normalized;
  }

  function parseCwd(cwd) {
    const value = String(cwd || '');
    if (!value.startsWith(DEST_PREFIX)) return { destinationIndex: null, relativeDir: '' };
    const rest = value.slice(DEST_PREFIX.length);
    const slash = rest.indexOf('/');
    const indexText = slash === -1 ? rest : rest.slice(0, slash);
    const destinationIndex = Number(indexText);
    return {
      destinationIndex: Number.isFinite(destinationIndex) ? destinationIndex : null,
      relativeDir: slash === -1 ? '' : normalizeRel(rest.slice(slash + 1))
    };
  }

  function makeCwd(destinationIndex, relativeDir = '') {
    const cleanDir = normalizeRel(relativeDir);
    return `${DEST_PREFIX}${destinationIndex}${cleanDir ? `/${cleanDir}` : ''}`;
  }

  function getDestinations(manifest) {
    return Array.isArray(manifest && manifest.destinations) ? manifest.destinations : [];
  }

  function destinationAt(manifest, index) {
    const destinations = getDestinations(manifest);
    return Number.isFinite(index) && index >= 0 ? destinations[index] || null : null;
  }

  function buildEntries(manifest, cwd) {
    const destinations = getDestinations(manifest);
    const parsed = parseCwd(cwd);

    if (parsed.destinationIndex === null) {
      return {
        mode: 'destinations',
        folders: destinations.map((destination, index) => {
          const summary = destination && destination.summary ? destination.summary : {};
          return {
            name: destination && destination.label || `Destination ${index + 1}`,
            path: makeCwd(index),
            count: Number(destination && destination.filesTotal || summary.filesTotal || 0),
            size: Number(summary.bytesTotal || 0),
            meta: destination && destination.path || '',
            required: destination && destination.required !== false
          };
        }),
        files: []
      };
    }

    const destination = destinationAt(manifest, parsed.destinationIndex);
    const files = Array.isArray(destination && destination.files) ? destination.files : [];
    const prefix = parsed.relativeDir ? `${parsed.relativeDir}/` : '';
    const folderMap = new Map();
    const fileRows = [];

    for (const file of files) {
      const relPath = normalizeRel(file && file.relativePath);
      if (!relPath) continue;
      if (prefix && !relPath.startsWith(prefix)) continue;
      const rest = relPath.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf('/');
      if (slash === -1) {
        fileRows.push({
          name: rest,
          relativePath: relPath,
          modifiedAt: file.modifiedAt || null,
          size: Number(file.size || 0),
          status: file.statusAtRestorePoint || 'present',
          livePath: file.livePath || ''
        });
      } else {
        const folderName = rest.slice(0, slash);
        const existing = folderMap.get(folderName) || { count: 0, size: 0 };
        existing.count += 1;
        existing.size += Number(file && file.size || 0);
        folderMap.set(folderName, existing);
      }
    }

    return {
      mode: 'files',
      destination,
      destinationIndex: parsed.destinationIndex,
      relativeDir: parsed.relativeDir,
      folders: [...folderMap.entries()].map(([name, summary]) => ({
        name,
        path: makeCwd(parsed.destinationIndex, parsed.relativeDir ? `${parsed.relativeDir}/${name}` : name),
        count: summary.count,
        size: summary.size,
        meta: parsed.relativeDir ? `${parsed.relativeDir}/${name}` : name
      })).sort((a, b) => a.name.localeCompare(b.name)),
      files: fileRows.sort((a, b) => a.name.localeCompare(b.name))
    };
  }

  function renderBreadcrumb(manifest, cwd) {
    const parsed = parseCwd(cwd);
    const crumbs = [`<button data-restore-point-crumb="" type="button"${parsed.destinationIndex === null ? ' class="current"' : ''}>Restore point</button>`];
    if (parsed.destinationIndex === null) return crumbs.join('');

    const destination = destinationAt(manifest, parsed.destinationIndex);
    const destinationLabel = destination && destination.label || `Destination ${parsed.destinationIndex + 1}`;
    crumbs.push('<span class="sep">/</span>');
    crumbs.push(`<button data-restore-point-crumb="${escapeAttr(makeCwd(parsed.destinationIndex))}" type="button"${parsed.relativeDir ? '' : ' class="current"'}>${escapeHtml(destinationLabel)}</button>`);

    let acc = '';
    const parts = parsed.relativeDir ? parsed.relativeDir.split('/').filter(Boolean) : [];
    parts.forEach((part, index) => {
      acc = acc ? `${acc}/${part}` : part;
      const isLast = index === parts.length - 1;
      crumbs.push('<span class="sep">/</span>');
      crumbs.push(`<button data-restore-point-crumb="${escapeAttr(makeCwd(parsed.destinationIndex, acc))}" type="button"${isLast ? ' class="current"' : ''}>${escapeHtml(part)}</button>`);
    });

    return crumbs.join('');
  }

  function renderBrowserHead(entries) {
    return `
      <div class="history-browser-head restore-point-file-head">
        <span>${entries && entries.mode === 'destinations' ? 'Destination' : 'Name'}</span>
        <span>Modified</span>
        <span>Size</span>
        <span>Status</span>
      </div>
    `;
  }

  function renderBrowser(manifest, cwd, options = {}) {
    const entries = buildEntries(manifest, cwd);
    const selectedFilePath = normalizeRel(options.selectedFilePath);
    const rows = [renderBrowserHead(entries)];

    entries.folders.forEach((folder) => {
      rows.push(`
        <button class="history-entry folder restore-point-folder" data-restore-point-folder="${escapeAttr(folder.path)}" type="button">
          <span class="entry-name">
            ${renderFolderIcon()}
            <span class="entry-main"><strong>${escapeHtml(folder.name)}</strong><small>${entries.mode === 'destinations' ? escapeHtml(folder.meta || '') : 'Folder'}</small></span>
          </span>
          <span class="entry-meta">${entries.mode === 'destinations' ? (folder.required ? 'Required' : 'Optional') : 'Folder'}</span>
          <span class="entry-meta mono">${escapeHtml(formatBytes(folder.size || 0))}</span>
          <span class="entry-status"><span class="mini-pill">${escapeHtml(formatNumber(folder.count || 0))} file(s)</span><span class="entry-arrow">›</span></span>
        </button>
      `);
    });

    entries.files.forEach((file) => {
      rows.push(`
        <button class="history-entry file restore-point-file${selectedFilePath && normalizeRel(file.relativePath).toLowerCase() === selectedFilePath.toLowerCase() ? ' selected' : ''}" data-restore-point-file="${escapeAttr(file.relativePath)}" type="button">
          <span class="entry-name">
            ${renderFileIcon(file.relativePath)}
            <span class="entry-main"><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(fileKindLabel(file.relativePath))}</small></span>
          </span>
          <span class="entry-meta">${escapeHtml(formatDate(file.modifiedAt))}</span>
          <span class="entry-meta mono">${escapeHtml(formatBytes(file.size || 0))}</span>
          <span class="entry-status"><span class="mini-pill">${escapeHtml(file.status || 'Present')}</span><span class="entry-arrow">›</span></span>
        </button>
      `);
    });

    if (rows.length > 1) return rows.join('');
    const emptyMessage = entries && entries.mode === 'destinations'
      ? 'This restore point has no destination snapshots in the manifest.'
      : 'This restore-point folder has no files in the loaded manifest. If the restore point summary shows files, refresh and reselect the restore point.';
    return renderBrowserHead(entries) + `<div class="history-empty">${escapeHtml(emptyMessage)}</div>`;
  }

  function describeCwd(manifest, cwd) {
    const parsed = parseCwd(cwd);
    if (parsed.destinationIndex === null) return 'Destination snapshots';
    const destination = destinationAt(manifest, parsed.destinationIndex);
    const destinationPath = destination && destination.path || 'Destination';
    return parsed.relativeDir ? `${destinationPath}/${parsed.relativeDir}` : destinationPath;
  }

  window.SyncarrRestorePointBrowserUtils = {
    normalizeRel,
    baseName,
    parseCwd,
    makeCwd,
    buildEntries,
    renderBreadcrumb,
    renderBrowser,
    describeCwd
  };
})();
