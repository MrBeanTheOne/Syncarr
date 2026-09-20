function getAutomaticPreviewSummary(preview) {
  if (!preview || typeof preview !== 'object') return null;
  return preview.history || (preview.preview && preview.preview.summary) || preview.summary || null;
}

function getAutomaticPreviewFailure(preview, label = 'Automatic', { requireStorageCheck = false, allowResolvedConflicts = false, mode = '' } = {}) {
  if (!preview || preview.ok !== true) {
    return {
      ok: false,
      status: 'preview-failed',
      message: preview && preview.message ? preview.message : `${label} preview failed.`,
      code: null
    };
  }

  const summary = getAutomaticPreviewSummary(preview);

  // Mirror safety: an empty source scan marks every destination file as a delete
  // candidate, so applying it would wipe the destination. buildSyncPreview
  // already blocks a missing/unreadable source, but a source folder that EXISTS
  // yet enumerates to zero files (a cloud-placeholder folder that momentarily
  // reads empty, a drive mid-remount, a path emptied by mistake) slips through
  // as a clean "delete everything" plan. The manual path gates this behind the
  // "Apply Mirror plan?" confirmation; the automatic path has no human in the
  // loop, so never auto-apply a whole-destination delete driven by an empty
  // source.
  if (mode === 'mirror' && summary) {
    // Key on the SOURCE-side file count, not `scanned`: `scanned`/`previewFiles`
    // also count destination-only extras, so they are never 0 when there are
    // deletes — the exact case this guard exists to catch. Require the count to
    // be a known number so a summary that never tracked it can't false-block.
    const sourceFiles = summary.sourceFiles;
    const deleteCandidates = Number(summary.destinationOnly || 0);
    if (typeof sourceFiles === 'number' && sourceFiles === 0 && deleteCandidates > 0) {
      return {
        ok: false,
        status: 'empty-source-mirror',
        message: `${label} mirror sync skipped: the source scan found no files, so applying it would delete all ${deleteCandidates} destination file(s). Check that the source folder is available and populated.`,
        code: null,
        summary
      };
    }
  }
  const conflictPolicy = summary && String(summary.conflictPolicy || 'newer');
  const conflictsAreExplicitlyResolved = allowResolvedConflicts && ['source', 'dest', 'keepBoth'].includes(conflictPolicy);
  if (summary && Number(summary.conflicts || 0) > 0 && !conflictsAreExplicitlyResolved) {
    return {
      ok: false,
      status: 'conflicts',
      message: `${label} sync skipped because the preview contains conflicts.`,
      code: null,
      summary
    };
  }

  if (requireStorageCheck && (!preview.storage || preview.storage.checked !== true)) {
    return {
      ok: false,
      status: 'space-unchecked',
      message: `${label} sync skipped because free-space preflight could not be completed.`,
      code: null,
      storage: preview.storage || null
    };
  }

  if (preview.storage && preview.storage.checked && !preview.storage.enoughSpace) {
    return {
      ok: false,
      status: 'space',
      message: preview.storage.message || `${label} sync skipped because free space is low.`,
      code: null,
      storage: preview.storage
    };
  }

  return null;
}

module.exports = {
  getAutomaticPreviewSummary,
  getAutomaticPreviewFailure
};
