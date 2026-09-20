// Root allow-list for privileged filesystem IPC (H12).
//
// The main process must not trust a renderer-supplied ABSOLUTE root for a
// privileged write/copy/delete: a compromised renderer could otherwise point a
// restore/delete at any path. resolveInside() only constrains the RELATIVE part
// against a root — the ROOT itself comes from the IPC request. This module
// answers "is this root one the app is configured to operate on?": a configured
// job source or destination (or a subpath of one).
//
// Note: ad-hoc "Other target"/restore-to-folder destinations are intentionally
// NOT gated by callers — those are first-class user-typed/-picked write
// locations, and a typed path can't be trust-granted. Those writes stay safe via
// resolveInside() containment plus a gated (configured) archive source.
//
// Pure except for the injected readConfig.

const path = require('path');
const { isPathInside } = require('./fs-utils');

// Resolve + case-fold (win32) so comparisons are canonical. UNC and mapped-drive
// paths resolve to themselves, which is what we want.
function normalizeRoot(inputPath) {
  const clean = String(inputPath || '').trim();
  if (!clean) return '';
  const resolved = path.resolve(clean);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function createPathAllowlist({ readConfig } = {}) {
  if (typeof readConfig !== 'function') {
    throw new Error('createPathAllowlist requires a readConfig function.');
  }

  async function collectConfiguredRoots() {
    let config = {};
    try { config = (await readConfig()) || {}; } catch { config = {}; }
    const roots = new Set();
    const add = (p) => { const n = normalizeRoot(p); if (n) roots.add(n); };
    for (const job of Array.isArray(config.jobs) ? config.jobs : []) {
      if (!job) continue;
      for (const source of Array.isArray(job.sourcePaths) ? job.sourcePaths : []) add(source);
      if (job.sourcePath) add(job.sourcePath);
      for (const dest of Array.isArray(job.targetDestinations) ? job.targetDestinations : []) add(dest && dest.path);
      if (job.targetPath) add(job.targetPath);
    }
    return roots;
  }

  async function isRootAllowed(root) {
    const candidate = normalizeRoot(root);
    if (!candidate) return false;
    const allowed = await collectConfiguredRoots();
    // A candidate equal to OR nested inside a configured root passes (a restore
    // lands under a configured source/destination); the reverse (a parent of a
    // configured root) does not.
    return [...allowed].some((allowedRoot) => isPathInside(allowedRoot, candidate));
  }

  async function assertRootAllowed(root, label = 'path') {
    if (!(await isRootAllowed(root))) {
      throw new Error(`${label} "${String(root || '').trim()}" is not an allowed location: it is not a configured source or destination.`);
    }
  }

  return { isRootAllowed, assertRootAllowed, collectConfiguredRoots };
}

module.exports = { createPathAllowlist, normalizeRoot };
