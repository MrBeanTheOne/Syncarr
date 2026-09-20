// Pure two-way reconciliation planner.
//
// Given the current files on both sides plus the last-synced baseline (from
// two-way-state.js), decide what should happen to each path: copy one way,
// delete one way, flag a conflict, or do nothing. This module performs NO I/O
// and touches no files — it is the decision brain that the two-way executor and
// the compare preview will consume. Keeping it pure makes every reconciliation
// rule exhaustively unit-testable, exactly like robocopy-dryrun-parser.js.
//
// Three-way reconciliation: for each relative path we hold three observations —
// the baseline (what was recorded at the last successful sync), source-now, and
// dest-now — and ask "what changed on each side since the baseline?".
//
//   sourceVsBase | destVsBase            -> action
//   -------------+----------------------------------------------------
//   changed      | unchanged             copy source -> dest
//   unchanged    | changed               copy dest   -> source
//   changed      | changed (same bytes)  converged, refresh baseline
//   changed      | changed (different)   conflict -> policy
//   deleted      | unchanged             delete dest   (archive first)
//   unchanged    | deleted               delete source (archive first)
//   deleted      | changed               delete-vs-edit conflict -> policy
//   new (no base)| absent                copy source -> dest
//   absent       | new (no base)         copy dest   -> source
//   deleted      | deleted               drop from baseline
//
// Inputs
//   sourceFiles / destFiles : arrays of file entries. Each entry needs a
//     `relativePath` plus size + mtimeMs, supplied either directly
//     ({ relativePath, size, mtimeMs, sha1? }) or via an fs.Stats-like object
//     ({ relativePath, stats: { size, mtimeMs }, sha1? }). This matches what
//     collectSourceFiles() already produces.
//   baseline : the last-synced state — an array of records from
//     TwoWayState.listRecords(), a Map, or a plain object keyed by path. Each
//     record carries `source` and `destination` observations as captured when
//     the path was last synced.
//   policy : conflict resolution — 'newer' (default), 'source', 'dest',
//     or 'keepBoth'.
//   toleranceMs : timestamp slop for metadata comparison (default 2100 — the
//     same FAT/SMB tolerance the one-way planner uses in shouldSourceReplaceTarget).
//
// Clock caveat (audit M4): the 'newer' policy compares raw mtimes across two
// hosts, so it is only as good as the client/NAS clock agreement. Skew inside
// toleranceMs resolves to a tie (keep-both — both versions survive). Skew
// beyond it can pick the wrong winner, but the executor archives every file
// before overwriting, so the losing version is always recoverable from
// history. 'newer'-policy resolutions carry `mtimeDeltaMs` so the preview and
// journal show how close the call was.
//
// Output: action buckets (copyToDest, copyToSource, deleteOnDest,
// deleteOnSource, keepBoth), plus `conflicts` (entries that needed a policy
// decision — these ALSO appear in whichever action bucket they resolved into,
// so an executor can simply walk the action buckets while the UI highlights
// `conflicts` separately), `unchanged` (no file op; `baselineUpdate:true` means
// the store should be refreshed/seeded), `dropFromBaseline` (paths to forget),
// and a `summary` of counts.
//
// Safety contract: a path is NEVER deleted unless it exists in the baseline
// (i.e. it was previously synced) AND the surviving side is unchanged versus
// that baseline. A file with no baseline is treated as new and copied — never
// deleted. This is the guard that stops two-way sync from destroying data.

'use strict';

const { normalizeRelativePath } = require('./two-way-state');
// Reuse the authoritative policy set from job-model so the planner and the
// job validator can never drift apart on which policies are valid.
const { TWO_WAY_CONFLICT_POLICIES, FILE_MTIME_TOLERANCE_MS } = require('./job-model');

const DEFAULT_TOLERANCE_MS = FILE_MTIME_TOLERANCE_MS;

// Normalize any accepted file/observation shape into { size, mtimeMs, sha1 }.
function toObservation(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const stats = entry.stats && typeof entry.stats === 'object' ? entry.stats : entry;
  const size = Number(stats.size);
  const mtimeMs = Number(stats.mtimeMs);
  if (!Number.isFinite(size) || !Number.isFinite(mtimeMs)) return null;
  const sha1 = (typeof entry.sha1 === 'string' && entry.sha1)
    ? entry.sha1
    : (typeof stats.sha1 === 'string' && stats.sha1 ? stats.sha1 : null);
  return { size, mtimeMs, sha1 };
}

