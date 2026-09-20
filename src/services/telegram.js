const https = require('https');
const { extractRunStats } = require('../main/run-stats');

function normalizeTelegramSettings(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    enabled: raw.enabled === true,
    botToken: String(raw.botToken || '').trim(),
    // Sealed token blob (audit M1). normalizeConfig runs this on every config
    // write, so the field must survive normalization or the stored token
    // would be silently dropped by the next save.
    botTokenEncrypted: String(raw.botTokenEncrypted || '').trim(),
    chatId: String(raw.chatId || '').trim(),
    notifyOnSuccess: raw.notifyOnSuccess !== false,
    notifyOnFailure: raw.notifyOnFailure !== false,
    notifyOnCompare: raw.notifyOnCompare === true
  };
}

function hasUsableTelegramSettings(settings) {
  const clean = normalizeTelegramSettings(settings);
  return clean.enabled && Boolean(clean.botToken) && Boolean(clean.chatId);
}

function sendTelegramMessage(settingsInput, text, options = {}) {
  const settings = normalizeTelegramSettings(settingsInput);
  if (!hasUsableTelegramSettings(settings)) {
    return Promise.resolve({ ok: false, message: 'Telegram is disabled or missing bot token/chat ID.' });
  }

  const payload = JSON.stringify({
    chat_id: settings.chatId,
    text: String(text || '').slice(0, 3900),
    disable_web_page_preview: true,
    ...(options && options.parseMode ? { parse_mode: options.parseMode } : {})
  });

  const requestOptions = {
    hostname: 'api.telegram.org',
    path: `/bot${settings.botToken}/sendMessage`,
    method: 'POST',
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  // The `timeout` above is Node's socket-IDLE timeout — a slowly dripping
  // response never trips it, which could keep a "fire-and-forget" notification
  // pending forever (audit M11). deadlineMs is the absolute wall-clock cap.
  // requestFn is injectable so tests can drive every failure path.
  const deadlineMs = Number(options.deadlineMs) > 0 ? Number(options.deadlineMs) : 15000;
  const requestFn = typeof options.requestFn === 'function' ? options.requestFn : https.request;

  const attemptSend = () => new Promise((resolve) => {
    let settled = false;
    let responded = false;
    let deadline = null;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      resolve(result);
    };

    const req = requestFn(requestOptions, (res) => {
      responded = true;
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { parsed = null; }
        if (res.statusCode >= 200 && res.statusCode < 300 && (!parsed || parsed.ok !== false)) {
          settle({ ok: true, message: 'Telegram message sent.', transient: false });
          return;
        }
        const description = parsed && parsed.description ? parsed.description : `Telegram HTTP ${res.statusCode}`;
        settle({ ok: false, message: description, transient: false });
      });
    });

    deadline = setTimeout(() => {
      req.destroy(new Error('Telegram request deadline exceeded.'));
    }, deadlineMs);
    if (typeof deadline.unref === 'function') deadline.unref();

    req.on('timeout', () => {
      req.destroy(new Error('Telegram request timed out.'));
    });
    // Only pre-response failures are safe to retry: once Telegram has started
    // replying, the message may already be delivered and a retry would risk a
    // double-send.
    req.on('error', (error) => {
      settle({ ok: false, message: error.message || String(error), transient: !responded });
    });
    req.write(payload);
    req.end();
  });

  return attemptSend().then((first) => {
    if (first.ok || !first.transient) return { ok: first.ok, message: first.message };
    return attemptSend().then((second) => ({ ok: second.ok, message: second.message }));
  });
}

function shouldNotifyRun({ settings, job, result, dryRun }) {
  const telegram = normalizeTelegramSettings(settings);
  if (!hasUsableTelegramSettings(telegram)) return false;
  if (!job || job.notificationsEnabled !== true) return false;

  if (!(result && result.ok)) return telegram.notifyOnFailure !== false;
  if (dryRun) return telegram.notifyOnCompare === true;
  return telegram.notifyOnSuccess !== false;
}

