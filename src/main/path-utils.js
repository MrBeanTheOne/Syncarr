// Shared path / relative-path helpers used by both the main process and the
// robocopy dry-run parser. Keeping these tiny utilities in one place avoids
// circular imports between `main.js` and `sync-engines/robocopy-dryrun-parser.js`.

const path = require('path');

/**
 * Normalize a path string into the form Syncarr stores in manifests:
 * forward slashes, no leading slash, case preserved (case rules are host-specific
 * and are applied at comparison time, not at normalization time).
 *
 * @param {unknown} input
 * @returns {string}
 */
function normalizeRelativeForManifest(input) {
  return String(input || '').replace(/[\\/]+/g, '/').replace(/^\/+/, '');
}

/**
 * Normalize a path for path-identity comparison (case-insensitive on Windows,
 * case-sensitive elsewhere; separators collapsed to the host's separator).
 *
 * @param {unknown} input
 * @returns {string}
 */
function normalizePathForCompare(input) {
  return String(input || '').replace(/[\/]+$/g, '').toLowerCase();
}

module.exports = {
  normalizeRelativeForManifest,
  normalizePathForCompare
};
