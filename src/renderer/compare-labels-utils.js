(() => {
  'use strict';

  // Pure compare/run-overlay label dictionaries keyed by sync mode. normalizeSyncMode
  // is injected by app.js (configure) so this module does not depend on the
  // job-model mirror's load order; the default passes the value through, which is
  // correct for the canonical mode strings ('mirror'/'twoWay'/'compare').
  let normalizeSyncMode = (value) => String(value || '');

  function configure(deps) {
    if (deps && typeof deps.normalizeSyncMode === 'function') normalizeSyncMode = deps.normalizeSyncMode;
  }

  function isMirrorMode(mode) {
    return normalizeSyncMode(mode) === 'mirror';
  }

  function getDestinationOnlyHelp(mode) {
    return isMirrorMode(mode) ? 'Will be archived, then deleted' : 'Left untouched by one-way sync';
  }

  function getDestinationOnlyState(mode) {
    return isMirrorMode(mode) ? 'Delete candidate' : 'Left untouched';
  }

  function getCompareModeLabels(mode) {
    const clean = normalizeSyncMode(mode);
    if (clean === 'mirror') {
      return {
        flow: 'mirror',
        sourceTitle: 'Mirror source',
        destinationTitle: 'Mirror destination',
        latestIdle: 'Building mirror plan...',
        newLabel: 'Copy to destination',
        newSub: 'Missing/new files',
        changedLabel: 'Replace/update',
        changedSub: 'Destination will match source',
        archiveLabel: 'Archive first',
        archiveSub: 'Before overwrite/delete',
        issueLabel: 'Blocked',
        issueSub: 'Conflicts or issues',
        extraLabel: 'Delete candidates',
        extraSub: 'Destination-only files'
      };
    }
    if (clean === 'twoWay') {
      return {
        flow: 'two-way',
        sourceTitle: 'Source side',
        destinationTitle: 'Destination side',
        latestIdle: 'Building two-way planning view...',
        newLabel: 'Source-only',
        newSub: 'Needs sync direction',
        changedLabel: 'Changed',
        changedSub: 'Needs conflict check',
        archiveLabel: 'Protection',
        archiveSub: 'Possible archived versions',
        issueLabel: 'Conflicts',
        issueSub: 'Needs manual decision',
        extraLabel: 'Destination-only',
        extraSub: 'Needs sync direction'
      };
    }
    return {
      flow: 'compare',
      sourceTitle: 'Source side',
      destinationTitle: 'Destination side',
      latestIdle: 'Building compare plan...',
      newLabel: 'New files',
      newSub: 'Will be copied',
      changedLabel: 'Changed files',
      changedSub: 'Will replace destination',
      archiveLabel: 'Archive plan',
      archiveSub: 'Before overwrite',
      issueLabel: 'Issues',
      issueSub: 'Conflicts or blocked files',
      extraLabel: 'Destination-only',
      extraSub: 'Left untouched by one-way'
    };
  }

  window.SyncarrCompareLabels = {
    configure,
    isMirrorMode,
    getDestinationOnlyHelp,
    getDestinationOnlyState,
    getCompareModeLabels
  };
})();
