(() => {
  'use strict';

  // Pure: does the saved compare plan contain work the active mode would apply?
  // Destination-only files are excluded in one-way (left untouched) and counted
  // only as delete candidates in mirror; two-way sums its direction fields.
  // summary + mode are passed in by the caller (they read previewState).
  function previewHasActionableWork(summary, mode) {
    if (!summary) return true; // Nothing to reason about -> preserve prior behavior.
    if (mode === 'twoWay') {
      const fields = ['copyToDest', 'copyToSource', 'deleteOnDest', 'deleteOnSource', 'keepBoth', 'conflicts'];
      if (!fields.some((key) => summary[key] !== undefined)) return true;
      return fields.reduce((sum, key) => sum + Number(summary[key] || 0), 0) > 0;
    }
    const wouldCopy = Number(summary.wouldCopy || 0);
    const conflicts = Number(summary.conflicts || 0);
    const deleteCandidates = mode === 'mirror' ? Number(summary.destinationOnly || 0) : 0;
    return (wouldCopy + conflicts + deleteCandidates) > 0;
  }

  window.SyncarrPreviewActionable = { previewHasActionableWork };
})();