function indexFiles(files) {
  const map = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    if (!file) continue;
    const key = normalizeRelativePath(file.relativePath);
    if (!key) continue;
    const obs = toObservation(file);
    if (obs) map.set(key, obs);
  }
  return map;
}

function indexBaseline(baseline) {
  const map = new Map();
  let records = [];
  if (Array.isArray(baseline)) {
    records = baseline;
  } else if (baseline instanceof Map) {
    records = [...baseline.entries()].map(([path, rec]) => ({ path, ...(rec || {}) }));
  } else if (baseline && typeof baseline === 'object') {
    records = Object.entries(baseline).map(([path, rec]) => ({ path, ...(rec || {}) }));
  }

  for (const rec of records) {
    if (!rec) continue;
    const key = normalizeRelativePath(rec.path || rec.relativePath);
    if (!key) continue;
    map.set(key, {
      source: toObservation(rec.source),
      destination: toObservation(rec.destination)
    });
  }
  return map;
}

// Content equality: prefer sha1 when both sides have it; otherwise fall back to
// size plus mtime-within-tolerance (metadata-only identity).
function sameContent(a, b, toleranceMs = DEFAULT_TOLERANCE_MS) {
  if (!a || !b) return false;
  if (a.sha1 && b.sha1) return a.sha1 === b.sha1;
  return a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) <= toleranceMs;
}

// Which side is newer by mtime: 'source' | 'dest' | 'tie' (within tolerance).
function newerSide(source, destination, toleranceMs) {
  const diff = source.mtimeMs - destination.mtimeMs;
  if (Math.abs(diff) <= toleranceMs) return 'tie';
  return diff > 0 ? 'source' : 'dest';
}

