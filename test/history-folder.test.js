const test = require('node:test');
const assert = require('node:assert/strict');

const { markHistoryFolderHidden } = require('../src/main/history-folder');

test('Windows history folders receive the hidden attribute', async () => {
  const calls = [];
  const result = await markHistoryFolderHidden('C:\\Target\\.syncarr-history', {
    platform: 'win32',
    execFileFn: (file, args, options, callback) => {
      calls.push({ file, args, options });
      callback(null);
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(calls[0], {
    file: 'attrib.exe',
    args: ['+H', 'C:\\Target\\.syncarr-history'],
    options: { windowsHide: true }
  });
});

test('non-Windows history folders need no attribute command', async () => {
  let called = false;
  const result = await markHistoryFolderHidden('/target/.syncarr-history', {
    platform: 'linux',
    execFileFn: () => { called = true; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(called, false);
});
