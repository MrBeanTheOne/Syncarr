// App-lifecycle IPC handlers: app info, background settings (start at login,
// close-to-tray, auto-check updates), tray state, and auto-update.
//
// All handlers here are thin wrappers around helpers that already live in
// main.js — this module only owns the IPC channel → handler mapping.

function register(ipcMain, deps) {
const {
  app,
  getAutoUpdater,
  getPlatform,
  getPlatformCapabilities,
  getSyncEngineMetadata,
  setTrayActivity,
  setTrayState,
  setIsQuiting,
  refreshTrayMenu,
  loadBackgroundSettings,
  applyLoginItemSettings,
  getLoginItemStatus,
  readConfig,
  writeConfig,
  getBackgroundSettings,
  refreshBackgroundScheduler,
  checkForUpdates
} = deps;

  ipcMain.handle('app:getInfo', async () => ({
    version: app.getVersion(),
    platform: getPlatform(),
    capabilities: getPlatformCapabilities(),
    syncEngine: getSyncEngineMetadata(),
    isPackaged: app.isPackaged,
    autoUpdateSupported: getAutoUpdater() !== false,
    loginItem: getLoginItemStatus()
  }));

  ipcMain.on('app:updateTrayActivity', (_event, activity) => {
    setTrayActivity(activity || {});
  });

  ipcMain.handle('app:getBackgroundSettings', async () => {
    await loadBackgroundSettings();
    return getBackgroundSettings();
  });

  ipcMain.handle('app:setBackgroundSettings', async (_event, next) => {
    const config = await readConfig();
    const merged = {
      ...config,
      backgroundSettings: {
        startAtLogin: next && next.startAtLogin === true,
        closeToTray: !(next && next.closeToTray === false),
        startMinimized: next && next.startMinimized === true,
        autoCheckUpdates: !(next && next.autoCheckUpdates === false),
        desktopNotifications: !(next && next.desktopNotifications === false),
        notifyBeforeScheduledRun: !(next && next.notifyBeforeScheduledRun === false),
        schedulerPaused: next && next.schedulerPaused === true
      }
    };
    const saved = await writeConfig(merged);
    await loadBackgroundSettings();
    applyLoginItemSettings(saved.backgroundSettings);
    refreshTrayMenu();
    if (refreshBackgroundScheduler) await refreshBackgroundScheduler();
    return {
      ...saved.backgroundSettings,
      loginItem: getLoginItemStatus()
    };
  });

  ipcMain.handle('app:checkForUpdates', async () => checkForUpdates({ interactive: true }));

  ipcMain.handle('app:setTrayState', async (_event, state) => ({
    ok: true,
    state: setTrayState(state, ['success', 'warning', 'error', 'paused'].includes(state) ? { resetAfterMs: 9000 } : {})
  }));

  ipcMain.handle('app:installUpdateNow', async () => {
    const updater = getAutoUpdater();
    if (!updater || !app.isPackaged) {
      return { ok: false, message: 'No downloaded update to install.' };
    }
    setIsQuiting(true);
    setImmediate(() => updater.quitAndInstall());
    return { ok: true };
  });
}

module.exports = { register };
