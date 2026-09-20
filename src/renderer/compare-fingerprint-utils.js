(() => {
  'use strict';

  // makeCompareFingerprint output is PERSISTED in config.pendingCompares and
  // compared on reload to decide whether a saved Compare is still fresh, so its
  // field set and serialized form must stay byte-identical. The job-model
  // normalizers and DEFAULT_EXCLUDE_PATTERNS are injected via configure so
  // production uses the SAME functions as before the extraction; the defaults
  // are safe standalone fallbacks for tests / before configure() runs.
  let normalizeSyncMode = (value) => String(value || 'oneWay');
  let normalizeTwoWayConflictPolicy = (value) => String(value || 'newest');
  let normalizeSourcePaths = (input) => (Array.isArray(input) ? input : (input ? [input] : [])).filter(Boolean);
  let normalizeTargetDestinations = (input, fallback = '') => (Array.isArray(input) && input.length ? input : (fallback ? [{ path: fallback, required: true }] : []));
  let defaultExcludePatterns = [];

  function configure(deps) {
    if (!deps) return;
    if (typeof deps.normalizeSyncMode === 'function') normalizeSyncMode = deps.normalizeSyncMode;
    if (typeof deps.normalizeTwoWayConflictPolicy === 'function') normalizeTwoWayConflictPolicy = deps.normalizeTwoWayConflictPolicy;
    if (typeof deps.normalizeSourcePaths === 'function') normalizeSourcePaths = deps.normalizeSourcePaths;
    if (typeof deps.normalizeTargetDestinations === 'function') normalizeTargetDestinations = deps.normalizeTargetDestinations;
    if (Array.isArray(deps.defaultExcludePatterns)) defaultExcludePatterns = deps.defaultExcludePatterns;
  }

  function makeCompareFingerprint(job) {
    const cleanMode = normalizeSyncMode(job && job.syncMode);
    const clean = {
      syncMode: cleanMode,
      twoWayConflictPolicy: normalizeTwoWayConflictPolicy(job && job.twoWayConflictPolicy),
      sourcePaths: normalizeSourcePaths(job && (job.sourcePaths && job.sourcePaths.length ? job.sourcePaths : job.sourcePath)),
      targetPath: String((job && job.targetPath) || '').trim(),
      targetDestinations: normalizeTargetDestinations(job && job.targetDestinations, job && job.targetPath).map((destination) => ({ path: destination.path, required: destination.required !== false })),
      excludePatterns: Array.isArray(job && job.excludePatterns) ? job.excludePatterns : defaultExcludePatterns,
      // Mirror Compare uses /MIR and does not include /XO, so the saved Mirror
      // plan must ignore the one-way "skip older source" checkbox when applying.
      skipOlderSource: cleanMode === 'mirror' ? false : job && job.skipOlderSource !== false,
      copySubfolders: job && job.copySubfolders !== false,
      historyEnabled: job && job.historyEnabled !== false,
      historyFolderName: (job && job.historyFolderName) || '.syncarr-history',
      freeSpaceCheckEnabled: job && job.freeSpaceCheckEnabled !== false,
      minimumFreeGb: Number(job && job.minimumFreeGb) || 0
    };
    return stableStringify(clean);
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  window.SyncarrCompareFingerprint = { configure, makeCompareFingerprint, stableStringify };
})();
