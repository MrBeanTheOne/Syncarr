const { normalizeSyncMode, RUN_STATUS, NO_CHANGE_MESSAGE } = require('./job-model');

function getPlannedSyncActionCounts(summary = {}, syncMode = 'oneWay') {
  const mode = normalizeSyncMode(syncMode);
  const wouldCopy = Number(summary && summary.wouldCopy || 0);
  const destinationOnly = Number(summary && summary.destinationOnly || 0);
  const conflicts = Number(summary && summary.conflicts || 0);
  const archive = Number(summary && summary.wouldArchive || 0);
  const skippedOlder = Number(summary && summary.skippedOlder || 0);
  const unchanged = Number(summary && summary.unchanged || 0);
  const deleteCandidates = mode === 'mirror' ? destinationOnly : 0;

  return {
    mode,
    copyOrUpdate: wouldCopy,
    deleteCandidates,
    conflicts,
    archive,
    skippedOlder,
    unchanged,
    actionable: wouldCopy + deleteCandidates,
    blocked: conflicts
  };
}

// Mirror must overwrite the destination to match the source, so the "never
// overwrite a newer destination" safety rule (Robocopy /XO, rsync -u) is forced
// off in mirror mode; every other mode defaults it on unless explicitly disabled.
function resolveSkipOlderSource(syncMode, skipOlderSource) {
  return normalizeSyncMode(syncMode) === 'mirror' ? false : skipOlderSource !== false;
}

function isNoOpSyncPlan(historyPlan, syncMode = 'oneWay', options = {}) {
  const mode = normalizeSyncMode(syncMode);

  // The planner inventories files, while recursive engines also create and
  // remove empty directories. Always run those engine passes so directory-only
  // changes cannot be mistaken for a no-op.
  if (mode === 'mirror' || options.copySubfolders !== false) return false;

  const counts = getPlannedSyncActionCounts(historyPlan && historyPlan.summary ? historyPlan.summary : {}, mode);
  return counts.actionable === 0 && counts.blocked === 0;
}

// Re-classify an engine run's interpreted status after the fact.
//
// In a non-mirror run, files that exist on the destination but not the source
// are intentionally left untouched. Robocopy still LISTS them (`*EXTRA File`)
// and sets the "extras" bit in its exit code (e.g. exit 2), which
// interpretExitCode maps to a non-fatal 'success'. The result is that every
// compare/sync over a destination that holds extra files reports a completed
// sync that "did work", even though nothing was copied — so repeated runs never
// converge to a quiet "no changes" state.
//
// This helper downgrades such a run to 'no-change' when no real work happened.
// "Real work" is read from the engine-neutral file counts (copied/failed) plus
// the shared summary shape: dirs.copied (so empty-directory creation still
// counts) and mismatch (file/dir name collisions). Mirror mode is never
// downgraded — there, extras are genuine delete actions.
function reconcileNoChangeStatus({ interpreted, fileCounts, summary, syncMode } = {}) {
  if (!interpreted || interpreted.ok !== true || interpreted.status !== RUN_STATUS.SUCCESS) return interpreted;
  if (normalizeSyncMode(syncMode) === 'mirror') return interpreted;

  const counts = fileCounts || {};
  const dirs = (summary && summary.dirs) || {};
  const files = (summary && summary.files) || {};

  const filesCopied = Number(counts.copied || 0);
  const filesFailed = Number(counts.failed || 0);
  const dirsCopied = Number(dirs.copied || 0);
  const dirsFailed = Number(dirs.failed || 0);
  const mismatch = Number(files.mismatch || 0) + Number(dirs.mismatch || 0);

  const didRealWork = filesCopied > 0 || dirsCopied > 0 || filesFailed > 0 || dirsFailed > 0 || mismatch > 0;
  if (didRealWork) return interpreted;

  return { ok: true, status: RUN_STATUS.NO_CHANGE, message: NO_CHANGE_MESSAGE };
}

module.exports = {
  getPlannedSyncActionCounts,
  isNoOpSyncPlan,
  reconcileNoChangeStatus,
  resolveSkipOlderSource
};
