(() => {
  'use strict';

  // Pure preview data-model: dedupe the actionable file list into a path-keyed
  // map, group entries at a folder depth, and compute action counts. No DOM and
  // no preview state — callers pass the file list / summary / cwd explicitly
  // (getActionablePreviewFiles, the previewState reader, stays in app.js).

  function sanitizePreviewPathPart(input) {
    return String(input || 'Destination')
      .replace(/[\\/]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || 'Destination';
  }

  function buildPreviewFileMap(files) {
    const map = new Map();
    const source = Array.isArray(files) ? files : [];
    const duplicateCounts = new Map();

    for (const file of source) {
      const rawKey = String(file.relativePath || '').replace(/\\/g, '/');
      if (!rawKey) continue;
      let key = rawKey;
      const duplicateIndex = duplicateCounts.get(rawKey.toLowerCase()) || 0;
      duplicateCounts.set(rawKey.toLowerCase(), duplicateIndex + 1);
      if (duplicateIndex > 0) {
        const destination = sanitizePreviewPathPart(file.destinationLabel || file.destinationPath || `Destination ${duplicateIndex + 1}`);
        key = `${destination}/${rawKey}`;
      }
      map.set(key, { ...file, relativePath: key, originalRelativePath: rawKey });
    }
    return map;
  }

  function previewEntriesAt(fileMap, cwd) {
    const prefix = cwd ? `${cwd}/` : '';
    const folders = new Map();
    const files = [];

    for (const [relPath, file] of fileMap) {
      if (prefix && !relPath.startsWith(prefix)) continue;
      const rest = relPath.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf('/');
      if (slash === -1) {
        files.push({ ...file, name: rest });
      } else {
        const folder = rest.slice(0, slash);
        const existing = folders.get(folder) || {
          name: folder,
          relPath: cwd ? `${cwd}/${folder}` : folder,
          count: 0,
          copyBytes: 0,
          archiveBytes: 0,
          conflicts: 0,
          newFiles: 0,
          changed: 0,
          destinationOnly: 0,
          issues: 0
        };
        existing.count += 1;
        existing.copyBytes += Number(file.copyBytes || 0);
        existing.archiveBytes += Number(file.archiveBytes || 0);
        if (file.action === 'copy-new') existing.newFiles += 1;
        if (file.action === 'update-archive') existing.changed += 1;
        if (file.action === 'extra') existing.destinationOnly += 1;
        if (file.action === 'conflict' || file.action === 'skip-older-source') existing.issues += 1;
        if (file.action === 'conflict') existing.conflicts += 1;
        folders.set(folder, existing);
      }
    }

    return { folders, files };
  }

  function summarizePreviewActions(files) {
    return files.reduce((acc, file) => {
      if (file.action === 'copy-new') acc.newFiles += 1;
      if (file.action === 'update-archive') acc.changed += 1;
      if (file.action === 'extra') acc.destinationOnly += 1;
      if (file.action === 'update-archive' || file.action === 'extra') acc.archive += Number(file.archiveBytes || 0) > 0 ? 1 : 0;
      if (file.action === 'conflict' || file.action === 'skip-older-source') acc.issues += 1;
      acc.copyBytes += Number(file.copyBytes || 0);
      acc.archiveBytes += Number(file.archiveBytes || 0);
      return acc;
    }, { newFiles: 0, changed: 0, destinationOnly: 0, issues: 0, archive: 0, copyBytes: 0, archiveBytes: 0 });
  }

  // Authoritative action counts for the preview breakdown cards and the
  // apply-plan confirmation. The in-memory preview file list is capped at
  // PREVIEW_FILE_LIMIT (1000) for storage/IPC reasons, so recounting it
  // undercounts every category once a compare exceeds that cap. The backend
  // summary counts every scanned file, so prefer it and only fall back to the
  // (capped) list when no summary is available — e.g. live progress states
  // before the summary arrives.
  function getPreviewActionCounts(files, summary) {
    if (!summary) {
      const list = Array.isArray(files) ? files : [];
      return summarizePreviewActions(list);
    }
    const newFiles = Number(summary.newFiles || 0);
    const wouldCopy = Number(summary.wouldCopy || 0);
    return {
      newFiles,
      changed: Math.max(0, wouldCopy - newFiles),
      destinationOnly: Number(summary.destinationOnly || 0),
      issues: Number(summary.conflicts || 0) + Number(summary.skippedOlder || 0),
      archive: Number(summary.wouldArchive || 0),
      copyBytes: Number(summary.copyBytes || 0),
      archiveBytes: Number(summary.archiveBytes || 0)
    };
  }

  window.SyncarrPreviewModel = {
    sanitizePreviewPathPart,
    buildPreviewFileMap,
    previewEntriesAt,
    summarizePreviewActions,
    getPreviewActionCounts
  };
})();
