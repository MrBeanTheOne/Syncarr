const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

const {
  pathIdentityKey,
  getPlatformCapabilities,
  getAutostartMechanism,
  buildLoginItemSettings,
  calculateTrayWindowPosition
} = require('../src/main/platform');
const {
  getLinuxAutostartDirectory,
  getLinuxAutostartDesktopFilePath,
  buildLinuxDesktopEntry,
  applyLinuxAutostartDesktopFile,
  readLinuxAutostartDesktopFile,
  parseLinuxDesktopEntry,
  DEFAULT_HIDDEN_FLAG
} = require('../src/main/linux-autostart');

test('path identity follows host case and separator rules', () => {
  assert.equal(pathIdentityKey('C:/Photos/RAW', 'win32'), 'c:\\photos\\raw');
  assert.equal(pathIdentityKey('/Photos/RAW', 'linux'), '/Photos/RAW');
  assert.notEqual(pathIdentityKey('/Photos/RAW', 'linux'), pathIdentityKey('/photos/raw', 'linux'));
  assert.notEqual(pathIdentityKey('/Volumes/Media', 'darwin'), pathIdentityKey('/Volumes/media', 'darwin'));
});

test('platform capabilities expose portable UI behavior', () => {
  assert.deepEqual(getPlatformCapabilities('linux'), {
    platform: 'linux',
    windows: false,
    macOS: false,
    linux: true,
    loginItems: true,
    autostartMechanism: 'autostart-desktop',
    pathSeparator: '/',
    caseSensitivePaths: true,
    statefulTrayIcons: false
  });
  assert.equal(getPlatformCapabilities('win32').pathSeparator, '\\');
  assert.equal(getPlatformCapabilities('darwin').loginItems, true);
  assert.equal(getPlatformCapabilities('win32').autostartMechanism, 'electron');
  assert.equal(getPlatformCapabilities('darwin').autostartMechanism, 'electron');
  // Unknown platforms still get a capabilities object — they just have
  // autostartMechanism: null and loginItems: false.
  const freebsd = getPlatformCapabilities('freebsd');
  assert.equal(freebsd.platform, 'freebsd');
  assert.equal(freebsd.autostartMechanism, null);
  assert.equal(freebsd.loginItems, false);
});

test('login item settings include a mechanism discriminator and omit Windows args on macOS', () => {
  const settings = { startAtLogin: true, startMinimized: true };
  assert.deepEqual(buildLoginItemSettings(settings, 'win32'), {
    openAtLogin: true,
    openAsHidden: true,
    mechanism: 'electron',
    args: ['--hidden']
  });
  assert.deepEqual(buildLoginItemSettings(settings, 'darwin'), {
    openAtLogin: true,
    openAsHidden: true,
    mechanism: 'electron'
  });
  // Linux is now non-null — see "Linux autostart payload" test below.
  const linux = buildLoginItemSettings(settings, 'linux');
  assert.ok(linux, 'linux should return a non-null payload');
  assert.equal(linux.mechanism, 'autostart-desktop');
  assert.equal(linux.openAtLogin, true);
  assert.equal(linux.openAsHidden, true);
});

test('login item settings are null on platforms with no autostart mechanism', () => {
  assert.equal(buildLoginItemSettings({ startAtLogin: true }, 'freebsd'), null);
  assert.equal(getAutostartMechanism('freebsd'), null);
});

test('tray window positioning supports bottom, top, and side panels', () => {
  const windowBounds = { width: 390, height: 300 };
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

  assert.deepEqual(calculateTrayWindowPosition({
    trayBounds: { x: 1800, y: 1040, width: 24, height: 40 },
    windowBounds,
    workArea
  }), { x: 1522, y: 732 });

  assert.deepEqual(calculateTrayWindowPosition({
    trayBounds: { x: 900, y: 0, width: 24, height: 24 },
    windowBounds,
    workArea: { x: 0, y: 24, width: 1920, height: 1056 }
  }), { x: 717, y: 32 });

  assert.deepEqual(calculateTrayWindowPosition({
    trayBounds: { x: 1920, y: 500, width: 36, height: 24 },
    windowBounds,
    workArea
  }), { x: 1522, y: 362 });
});

