// Shared per-direction (dirs/files/bytes) line-total helpers used by both sync
// engines. The totals skeleton and the accumulator are identical across
// Robocopy and rsync, so they live here once to keep the two engines'
// summary shapes in lockstep. Each engine keeps its own thin wrapper
// (emptyRobocopyLineTotals / emptyRsyncLineTotals, etc.) so its public exports
// and the engine-specific aggregate functions stay unchanged.

function emptyLineTotals() {
  return {
    total: 0,
    copied: 0,
    skipped: 0,
    mismatch: 0,
    failed: 0,
    extras: 0
  };
}

// Mutates `target` in place by adding `source`'s counts. No-op when `source`
// is falsy (matches the engines' previous behavior). Callers ignore the return.
function addLineTotals(target, source) {
  if (!source) return;
  for (const key of ['total', 'copied', 'skipped', 'mismatch', 'failed', 'extras']) {
    target[key] += Number(source[key] || 0);
  }
}

module.exports = { emptyLineTotals, addLineTotals };
