// Two-way sync state store — per (job, destination) pair.
//
// Persists last-seen file observations for both source and destination sides so
// the next sync run can detect cross-side changes (file modified on one side
// only, modified on both = conflict, deleted on one side, etc.).
//
// Storage layout:
//   <userDataPath>/two-way-state/<jobId>/<destinationIndex>/
//     snapshot.json   - compact JSON dump of all records (written periodically)
//     events.ndjson   - append-only log of set/delete/clear events since snapshot
//
// Boot: read snapshot, then replay any events newer than the snapshot's mtime.
// Crash safety: log appends are idempotent on replay; snapshot writes go via a
// .tmp file + rename so a partial snapshot never replaces a good one. A stale
// .tmp file from a prior crash is cleaned up on the next load().

const path = require('node:path');
// original-fs (via ./real-fs) so `.asar` files in synced app builds are treated
// as regular files, not the virtual directories Electron's default fs presents
// them as (which would make a synced app.asar hash as a 0-byte directory). The
// `node:` scheme used previously evaded the systemic `require('fs')` sweep, so
// getSha1/recordSha1 — which stream user source/destination files — were left on
// the patched fs. See real-fs.js. Falls back to plain fs outside Electron (e.g.
// the test runner).
const realFs = require('./real-fs');
const fs = realFs.promises;
const fssync = realFs;
const crypto = require('node:crypto');

const STATE_VERSION = 1;
const DEFAULT_SNAPSHOT_INTERVAL_MS = 5000;
const DEFAULT_LOG_COMPACTION_BYTES = 1_000_000;
const VALID_ACTIONS = new Set([
  'synced',
  'skipped-older',
  'conflict-detected',
  'conflict-resolved',
  'archived',
  'mirrored',
  'source-deleted',
  'destination-deleted',
  'unknown'
]);

