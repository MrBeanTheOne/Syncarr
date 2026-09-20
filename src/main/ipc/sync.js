// Sync IPC: run compare, run sync, cancel an active run.
//
// These (compare/run) are the heaviest IPC channels in the app and own a lot
// of shared state (active run id, cancellation, scheduler, progress event
// emission). They share the same deps object as the rest of main.js but the
// actual orchestration logic (`executeSyncRun`) is still defined in main.js —
// extracting that is its own refactor. (`buildSyncPreview` is still called
// internally by executeSyncRun; it just has no standalone IPC channel.)

function register(ipcMain, deps) {
  const {
    executeSyncRun,
    runCompareOnly,
    cancelActiveRun
  } = deps;

  ipcMain.handle('sync:compare', async (_event, request) => runCompareOnly(request || {}));
  ipcMain.handle('sync:run', async (_event, request) => executeSyncRun(request || {}));
  ipcMain.handle('sync:cancel', async () => cancelActiveRun());
}

module.exports = { register };
