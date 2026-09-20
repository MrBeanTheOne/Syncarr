// Navigation hardening for BrowserWindows (audit M2). Both app windows only
// ever load local files via loadFile, and nothing in the renderer uses
// window.open or external links — so new windows are denied outright and
// navigation is restricted to the URL the window already shows (which keeps
// Ctrl+R / webContents.reload() working: on some Electron versions a reload
// emits will-navigate for the current URL). will-navigate does not fire for
// main-process loadFile/loadURL calls, so initial loads are unaffected.
function installWebContentsGuards(contents) {
  if (!contents) return;

  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault();
  });
}

module.exports = { installWebContentsGuards };
