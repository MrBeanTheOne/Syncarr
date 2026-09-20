// Linux autostart via XDG desktop entry.
//
// The XDG Desktop Entry Specification (https://specifications.freedesktop.org/autostart-spec/autostart-spec-latest.html)
// describes how freedesktop.org-compliant desktop environments (GNOME, KDE, XFCE,
// Cinnamon, MATE, LXQt, etc.) pick up `.desktop` files in `$XDG_CONFIG_HOME/autostart/`
// (defaulting to `~/.config/autostart/`) at user login. This is the standard way
// to register a "start at login" preference on Linux — there is no Electron API
// equivalent to `app.setLoginItemSettings` on this platform.
//
// We intentionally do not depend on Electron here: this module is pure Node and
// can be unit-tested without booting the renderer.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_AUTOSTART_DIRNAME = 'autostart';
const DEFAULT_APP_SLUG = 'syncarr';
const DEFAULT_APP_DISPLAY_NAME = 'Syncarr';
const DEFAULT_HIDDEN_FLAG = '--hidden';

function getLinuxAutostartDirectory(env = process.env) {
  const xdgConfigHome = env && typeof env.XDG_CONFIG_HOME === 'string' ? env.XDG_CONFIG_HOME.trim() : '';
  const base = xdgConfigHome || path.join(os.homedir(), '.config');
  return path.join(base, DEFAULT_AUTOSTART_DIRNAME);
}

function getLinuxAutostartDesktopFilePath({ appSlug = DEFAULT_APP_SLUG, env = process.env } = {}) {
  return path.join(getLinuxAutostartDirectory(env), `${appSlug}.desktop`);
}

function shellQuoteExecToken(token) {
  if (token === '' || token == null) return '""';
  // Quote anything containing whitespace, quotes, or shell metacharacters.
  if (/[\s"'$`\\\n]/.test(token)) {
    return `"${String(token).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return String(token);
}

function buildLinuxDesktopEntry({
  appName = DEFAULT_APP_DISPLAY_NAME,
  execPath,
  args = [],
  workingDirectory = null,
  hiddenFlag = DEFAULT_HIDDEN_FLAG
} = {}) {
  if (!execPath || typeof execPath !== 'string') {
    throw new TypeError('buildLinuxDesktopEntry: execPath is required');
  }
  const execTokens = [execPath, ...(Array.isArray(args) ? args : [])];
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${appName}`,
    `Exec=${execTokens.map(shellQuoteExecToken).join(' ')}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    `Comment=${appName} background sync scheduler`
  ];
  if (workingDirectory && typeof workingDirectory === 'string' && workingDirectory.trim()) {
    lines.push(`Path=${workingDirectory}`);
  }
  if (hiddenFlag && typeof hiddenFlag === 'string') {
    lines.push(`X-Syncarr-HiddenFlag=${hiddenFlag}`);
  }
  // Trailing newline — most desktop entry parsers tolerate both, but POSIX
  // text files end with a newline.
  return lines.join('\n') + '\n';
}

function applyLinuxAutostartDesktopFile({
  desktopFilePath,
  desktopEntry,
  remove = false,
  fsModule = fs
} = {}) {
  if (!desktopFilePath || typeof desktopFilePath !== 'string') {
    throw new TypeError('applyLinuxAutostartDesktopFile: desktopFilePath is required');
  }
  const shouldRemove = remove === true || !desktopEntry;
  if (shouldRemove) {
    try {
      fsModule.unlinkSync(desktopFilePath);
      return { written: false, removed: true, path: desktopFilePath };
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        return { written: false, removed: false, path: desktopFilePath, noop: true };
      }
      throw err;
    }
  }
  if (typeof desktopEntry !== 'string') {
    throw new TypeError('applyLinuxAutostartDesktopFile: desktopEntry must be a string');
  }
  fsModule.mkdirSync(path.dirname(desktopFilePath), { recursive: true });
  fsModule.writeFileSync(desktopFilePath, desktopEntry, { encoding: 'utf8' });
  return { written: true, removed: false, path: desktopFilePath };
}

function readLinuxAutostartDesktopFile(desktopFilePath, fsModule = fs) {
  if (!desktopFilePath || typeof desktopFilePath !== 'string') return null;
  try {
    return fsModule.readFileSync(desktopFilePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

// Parse the simple key/value lines back out for IPC status reporting and tests.
function parseLinuxDesktopEntry(contents) {
  if (typeof contents !== 'string' || !contents) return null;
  const fields = {};
  const lines = contents.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) continue; // group headers
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    fields[key] = value;
  }
  return fields;
}

module.exports = {
  DEFAULT_HIDDEN_FLAG,
  getLinuxAutostartDirectory,
  getLinuxAutostartDesktopFilePath,
  buildLinuxDesktopEntry,
  applyLinuxAutostartDesktopFile,
  readLinuxAutostartDesktopFile,
  parseLinuxDesktopEntry
};
