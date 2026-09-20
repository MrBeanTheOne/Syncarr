const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSyncEngine,
  getSyncEngineMetadata,
  isOperationSupported,
  mergeEngineExitCodes,
  buildUnsupportedOperationResult
} = require('../src/main/sync-engine-registry');

// ---------------------------------------------------------------------------
// getSyncEngine — returns the full engine record, including the loaded
// engine module as `interface`. The orchestrator uses the interface field
// directly (engine.interface.buildArgs, etc.).
// ---------------------------------------------------------------------------

test('getSyncEngine returns the full record for win32 with the robocopy interface loaded', () => {
  const engine = getSyncEngine('win32');
  assert.equal(engine.id, 'robocopy');
  assert.equal(engine.label, 'Robocopy');
  assert.equal(engine.command, 'robocopy');
  assert.equal(engine.implemented, true);
  assert.equal(engine.compareSupported, true);
  assert.equal(engine.syncSupported, true);
  assert.ok(engine.interface, 'interface field must be loaded');
  // Spot-check the interface contract is wired
  assert.equal(typeof engine.interface.buildArgs, 'function');
  assert.equal(typeof engine.interface.spawn, 'function');
  assert.equal(typeof engine.interface.parseProgressLine, 'function');
  assert.equal(engine.interface.command, 'robocopy');
});

test('getSyncEngine returns the rsync interface for linux with implemented:true', () => {
  const engine = getSyncEngine('linux');
  assert.equal(engine.id, 'rsync');
  assert.equal(engine.label, 'rsync');
  assert.equal(engine.command, 'rsync');
  assert.equal(engine.implemented, true, 'linux must be marked implemented in this round');
  assert.equal(engine.compareSupported, true);
  assert.equal(engine.syncSupported, true);
  assert.ok(engine.interface);
  assert.equal(typeof engine.interface.buildArgs, 'function');
  assert.equal(engine.interface.command, 'rsync');
});

test('getSyncEngine returns the rsync interface for darwin with implemented:true', () => {
  const engine = getSyncEngine('darwin');
  assert.equal(engine.id, 'rsync');
  assert.equal(engine.implemented, true, 'darwin must be marked implemented in this round');
  assert.ok(engine.interface);
});

test('getSyncEngine returns the unsupported fallback for unknown platforms', () => {
  const engine = getSyncEngine('freebsd');
  assert.equal(engine.id, 'unsupported');
  assert.equal(engine.implemented, false);
  assert.equal(engine.interface, null);
});

// ---------------------------------------------------------------------------
// getSyncEngineMetadata — strips the non-serialisable interface field.
// The IPC handler uses this so the engine module doesn't end up in the
// renderer payload.
// ---------------------------------------------------------------------------

test('getSyncEngineMetadata strips the interface field', () => {
  const meta = getSyncEngineMetadata('win32');
  assert.equal(meta.id, 'robocopy');
  assert.equal(meta.label, 'Robocopy');
  assert.ok(!('interface' in meta), 'metadata must NOT include the interface field');
});

test('getSyncEngineMetadata for linux returns the same shape minus interface', () => {
  const meta = getSyncEngineMetadata('linux');
  assert.equal(meta.id, 'rsync');
  assert.equal(meta.implemented, true);
  assert.ok(!('interface' in meta));
});

test('getSyncEngineMetadata for unknown platforms still works', () => {
  const meta = getSyncEngineMetadata('freebsd');
  assert.equal(meta.id, 'unsupported');
  assert.equal(meta.implemented, false);
});

// ---------------------------------------------------------------------------
// isOperationSupported — gate that the orchestrator's compare/sync callers
// check before dispatching.
// ---------------------------------------------------------------------------

test('isOperationSupported returns true for compare/sync on all three supported platforms', () => {
  for (const platform of ['win32', 'linux', 'darwin']) {
    assert.equal(isOperationSupported('compare', platform), true, `compare on ${platform}`);
    assert.equal(isOperationSupported('sync', platform), true, `sync on ${platform}`);
  }
});

test('isOperationSupported returns false for unknown operations', () => {
  assert.equal(isOperationSupported('bogus', 'win32'), false);
});

test('isOperationSupported returns false on unsupported platforms', () => {
  assert.equal(isOperationSupported('compare', 'freebsd'), false);
  assert.equal(isOperationSupported('sync', 'freebsd'), false);
});

test('mergeEngineExitCodes follows each engine exit-code model', () => {
  assert.equal(mergeEngineExitCodes(getSyncEngine('win32'), 1, 2), 3);
  assert.equal(mergeEngineExitCodes(getSyncEngine('linux'), 23, 24), 23);
  assert.equal(mergeEngineExitCodes(getSyncEngine('linux'), 0, 24), 24);
  assert.equal(mergeEngineExitCodes(getSyncEngine('linux'), 24, 12), 12);
});

// ---------------------------------------------------------------------------
// buildUnsupportedOperationResult — shape that callers spread into error
// responses. Now that linux/darwin report implemented:true, this path only
// fires for genuinely unsupported platforms.
// ---------------------------------------------------------------------------

test('buildUnsupportedOperationResult returns the unsupported-platform shape', () => {
  // This function is only called by orchestrators that have already gated on
  // isOperationSupported(); on supported platforms it's a defensive helper.
  // We just lock down the returned shape so callers can rely on it.
  const result = buildUnsupportedOperationResult('compare');
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unsupported-platform');
  assert.equal(result.code, null);
  assert.ok(typeof result.message === 'string' && result.message.length > 0);
  assert.ok(result.engine, 'engine field is included for caller diagnostics');
  assert.equal(result.output, '');
  assert.equal(result.summary, null);
});

test('buildUnsupportedOperationResult spreads caller extras onto the result', () => {
  const result = buildUnsupportedOperationResult('sync', { preview: { files: [] } });
  assert.deepEqual(result.preview, { files: [] });
});

test('buildUnsupportedOperationResult echoes an engine field without the interface module', () => {
  // The 'engine' field is meant for caller diagnostics, not for serialising
  // back to the renderer — keep the interface module out of it.
  const result = buildUnsupportedOperationResult('compare');
  assert.ok(!('interface' in result.engine));
});
