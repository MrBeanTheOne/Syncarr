'use strict';

// Tray / window / app icon resolution via Electron nativeImage.
//
// assetsRoot MUST be injected: it is the directory that contains `assets/` and
// `renderer/assets/` — i.e. main.js's __dirname (the `src/` dir). This module
// lives in src/main/, so its own __dirname would point one level too deep and
// every icon path would miss. Inject createTrayIcons({ assetsRoot: __dirname })
// from main.js.

const path = require('path');
const { nativeImage } = require('electron');
const { isWindows, isMacOS } = require('./platform');
const { getMacOSTrayTemplateAssetPath } = require('./macos-tray-template');

const TRAY_ICON_BY_STATE = {
  idle: 'syncarr-tray-idle.ico',
  syncing: 'syncarr-tray-syncing.ico',
  success: 'syncarr-tray-success.ico',
  warning: 'syncarr-tray-warning.ico',
  error: 'syncarr-tray-error.ico',
  paused: 'syncarr-tray-paused.ico'
};

function createTrayIcons({ assetsRoot }) {
  function makeNativeImageFromCandidates(candidates = []) {
    for (const candidate of candidates) {
      try {
        const image = nativeImage.createFromPath(candidate);
        if (!image.isEmpty()) return image;
      } catch {
        // Try the next candidate.
      }
    }
    return nativeImage.createEmpty();
  }

  function getAppIconImage() {
    return makeNativeImageFromCandidates([
      path.join(assetsRoot, 'assets', 'ico', 'app', 'syncarr.ico'),
      path.join(assetsRoot, 'renderer', 'assets', 'syncarr-icon-dark-256.png')
    ]);
  }

  function getWindowIconImage() {
    return makeNativeImageFromCandidates([
      path.join(assetsRoot, 'assets', 'ico', 'taskbar', 'syncarr-taskbar.ico'),
      path.join(assetsRoot, 'assets', 'ico', 'app', 'syncarr.ico'),
      path.join(assetsRoot, 'renderer', 'assets', 'syncarr-icon-dark-256.png')
    ]);
  }

  function getTrayIconImage(state = 'idle') {
    const iconName = TRAY_ICON_BY_STATE[state] || TRAY_ICON_BY_STATE.idle;
    const portableIcon = path.join(assetsRoot, 'renderer', 'assets', 'syncarr-icon-dark-256.png');

    if (isMacOS()) {
      // macOS menu bar uses template images (black/transparent) that the OS
      // auto-inverts between light and dark menu bar. We generate a small PNG
      // asset at runtime if it's missing so the app works out-of-the-box.
      const templatePath = getMacOSTrayTemplateAssetPath({
        assetsDir: path.join(assetsRoot, 'renderer', 'assets')
      });
      try {
        const templateImage = nativeImage.createFromPath(templatePath);
        if (!templateImage.isEmpty()) {
          return templateImage.setTemplateImage(true);
        }
      } catch {
        // Fall through to the portable icon below.
      }
    }

    const candidates = isWindows()
      ? [
          path.join(assetsRoot, 'assets', 'ico', 'tray', iconName),
          path.join(assetsRoot, 'assets', 'ico', 'tray', TRAY_ICON_BY_STATE.idle),
          path.join(assetsRoot, 'assets', 'ico', 'app', 'syncarr.ico'),
          portableIcon
        ]
      : [portableIcon];
    const trayImage = makeNativeImageFromCandidates(candidates);
    if (!isWindows() && !trayImage.isEmpty()) {
      const size = isMacOS() ? 18 : 16;
      return trayImage.resize({ width: size, height: size });
    }
    return trayImage;
  }

  return { makeNativeImageFromCandidates, getAppIconImage, getWindowIconImage, getTrayIconImage };
}

module.exports = { createTrayIcons, TRAY_ICON_BY_STATE };