test('Linux autostart directory follows XDG_CONFIG_HOME or falls back to ~/.config', () => {
  assert.equal(
    getLinuxAutostartDirectory({ XDG_CONFIG_HOME: '/srv/cfg' }),
    path.join('/srv/cfg', 'autostart')
  );
  // Empty / unset XDG_CONFIG_HOME falls through to os.homedir() — assert
  // against the real value because homedir is host-dependent.
  assert.equal(
    getLinuxAutostartDirectory({ XDG_CONFIG_HOME: '' }),
    path.join(os.homedir(), '.config', 'autostart')
  );
  assert.equal(
    getLinuxAutostartDirectory({}),
    path.join(os.homedir(), '.config', 'autostart')
  );
});

test('Linux desktop file path mirrors the autostart directory + slug', () => {
  const filePath = getLinuxAutostartDesktopFilePath({ env: { XDG_CONFIG_HOME: '/etc/xdg' } });
  assert.equal(filePath, path.join('/etc/xdg', 'autostart', 'syncarr.desktop'));
  assert.equal(
    getLinuxAutostartDesktopFilePath({ appSlug: 'other', env: { XDG_CONFIG_HOME: '/etc/xdg' } }),
    path.join('/etc/xdg', 'autostart', 'other.desktop')
  );
});

test('Linux desktop entry builder emits a valid XDG desktop file', () => {
  const entry = buildLinuxDesktopEntry({
    appName: 'Syncarr',
    execPath: '/opt/Syncarr/syncarr',
    args: [DEFAULT_HIDDEN_FLAG],
    workingDirectory: '/opt/Syncarr'
  });
  // Required header + standard keys.
  assert.match(entry, /^\[Desktop Entry\]\n/);
  assert.match(entry, /^Type=Application$/m);
  assert.match(entry, /^Name=Syncarr$/m);
  assert.match(entry, /^Exec=\/opt\/Syncarr\/syncarr --hidden$/m);
  assert.match(entry, /^Terminal=false$/m);
  assert.match(entry, /^X-GNOME-Autostart-enabled=true$/m);
  assert.match(entry, /^Path=\/opt\/Syncarr$/m);
  // Trailing newline.
  assert.ok(entry.endsWith('\n'));
});

test('Linux desktop entry builder shell-quotes args with whitespace', () => {
  const entry = buildLinuxDesktopEntry({
    appName: 'Syncarr',
    execPath: '/opt/Syncarr with space/syncarr',
    args: ['--label=My App']
  });
  // Path with whitespace must be double-quoted in Exec=.
  assert.match(entry, /^Exec="\/opt\/Syncarr with space\/syncarr" "--label=My App"$/m);
});

test('Linux desktop entry builder rejects missing execPath', () => {
  assert.throws(() => buildLinuxDesktopEntry({ appName: 'Syncarr' }), /execPath is required/);
});

test('Linux autostart apply writes a desktop file when enabled', () => {
  const calls = { mkdir: [], writeFile: [], unlink: [] };
  const fakeFs = {
    mkdirSync(p) { calls.mkdir.push(p); },
    writeFileSync(p, content) { calls.writeFile.push({ p, content }); },
    unlinkSync() { throw Object.assign(new Error('should not unlink on enable'), { code: 'EUNEXPECTED' }); }
  };
  const result = applyLinuxAutostartDesktopFile({
    desktopFilePath: '/srv/cfg/autostart/syncarr.desktop',
    desktopEntry: '[Desktop Entry]\nType=Application\n',
    fsModule: fakeFs
  });
  assert.equal(result.written, true);
  assert.equal(result.removed, false);
  assert.equal(calls.mkdir[0], '/srv/cfg/autostart');
  assert.equal(calls.writeFile.length, 1);
  assert.equal(calls.writeFile[0].p, '/srv/cfg/autostart/syncarr.desktop');
  assert.equal(calls.writeFile[0].content, '[Desktop Entry]\nType=Application\n');
});

