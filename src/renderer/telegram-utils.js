(() => {
  'use strict';

  // Telegram settings controller helpers — extracted from app.js so the
  // settings-card lifecycle (normalize / read form / apply to form / render
  // status / visibility) lives in one self-contained module. The actual save
  // and test calls remain in app.js because they need to update the
  // renderer-wide config state.
  //
  // Depends on window.SyncarrRendererUtils.escapeHtml being available; we
  // degrade gracefully to a noop if it isn't.

  const DEFAULT_TELEGRAM_SETTINGS = Object.freeze({
    enabled: false,
    botToken: '',
    chatId: '',
    notifyOnSuccess: true,
    notifyOnFailure: true,
    notifyOnCompare: false
  });

  function escapeHtmlSafe(input) {
    if (window.SyncarrRendererUtils && typeof window.SyncarrRendererUtils.escapeHtml === 'function') {
      return window.SyncarrRendererUtils.escapeHtml(input);
    }
    return String(input == null ? '' : input);
  }

  function normalizeTelegramSettings(input = {}) {
    const raw = input && typeof input === 'object' ? input : {};
    return {
      ...DEFAULT_TELEGRAM_SETTINGS,
      ...raw,
      enabled: raw.enabled === true,
      botToken: String(raw.botToken || '').trim(),
      chatId: String(raw.chatId || '').trim(),
      notifyOnSuccess: raw.notifyOnSuccess !== false,
      notifyOnFailure: raw.notifyOnFailure !== false,
      notifyOnCompare: raw.notifyOnCompare === true
    };
  }

  function applyTelegramSettingsToForm(els, input = {}) {
    if (!els) return;
    const settings = normalizeTelegramSettings(input);
    if (els.telegramEnabled) els.telegramEnabled.checked = settings.enabled;
    if (els.telegramBotToken) {
      els.telegramBotToken.value = settings.botToken;
      // The main process redacts the stored token (M1): the field arrives
      // blank with botTokenConfigured=true. Blank-on-save means "keep the
      // stored token"; typing a value replaces it.
      const configuredBlank = !settings.botToken && settings.botTokenConfigured === true;
      els.telegramBotToken.dataset.configured = configuredBlank ? 'true' : 'false';
      els.telegramBotToken.placeholder = configuredBlank
        ? 'Configured — leave blank to keep, or paste a new token'
        : '';
    }
    if (els.telegramChatId) els.telegramChatId.value = settings.chatId;
    if (els.telegramNotifySuccess) els.telegramNotifySuccess.checked = settings.notifyOnSuccess;
    if (els.telegramNotifyFailure) els.telegramNotifyFailure.checked = settings.notifyOnFailure;
    if (els.telegramNotifyCompare) els.telegramNotifyCompare.checked = settings.notifyOnCompare;
    updateTelegramSettingsVisibility(els);
  }

  function updateTelegramSettingsVisibility(els) {
    if (!els) return;
    const enabled = els.telegramEnabled ? els.telegramEnabled.checked : false;
    document.querySelectorAll('.telegram-dependent-settings').forEach((node) => {
      node.classList.toggle('hidden', !enabled);
      node.setAttribute('aria-hidden', enabled ? 'false' : 'true');
    });
    if (els.testTelegramBtn) {
      els.testTelegramBtn.classList.toggle('hidden', !enabled);
      els.testTelegramBtn.disabled = !enabled;
    }
  }

  function getTelegramSettingsFromForm(els) {
    if (!els) return normalizeTelegramSettings({});
    return normalizeTelegramSettings({
      enabled: els.telegramEnabled ? els.telegramEnabled.checked : false,
      botToken: els.telegramBotToken ? els.telegramBotToken.value : '',
      // A stored (sealed) token exists even though the field is blank (M1).
      botTokenConfigured: els.telegramBotToken ? els.telegramBotToken.dataset.configured === 'true' : false,
      chatId: els.telegramChatId ? els.telegramChatId.value : '',
      notifyOnSuccess: els.telegramNotifySuccess ? els.telegramNotifySuccess.checked : true,
      notifyOnFailure: els.telegramNotifyFailure ? els.telegramNotifyFailure.checked : true,
      notifyOnCompare: els.telegramNotifyCompare ? els.telegramNotifyCompare.checked : false
    });
  }

  function renderTelegramStatus(els, status) {
    if (!els || !els.telegramStatus) return;
    updateTelegramSettingsVisibility(els);
    const settings = getTelegramSettingsFromForm(els);
    els.telegramStatus.classList.remove('ok', 'error', 'warning');

    if (status && typeof status === 'object') {
      els.telegramStatus.classList.add(status.ok ? 'ok' : 'error');
      els.telegramStatus.innerHTML = `
        <strong>Telegram status</strong>
        <span>${escapeHtmlSafe(status.message || (status.ok ? 'Telegram is working.' : 'Telegram test failed.'))}</span>
        <small>${status.ok ? 'Test message sent successfully.' : 'Check the bot token and chat ID.'}</small>
      `;
      return;
    }

    if (!settings.enabled) {
      els.telegramStatus.innerHTML = `
        <strong>Telegram status</strong>
        <span>Disabled.</span>
        <small>Enable Telegram integration to send job notifications.</small>
      `;
      return;
    }

    const tokenSatisfied = Boolean(settings.botToken) || settings.botTokenConfigured === true;
    if (!tokenSatisfied || !settings.chatId) {
      els.telegramStatus.classList.add('warning');
      els.telegramStatus.innerHTML = `
        <strong>Telegram status</strong>
        <span>Missing bot token or chat ID.</span>
        <small>Paste both values, save settings, then send a test.</small>
      `;
      return;
    }

    els.telegramStatus.classList.add('ok');
    els.telegramStatus.innerHTML = `
      <strong>Telegram status</strong>
      <span>Configured.</span>
      <small>Only jobs with notifications enabled will send messages.</small>
    `;
  }

  window.SyncarrTelegramUtils = {
    DEFAULT_TELEGRAM_SETTINGS,
    normalizeTelegramSettings,
    applyTelegramSettingsToForm,
    updateTelegramSettingsVisibility,
    getTelegramSettingsFromForm,
    renderTelegramStatus
  };
})();
