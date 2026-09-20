const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('syncarr', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  testTelegram: (settings) => ipcRenderer.invoke('telegram:test', settings),
  pickSource: () => ipcRenderer.invoke('dialog:pickSource'),
  pickRestoreFolder: () => ipcRenderer.invoke('dialog:pickRestoreFolder'),
  testTarget: (targetPath) => ipcRenderer.invoke('target:test', targetPath),
  listHistory: (request) => ipcRenderer.invoke('history:list', request),
  restoreHistory: (request) => ipcRenderer.invoke('history:restore', request),
  deleteJobHistoryCache: (request) => ipcRenderer.invoke('history:deleteJobCache', request),
  listRestorePoints: (request) => ipcRenderer.invoke('restorePoints:list', request),
  readRestorePoint: (request) => ipcRenderer.invoke('restorePoints:read', request),
  previewRestorePointPlan: (request) => ipcRenderer.invoke('restorePoints:previewPlan', request),
  restorePointToFolder: (request) => ipcRenderer.invoke('restorePoints:restoreToFolder', request),
  getRecoveryStatus: () => ipcRenderer.invoke('recovery:status'),
  previewRecoveryRollback: (request) => ipcRenderer.invoke('recovery:previewRollback', request),
  rollbackRecoveryRun: (request) => ipcRenderer.invoke('recovery:rollback', request),
  resumeRecoveryRun: (request) => ipcRenderer.invoke('recovery:resume', request),
  dismissRecoveryRun: (request) => ipcRenderer.invoke('recovery:dismiss', request),
  compareSync: (request) => ipcRenderer.invoke('sync:compare', request),
  runSync: (request) => ipcRenderer.invoke('sync:run', request),
  cancelSync: () => ipcRenderer.invoke('sync:cancel'),
  onSyncEvent: (callback) => {
    const listener = (_event, payload) => {
      // Render-side handlers can briefly run before the DOM is fully wired
      // (e.g. a `complete` event arrives during a sync finalization). Without
      // this boundary the throw escapes the preload's listener and shows up as
      // an "Uncaught Error" in the console even though the renderer recovers.
      try {
        callback(payload);
      } catch (error) {
        // Surface only to the renderer's own console if it's available; do not
        // re-throw across the preload boundary.
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('sync:event handler error:', error && error.message ? error.message : error);
        }
      }
    };
    ipcRenderer.on('sync:event', listener);
    return () => ipcRenderer.removeListener('sync:event', listener);
  },
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  getBackgroundSettings: () => ipcRenderer.invoke('app:getBackgroundSettings'),
  setBackgroundSettings: (settings) => ipcRenderer.invoke('app:setBackgroundSettings', settings),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  installUpdateNow: () => ipcRenderer.invoke('app:installUpdateNow'),
  setTrayState: (state) => ipcRenderer.invoke('app:setTrayState', state),
  setTrayActivity: (activity) => ipcRenderer.send('app:updateTrayActivity', activity),
  onSchedulerEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('scheduler:event', listener);
    return () => ipcRenderer.removeListener('scheduler:event', listener);
  },
  onWatcherEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('watcher:event', listener);
    return () => ipcRenderer.removeListener('watcher:event', listener);
  },
  getWatcherStatus: () => ipcRenderer.invoke('watcher:getStatus'),
  onUpdateEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:update', listener);
    return () => ipcRenderer.removeListener('app:update', listener);
  },
  onFocusJob: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:focusJob', listener);
    return () => ipcRenderer.removeListener('app:focusJob', listener);
  }
});
