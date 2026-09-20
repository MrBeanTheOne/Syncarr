// Tray-window IPC: resize (one-way), getActivity, command.

function register(ipcMain, deps) {
  const {
    getTrayWindow,
    getTrayActivity,
    positionTrayWindow,
    showMainWindow,
    startBackgroundScheduler,
    setSchedulerPaused,
    cancelActiveRun
  } = deps;

  ipcMain.on('tray:resize', (event, size) => {
    const trayWindow = getTrayWindow();
    if (!trayWindow || trayWindow.isDestroyed() || event.sender !== trayWindow.webContents) return;
    const requestedHeight = Math.round(Number(size && size.height) || 0);
    const height = Math.max(280, Math.min(620, requestedHeight));
    if (trayWindow.getBounds().height === height) return;
    // Resize and reposition together so the flyout stays pinned to the taskbar
    // (a separate setSize + reposition could position for a stale height and
    // leave the panel floating after a run).
    positionTrayWindow(height);
  });

  ipcMain.handle('tray:getActivity', async () => getTrayActivity());

  ipcMain.handle('tray:command', async (_event, command) => {
    if (command === 'open') {
      showMainWindow();
      return { ok: true };
    }
    if (command === 'run-next-scheduled' || command === 'run-scheduler') {
      // Keep the flyout open so the user sees the task move into the active
      // card and run, instead of the window disappearing on click.
      return startBackgroundScheduler().runNext();
    }
    if (command === 'cancel') {
      return cancelActiveRun();
    }
    if (command === 'toggle-scheduler-pause') {
      const activity = getTrayActivity();
      return setSchedulerPaused(!(activity && activity.schedulerPaused === true));
    }
    if (command === 'hide') {
      const trayWindow = getTrayWindow();
      if (trayWindow && !trayWindow.isDestroyed()) trayWindow.hide();
      return { ok: true };
    }
    return { ok: false, message: 'Unknown tray command.' };
  });
}

module.exports = { register };