/* ---------------------------------------------------------------------------
 * Formatting helpers (kept dependency-free so the message builders are pure
 * and unit-testable).
 * ------------------------------------------------------------------------- */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const value = n / Math.pow(1024, exp);
  if (exp === 0) return `${Math.round(value)} B`;
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[exp]}`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

function syncModeLabel(mode) {
  const clean = String(mode || 'oneWay');
  if (clean === 'mirror') return 'Mirror';
  if (clean === 'twoWay') return 'Two-way';
  return 'One-way backup';
}

function humanizeReason(reason) {
  const map = {
    'not-connected-or-unreadable': 'not reachable',
    'destination-will-be-created': 'will be created',
    'optional-compare-failed': 'compare failed',
    'optional-sync-failed': 'sync failed',
    'compare-timed-out': 'timed out',
    'optional-destination-skipped': 'skipped'
  };
  return map[reason] || String(reason || '').replace(/[-_]+/g, ' ');
}

function runStatusHeader(action, ok, status) {
  const clean = String(status || '').toLowerCase();
  if (clean === 'warning' || clean === 'warn') return { emoji: '⚠️', label: `${action} finished with warnings` };
  if (clean === 'cancelled' || clean === 'canceled') return { emoji: '⛔', label: `${action} cancelled` };
  if (ok) return { emoji: '✅', label: `${action} succeeded` };
  return { emoji: '❌', label: `${action} failed` };
}

/**
 * Build a detailed, HTML-formatted Telegram message for a compare or sync run.
 * Returns a string; the caller sends it with parse_mode "HTML".
 */
function buildTelegramRunMessage({ job, result, dryRun, now = new Date() } = {}) {
  const action = dryRun ? 'Compare' : 'Sync';
  const ok = Boolean(result && result.ok);
  const status = (result && result.status) || (ok ? 'success' : 'error');
  const header = runStatusHeader(action, ok, status);
  const jobName = (job && job.name) || (result && result.jobName) || 'Sync job';
  const mode = syncModeLabel((result && result.syncMode) || (job && job.syncMode));

  const history = (result && result.history) || {};
  const stats = extractRunStats({ job, result, dryRun });
  const destinationResults = Array.isArray(result && result.destinationResults) ? result.destinationResults : [];
  const skippedDestinations = Array.isArray(result && result.skippedDestinations) ? result.skippedDestinations : [];

  const startedAt = result && result.compareCreatedAt ? new Date(result.compareCreatedAt) : null;
  const duration = startedAt && !Number.isNaN(startedAt.getTime())
    ? formatDuration(now.getTime() - startedAt.getTime())
    : null;

  const lines = [];
  lines.push(`${header.emoji} <b>${escapeHtml(header.label)}</b>`);
  lines.push(`<b>Job:</b> ${escapeHtml(jobName)} · <i>${escapeHtml(mode)}</i>`);
  if (result && result.message) lines.push(escapeHtml(result.message));
  lines.push('');

  if (dryRun) {
    const newFiles = Number(history.newFiles || 0);
    const changed = Math.max(0, stats.plannedCopies - newFiles);
    const archive = Number(history.wouldArchive || 0);
    const destinationOnly = Number(history.destinationOnly || 0);
    lines.push(`🔍 <b>Plan:</b> ${formatNumber(stats.plannedActions)} file action(s)`);
    lines.push(`• ${formatNumber(newFiles)} new · ${formatNumber(changed)} changed · ${formatNumber(archive)} to archive`);
    if (stats.plannedDeletes) lines.push(`• ${formatNumber(stats.plannedDeletes)} delete action(s)`);
    if (stats.conflicts) lines.push(`• ⚠️ ${formatNumber(stats.conflicts)} conflict(s)`);
    if (destinationOnly && stats.mode === 'oneWay') lines.push(`• ${formatNumber(destinationOnly)} destination-only`);
    lines.push(`💾 <b>Estimated:</b> ${formatBytes(stats.copyBytes)} to copy · ${formatBytes(stats.archiveBytes)} history`);
  } else {
    lines.push(`📁 <b>Files:</b> ${formatNumber(stats.copied)} copied · ${formatNumber(stats.deleted)} deleted · ${formatNumber(stats.skipped)} skipped · ${formatNumber(stats.failed)} failed`);
    lines.push(`💾 <b>Data:</b> ${formatBytes(stats.copyBytes)} copied`);
    if (stats.archived) lines.push(`🗂 <b>History:</b> ${formatNumber(stats.archived)} version(s) archived · ${formatBytes(stats.archiveBytes)}`);
    if (result && result.retention && result.retention.summary) {
      const deleted = Number(result.retention.summary.deletedFiles || 0);
      if (deleted) lines.push(`🧹 <b>Cleanup:</b> ${formatNumber(deleted)} old version(s) removed · ${formatBytes(result.retention.summary.freedBytes)} freed`);
    }
    if (result && result.restorePoint && result.restorePoint.ok) lines.push('📌 Restore point created');
  }

  if (destinationResults.length) {
    lines.push('');
    lines.push('<b>Destinations:</b>');
    for (const dest of destinationResults.slice(0, 6)) {
      const destOk = String(dest.status || '').toLowerCase() === 'success';
      const mark = destOk ? '✅' : '❌';
      const role = dest.destinationRequired === false ? ' (optional)' : '';
      const detail = destOk ? '' : ` — ${escapeHtml(dest.message || 'failed')}`;
      lines.push(`${mark} ${escapeHtml(dest.destinationLabel || 'Destination')}${role}${detail}`);
    }
  }

  if (skippedDestinations.length) {
    if (!destinationResults.length) lines.push('');
    for (const dest of skippedDestinations.slice(0, 6)) {
      const reason = dest.reason ? ` (${escapeHtml(humanizeReason(dest.reason))})` : '';
      lines.push(`⏭ <b>Skipped:</b> ${escapeHtml(dest.label || dest.path || 'destination')}${reason}`);
    }
  }

  lines.push('');
  lines.push(`🕑 ${escapeHtml(now.toLocaleString())}${duration ? ` · took ${duration}` : ''}`);

  return lines.join('\n');
}

module.exports = {
  normalizeTelegramSettings,
  sendTelegramMessage,
  shouldNotifyRun,
  buildTelegramRunMessage,
  // Exposed for tests / reuse by the desktop notifier.
  formatBytes,
  formatNumber,
  formatDuration,
  syncModeLabel,
  humanizeReason
};