test('Linux autostart apply removes a desktop file when disabled', () => {
  const unlinked = [];
  const fakeFs = {
    mkdirSync() { throw new Error('should not mkdir on remove'); },
    writeFileSync() { throw new Error('should not write on remove'); },
    unlinkSync(p) { unlinked.push(p); }
  };
  const result = applyLinuxAutostartDesktopFile({
    desktopFilePath: '/srv/cfg/autostart/syncarr.desktop',
    desktopEntry: null,
    fsModule: fakeFs
  });
  assert.equal(result.written, false);
  assert.equal(result.removed, true);
  assert.deepEqual(unlinked, ['/srv/cfg/autostart/syncarr.desktop']);
});

test('Linux autostart apply treats ENOENT on remove as a noop', () => {
  const fakeFs = {
    mkdirSync() { throw new Error('unused'); },
    writeFileSync() { throw new Error('unused'); },
    unlinkSync() { throw Object.assign(new Error('not there'), { code: 'ENOENT' }); }
  };
  const result = applyLinuxAutostartDesktopFile({
    desktopFilePath: '/missing/syncarr.desktop',
    desktopEntry: null,
    fsModule: fakeFs
  });
  assert.equal(result.written, false);
  assert.equal(result.removed, false);
  assert.equal(result.noop, true);
});

test('Linux autostart apply rethrows unexpected filesystem errors', () => {
  const fakeFs = {
    mkdirSync() { throw new Error('unused'); },
    writeFileSync() { throw new Error('unused'); },
    unlinkSync() { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); }
  };
  assert.throws(() => applyLinuxAutostartDesktopFile({
    desktopFilePath: '/srv/cfg/autostart/syncarr.desktop',
    desktopEntry: null,
    fsModule: fakeFs
  }), /permission denied/);
});

test('Linux autostart apply requires a desktopFilePath', () => {
  assert.throws(() => applyLinuxAutostartDesktopFile({ desktopEntry: 'x' }), /desktopFilePath is required/);
  assert.throws(() => applyLinuxAutostartDesktopFile({ desktopFilePath: '/x', desktopEntry: 42 }), /desktopEntry must be a string/);
});

test('Linux desktop file read returns null on ENOENT and contents otherwise', () => {
  const calls = [];
  const fakeFsMissing = {
    readFileSync() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }
  };
  assert.equal(readLinuxAutostartDesktopFile('/missing', fakeFsMissing), null);

  const fakeFsOk = {
    readFileSync(p, enc) { calls.push([p, enc]); return 'Type=Application\nName=Syncarr\n'; }
  };
  const result = readLinuxAutostartDesktopFile('/srv/cfg/autostart/syncarr.desktop', fakeFsOk);
  assert.equal(result, 'Type=Application\nName=Syncarr\n');
  assert.deepEqual(calls, [['/srv/cfg/autostart/syncarr.desktop', 'utf8']]);
});

test('Linux desktop entry parser flattens key/value lines', () => {
  const fields = parseLinuxDesktopEntry([
    '[Desktop Entry]',
    '# comment',
    '',
    'Type=Application',
    'Name=Syncarr',
    'Exec=/opt/Syncarr/syncarr',
    'X-GNOME-Autostart-enabled=true'
  ].join('\n'));
  assert.deepEqual(fields, {
    Type: 'Application',
    Name: 'Syncarr',
    Exec: '/opt/Syncarr/syncarr',
    'X-GNOME-Autostart-enabled': 'true'
  });
  assert.equal(parseLinuxDesktopEntry(''), null);
  assert.equal(parseLinuxDesktopEntry(null), null);
});

test('buildLoginItemSettings Linux payload appends the project root in dev mode', () => {
  // Dev mode (isPackaged: false) — the executable is the Electron binary
  // inside node_modules, so we need to pass the project root as an arg or
  // Electron loads its default app. The exec line must therefore be
  // `<exec> <cwd> --hidden`.
  const dev = buildLoginItemSettings({
    startAtLogin: true,
    startMinimized: true,
    execPath: '/home/dev/syncarr/node_modules/electron/dist/electron',
    workingDirectory: '/home/dev/syncarr',
    isPackaged: false
  }, 'linux');
  assert.equal(dev.mechanism, 'autostart-desktop');
  assert.match(
    dev.desktopEntry,
    /^Exec="?\/home\/dev\/syncarr\/node_modules\/electron\/dist\/electron"? \/home\/dev\/syncarr --hidden$/m
  );
});

