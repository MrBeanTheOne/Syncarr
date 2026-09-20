const test = require('node:test');
const assert = require('node:assert/strict');

const { installWebContentsGuards } = require('../src/main/window-guards');

function makeFakeContents(currentUrl) {
  const state = { openHandler: null, listeners: {} };
  return {
    state,
    getURL: () => currentUrl,
    setWindowOpenHandler: (handler) => { state.openHandler = handler; },
    on: (event, listener) => { state.listeners[event] = listener; }
  };
}

test('window.open is denied outright', () => {
  const contents = makeFakeContents('file:///app/index.html');
  installWebContentsGuards(contents);

  assert.ok(contents.state.openHandler, 'a window-open handler is installed');
  assert.deepEqual(contents.state.openHandler({ url: 'https://evil.example' }), { action: 'deny' });
  assert.deepEqual(contents.state.openHandler({ url: 'file:///app/index.html' }), { action: 'deny' });
});

test('navigation away from the current URL is blocked', () => {
  const contents = makeFakeContents('file:///app/index.html');
  installWebContentsGuards(contents);

  const listener = contents.state.listeners['will-navigate'];
  assert.ok(listener, 'a will-navigate listener is installed');

  let prevented = 0;
  const event = { preventDefault: () => { prevented += 1; } };

  listener(event, 'https://evil.example/phish');
  assert.equal(prevented, 1, 'off-origin navigation is prevented');

  listener(event, 'file:///somewhere/else.html');
  assert.equal(prevented, 2, 'other local files are prevented too');
});

test('navigating to the current URL (reload) is allowed', () => {
  const contents = makeFakeContents('file:///app/index.html');
  installWebContentsGuards(contents);

  let prevented = 0;
  contents.state.listeners['will-navigate']({ preventDefault: () => { prevented += 1; } }, 'file:///app/index.html');
  assert.equal(prevented, 0, 'same-URL navigation (Ctrl+R style reload) passes through');
});

test('a missing contents object is tolerated', () => {
  assert.doesNotThrow(() => installWebContentsGuards(null));
});