function buildTwoWayPlan({
  sourceFiles,
  destFiles,
  baseline,
  policy = 'newer',
  toleranceMs = DEFAULT_TOLERANCE_MS
} = {}) {
  const cleanPolicy = TWO_WAY_CONFLICT_POLICIES.has(policy) ? policy : 'newer';
  const tolerance = Number.isFinite(toleranceMs) && toleranceMs >= 0 ? toleranceMs : DEFAULT_TOLERANCE_MS;

  const source = indexFiles(sourceFiles);
  const dest = indexFiles(destFiles);
  const base = indexBaseline(baseline);

  const result = {
    policy: cleanPolicy,
    copyToDest: [],
    copyToSource: [],
    deleteOnDest: [],
    deleteOnSource: [],
    keepBoth: [],
    conflicts: [],
    unchanged: [],
    dropFromBaseline: []
  };

  const allPaths = new Set([...source.keys(), ...dest.keys(), ...base.keys()]);

  for (const relativePath of allPaths) {
    const S = source.get(relativePath) || null;
    const D = dest.get(relativePath) || null;
    const B = base.get(relativePath) || null;

    const makeEntry = (extra) => ({
      relativePath,
      source: S,
      destination: D,
      baseline: B,
      conflict: false,
      baselineUpdate: false,
      ...extra
    });

    const intoCopyToDest = (e) => { result.copyToDest.push(e); if (e.conflict) result.conflicts.push(e); };
    const intoCopyToSource = (e) => { result.copyToSource.push(e); if (e.conflict) result.conflicts.push(e); };
    const intoDeleteOnDest = (e) => { result.deleteOnDest.push(e); if (e.conflict) result.conflicts.push(e); };
    const intoDeleteOnSource = (e) => { result.deleteOnSource.push(e); if (e.conflict) result.conflicts.push(e); };
    const intoKeepBoth = (e) => { result.keepBoth.push(e); if (e.conflict) result.conflicts.push(e); };

    // Both sides changed (or first-run divergence): one ambiguous file, two
    // candidate versions. Resolve by policy.
    const resolveDivergence = (reasonPrefix) => {
      if (cleanPolicy === 'source') {
        intoCopyToDest(makeEntry({ reason: `${reasonPrefix}-source-wins`, conflict: true, baselineUpdate: true }));
      } else if (cleanPolicy === 'dest') {
        intoCopyToSource(makeEntry({ reason: `${reasonPrefix}-dest-wins`, conflict: true, baselineUpdate: true }));
      } else if (cleanPolicy === 'keepBoth') {
        intoKeepBoth(makeEntry({ reason: `${reasonPrefix}-keep-both`, conflict: true, baselineUpdate: true }));
      } else {
        const winner = newerSide(S, D, tolerance);
        // Stamp how far apart the mtimes were: a small margin means the
        // outcome may have been decided by clock skew rather than a real
        // edit order (audit M4) — surfaced in previews and the run journal.
        const mtimeDeltaMs = S && D ? Math.abs(S.mtimeMs - D.mtimeMs) : null;
        if (winner === 'source') intoCopyToDest(makeEntry({ reason: `${reasonPrefix}-newer-source`, conflict: true, baselineUpdate: true, mtimeDeltaMs }));
        else if (winner === 'dest') intoCopyToSource(makeEntry({ reason: `${reasonPrefix}-newer-dest`, conflict: true, baselineUpdate: true, mtimeDeltaMs }));
        else intoKeepBoth(makeEntry({ reason: `${reasonPrefix}-tie-keep-both`, conflict: true, baselineUpdate: true, mtimeDeltaMs }));
      }
    };

    // Present on both sides.
    if (S && D) {
      if (!B) {
        if (sameContent(S, D, tolerance)) {
          result.unchanged.push(makeEntry({ reason: 'first-run-equal', baselineUpdate: true }));
        } else {
          resolveDivergence('first-run-diff');
        }
        continue;
      }

      const sChanged = !sameContent(S, B.source, tolerance);
      const dChanged = !sameContent(D, B.destination, tolerance);

      if (!sChanged && !dChanged) {
        result.unchanged.push(makeEntry({ reason: 'unchanged' }));
      } else if (sChanged && !dChanged) {
        intoCopyToDest(makeEntry({ reason: 'source-modified', baselineUpdate: true }));
      } else if (!sChanged && dChanged) {
        intoCopyToSource(makeEntry({ reason: 'dest-modified', baselineUpdate: true }));
      } else if (sameContent(S, D, tolerance)) {
        result.unchanged.push(makeEntry({ reason: 'converged', baselineUpdate: true }));
      } else {
        resolveDivergence('both-modified');
      }
      continue;
    }

    // Source only.
    if (S && !D) {
      if (!B) {
        intoCopyToDest(makeEntry({ reason: 'source-new', baselineUpdate: true }));
        continue;
      }
      const sChanged = !sameContent(S, B.source, tolerance);
      if (!sChanged) {
        // Dest was deleted out-of-band; source untouched since baseline. Safe to
        // propagate the deletion. (Executor deletes source, then forgets it.)
        intoDeleteOnSource(makeEntry({ reason: 'dest-deleted' }));
      } else if (cleanPolicy === 'dest') {
        intoDeleteOnSource(makeEntry({ reason: 'conflict-delete-dest-wins', conflict: true }));
      } else {
        // newer / source / keepBoth: an explicit edit beats a deletion — resurrect.
        intoCopyToDest(makeEntry({ reason: 'conflict-source-edit-vs-dest-delete', conflict: true, baselineUpdate: true }));
      }
      continue;
    }

    // Dest only.
    if (!S && D) {
      if (!B) {
        intoCopyToSource(makeEntry({ reason: 'dest-new', baselineUpdate: true }));
        continue;
      }
      const dChanged = !sameContent(D, B.destination, tolerance);
      if (!dChanged) {
        intoDeleteOnDest(makeEntry({ reason: 'source-deleted' }));
      } else if (cleanPolicy === 'source') {
        intoDeleteOnDest(makeEntry({ reason: 'conflict-delete-source-wins', conflict: true }));
      } else {
        intoCopyToSource(makeEntry({ reason: 'conflict-dest-edit-vs-source-delete', conflict: true, baselineUpdate: true }));
      }
      continue;
    }

    // Absent on both sides: nothing to sync; forget any stale baseline.
    if (B) result.dropFromBaseline.push(relativePath);
  }

  result.summary = {
    copyToDest: result.copyToDest.length,
    copyToSource: result.copyToSource.length,
    deleteOnDest: result.deleteOnDest.length,
    deleteOnSource: result.deleteOnSource.length,
    keepBoth: result.keepBoth.length,
    conflicts: result.conflicts.length,
    unchanged: result.unchanged.length,
    dropFromBaseline: result.dropFromBaseline.length
  };

  return result;
}

module.exports = {
  buildTwoWayPlan,
  // Exported for reuse + direct unit tests.
  sameContent,
  DEFAULT_TOLERANCE_MS
};
