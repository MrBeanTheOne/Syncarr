'use strict';

// "Start at login" registration + status. Maps to three platform mechanisms:
// Electron's login-item API (Windows + macOS) and an XDG autostart desktop file
// (Linux). All collaborators (platform capability checks, the Linux autostart
// helper, and Electron's app) are required directly — no injection needed.

const { app } = require('electron');
const { supportsLoginItems, buildLoginItemSettings, getAutostartMechanism } = require('./platform');
const linuxAutostart = require('./linux-autostart');

function applyLoginItemSettings(settings) {
  if (!supportsLoginItems()) return;
  const loginItemSettings = buildLoginItemSettings({ ...settings, isPackaged: app.isPackaged });
  if (!loginItemSettings) return;
  const mechanism = loginItemSettings.mechanism || getAutostartMechanism();

  if (mechanism === 'autostart-desktop') {
    try {
      linuxAutostart.applyLinuxAutostartDesktopFile({
        desktopFilePath: loginItemSettings.desktopFilePath,
        desktopEntry: loginItemSettings.desktopEntry
      });
    } catch (err) {
      // Autostart registration is best-effort; surface to logs but never block
      // startup on a filesystem permission error.
      console.warn('[syncarr] failed to apply Linux autostart desktop entry:', err && err.message || err);
    }
    return;
  }

  // Default: Electron's built-in login-item API (Windows + macOS).
  try {
    app.setLoginItemSettings(loginItemSettings);
  } catch {
    // Login-item registration is best-effort; never block startup on it.
  }
}

function getLoginItemStatus() {
  const mechanism = getAutostartMechanism();
  if (mechanism === 'autostart-desktop') {
    const desktopFilePath = linuxAutostart.getLinuxAutostartDesktopFilePath();
    const contents = linuxAutostart.readLinuxAutostartDesktopFile(desktopFilePath);
    const fields = contents ? linuxAutostart.parseLinuxDesktopEntry(contents) : null;
    return {
      mechanism,
      registered: Boolean(fields && fields.Type === 'Application'),
      path: desktopFilePath,
      entry: fields
    };
  }
  if (mechanism === 'electron') {
    try {
      const status = app.getLoginItemSettings();
      return {
        mechanism,
        registered: status && status.openAtLogin === true,
        openAsHidden: status && status.openAsHidden === true
      };
    } catch {
      return { mechanism, registered: false };
    }
  }
  return { mechanism: null, registered: false };
}

module.exports = { applyLoginItemSettings, getLoginItemStatus };
