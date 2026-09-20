(() => {
  'use strict';

  // Pure decoders that turn a sync/compare progress event into a visual action
  // token, a human status line, and a completed-file count. The mirror-mode
  // predicate is injected by app.js (configure) so this module does not depend
  // on the job-model mirror's load order; the default is a safe standalone
  // fallback used by tests and before configure() runs.
  let isMirrorMode = (mode) => String(mode || '').toLowerCase() === 'mirror';

  function configure(deps) {
    if (deps && typeof deps.isMirrorMode === 'function') isMirrorMode = deps.isMirrorMode;
  }

  function getProgressVisualAction(progress, mode, isCompare) {
    const kind = String(progress && progress.kind || '').toLowerCase();
    const label = String(progress && progress.label || '').toLowerCase();
    if (kind === 'cancelled' || kind === 'canceled') return 'warning';
    if (kind === 'failed') return 'error';
    if (kind === 'deleted') return 'delete';
    if (kind === 'extra') return isMirrorMode(mode) ? 'delete' : 'warning';
    if (kind === 'skipped') return 'skip';
    if (kind === 'copied') {
      if (label.includes('newer') || label.includes('changed') || label.includes('tweaked')) return 'replace';
      return 'copy';
    }
    return isCompare ? 'scan' : 'active';
  }

  function getProgressActionStatus(progress, mode, isCompare) {
    const kind = String(progress && progress.kind || '').toLowerCase();
    const label = String(progress && progress.label || '').toLowerCase();
    const latestText = progress && progress.latestText ? String(progress.latestText) : '';
    if ((kind === 'phase' || kind === 'status') && latestText) return latestText;
    if (kind === 'cancelled' || kind === 'canceled') return isCompare ? 'Cancelling compare…' : 'Cancelling sync…';
    if (kind === 'failed') return 'Handling file issue…';
    if (kind === 'deleted') return isCompare ? 'Found delete candidate…' : 'Deleting destination-only file…';
    if (kind === 'extra') {
      if (isCompare) return isMirrorMode(mode) ? 'Found delete candidate…' : 'Found destination-only file…';
      return isMirrorMode(mode) ? 'Deleting destination-only file…' : 'Checking destination-only file…';
    }
    if (kind === 'skipped') return label.includes('older') ? 'Skipping older source file…' : 'Skipping unchanged file…';
    if (kind === 'copied') {
      if (label.includes('new')) return 'Copying new file…';
      if (label.includes('newer') || label.includes('changed') || label.includes('tweaked')) return 'Replacing changed file…';
      return 'Copying file…';
    }
    return isCompare ? 'Scanning source and destination differences…' : 'Processing files…';
  }

  function getProgressFileLine(progress, mode, isCompare) {
    const file = progress && (progress.latestFile || progress.file) ? String(progress.latestFile || progress.file) : '';
    const action = getProgressActionStatus(progress, mode, isCompare).replace(/…$/, '');
    return file ? `${action}: ${file}` : action;
  }

  function getProgressCompletedCount({ copied, extra, failed }, mode) {
    return copied + failed + (isMirrorMode(mode) ? extra : 0);
  }

  window.SyncarrRunProgress = {
    configure,
    getProgressVisualAction,
    getProgressActionStatus,
    getProgressFileLine,
    getProgressCompletedCount
  };
})();
