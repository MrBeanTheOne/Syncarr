// Themed confirm/alert dialogs that match the app shell, replacing the native
// window.confirm/window.alert OS popups. Promise-based:
//   await SyncarrDialog.confirm({ title, message, confirmLabel, cancelLabel, tone })  -> boolean
//   await SyncarrDialog.alert({ title, message, confirmLabel, tone })                 -> true
// CSP-safe: built from createElement + classes (no inline styles); the only
// innerHTML is the static icon SVG strings below, never user content.
(function () {
  const ICONS = {
    question: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4"/><path d="M12 17h.01"/></svg>',
    danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.5 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.5a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>'
  };

  let openCount = 0;

  function makeButton(label, className) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    return btn;
  }

  function open(options) {
    const opts = options || {};
    const kind = opts.kind === 'alert' ? 'alert' : 'confirm';
    const tone = ICONS[opts.tone] ? opts.tone : (kind === 'alert' ? 'info' : 'question');
    const title = opts.title || (kind === 'alert' ? 'Notice' : 'Are you sure?');
    const message = opts.message == null ? '' : String(opts.message);
    const confirmLabel = opts.confirmLabel || (kind === 'alert' ? 'OK' : 'Confirm');
    const cancelLabel = opts.cancelLabel || 'Cancel';

    return new Promise((resolve) => {
      const previousFocus = document.activeElement;

      const overlay = document.createElement('div');
      overlay.className = 'app-dialog-overlay';
      overlay.setAttribute('role', 'presentation');

      const scrim = document.createElement('div');
      scrim.className = 'app-dialog-scrim';

      const modal = document.createElement('section');
      modal.className = 'app-dialog';
      modal.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog');
      modal.setAttribute('aria-modal', 'true');

      const head = document.createElement('header');
      head.className = 'app-dialog-head';

      const icon = document.createElement('span');
      icon.className = `app-dialog-icon tone-${tone}`;
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = ICONS[tone];

      const titleEl = document.createElement('h3');
      titleEl.className = 'app-dialog-title';
      titleEl.textContent = title;
      head.appendChild(icon);
      head.appendChild(titleEl);
      modal.appendChild(head);

      if (message) {
        const body = document.createElement('p');
        body.className = 'app-dialog-body';
        body.textContent = message;
        modal.appendChild(body);
      }

      const actions = document.createElement('div');
      actions.className = 'app-dialog-actions';

      let cancelBtn = null;
      if (kind !== 'alert') {
        cancelBtn = makeButton(cancelLabel, 'secondary');
        actions.appendChild(cancelBtn);
      }
      const confirmBtn = makeButton(
        confirmLabel,
        'primary' + (tone === 'danger' ? ' danger-primary' : '')
      );
      actions.appendChild(confirmBtn);
      modal.appendChild(actions);

      overlay.appendChild(scrim);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      openCount += 1;
      document.body.classList.add('dialog-open');

      let settled = false;
      function settle(result) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.classList.add('is-closing');
        openCount = Math.max(0, openCount - 1);
        if (openCount === 0) document.body.classList.remove('dialog-open');
        window.setTimeout(() => {
          overlay.remove();
          if (previousFocus && typeof previousFocus.focus === 'function') {
            try { previousFocus.focus(); } catch (_) { /* ignore */ }
          }
          resolve(result);
        }, 140);
      }

      const onConfirm = () => settle(true);
      const onCancel = () => settle(kind === 'alert' ? true : false);

      confirmBtn.addEventListener('click', onConfirm);
      if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
      scrim.addEventListener('click', onCancel);

      function focusable() {
        return Array.prototype.slice.call(modal.querySelectorAll('button'));
      }
      function onKey(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        } else if (event.key === 'Tab') {
          const items = focusable();
          if (!items.length) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
      document.addEventListener('keydown', onKey, true);

      // Default focus: a destructive primary should not be the Enter target —
      // land on Cancel so a stray Enter doesn't fire the dangerous action.
      const initial = (tone === 'danger' && cancelBtn) ? cancelBtn : confirmBtn;
      window.requestAnimationFrame(() => {
        try { initial.focus(); } catch (_) { /* ignore */ }
      });
    });
  }

  window.SyncarrDialog = {
    open,
    confirm(options) { return open({ ...(options || {}), kind: 'confirm' }); },
    alert(options) { return open({ ...(options || {}), kind: 'alert' }); }
  };
}());
