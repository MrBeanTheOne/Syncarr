// macOS tray template image — generates a small black-with-alpha PNG that
// Electron's Tray will treat as a template image when setTemplateImage(true)
// is called. The macOS menu bar automatically inverts template images between
// light and dark mode, so we only need a single black-on-transparent asset
// instead of light/dark variants.
//
// The icon is a simple rounded square with a small "S" mark in negative space —
// replace the file on disk at build time with a designed asset if the branding
// team ever ships one. The filename includes "Template" per Apple's convention
// (Finder uses the suffix to pick the right variant for status bar items).
//
// We build the PNG by hand because we want zero dev dependencies and the file
// is generated once at build time / first launch.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function pngCrc32(buf) {
  // zlib.crc32 returns a signed 32-bit integer — convert to unsigned for PNG.
  return (zlib.crc32(buf) >>> 0);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(crcInput), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makeTemplatePngPixels(size) {
  // Build raw RGBA: black with rounded corners and a stylized "S" mark in
  // negative space. The exact glyph doesn't matter — the goal is a clearly
  // recognizable tray icon, not a logo.
  const stride = size * 4 + 1; // +1 for the PNG filter byte per row
  const raw = Buffer.alloc(stride * size);
  const radius = Math.max(2, Math.floor(size / 5));

  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // PNG filter type: None
    for (let x = 0; x < size; x++) {
      const dxLeft = radius - x;
      const dxRight = x - (size - 1 - radius);
      const dyTop = radius - y;
      const dyBottom = y - (size - 1 - radius);
      const cornerCutoff = (dxLeft > 0 && dyTop > 0)
        || (dxRight > 0 && dyTop > 0)
        || (dxLeft > 0 && dyBottom > 0)
        || (dxRight > 0 && dyBottom > 0);
      const inCorner = cornerCutoff
        && (dxLeft * dxLeft + dyTop * dyTop > radius * radius)
        && (dxRight * dxRight + dyTop * dyTop > radius * radius)
        && (dxLeft * dxLeft + dyBottom * dyBottom > radius * radius)
        && (dxRight * dxRight + dyBottom * dyBottom > radius * radius);

      // Build an "S" mark — two stacked horizontal bars connected diagonally.
      // Tuned by eye for the 22x22 default size.
      const t = size / 22;
      const barTop = Math.round(7 * t);
      const barBottom = Math.round(15 * t);
      const barHeight = Math.max(2, Math.round(2 * t));
      const inTopBar = y >= barTop && y < barTop + barHeight && x >= 4 && x < size - 4;
      const inBottomBar = y >= barBottom && y < barBottom + barHeight && x >= 4 && x < size - 4;
      const inLeft = y >= barTop + barHeight && y < barBottom && x >= 4 && x < 4 + barHeight;
      const inRight = y >= barTop && y < barBottom - barHeight + 1 && x >= size - 4 - barHeight && x < size - 4;
      const inMark = inTopBar || inBottomBar || inLeft || inRight;

      const offset = y * stride + 1 + x * 4;
      if (inCorner || inMark) {
        // Transparent — let the menu bar show through.
        raw[offset] = 0;
        raw[offset + 1] = 0;
        raw[offset + 2] = 0;
        raw[offset + 3] = 0;
      } else {
        // Pure black with full alpha.
        raw[offset] = 0;
        raw[offset + 1] = 0;
        raw[offset + 2] = 0;
        raw[offset + 3] = 255;
      }
    }
  }
  return raw;
}

function buildTemplateTrayPng(size = 22) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth: 8
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression: deflate
  ihdr[11] = 0;  // filter: standard
  ihdr[12] = 0;  // interlace: none
  const idat = zlib.deflateSync(makeTemplatePngPixels(size));
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const DEFAULT_TEMPLATE_FILENAME = 'syncarr-trayTemplate.png';
const DEFAULT_TEMPLATE_SIZE = 22;

function getMacOSTrayTemplateAssetPath({ assetsDir, filename = DEFAULT_TEMPLATE_FILENAME, force = false } = {}) {
  if (!assetsDir) throw new TypeError('getMacOSTrayTemplateAssetPath: assetsDir is required');
  const target = path.join(assetsDir, filename);
  if (force || !fs.existsSync(target)) {
    const png = buildTemplateTrayPng(DEFAULT_TEMPLATE_SIZE);
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(target, png);
  }
  return target;
}

module.exports = {
  buildTemplateTrayPng,
  getMacOSTrayTemplateAssetPath,
  DEFAULT_TEMPLATE_FILENAME,
  DEFAULT_TEMPLATE_SIZE
};
