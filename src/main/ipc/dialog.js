// Folder-picker dialogs. Both use mainWindow as the parent so the dialog is
// modal against the app window (not floating on its own).

function register(ipcMain, deps) {
  const { dialog, getMainWindow } = deps;

  ipcMain.handle('dialog:pickSource', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Choose source folder',
      properties: ['openDirectory']
    });

    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:pickRestoreFolder', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Choose restore folder',
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
}

module.exports = { register };
