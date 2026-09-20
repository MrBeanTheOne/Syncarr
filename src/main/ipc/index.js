// Single entry point that wires every IPC domain module with the shared
// dependency bundle. main.js calls `registerIpcHandlers(ipcMain, deps)` once
// during bootstrap, after all helpers and module-level state are wired.
//
// Each domain module owns its channel names and is responsible for:
//   - declaring which dependencies it needs via the destructured `deps` arg,
//   - keeping its handlers thin — actual orchestration stays in main.js.

const { register: registerAppIpc } = require('./app');
const { register: registerTrayIpc } = require('./tray');
const { register: registerConfigIpc } = require('./config');
const { register: registerTelegramIpc } = require('./telegram');
const { register: registerDialogIpc } = require('./dialog');
const { register: registerTargetIpc } = require('./target');
const { register: registerHistoryIpc } = require('./history');
const { register: registerRestorePointsIpc } = require('./restore-points');
const { register: registerSyncIpc } = require('./sync');
const { register: registerWatcherIpc } = require('./watcher');
const { register: registerRecoveryIpc } = require('./recovery');

// Wrap ipcMain so EVERY `handle` gains a uniform try/catch. Without it, a
// handler that throws surfaces to the renderer's invoke() as an unhandled
// rejection — the UI then silently shows nothing or hangs a spinner. Several
// handlers already catch into `{ ok:false, message }`; this makes the rest
// consistent (and logs the failure so it isn't masked). `on` registrations
// (fire-and-forget events) pass through untouched.
function withSafeHandle(ipcMain) {
  return {
    handle(channel, handler) {
      return ipcMain.handle(channel, async (...args) => {
        try {
          return await handler(...args);
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          console.error(`[syncarr] IPC handler "${channel}" failed:`, error && error.stack ? error.stack : message);
          return { ok: false, status: 'error', message };
        }
      });
    },
    on: (...args) => ipcMain.on(...args),
    removeHandler: (...args) => ipcMain.removeHandler(...args)
  };
}

function registerIpcHandlers(ipcMain, deps) {
  const safe = withSafeHandle(ipcMain);
  registerAppIpc(safe, deps);
  registerTrayIpc(safe, deps);
  registerConfigIpc(safe, deps);
  registerTelegramIpc(safe, deps);
  registerDialogIpc(safe, deps);
  registerTargetIpc(safe, deps);
  registerHistoryIpc(safe, deps);
  registerRestorePointsIpc(safe, deps);
  registerSyncIpc(safe, deps);
  registerWatcherIpc(safe, deps);
  registerRecoveryIpc(safe, deps);
}

module.exports = { registerIpcHandlers, withSafeHandle };
