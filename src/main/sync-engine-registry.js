const { getPlatform } = require('./platform');
const robocopyEngine = require('./sync-engines/robocopy-engine');
const rsyncEngine = require('./sync-engines/rsync-engine');

// Each platform entry exposes:
//   id, label, command            — short identifiers for the UI / IPC
//   implemented, compareSupported,
//   syncSupported                 — capability gates consumed by the orchestrator
//   interface                     — the SyncEngine module exports (see the
//                                   contract at the top of robocopy-engine.js)
//   notes                         — human-readable explanation for `app:getInfo`
//
// The `interface` field is the loaded engine module, not a string path, so
// callers can call `engine.interface.buildArgs(...)` directly. IPC consumers
// strip this field before serializing the entry back to the renderer.
const SYNC_ENGINE_BY_PLATFORM = {
  win32: {
    id: 'robocopy',
    label: 'Robocopy',
    command: 'robocopy',
    implemented: true,
    compareSupported: true,
    syncSupported: true,
    interface: robocopyEngine,
    notes: 'Windows engine used for current Compare and Sync jobs.'
  },
  linux: {
    id: 'rsync',
    label: 'rsync',
    command: 'rsync',
    implemented: true,
    compareSupported: true,
    syncSupported: true,
    interface: rsyncEngine,
    notes: 'Linux engine target. Wired through the SyncEngine interface; ready for live testing on a Linux host.'
  },
  darwin: {
    id: 'rsync',
    label: 'rsync',
    command: 'rsync',
    implemented: true,
    compareSupported: true,
    syncSupported: true,
    interface: rsyncEngine,
    notes: 'macOS engine target. Wired through the SyncEngine interface; ready for live testing on a macOS host.'
  }
};

function getSyncEngine(platform = getPlatform()) {
  return SYNC_ENGINE_BY_PLATFORM[platform] || {
    id: 'unsupported',
    label: 'Unsupported platform',
    command: null,
    implemented: false,
    compareSupported: false,
    syncSupported: false,
    interface: null,
    notes: 'No sync engine is registered for this platform.'
  };
}

function isOperationSupported(operation, platform = getPlatform()) {
  const engine = getSyncEngine(platform);
  if (operation === 'compare') return engine.implemented && engine.compareSupported;
  if (operation === 'sync') return engine.implemented && engine.syncSupported;
  return false;
}

function mergeEngineExitCodes(engine, currentCode, nextCode) {
  const current = Number.isFinite(currentCode) ? currentCode : 0;
  const next = Number.isFinite(nextCode) ? nextCode : 0;

  if (engine && engine.id === 'robocopy') return current | next;
  if (current === 0) return next;
  if (next === 0) return current;

  const iface = engine && engine.interface;
  if (!iface || typeof iface.interpretExitCode !== 'function') return next;

  const currentStatus = iface.interpretExitCode(current);
  const nextStatus = iface.interpretExitCode(next);
  if (!nextStatus.ok) return next;
  if (!currentStatus.ok) return current;

  // rsync's successful non-zero codes are not bit flags. Preserve a valid
  // partial-transfer code instead of manufacturing an invalid value such as 31.
  return current === 23 || next === 23 ? 23 : next;
}

function buildUnsupportedOperationResult(operation, extra = {}) {
  const platform = getPlatform();
  const engine = getSyncEngine(platform);
  const noun = operation === 'compare' ? 'compare' : 'sync';
  const message = engine.id === 'unsupported'
    ? `Syncarr ${noun} jobs are not available on this platform yet.`
    : `Syncarr ${noun} jobs are blocked on ${platform}: ${engine.notes}`;

  // Strip the loaded engine module before echoing; it's not serialisable
  // and the caller usually spreads this onto an IPC payload.
  const { interface: _interface, ...engineMeta } = engine;

  return {
    ok: false,
    code: null,
    status: 'unsupported-platform',
    message,
    output: '',
    summary: null,
    engine: engineMeta,
    ...extra
  };
}

// Strip non-serialisable fields (like the loaded engine module) before
// sending a registry entry across the IPC boundary. Used by app:getInfo.
function getSyncEngineMetadata(platform = getPlatform()) {
  const { interface: _interface, ...metadata } = getSyncEngine(platform);
  return metadata;
}

module.exports = {
  getSyncEngine,
  getSyncEngineMetadata,
  isOperationSupported,
  mergeEngineExitCodes,
  buildUnsupportedOperationResult
};
