// Telegram bot-token sealing (audit M1).
//
// The token used to be persisted in plaintext inside syncarr-config.json (and
// its three rotating backups) and returned verbatim to the renderer on every
// config:load. This codec seals it with Electron safeStorage (DPAPI on
// Windows) at the persistence boundary and opens it back into memory on read,
// so every internal consumer (run notifications, scheduler, watcher) keeps
// seeing a usable plaintext token while the disk only ever holds ciphertext.
// The IPC layer uses redactTelegramSettings so the renderer sees neither.
//
// Posture: fail-open, matching the storage-check precedent (H5). If
// encryption is unavailable (rare — non-Electron test runs, exotic setups),
// sealing is a no-op and the pre-M1 plaintext behavior remains; if a sealed
// blob cannot be decrypted (user profile changed), the token is dropped but
// the config stays readable — the user re-enters the token.
//
// Pure except for the injected safeStorage (tests supply a fake).

function createTelegramTokenCodec({ safeStorage } = {}) {
  function isEncryptionAvailable() {
    try {
      return Boolean(safeStorage && safeStorage.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  // Persisting: replace the plaintext token with an encrypted blob.
  function sealTelegramSettings(config) {
    const settings = config && config.telegramSettings;
    const token = settings ? String(settings.botToken || '').trim() : '';
    if (!token || !isEncryptionAvailable()) return config;
    try {
      const botTokenEncrypted = safeStorage.encryptString(token).toString('base64');
      return { ...config, telegramSettings: { ...settings, botToken: '', botTokenEncrypted } };
    } catch {
      return config;
    }
  }

  // Reading: decrypt the blob back into a usable in-memory token.
  function openTelegramSettings(config) {
    const settings = config && config.telegramSettings;
    const blob = settings ? String(settings.botTokenEncrypted || '').trim() : '';
    if (!blob) return config;
    if (String(settings.botToken || '').trim()) return config; // plaintext already present (mid-migration)
    if (!isEncryptionAvailable()) return config;
    try {
      const botToken = safeStorage.decryptString(Buffer.from(blob, 'base64'));
      return { ...config, telegramSettings: { ...settings, botToken } };
    } catch {
      return config;
    }
  }

  // IPC boundary: the renderer gets neither the token nor the ciphertext —
  // only whether one is stored, so the form can show "configured".
  function redactTelegramSettings(config) {
    const settings = config && config.telegramSettings;
    if (!settings || typeof settings !== 'object') return config;
    const botTokenConfigured = Boolean(
      String(settings.botToken || '').trim() || String(settings.botTokenEncrypted || '').trim()
    );
    const { botTokenEncrypted, ...rest } = settings;
    return { ...config, telegramSettings: { ...rest, botToken: '', botTokenConfigured } };
  }

  function hasPlaintextToken(config) {
    const settings = config && config.telegramSettings;
    return Boolean(settings && String(settings.botToken || '').trim());
  }

  return {
    isEncryptionAvailable,
    sealTelegramSettings,
    openTelegramSettings,
    redactTelegramSettings,
    hasPlaintextToken
  };
}

module.exports = { createTelegramTokenCodec };
