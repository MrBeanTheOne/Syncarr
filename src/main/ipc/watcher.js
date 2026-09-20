function register(ipcMain, deps) {
  const { getSmartWatcherStatus } = deps;

  ipcMain.handle('watcher:getStatus', async () => (
    typeof getSmartWatcherStatus === 'function'
      ? getSmartWatcherStatus()
      : { enabledJobs: 0, watchedSources: 0, unavailableSources: 0, jobs: [] }
  ));
}

module.exports = { register };
