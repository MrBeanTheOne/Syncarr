const test = require('node:test');
const assert = require('node:assert/strict');

// Browser IIFE attaching to window; shim before require (see renderer-utils.test.js).
global.window = global.window || {};
require('../src/renderer/compare-labels-utils.js');
const { configure, isMirrorMode, getDestinationOnlyHelp, getDestinationOnlyState, getCompareModeLabels } = global.window.SyncarrCompareLabels;

// Inject a normalizeSyncMode matching the real canonical mapping so the tests
// exercise the same branching the app sees.
configure({
  normalizeSyncMode: (value) => {
    const v = String(value || '').toLowerCase();
    if (v === 'mirror') return 'mirror';
    if (v === 'twoway' || v === 'two-way') return 'twoWay';
    return 'oneWay';
  }
});

test('isMirrorMode is true only for mirror', () => {
  assert.equal(isMirrorMode('mirror'), true);
  assert.equal(isMirrorMode('two-way'), false);
  assert.equal(isMirrorMode('oneWay'), false);
  assert.equal(isMirrorMode(''), false);
});

test('destination-only help/state differ for mirror vs one-way', () => {
  assert.equal(getDestinationOnlyHelp('mirror'), 'Will be archived, then deleted');
  assert.equal(getDestinationOnlyHelp('oneWay'), 'Left untouched by one-way sync');
  assert.equal(getDestinationOnlyState('mirror'), 'Delete candidate');
  assert.equal(getDestinationOnlyState('oneWay'), 'Left untouched');
});

test('getCompareModeLabels returns the right dictionary per mode', () => {
  assert.equal(getCompareModeLabels('mirror').flow, 'mirror');
  assert.equal(getCompareModeLabels('mirror').extraLabel, 'Delete candidates');
  assert.equal(getCompareModeLabels('two-way').flow, 'two-way');
  assert.equal(getCompareModeLabels('two-way').issueLabel, 'Conflicts');
  assert.equal(getCompareModeLabels('oneWay').flow, 'compare');
  assert.equal(getCompareModeLabels('oneWay').extraSub, 'Left untouched by one-way');
});

test('every mode dictionary has the same key set', () => {
  const keys = (mode) => Object.keys(getCompareModeLabels(mode)).sort();
  assert.deepEqual(keys('mirror'), keys('two-way'));
  assert.deepEqual(keys('mirror'), keys('oneWay'));
});
