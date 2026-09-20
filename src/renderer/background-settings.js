(() => {
  'use strict';

  // Self-contained controller for the "Background & updates" settings card.
  // Kept out of app.js so it does not depend on the large renderer controller
  // and degrades gracefully if the preload bridge is an older build.
  const api = window.syncarr || {};

  const els = {
    closeToTray: document.getElementById('bgCloseToTray'),
    startAtLogin: document.getElementById('bgStartAtLogin'),
    startMinimized: document.getElementById('bgStartMinimized'),
    autoCheckUpdates: document.getElementById('bgAutoCheckUpdates'),
    desktopNotifications: document.getElementById('bgDesktopNotifications'),
    notifyBeforeScheduledRun: document.getElementById('bgNotifyBeforeScheduledRun'),
    schedulerPaused: document.getElementById('bgSchedulerPaused'),
    checkBtn: document.getElementById('checkUpdatesBtn'),
    installBtn: document.getElementById('installUpdateBtn'),
    status: document.getElementById('updateStatusText'),
    statusNote: document.getElementById('updateStatusNote'),
    version: document.getElementById('appVersionText')
  };

  function setStatus(text, note) {
    if (els.status) els.status.textContent = text;
    if (els.statusNote && typeof note === 'string') els.statusNote.textContent = note;
  }

  function showInstall(show) {
    if (els.installBtn) els.installBtn.hidden = !show;
  }

  function readForm() {
    return {
      closeToTray: els.closeToTray ? els.closeToTray.checked : true,
      startAtLogin: els.startAtLogin ? els.startAtLogin.checked : false,
      startMinimized: els.startMinimized ? els.startMinimized.checked : false,
      autoCheckUpdates: els.autoCheckUpdates ? els.autoCheckUpdates.checked : true,
      desktopNotifications: els.desktopNotifications ? els.desktopNotifications.checked : true,
      notifyBeforeScheduledRun: els.notifyBeforeScheduledRun ? els.notifyBeforeScheduledRun.checked : true,
      schedulerPaused: els.schedulerPaused ? els.schedulerPaused.checked : false
    };
  }

  function applyToForm(settings) {
    const s = settings || {};
    if (els.closeToTray) els.closeToTray.checked = s.closeToTray !== false;
    if (els.startAtLogin) els.startAtLogin.checked = s.startAtLogin === true;
    if (els.startMinimized) els.startMinimized.checked = s.startMinimized === true;
    if (els.autoCheckUpdates) els.autoCheckUpdates.checked = s.autoCheckUpdates !== false;
    if (els.desktopNotifications) els.desktopNotifications.checked = s.desktopNotifications !== false;
    if (els.notifyBeforeScheduledRun) els.notifyBeforeScheduledRun.checked = s.notifyBeforeScheduledRun !== false;
    if (els.schedulerPaused) els.schedulerPaused.checked = s.schedulerPaused === true;
    syncDependentState();
  }

  function syncDependentState() {
    // "Start hidden" only makes sense when "start at login" is on.
    if (els.startMinimized && els.startAtLogin) {
      els.startMinimized.disabled = !els.startAtLogin.checked;
    }
  }

  async function persist() {
    if (typeof api.setBackgroundSettings !== 'function') return;
    syncDependentState();
    try {
      const saved = await api.setBackgroundSettings(readForm());
      applyToForm(saved);
      if (window.SyncarrToasts) window.SyncarrToasts.success('Setting saved');
    } catch {
      // Leave the form as-is; the next open re-reads the saved state.
    }
  }

  function describeUpdate(payload) {
    const p = payload || {};
    switch (p.status) {
      case 'checking': setStatus('Checking for updates…', ''); showInstall(false); break;
      case 'available': setStatus(`Update ${p.version || ''} found — downloading…`.trim(), ''); showInstall(false); break;
      case 'downloading': setStatus(`Downloading update… ${Number.isFinite(p.percent) ? p.percent + '%' : ''}`.trim(), ''); showInstall(false); break;
      case 'downloaded': setStatus(`Update ${p.version || ''} ready to install.`.trim(), 'Restart to finish updating.'); showInstall(true); break;
      case 'none': setStatus('You are on the latest version.', ''); showInstall(false); break;
      case 'dev': setStatus('Auto-update runs in a packaged build only.', 'Build the installer (npm run dist:win) to use updates.'); showInstall(false); break;
      case 'unsupported': setStatus('Auto-update is not installed.', p.message || 'Run npm install to add electron-updater.'); showInstall(false); break;
      case 'error': {
        // electron-updater errors are multi-line dumps (URL, headers, JSON);
        // keep only the first line so the card layout survives.
        const brief = String(p.message || '').split('\n')[0].trim().slice(0, 140);
        setStatus('Update check failed.', brief || 'Could not reach the update server. Check your connection and try again.');
        showInstall(false);
        break;
      }
      default: break;
    }
  }

  function bind() {
    [els.closeToTray, els.startAtLogin, els.startMinimized, els.autoCheckUpdates, els.desktopNotifications, els.notifyBeforeScheduledRun, els.schedulerPaused].forEach((input) => {
      if (input) input.addEventListener('change', persist);
    });

    if (els.checkBtn && typeof api.checkForUpdates === 'function') {
      els.checkBtn.addEventListener('click', async () => {
        setStatus('Checking for updates…', '');
        try { await api.checkForUpdates(); } catch { setStatus('Update check failed.', ''); }
      });
    }

    if (els.installBtn && typeof api.installUpdateNow === 'function') {
      els.installBtn.addEventListener('click', () => { api.installUpdateNow().catch(() => {}); });
    }

    if (typeof api.onUpdateEvent === 'function') {
      api.onUpdateEvent(describeUpdate);
    }
  }

  async function load() {
    if (typeof api.getBackgroundSettings === 'function') {
      try { applyToForm(await api.getBackgroundSettings()); } catch { /* keep defaults */ }
    }
    if (typeof api.getAppInfo === 'function') {
      try {
        const info = await api.getAppInfo();
        if (els.version && info && info.version) els.version.textContent = `v${info.version}`;
        if (info && info.autoUpdateSupported === false) {
          setStatus('Auto-update is not installed.', 'Run npm install to add electron-updater, then build the installer.');
        }
      } catch { /* ignore */ }
    }
  }

  function init() {
    bind();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
