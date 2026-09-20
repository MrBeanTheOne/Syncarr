const { execFile } = require('child_process');
const linuxAutostart = require('./linux-autostart');

function getPlatform() {
  return process.platform;
}

function isWindows(platform = getPlatform()) {
  return platform === 'win32';
}

function isMacOS(platform = getPlatform()) {
  return platform === 'darwin';
}

function isLinux(platform = getPlatform()) {
  return platform === 'linux';
}

function supportsLoginItems(platform = getPlatform()) {
  // All three supported platforms have *some* autostart mechanism: Windows and
  // macOS use Electron's app.setLoginItemSettings; Linux uses an XDG desktop
  // entry under ~/.config/autostart/.
  return isWindows(platform) || isMacOS(platform) || isLinux(platform);
}

function getPathSeparator(platform = getPlatform()) {
  return isWindows(platform) ? '\\' : '/';
}

function pathIdentityKey(input, platform = getPlatform()) {
  const clean = String(input || '').trim();
  if (!isWindows(platform)) return clean;
  return clean.replace(/\//g, '\\').toLowerCase();
}

function getPlatformCapabilities(platform = getPlatform()) {
  return {
    platform,
    windows: isWindows(platform),
    macOS: isMacOS(platform),
    linux: isLinux(platform),
    loginItems: supportsLoginItems(platform),
    autostartMechanism: getAutostartMechanism(platform),
    pathSeparator: getPathSeparator(platform),
    caseSensitivePaths: !isWindows(platform),
    statefulTrayIcons: isWindows(platform)
  };
}

function getAutostartMechanism(platform = getPlatform()) {
  if (isWindows(platform)) return 'electron';
  if (isMacOS(platform)) return 'electron';
  if (isLinux(platform)) return 'autostart-desktop';
  return null;
}

function buildLoginItemSettings(settings = {}, platform = getPlatform()) {
  if (!supportsLoginItems(platform)) return null;
  const openAtLogin = settings.startAtLogin === true;
  const openAsHidden = openAtLogin && settings.startMinimized === true;
  const mechanism = getAutostartMechanism(platform);

  if (mechanism === 'electron') {
    const result = { openAtLogin, openAsHidden, mechanism };
    if (isWindows(platform)) {
      result.args = openAsHidden ? [linuxAutostart.DEFAULT_HIDDEN_FLAG] : [];
    }
    return result;
  }

  if (mechanism === 'autostart-desktop') {
    // Linux payload: caller is expected to write (or remove) a desktop file at
    // `desktopFilePath`. We hand back the full entry string so the caller never
    // has to know the XDG format details.
    const execPath = settings.execPath || process.execPath;
    const workingDirectory = settings.workingDirectory || process.cwd();
    const args = [];
    // In dev mode the executable is the Electron binary, not a packaged app.
    // Electron loads the default app unless we pass it a path to load — append
    // the project root so `Exec=` is self-contained even without a `Path=`
    // entry. Packaged builds ignore the extra arg because the binary already
    // knows its own app dir.
    if (settings.isPackaged === false) {
      args.push(workingDirectory);
    }
    if (openAsHidden) args.push(linuxAutostart.DEFAULT_HIDDEN_FLAG);
    return {
      openAtLogin,
      openAsHidden,
      mechanism,
      desktopFilePath: linuxAutostart.getLinuxAutostartDesktopFilePath(),
      desktopEntry: openAtLogin
        ? linuxAutostart.buildLinuxDesktopEntry({
            execPath,
            args,
            workingDirectory
          })
        : null
    };
  }

  return null;
}

function calculateTrayWindowPosition({ trayBounds, windowBounds, workArea, gap = 6, margin = 8 } = {}) {
  const trayRect = normalizeRect(trayBounds);
  const windowRect = normalizeRect(windowBounds);
  const workRect = normalizeRect(workArea);
  const workRight = workRect.x + workRect.width;
  const workBottom = workRect.y + workRect.height;
  const trayRight = trayRect.x + trayRect.width;
  const trayBottom = trayRect.y + trayRect.height;
  const centeredX = trayRect.x + (trayRect.width - windowRect.width) / 2;
  const centeredY = trayRect.y + (trayRect.height - windowRect.height) / 2;
  let x = centeredX;
  let y = trayRect.y - windowRect.height - gap;

  if (trayRight <= workRect.x) {
    x = trayRight + gap;
    y = centeredY;
  } else if (trayRect.x >= workRight) {
    x = trayRect.x - windowRect.width - gap;
    y = centeredY;
  } else if (trayBottom <= workRect.y) {
    x = centeredX;
    y = trayBottom + gap;
  } else if (trayRect.y < workBottom && trayBottom + windowRect.height + gap <= workBottom) {
    x = centeredX;
    y = trayBottom + gap;
  }

  const minX = workRect.x + margin;
  const maxX = Math.max(minX, workRight - windowRect.width - margin);
  const minY = workRect.y + margin;
  const maxY = Math.max(minY, workBottom - windowRect.height - margin);
  return {
    x: Math.round(Math.max(minX, Math.min(maxX, x))),
    y: Math.round(Math.max(minY, Math.min(maxY, y)))
  };
}

function normalizeRect(input = {}) {
  return {
    x: Number(input.x) || 0,
    y: Number(input.y) || 0,
    width: Math.max(0, Number(input.width) || 0),
    height: Math.max(0, Number(input.height) || 0)
  };
}

function killProcessTree(child, platform = getPlatform()) {
  if (!child || !child.pid) return false;

  if (isWindows(platform)) {
    try {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } catch {
      // Fall back to Node's signal handling below.
    }
  }

  try {
    child.kill('SIGTERM');
    return true;
  } catch {
    try {
      child.kill();
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = {
  getPlatform,
  isWindows,
  isMacOS,
  supportsLoginItems,
  getAutostartMechanism,
  pathIdentityKey,
  getPlatformCapabilities,
  buildLoginItemSettings,
  calculateTrayWindowPosition,
  killProcessTree
};
