const test = require('node:test');
const assert = require('node:assert/strict');

// Self-contained browser IIFE; shim window before require.
global.window = global.window || {};
require('../src/renderer/compare-fingerprint-utils.js');
const { configure, makeCompareFingerprint, stableStringify } = global.window.SyncarrCompareFingerprint;

// Inject deterministic normalizers matching the renderer's canonical behavior so
// the fingerprint structure is exercised end-to-end.
configure({
  normalizeSyncMode: (v) => {
    const s = String(v || 'oneWay').toLowerCase();
    if (s === 'mirror') return 'mirror';
    if (s === 'twoway' || s === 'two-way') return 'twoWay';
    return 'oneWay';
  },
  normalizeTwoWayConflictPolicy: (v) => String(v || 'newest'),
  normalizeSourcePaths: (input) => (Array.isArray(input) ? input : (input ? [input] : [])).filter(Boolean),
  normalizeTargetDestinations: (input, fallback = '') => (Array.isArray(input) && input.length ? input : (fallback ? [{ path: fallback, required: true }] : [])),
  defaultExcludePatterns: ['node_modules', '.git']
});

test('stableStringify sorts object keys and emits valid JSON', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(stableStringify([3, 'x', true]), '[3,"x",true]');
  assert.equal(stableStringify({ z: [{ y: 1, x: 2 }] }), '{"z":[{"x":2,"y":1}]}');
});

test('makeCompareFingerprint produces the full, stable field set (serialization contract)', () => {
  const fp = makeCompareFingerprint({ syncMode: 'oneWay', sourcePaths: ['C:\\a'], targetPath: 'N:\\b' });
  const parsed = JSON.parse(fp); // output is valid JSON with sorted keys
  assert.deepEqual(parsed, {
    copySubfolders: true,
    excludePatterns: ['node_modules', '.git'],
    freeSpaceCheckEnabled: true,
    historyEnabled: true,
    historyFolderName: '.syncarr-history',
    minimumFreeGb: 0,
    skipOlderSource: true,
    sourcePaths: ['C:\\a'],
    syncMode: 'oneWay',
    targetDestinations: [{ path: 'N:\\b', required: true }],
    targetPath: 'N:\\b',
    twoWayConflictPolicy: 'newest'
  });
});

test('fingerprint is independent of input key order (the persistence contract relies on this)', () => {
  const a = makeCompareFingerprint({ syncMode: 'oneWay', targetPath: 'N:\\b', sourcePaths: ['C:\\a'] });
  const b = makeCompareFingerprint({ sourcePaths: ['C:\\a'], syncMode: 'oneWay', targetPath: 'N:\\b' });
  assert.equal(a, b);
});

test('mirror mode forces skipOlderSource:false regardless of the job flag', () => {
  const parsed = JSON.parse(makeCompareFingerprint({ syncMode: 'mirror', skipOlderSource: true, targetPath: 'N:\\b' }));
  assert.equal(parsed.syncMode, 'mirror');
  assert.equal(parsed.skipOlderSource, false);
});

test('explicit excludePatterns override the default', () => {
  const parsed = JSON.parse(makeCompareFingerprint({ syncMode: 'oneWay', excludePatterns: ['*.tmp'], targetPath: 'N:\\b' }));
  assert.deepEqual(parsed.excludePatterns, ['*.tmp']);
});