test('buildLoginItemSettings Linux payload omits the project root in packaged mode', () => {
  // Packaged mode (isPackaged: true) — the binary knows its own app dir, so
  // no extra path arg is needed. exec line stays `<exec> --hidden`.
  const packaged = buildLoginItemSettings({
    startAtLogin: true,
    startMinimized: true,
    execPath: '/opt/Syncarr/syncarr',
    workingDirectory: '/opt/Syncarr',
    isPackaged: true
  }, 'linux');
  assert.match(
    packaged.desktopEntry,
    /^Exec="?\/opt\/Syncarr\/syncarr"? --hidden$/m
  );
  // When isPackaged is not specified, we default to "assume packaged" (the
  // safer option — a packaged binary would misinterpret a stray cwd arg as
  // a file path to load). The dev-mode case has to be opted into explicitly.
  const legacy = buildLoginItemSettings({
    startAtLogin: true,
    startMinimized: true,
    execPath: '/opt/Syncarr/syncarr',
    workingDirectory: '/opt/Syncarr'
  }, 'linux');
  assert.match(
    legacy.desktopEntry,
    /^Exec="?\/opt\/Syncarr\/syncarr"? --hidden$/m
  );
});

test('buildLoginItemSettings Linux payload round-trips via apply + read + parse', () => {
  // The full lifecycle: build the payload, apply it, then re-read the file
  // and parse it back. Uses an in-memory mock filesystem so we never touch disk.
  const files = {};
  const dirs = new Set();
  const fakeFs = {
    mkdirSync(p) { dirs.add(p); },
    writeFileSync(p, content) { files[p] = content; },
    unlinkSync(p) { delete files[p]; },
    readFileSync(p) {
      if (!(p in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return files[p];
    }
  };

  const payload = buildLoginItemSettings({
    startAtLogin: true,
    startMinimized: true,
    execPath: '/opt/Syncarr/syncarr',
    workingDirectory: '/opt/Syncarr',
    isPackaged: true
  }, 'linux');
  assert.equal(payload.mechanism, 'autostart-desktop');
  assert.equal(payload.openAtLogin, true);
  assert.equal(payload.openAsHidden, true);
  assert.ok(payload.desktopFilePath.endsWith('syncarr.desktop'));
  assert.match(payload.desktopEntry, /^Exec="?\/opt\/Syncarr\/syncarr"? --hidden$/m);

  // Apply + read back.
  const writeResult = applyLinuxAutostartDesktopFile({
    desktopFilePath: payload.desktopFilePath,
    desktopEntry: payload.desktopEntry,
    fsModule: fakeFs
  });
  assert.equal(writeResult.written, true);
  assert.ok(dirs.has(path.dirname(payload.desktopFilePath)));

  const readBack = readLinuxAutostartDesktopFile(payload.desktopFilePath, fakeFs);
  const parsed = parseLinuxDesktopEntry(readBack);
  assert.equal(parsed.Type, 'Application');
  assert.equal(parsed.Name, 'Syncarr');
  assert.match(parsed.Exec, /^\/opt\/Syncarr\/syncarr --hidden$/);
  assert.equal(parsed['X-GNOME-Autostart-enabled'], 'true');
  assert.equal(parsed.Path, '/opt/Syncarr');

  // Now toggle off: apply with desktopEntry=null should unlink.
  const disablePayload = buildLoginItemSettings({
    startAtLogin: false,
    startMinimized: false,
    execPath: '/opt/Syncarr/syncarr',
    workingDirectory: '/opt/Syncarr',
    isPackaged: true
  }, 'linux');
  assert.equal(disablePayload.openAtLogin, false);
  assert.equal(disablePayload.desktopEntry, null);
  const removeResult = applyLinuxAutostartDesktopFile({
    desktopFilePath: disablePayload.desktopFilePath,
    desktopEntry: disablePayload.desktopEntry,
    fsModule: fakeFs
  });
  assert.equal(removeResult.removed, true);
  assert.equal(readLinuxAutostartDesktopFile(disablePayload.desktopFilePath, fakeFs), null);
});
