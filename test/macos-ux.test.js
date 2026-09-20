const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildAppMenuTemplate,
  shouldInstallAppMenu
} = require('../src/main/app-menu');
const {
  buildTemplateTrayPng,
  getMacOSTrayTemplateAssetPath,
  DEFAULT_TEMPLATE_FILENAME,
  DEFAULT_TEMPLATE_SIZE
} = require('../src/main/macos-tray-template');

test('shouldInstallAppMenu is true on macOS only', () => {
  assert.equal(shouldInstallAppMenu('darwin'), true);
  assert.equal(shouldInstallAppMenu('win32'), false);
  assert.equal(shouldInstallAppMenu('linux'), false);
  assert.equal(shouldInstallAppMenu('freebsd'), false);
});

test('buildAppMenuTemplate returns null on non-macOS platforms', () => {
  assert.equal(buildAppMenuTemplate({ isMacOS: false }), null);
  assert.equal(buildAppMenuTemplate({ isMacOS: true, productName: 'Syncarr' }).length > 0, true);
});

test('buildAppMenuTemplate puts the application name as the first menu on macOS', () => {
  const template = buildAppMenuTemplate({ isMacOS: true, productName: 'Syncarr' });
  assert.equal(template[0].label, 'Syncarr');
  // Apple HIG: the app menu must come first, then Edit / View / Window / Help.
  assert.deepEqual(template.map((entry) => entry.label || entry.role), [
    'Syncarr',
    'Edit',
    'View',
    'Window',
    'help'
  ]);
});

test('buildAppMenuTemplate includes the standard macOS app-menu items', () => {
  const template = buildAppMenuTemplate({ isMacOS: true, productName: 'Syncarr' });
  const appMenu = template[0];
  const roles = appMenu.submenu.map((entry) => entry.role);
  assert.ok(roles.includes('about'), 'app menu should include About');
  assert.ok(roles.includes('hide'), 'app menu should include Hide');
  assert.ok(roles.includes('hideOthers'), 'app menu should include Hide Others');
  assert.ok(roles.includes('quit'), 'app menu should include Quit');
  const settings = appMenu.submenu.find((entry) => entry.label && entry.label.startsWith('Settings'));
  assert.ok(settings, 'app menu should include a Settings… entry');
  assert.equal(settings.accelerator, 'Cmd+,');
});

test('buildAppMenuTemplate wires the settings click through the actions hook', () => {
  let called = 0;
  const template = buildAppMenuTemplate({
    isMacOS: true,
    productName: 'Syncarr',
    actions: { showMainWindow: () => { called += 1; } }
  });
  const settings = template[0].submenu.find((entry) => entry.label && entry.label.startsWith('Settings'));
  settings.click();
  assert.equal(called, 1);
});

test('buildAppMenuTemplate does not crash when actions hook is missing', () => {
  const template = buildAppMenuTemplate({ isMacOS: true, productName: 'Syncarr' });
  const settings = template[0].submenu.find((entry) => entry.label && entry.label.startsWith('Settings'));
  assert.doesNotThrow(() => settings.click());
});

test('buildTemplateTrayPng produces a valid PNG buffer of the requested size', () => {
  const png = buildTemplateTrayPng(DEFAULT_TEMPLATE_SIZE);
  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  assert.equal(png[0], 0x89);
  assert.equal(png[1], 0x50);
  assert.equal(png[2], 0x4E);
  assert.equal(png[3], 0x47);
  // IHDR chunk starts at offset 8; chunk length is 4 bytes, then "IHDR".
  assert.equal(png.slice(12, 16).toString('ascii'), 'IHDR');
  // Width and height come right after the chunk type.
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(width, DEFAULT_TEMPLATE_SIZE);
  assert.equal(height, DEFAULT_TEMPLATE_SIZE);
  // The buffer must end with an IEND chunk. Layout: 4-byte length (=0) +
  // 4-byte type 'IEND' + 0-byte data + 4-byte CRC. We check the type bytes.
  const iendChunk = png.slice(-12);
  assert.equal(iendChunk.readUInt32BE(0), 0, 'IEND data length is 0');
  assert.equal(iendChunk.slice(4, 8).toString('ascii'), 'IEND');
});

test('buildTemplateTrayPng handles a different size', () => {
  const png = buildTemplateTrayPng(16);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(width, 16);
  assert.equal(height, 16);
});

test('getMacOSTrayTemplateAssetPath writes the asset when missing and reuses it on subsequent calls', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syncarr-template-'));
  try {
    const first = getMacOSTrayTemplateAssetPath({ assetsDir: tmp });
    assert.equal(path.basename(first), DEFAULT_TEMPLATE_FILENAME);
    const stat1 = fs.statSync(first);
    const written = fs.readFileSync(first);
    // Magic bytes round-trip
    assert.equal(written[0], 0x89);
    assert.equal(written[1], 0x50);
    // Second call should be a no-op (no error, same path, file size unchanged).
    const second = getMacOSTrayTemplateAssetPath({ assetsDir: tmp });
    assert.equal(second, first);
    const stat2 = fs.statSync(second);
    assert.equal(stat2.size, stat1.size);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getMacOSTrayTemplateAssetPath requires an assetsDir', () => {
  assert.throws(() => getMacOSTrayTemplateAssetPath({}), /assetsDir is required/);
});
