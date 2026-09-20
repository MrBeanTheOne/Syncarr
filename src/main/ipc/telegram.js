// Telegram test-send channel. The full Telegram integration (settings, run
// notifications) is wired in main.js; this module only exposes the test
// channel the renderer uses from the Settings page.

function register(ipcMain, deps) {
  const { normalizeTelegramSettings, sendTelegramMessage, readConfig } = deps;

  ipcMain.handle('telegram:test', async (_event, settingsInput) => {
    const settings = normalizeTelegramSettings(settingsInput);
    // M1: the renderer no longer holds the stored token (its form field is
    // blank when the token is sealed on disk). An empty token in a test
    // request means "use the stored one".
    if (!settings.botToken && typeof readConfig === 'function') {
      const config = await readConfig();
      const stored = normalizeTelegramSettings(config && config.telegramSettings);
      if (stored.botToken) settings.botToken = stored.botToken;
    }
    return sendTelegramMessage(settings, `Syncarr Telegram test\nTime: ${new Date().toLocaleString()}`);
  });
}

module.exports = { register };
