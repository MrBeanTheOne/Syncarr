const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global.window || {};
require('../src/renderer/toasts.js');
const toasts = global.window.SyncarrToasts;

// Minimal stand-ins for the few DOM members toasts.js touches — the suite
// deliberately avoids jsdom (see test/summary-metrics.test.js).
function makeFakeElement(tag) {
  const el = {
    tagName: tag,
    className: '',
    textContent: '',
    attributes: {},
    childList: [],
    parentNode: null,
    listeners: {}
  };
  el.setAttribute = (name, value) => { el.attributes[name] = value; };
  el.appendChild = (child) => { child.parentNode = el; el.childList.push(child); return child; };
  el.removeChild = (child) => {
    const index = el.childList.indexOf(child);
    if (index >= 0) el.childList.splice(index, 1);
    child.parentNode = null;
    return child;
  };
  el.addEventListener = (name, fn) => { (el.listeners[name] = el.listeners[name] || []).push(fn); };
  el.dispatch = (name) => { for (const fn of (el.listeners[name] || []).slice()) fn(); };
  el.classList = {
    add: (cls) => {
      const parts = el.className ? el.className.split(' ') : [];
      if (!parts.includes(cls)) parts.push(cls);
      el.className = parts.join(' ');
    },
    remove: (cls) => { el.className = el.className.split(' ').filter((c) => c !== cls).join(' '); },
    contains: (cls) => el.className.split(' ').includes(cls)
  };
  Object.defineProperty(el, 'children', { get: () => el.childList });
  return el;
}

function makeFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    pending,
    set: (fn, ms) => { const id = nextId++; pending.set(id, { fn, ms }); return id; },
    clear: (id) => { pending.delete(id); },
    // Runs everything currently queued; timers queued *during* the run wait
    // for the next call (mirrors how the leave timer follows the dismiss timer).
    advanceAll: () => {
      const batch = [...pending.values()];
      pending.clear();
      for (const { fn } of batch) fn();
    }
  };
}

function setup() {
  const stack = makeFakeElement('div');
  const doc = {
    createElement: makeFakeElement,
    getElementById: (id) => (id === 'toastStack' ? stack : null)
  };
  const timers = makeFakeTimers();
  toasts.init({
    documentRef: doc,
    setTimeoutFn: timers.set,
    clearTimeoutFn: timers.clear,
    frameFn: (fn) => fn()
  });
  return { stack, timers };
}

test('buildToastModel maps kinds to class, role and duration', () => {
  const success = toasts.buildToastModel({ kind: 'success', message: 'Saved' });
  assert.equal(success.className, 'toast toast-success');
  assert.equal(success.role, 'status');
  assert.equal(success.durationMs, 4500);
  assert.equal(success.message, 'Saved');

  const error = toasts.buildToastModel({ kind: 'error', message: 'Boom' });
  assert.equal(error.role, 'alert');
  assert.equal(error.durationMs, 7000);

  const unknown = toasts.buildToastModel({ kind: 'sparkle', message: 'Hm' });
  assert.equal(unknown.kind, 'info');

  const custom = toasts.buildToastModel({ kind: 'info', message: 'Hi', durationMs: 1234 });
  assert.equal(custom.durationMs, 1234);
});

test('show renders a toast with variant class, role and message text', () => {
  const { stack } = setup();
  const toast = toasts.success('Job saved');
  assert.equal(stack.children.length, 1);
  assert.equal(toast.className, 'toast toast-success toast-in');
  assert.equal(toast.attributes.role, 'status');
  const body = toast.children[0];
  assert.equal(body.children[0].textContent, 'Job saved');
});

test('optional title renders above the message', () => {
  setup();
  const toast = toasts.info('sync finished', { title: 'Nightly backup' });
  const body = toast.children[0];
  assert.equal(body.children[0].textContent, 'Nightly backup');
  assert.equal(body.children[1].textContent, 'sync finished');
});

test('toast auto-dismisses: leave class, then removal', () => {
  const { stack, timers } = setup();
  const toast = toasts.success('Bye');
  timers.advanceAll(); // duration timer → adds toast-leave, queues removal
  assert.ok(toast.classList.contains('toast-leave'));
  assert.equal(stack.children.length, 1);
  timers.advanceAll(); // leave timer → removed from the stack
  assert.equal(stack.children.length, 0);
});

test('hover pauses the dismiss timer, leaving restarts it', () => {
  const { stack, timers } = setup();
  const toast = toasts.success('Reading this');
  assert.equal(timers.pending.size, 1);
  toast.dispatch('mouseenter');
  assert.equal(timers.pending.size, 0, 'hover cancels the auto-dismiss timer');
  timers.advanceAll();
  assert.equal(stack.children.length, 1, 'toast survives while hovered');
  toast.dispatch('mouseleave');
  assert.equal(timers.pending.size, 1, 'leaving re-arms the timer');
  timers.advanceAll();
  timers.advanceAll();
  assert.equal(stack.children.length, 0);
});

test('close button dismisses immediately', () => {
  const { stack, timers } = setup();
  const toast = toasts.error('Nope');
  const closeBtn = toast.children[1];
  closeBtn.dispatch('click');
  assert.ok(toast.classList.contains('toast-leave'));
  timers.advanceAll();
  assert.equal(stack.children.length, 0);
});

test('stack caps at 4 toasts, evicting the oldest', () => {
  const { stack } = setup();
  for (let i = 1; i <= 5; i += 1) toasts.info(`toast ${i}`);
  assert.equal(stack.children.length, 4);
  assert.equal(stack.children[0].children[0].children[0].textContent, 'toast 2');
});

test('dismissAll empties the stack', () => {
  const { stack } = setup();
  toasts.success('a');
  toasts.warning('b');
  toasts.dismissAll();
  assert.equal(stack.children.length, 0);
});

test('show is a safe no-op without a toast stack in the DOM', () => {
  toasts.init({ documentRef: { createElement: makeFakeElement, getElementById: () => null } });
  assert.equal(toasts.success('nowhere to go'), null);
});
