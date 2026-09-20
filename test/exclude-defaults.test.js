const test = require('node:test');
const assert = require('node:assert/strict');

const { withHistoryExclude, DEFAULT_EXCLUDE_PATTERNS } = require('../src/main/job-model');

const FFS_ARTIFACTS = ['*.ffs_db', '*.ffs_lock', '*.ffs_tmp'];

test('DEFAULT_EXCLUDE_PATTERNS includes FreeFileSync artifacts', () => {
  for (const pattern of FFS_ARTIFACTS) {
    assert.ok(DEFAULT_EXCLUDE_PATTERNS.includes(pattern), `default excludes ${pattern}`);
  }
});

test('withHistoryExclude always injects FreeFileSync artifacts for every job', () => {
  const out = withHistoryExclude([], '.syncarr-history');
  for (const pattern of [...FFS_ARTIFACTS, '.syncarr-history']) {
    assert.ok(out.includes(pattern), `effective excludes contain ${pattern}`);
  }
});

test('withHistoryExclude keeps user patterns and de-duplicates', () => {
  const out = withHistoryExclude(['*.bak', '*.ffs_db'], '.syncarr-history');
  assert.ok(out.includes('*.bak'), 'user pattern preserved');
  assert.equal(out.filter((p) => p === '*.ffs_db').length, 1, 'no duplicate ffs_db');
});
