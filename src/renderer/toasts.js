(() => {
  'use strict';

  // Ephemeral in-app toasts (top-right stack). The app's other feedback
  // surfaces are all persistent (result cards, save bar) or blocking
  // (SyncarrDialog) — this is the "it worked, carry on" channel. Pure model
  // building is separated from the DOM writes so tests can cover behavior
  // without jsdom, mirroring summary-metrics.js.

  const KINDS = ['success', 'info', 'warning', 'error'];
  const DEFAULT_DURATION_MS = 4500;
  const ERROR_DURATION_MS = 7000;
  const LEAVE_MS = 260; // keep in sync with the .toast transition in styles.css
  const MAX_TOASTS = 4;

  function buildToastModel({ kind, title, message, durationMs } = {}) {
    const safeKind = KINDS.includes(kind) ? kind : 'info';
    const duration = Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : (safeKind === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS);
    return {
      kind: safeKind,
      className: `toast toast-${safeKind}`,
      // Errors interrupt screen readers; everything else waits its turn.
      role: safeKind === 'error' ? 'alert' : 'status',
      durationMs: duration,
      title: title ? String(title) : '',
      message: message ? String(message) : ''
    };
  }

  const deps = {
    documentRef: typeof document !== 'undefined' ? document : null,
    setTimeoutFn: (fn, ms) => setTimeout(fn, ms),
    clearTimeoutFn: (id) => clearTimeout(id),
    // rAF so the enter transition runs after the initial paint; falls back to
    // an immediate call for tests and headless contexts.
    frameFn: (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : fn())
  };

  function init(overrides = {}) {
    Object.assign(deps, overrides);
  }

  function getStack() {
    return deps.documentRef && typeof deps.documentRef.getElementById === 'function'
      ? deps.documentRef.getElementById('toastStack')
      : null;
  }

  function removeToast(toast) {
    if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
  }

  function dismissToast(toast) {
    if (!toast || toast._dismissing) return;
    toast._dismissing = true;
    if (toast._timerId !== undefined) deps.clearTimeoutFn(toast._timerId);
    toast.classList.add('toast-leave');
    deps.setTimeoutFn(() => removeToast(toast), LEAVE_MS);
  }

  function show(input) {
    const model = input && input.className ? input : buildToastModel(input || {});
    const doc = deps.documentRef;
    const stack = getStack();
    if (!doc || !stack) return null;

    while (stack.children.length >= MAX_TOASTS) {
      removeToast(stack.children[0]);
    }

    const toast = doc.createElement('div');
    toast.className = model.className;
    toast.setAttribute('role', model.role);

    const body = doc.createElement('div');
    body.className = 'toast-body';
    if (model.title) {
      const title = doc.createElement('strong');
      title.className = 'toast-title';
      title.textContent = model.title;
      body.appendChild(title);
    }
    const message = doc.createElement('span');
    message.className = 'toast-msg';
    message.textContent = model.message;
    body.appendChild(message);
    toast.appendChild(body);

    const close = doc.createElement('button');
    close.className = 'toast-close';
    close.setAttribute('type', 'button');
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '×';
    close.addEventListener('click', () => dismissToast(toast));
    toast.appendChild(close);

    const startTimer = () => {
      toast._timerId = deps.setTimeoutFn(() => dismissToast(toast), model.durationMs);
    };
    // Hover keeps the toast alive while it's being read.
    toast.addEventListener('mouseenter', () => {
      if (toast._timerId !== undefined) deps.clearTimeoutFn(toast._timerId);
      toast._timerId = undefined;
    });
    toast.addEventListener('mouseleave', () => {
      if (!toast._dismissing && toast._timerId === undefined) startTimer();
    });

    stack.appendChild(toast);
    deps.frameFn(() => toast.classList.add('toast-in'));
    startTimer();
    return toast;
  }

  function dismissAll() {
    const stack = getStack();
    if (!stack) return;
    while (stack.children.length) removeToast(stack.children[0]);
  }

  function makeShorthand(kind) {
    return (message, opts = {}) => show(buildToastModel({ ...opts, kind, message }));
  }

  window.SyncarrToasts = {
    buildToastModel,
    show,
    dismissAll,
    init,
    success: makeShorthand('success'),
    info: makeShorthand('info'),
    warning: makeShorthand('warning'),
    error: makeShorthand('error')
  };
})();
