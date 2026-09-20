// Pure filesystem / path / exclude helpers extracted from src/main.js.
//
// Everything here is free of main-process module state. The one function that
// previously closed over the cancellation singleton — collectSourceFiles —
// now takes an injected `throwIfCancelled` hook and a `concurrency` value so
// it stays pure and unit-testable. main.js binds those back in via a thin
// wrapper so call sites (including the two-way `collectFiles` injection) keep
// behaving exactly as before.

// original-fs (via ./real-fs) so `.asar` files in synced app builds are treated
// as regular files, not Electron's virtual directories. This module copies and
// stats USER files (history archiving, source collection), so it must not see
// the asar patch. See real-fs.js.
const fs = require('./real-fs').promises;
const path = require('path');
const { normalizeRelativeForManifest } = require('./path-utils');
const { mapWithConcurrency } = require('./async-utils');
const { FILE_MTIME_TOLERANCE_MS } = require('./job-model');

const DEFAULT_STAT_CONCURRENCY = 16;

async function copyFilePreservingTimes(sourcePath, destinationPath, sourceStats) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);

  try {
    await fs.utimes(destinationPath, sourceStats.atime, sourceStats.mtime);
  } catch {
    // A successful copy is still useful if the destination refuses timestamp updates.
  }
}

async function statFileOrNull(inputPath) {
  const stats = await statAnyOrNull(inputPath);
  return stats && stats.isFile() ? stats : null;
}

async function statAnyOrNull(inputPath) {
  try {
    return await fs.stat(inputPath);
  } catch {
    return null;
  }
}

async function collectSourceFiles({
  sourcePath,
  copySubfolders,
  excludePatterns,
  throwIfCancelled = () => {},
  concurrency = DEFAULT_STAT_CONCURRENCY
}) {
  const shouldExclude = makeExcludeMatcher(excludePatterns);
  const pending = [];

  // Phase 1 — walk the tree with readdir only (no per-file stat), preserving
  // the original depth-first pre-order. This is cheap: one round-trip per
  // directory, not per file.
  async function walk(currentPath, relativeDir) {
    throwIfCancelled();
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      throwIfCancelled();
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      if (shouldExclude(relativePath, entry)) continue;

      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (copySubfolders) await walk(fullPath, relativePath);
        continue;
      }

      if (!entry.isFile()) continue;

      pending.push({ fullPath, relativePath });
    }
  }

  await walk(sourcePath, '');

  // Phase 2 — stat every file with bounded concurrency instead of a serial
  // `await fs.stat` per file. Over SMB to a NAS the serial form paid one full
  // network round-trip per file, which turned a no-change scan of a 22k-file
  // tree into a ~90s wait. mapWithConcurrency preserves input order, so the
  // returned list is identical to the old depth-first ordering.
  return mapWithConcurrency(pending, concurrency, async ({ fullPath, relativePath }) => {
    throwIfCancelled();
    const stats = await fs.stat(fullPath);
    return { fullPath, relativePath, stats };
  });
}

function shouldSourceReplaceTarget(sourceStats, targetStats, skipOlderSource) {
  const timestampToleranceMs = FILE_MTIME_TOLERANCE_MS;
  const sourceTime = sourceStats.mtimeMs;
  const targetTime = targetStats.mtimeMs;

  if (skipOlderSource && sourceTime < targetTime - timestampToleranceMs) {
    return { copy: false, reason: 'older-source' };
  }

  if (sourceStats.size !== targetStats.size) {
    return { copy: true, reason: 'changed-size' };
  }

  if (sourceTime > targetTime + timestampToleranceMs) {
    return { copy: true, reason: 'newer-source' };
  }

  if (!skipOlderSource && sourceTime < targetTime - timestampToleranceMs) {
    return { copy: true, reason: 'older-source-allowed' };
  }

  return { copy: false, reason: 'unchanged' };
}

function fileMetadata(stats) {
  return {
    size: stats.size,
    mtime: stats.mtime.toISOString(),
    mtimeMs: Math.round(stats.mtimeMs),
    birthtime: stats.birthtime.toISOString(),
    birthtimeMs: Math.round(stats.birthtimeMs)
  };
}

function makeExcludeMatcher(patterns) {
  const rules = (patterns || [])
    .map((pattern) => String(pattern || '').trim())
    .filter(Boolean)
    .map((pattern) => {
      const normalized = normalizeRelativeForMatch(pattern);
      return {
        raw: pattern,
        normalized,
        hasWildcard: /[*?]/.test(normalized),
        regex: /[*?]/.test(normalized) ? wildcardToRegExp(normalized) : null,
        isPath: normalized.includes('/')
      };
    });

  return (relativePath) => {
    const normalizedPath = normalizeRelativeForMatch(relativePath);
    const parts = normalizedPath.split('/').filter(Boolean);
    const name = parts[parts.length - 1] || normalizedPath;

    return rules.some((rule) => {
      if (rule.hasWildcard) {
        return rule.regex.test(name) || rule.regex.test(normalizedPath);
      }

      if (rule.isPath) {
        return normalizedPath === rule.normalized || normalizedPath.startsWith(`${rule.normalized}/`);
      }

      return parts.includes(rule.normalized) || name === rule.normalized;
    });
  };
}

function wildcardToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function normalizeRelativeForMatch(input) {
  return String(input || '')
    .replace(/[\\/]+/g, '/')
    .replace(/^\/+/, '')
    .toLowerCase();
}

function assertRelativePath(input, label) {
  const raw = String(input || '');
  const normalized = normalizeRelativeForManifest(raw);
  const segments = normalized.split('/').filter(Boolean);

  if (!normalized || path.isAbsolute(raw) || path.isAbsolute(normalized)) {
    throw new Error(`Invalid ${label}.`);
  }

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Invalid ${label}.`);
  }

  return normalized;
}

function resolveInside(rootPath, relativePath, label) {
  const safeRelativePath = assertRelativePath(relativePath, label);
  const resolvedRoot = path.resolve(rootPath);
  const resolvedPath = path.resolve(resolvedRoot, safeRelativePath);

  if (!isPathInside(resolvedRoot, resolvedPath)) {
    throw new Error(`Invalid ${label}.`);
  }

  return resolvedPath;
}

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathsShareStorageRoot(a, b) {
  const rootA = path.parse(path.resolve(a)).root.toLowerCase();
  const rootB = path.parse(path.resolve(b)).root.toLowerCase();
  return rootA && rootA === rootB;
}

module.exports = {
  copyFilePreservingTimes,
  statFileOrNull,
  statAnyOrNull,
  collectSourceFiles,
  shouldSourceReplaceTarget,
  fileMetadata,
  makeExcludeMatcher,
  wildcardToRegExp,
  normalizeRelativeForMatch,
  assertRelativePath,
  resolveInside,
  isPathInside,
  pathsShareStorageRoot
};