function normalizeRelativePath(input) {
  if (typeof input !== 'string') return null;
  let p = input.trim();
  if (!p) return null;
  p = p.replace(/\\/g, '/');
  p = p.replace(/^\.\//, '');
  p = p.replace(/\/+$/, '');
  return p || null;
}

function normalizeSideObservation(side) {
  if (side == null) return null;
  if (typeof side !== 'object') {
    throw new TypeError('observation must be an object or null');
  }
  if (side.mtimeMs == null || side.size == null) {
    throw new TypeError('observation requires mtimeMs and size');
  }
  const mtimeMs = Number(side.mtimeMs);
  const size = Number(side.size);
  if (!Number.isFinite(mtimeMs) || mtimeMs < 0) {
    throw new TypeError('observation.mtimeMs must be a non-negative number');
  }
  if (!Number.isFinite(size) || size < 0) {
    throw new TypeError('observation.size must be a non-negative number');
  }
  return {
    mtimeMs,
    size,
    sha1: typeof side.sha1 === 'string' && side.sha1 ? side.sha1 : null
  };
}

function normalizeRecord(rec) {
  if (rec == null || typeof rec !== 'object') return null;
  const action = typeof rec.lastAction === 'string' ? rec.lastAction : 'unknown';
  return {
    source: normalizeSideObservation(rec.source),
    destination: normalizeSideObservation(rec.destination),
    lastSeenAt: typeof rec.lastSeenAt === 'string' ? rec.lastSeenAt : null,
    lastSeenRunId: typeof rec.lastSeenRunId === 'string' ? rec.lastSeenRunId : null,
    lastAction: VALID_ACTIONS.has(action) ? action : 'unknown'
  };
}

function createTwoWayState(options = {}) {
  const userDataPath = options.userDataPath;
  const jobId = options.jobId;
  const destinationIndex = options.destinationIndex;
  const snapshotIntervalMs = options.snapshotIntervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS;
  const logCompactionBytes = options.logCompactionBytes ?? DEFAULT_LOG_COMPACTION_BYTES;

  if (typeof userDataPath !== 'string' || !userDataPath) {
    throw new TypeError('userDataPath is required');
  }
  if (typeof jobId !== 'string' || !jobId) {
    throw new TypeError('jobId is required');
  }
  if (!Number.isInteger(destinationIndex) || destinationIndex < 0) {
    throw new TypeError('destinationIndex must be a non-negative integer');
  }

  const stateDir = path.join(userDataPath, 'two-way-state', jobId, String(destinationIndex));
  const snapshotPath = path.join(stateDir, 'snapshot.json');
  const snapshotTmpPath = `${snapshotPath}.tmp`;
  const logPath = path.join(stateDir, 'events.ndjson');

  const records = new Map();
  let logQueue = Promise.resolve();
  let logBytes = 0;
  let lastSnapshotAt = 0;
  let pendingSnapshot = false;
  let closed = false;
  let destroyed = false;

  async function ensureStateDir() {
    await fs.mkdir(stateDir, { recursive: true });
  }

  async function cleanupStaleTmp() {
    try {
      await fs.unlink(snapshotTmpPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  function applyEvent(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'set' && typeof event.path === 'string') {
      const rec = normalizeRecord(event.record);
      if (rec) records.set(event.path, rec);
    } else if (event.type === 'delete' && typeof event.path === 'string') {
      records.delete(event.path);
    } else if (event.type === 'clear') {
      records.clear();
    }
  }

  async function load() {
    await ensureStateDir();
    await cleanupStaleTmp();

    try {
      const stat = await fs.stat(snapshotPath);
      const raw = await fs.readFile(snapshotPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.records === 'object' && parsed.records !== null) {
        for (const [k, v] of Object.entries(parsed.records)) {
          const rec = normalizeRecord(v);
          if (rec) records.set(k, rec);
        }
      }
      lastSnapshotAt = stat.mtimeMs;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    try {
      const stat = await fs.stat(logPath);
      // Always replay the log. It is truncated on every snapshot, so it only
      // holds events appended since that snapshot; replay is idempotent and
      // ordered, so re-applying is safe even if a prior truncation was
      // interrupted. A previous mtime-based skip (log mtime <= snapshot mtime)
      // dropped post-snapshot events whenever the two timestamps collided —
      // sub-millisecond writes, or coarse FAT/SMB mtime resolution — which could
      // silently lose the most recent deletes/edits on reload.
      const raw = await fs.readFile(logPath, 'utf8');
      const lines = raw.split('\n');
      for (const line of lines) {
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        applyEvent(event);
      }
      logBytes = stat.size;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async function writeSnapshot() {
    pendingSnapshot = false;
    const payload = JSON.stringify({
      version: STATE_VERSION,
      writtenAt: new Date().toISOString(),
      records: Object.fromEntries(records)
    });
    await fs.writeFile(snapshotTmpPath, payload, 'utf8');
    await fs.rename(snapshotTmpPath, snapshotPath);
    try {
      await fs.writeFile(logPath, '', 'utf8');
      logBytes = 0;
    } catch {
      // log truncation is best-effort; replay is idempotent so a stale log
      // is harmless other than a slightly slower next boot
    }
    lastSnapshotAt = Date.now();
  }

  function appendEvent(event) {
    const line = JSON.stringify(event) + '\n';
    const lineBytes = Buffer.byteLength(line, 'utf8');
    const op = logQueue.catch(() => {}).then(async () => {
      if (closed || destroyed) return;
      await ensureStateDir();
      await fs.appendFile(logPath, line, 'utf8');
      logBytes += lineBytes;
      if (logBytes >= logCompactionBytes) pendingSnapshot = true;
      if (pendingSnapshot && Date.now() - lastSnapshotAt >= snapshotIntervalMs) {
        try {
          await writeSnapshot();
        } catch {
          // leave pendingSnapshot true; next append will retry
        }
      }
    });
    logQueue = op;
    return op;
  }

  // ----- public API -----

  function getRecord(relativePath) {
    const key = normalizeRelativePath(relativePath);
    if (!key) return null;
    const rec = records.get(key);
    if (!rec) return null;
    return { path: key, ...rec };
  }

  function listRecords() {
    const out = [];
    for (const [p, rec] of records) {
      out.push({ path: p, ...rec });
    }
    return out;
  }

  function size() {
    return records.size;
  }

  async function recordFile(input) {
    if (destroyed) throw new Error('two-way state is destroyed');
    if (closed) throw new Error('two-way state is closed');
    if (input == null || typeof input !== 'object') {
      throw new TypeError('recordFile requires an object argument');
    }
    const key = normalizeRelativePath(input.relativePath);
    if (!key) throw new TypeError('relativePath is required');
    const action = typeof input.action === 'string' ? input.action : 'synced';
    const lastSeenAt = typeof input.now === 'string' && input.now
      ? input.now
      : new Date().toISOString();
    const record = {
      source: normalizeSideObservation(input.source),
      destination: normalizeSideObservation(input.destination),
      lastSeenAt,
      lastSeenRunId: typeof input.runId === 'string' ? input.runId : null,
      lastAction: VALID_ACTIONS.has(action) ? action : 'unknown'
    };
    records.set(key, record);
    await appendEvent({ type: 'set', path: key, record, at: lastSeenAt });
    return { path: key, ...record };
  }

  async function recordSha1(relativePath, side, absoluteFilePath) {
    if (destroyed) throw new Error('two-way state is destroyed');
    if (closed) throw new Error('two-way state is closed');
    if (side !== 'source' && side !== 'destination') {
      throw new TypeError('side must be "source" or "destination"');
    }
    const key = normalizeRelativePath(relativePath);
    if (!key) throw new TypeError('relativePath is required');
    const existing = records.get(key);
    if (!existing) throw new Error(`no record for ${relativePath}`);
    if (!existing[side]) {
      throw new Error(`no ${side} observation for ${relativePath}`);
    }
    const sha1 = await getSha1(absoluteFilePath);
    const updated = {
      ...existing,
      [side]: { ...existing[side], sha1 }
    };
    records.set(key, updated);
    await appendEvent({ type: 'set', path: key, record: updated, at: new Date().toISOString() });
    return { path: key, ...updated };
  }

  async function removeRecord(relativePath) {
    if (destroyed) throw new Error('two-way state is destroyed');
    if (closed) throw new Error('two-way state is closed');
    const key = normalizeRelativePath(relativePath);
    if (!key || !records.has(key)) return false;
    records.delete(key);
    await appendEvent({ type: 'delete', path: key, at: new Date().toISOString() });
    return true;
  }

  async function clear() {
    if (destroyed) throw new Error('two-way state is destroyed');
    if (closed) throw new Error('two-way state is closed');
    records.clear();
    await appendEvent({ type: 'clear', at: new Date().toISOString() });
  }

  async function flush() {
    if (destroyed) return;
    await logQueue.catch(() => {});
    if (pendingSnapshot && !destroyed) {
      await writeSnapshot();
    }
  }

  async function close() {
    if (destroyed) return;
    if (closed) return;
    closed = true;
    await logQueue.catch(() => {});
    if (records.size > 0 || pendingSnapshot) {
      try {
        await writeSnapshot();
      } catch {
        // best effort
      }
    }
  }

  async function destroy() {
    destroyed = true;
    closed = true;
    await logQueue.catch(() => {});
    records.clear();
    try {
      await fs.rm(stateDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }

  function getSha1(absoluteFilePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha1');
      const stream = fssync.createReadStream(absoluteFilePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  function getStateDir() {
    return stateDir;
  }

  const ready = load();

  return {
    ready,
    getRecord,
    listRecords,
    size,
    recordFile,
    recordSha1,
    removeRecord,
    clear,
    flush,
    close,
    destroy,
    getSha1,
    getStateDir
  };
}

module.exports = {
  createTwoWayState,
  normalizeRelativePath
};
