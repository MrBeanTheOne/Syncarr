'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { withTimeout } = require('../src/main/async-utils');

test('withTimeout passes through a promise that settles in time', async () => {
  assert.strictEqual(await withTimeout(Promise.resolve('ok'), 1000, 'Fast phase'), 'ok');
  await assert.rejects(
    withTimeout(Promise.reject(new Error('inner failure')), 1000, 'Fast phase'),
    /inner failure/
  );
});

test('withTimeout rejects a hung promise with the phase label', async () => {
  const hung = new Promise(() => {});
  await assert.rejects(
    withTimeout(hung, 25, 'Retention prune for X:\\share'),
    /Retention prune for X:\\share timed out after 0s/
  );
});
