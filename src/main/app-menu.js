// macOS menu bar — follows Apple's Human Interface Guidelines.
//
// On macOS, the first menu in the menu bar must be the application name menu
// (with About / Hide / Quit). On Windows and Linux, we skip the menu bar
// entirely: Syncarr lives in the system tray, and a top-level menu just eats
// vertical space without adding value.

function buildAppMenuTemplate({ isMacOS: macOS, productName, version, actions }) {
  if (!macOS) return null;
  const safeActions = actions || {};
  const appName = productName || 'Syncarr';

  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: `Settings…`,
          accelerator: 'Cmd+,',
          click: () => { if (typeof safeActions.showMainWindow === 'function') safeActions.showMainWindow(); }
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: `About ${appName}`,
          enabled: false
        }
      ]
    }
  ];
}

function shouldInstallAppMenu(platform) {
  return platform === 'darwin';
}

module.exports = {
  buildAppMenuTemplate,
  shouldInstallAppMenu
};
