const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeHistoryLocations } = require('../src/main/job-model');

test('two-way history locations include destinations and source folders', () => {
  const locations = normalizeHistoryLocations({
    syncMode: 'twoWay',
    sourcePaths: ['C:\\Source A', 'C:\\Source B'],
    targetDestinations: [{ path: 'D:\\Backup', label: 'Backup', required: true }]
  });

  assert.deepEqual(locations.map((location) => location.path), [
    'D:\\Backup',
    'C:\\Source A',
    'C:\\Source B'
  ]);
  assert.match(locations[1].label, /^Source 1/);
});

test('one-way history locations remain destination-only', () => {
  const locations = normalizeHistoryLocations({
    syncMode: 'oneWay',
    sourcePaths: ['C:\\Source'],
    targetPath: 'D:\\Backup'
  });
  assert.deepEqual(locations.map((location) => location.path), ['D:\\Backup']);
});
