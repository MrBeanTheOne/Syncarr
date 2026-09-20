const test = require('node:test');
const assert = require('node:assert/strict');

const { createTelegramTokenCodec } = require('../src/main/telegram-token');
const { normalizeTelegramSettings } = require('../src/services/telegram');

// Fake safeStorage: reversible transform so round-trips are observable.
function makeFakeSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (buf) => {
      const raw = Buffer.from(buf).toString('utf8');
      if (!raw.startsWith('enc:')) throw new Error('corrupt blob');
      return raw.slice(4);
    }
  };
}

const CONFIG = {
  jobs: [],
  telegramSettings: { enabled: true, botToken: '123:secret-token', chatId: '42' }
};

test('seal/open round-trips the token without plaintext on the sealed side', () => {
  const codec = createTelegramTokenCodec({ safeStorage: makeFakeSafeStorage() });

  const sealed = codec.sealTelegramSettings(CONFIG);
  assert.equal(sealed.telegramSettings.botToken, '', 'no plaintext after sealing');
  assert.ok(sealed.telegramSettings.botTokenEncrypted, 'ciphertext is stored');
  assert.ok(!JSON.stringify(sealed).includes('secret-token'), 'the serialized config never contains the token');

  const opened = codec.openTelegramSettings(sealed);
  assert.equal(opened.telegramSettings.botToken, '123:secret-token', 'reading restores the in-memory token');
});

test('the sealed blob survives normalizeTelegramSettings (config-store normalization)', () => {
  const codec = createTelegramTokenCodec({ safeStorage: makeFakeSafeStorage() });
  const sealed = codec.sealTelegramSettings(CONFIG);

  // config-store.writeConfig runs normalizeConfig -> normalizeTelegramSettings
  // on everything it persists; the blob must not be stripped.
  const normalized = normalizeTelegramSettings(sealed.telegramSettings);
  assert.equal(normalized.botTokenEncrypted, sealed.telegramSettings.botTokenEncrypted);
  assert.equal(codec.openTelegramSettings({ telegramSettings: normalized }).telegramSettings.botToken, '123:secret-token');
});

test('sealing is a no-op when the token is empty or encryption is unavailable', () => {
  const codec = createTelegramTokenCodec({ safeStorage: makeFakeSafeStorage() });
  const noToken = { telegramSettings: { enabled: true, botToken: '', chatId: '42' } };
  assert.equal(codec.sealTelegramSettings(noToken), noToken);

  const unavailable = createTelegramTokenCodec({ safeStorage: makeFakeSafeStorage({ available: false }) });
  assert.equal(unavailable.sealTelegramSettings(CONFIG), CONFIG, 'fail-open: plaintext persists as before');

  const noStorage = createTelegramTokenCodec({});
  assert.equal(noStorage.sealTelegramSettings(CONFIG), CONFIG, 'no safeStorage (plain node) -> passthrough');
});

test('opening a corrupt blob fails soft: token dropped, config still readable', () => {
  const codec = createTelegramTokenCodec({ safeStorage: makeFakeSafeStorage() });
  const corrupt = { telegramSettings: { enabled: true, botToken: '', botTokenEncrypted: Buffer.from('garbage').toString('base64'), chatId: '42' } };

  const opened = codec.openTelegramSettings(corrupt);
  assert.equal(opened.telegramSettings.botToken, '', 'the token is dropped');
  assert.equal(opened.telegramSettings.chatId, '42', 'the rest of the settings survive');
});

test('a mid-migration config with BOTH plaintext and blob keeps the plaintext', () => {
  const codec = createTelegramTokenCodec({ safeStorage: makeFakeSafeStorage() });
  const both = { telegramSettings: { botToken: 'typed-new-token', botTokenEncrypted: Buffer.from('enc:old').toString('base64') } };
  assert.equal(codec.openTelegramSettings(both).telegramSettings.botToken, 'typed-new-token');
});

test('redaction strips both the token and the ciphertext, exposing only a boolean', () => {
  const codec = createTelegramTokenCodec({ safeStorage: makeFakeSafeStorage() });
  const sealed = codec.sealTelegramSettings(CONFIG);

  const redacted = codec.redactTelegramSettings(sealed);
  assert.equal(redacted.telegramSettings.botToken, '');
  assert.equal('botTokenEncrypted' in redacted.telegramSettings, false, 'ciphertext never reaches the renderer');
  assert.equal(redacted.telegramSettings.botTokenConfigured, true);

  const empty = codec.redactTelegramSettings({ telegramSettings: { enabled: false, botToken: '', chatId: '' } });
  assert.equal(empty.telegramSettings.botTokenConfigured, false);
});

test('hasPlaintextToken drives the startup migration decision', () => {
  const codec = createTelegramTokenCodec({ safeStorage: makeFakeSafeStorage() });
  assert.equal(codec.hasPlaintextToken(CONFIG), true, 'legacy plaintext config needs migration');
  assert.equal(codec.hasPlaintextToken(codec.sealTelegramSettings(CONFIG)), false, 'sealed config does not');
  assert.equal(codec.hasPlaintextToken({}), false);
});
