const els = {
  statusPill: document.getElementById('statusPill'),
  statusLabel: document.getElementById('statusLabel'),
  updatedAt: document.getElementById('updatedAt'),
  activeCard: document.getElementById('activeCard'),
  activeName: document.getElementById('activeName'),
  activeKind: document.getElementById('activeKind'),
  activeMessage: document.getElementById('activeMessage'),
  activeFile: document.getElementById('activeFile'),
  progressTrack: document.getElementById('progressTrack'),
  progressFillBar: document.getElementById('progressFillBar'),
  progressValue: document.getElementById('progressValue'),
  copiedMetric: document.getElementById('copiedMetric'),
  skippedMetric: document.getElementById('skippedMetric'),
  failedMetric: document.getElementById('failedMetric'),
  idleCard: document.getElementById('idleCard'),
  idleTitle: document.getElementById('idleTitle'),
  idleMessage: document.getElementById('idleMessage'),
  conflictWarning: document.getElementById('conflictWarning'),
  conflictWarningTitle: document.getElementById('conflictWarningTitle'),
  conflictWarningMessage: document.getElementById('conflictWarningMessage'),
  pauseScheduleButton: document.getElementById('pauseScheduleButton'),
  queueCount: document.getElementById('queueCount'),
  queueList: document.getElementById('queueList'),
  emptyQueue: document.getElementById('emptyQueue'),
  cancelButton: document.getElementById('cancelButton'),
  runDueButton: document.getElementById('runDueButton'),
  panel: document.querySelector('.tray-panel')
};

const STATUS_COPY = {
  idle: { label: 'Idle', title: 'All caught up', message: 'No task is running.' },
  running: { label: 'Running', title: 'Working', message: 'A task is currently running.' },
  success: { label: 'Complete', title: 'Task complete', message: 'The last task finished successfully.' },
  warning: { label: 'Warning', title: 'Completed with warnings', message: 'The last task needs attention.' },
  error: { label: 'Error', title: 'Task failed', message: 'Open Syncarr to review the task log.' },
  cancelled: { label: 'Cancelled', title: 'Task cancelled', message: 'The last task was cancelled.' },
  paused: { label: 'Paused', title: 'Paused', message: 'Task processing is paused.' }
};

function formatNumber(value) {
  return (Number(value) || 0).toLocaleString();
}

function formatDueAt(value) {
  if (!value) return 'Waiting for schedule';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Waiting for schedule';
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return 'Due now';
  if (diff < 60 * 60 * 1000) return `Due in ${Math.max(1, Math.round(diff / 60000))} min`;
  if (diff < 24 * 60 * 60 * 1000) return `Due in ${Math.max(1, Math.round(diff / 3600000))} hr`;
  return `Due ${date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function renderActivity(activity = {}) {
  const status = STATUS_COPY[activity.status] ? activity.status : 'idle';
  const copy = STATUS_COPY[status];
  const active = activity.active || null;
  const queue = Array.isArray(activity.queue) ? activity.queue : [];
  const conflictWarnings = Array.isArray(activity.conflictWarnings) ? activity.conflictWarnings : [];
  const schedulerPaused = activity.schedulerPaused === true || status === 'paused';
  const isRunning = status === 'running' && active;

  els.statusPill.className = `status-pill ${status}`;
  els.statusLabel.textContent = copy.label;
  els.updatedAt.textContent = isRunning ? 'Live activity' : 'Activity overview';
  els.activeCard.classList.toggle('hidden', !active);
  els.idleCard.className = `idle-card ${status}${active ? ' hidden' : ''}`;
  els.idleTitle.textContent = copy.title;
  els.idleMessage.textContent = status === 'idle' && queue.length
    ? `${queue.length} scheduled ${queue.length === 1 ? 'task is' : 'tasks are'} coming up.`
    : copy.message;
  els.cancelButton.classList.toggle('hidden', !isRunning);
  els.runDueButton.disabled = isRunning || queue.length === 0;
  els.runDueButton.title = queue.length > 0 ? 'Run the next scheduled task now' : 'No scheduled tasks are configured';

  const conflictWarning = conflictWarnings[0] || null;
  els.conflictWarning.classList.toggle('hidden', !conflictWarning);
  if (conflictWarning) {
    els.conflictWarningTitle.textContent = `${conflictWarning.name || 'Scheduled task'} was blocked by conflicts`;
    els.conflictWarningMessage.textContent = conflictWarnings.length > 1
      ? `${conflictWarnings.length} jobs need conflict review. Open Syncarr and run Compare.`
      : (conflictWarning.message || 'Open Syncarr and review the conflicting files.');
  }

  if (active) {
    const progress = active.progress || {};
    const percent = Number.isFinite(Number(progress.percent)) ? Number(progress.percent) : null;
    els.activeName.textContent = active.name || 'Sync task';
    els.activeKind.textContent = `${active.label || active.kind || 'Task'}${active.scheduled ? ' - scheduled' : ''}`;
    els.activeMessage.textContent = progress.label || active.message || (isRunning ? 'Working...' : copy.message);
    els.activeFile.textContent = progress.file || '';
    els.progressTrack.classList.toggle('indeterminate', isRunning && percent === null);
    els.progressFillBar.setAttribute('width', percent === null ? '0' : String(Math.max(0, Math.min(100, Math.round(percent)))));
    els.progressValue.textContent = percent === null ? (isRunning ? 'Working' : copy.label) : `${Math.round(percent)}%`;
    els.copiedMetric.textContent = formatNumber(progress.copied);
    els.skippedMetric.textContent = formatNumber(progress.skipped);
    els.failedMetric.textContent = formatNumber(progress.failed);
  }

  els.pauseScheduleButton.textContent = schedulerPaused ? 'Resume' : 'Pause';
  els.pauseScheduleButton.classList.toggle('resume', schedulerPaused);
  els.pauseScheduleButton.title = schedulerPaused ? 'Resume automatic scheduled tasks' : 'Pause automatic scheduled tasks';

  els.queueCount.textContent = String(queue.length);
  els.emptyQueue.classList.toggle('hidden', queue.length > 0);
  els.queueList.innerHTML = '';
  queue.forEach((task) => els.queueList.appendChild(buildQueueItem(task)));

  scheduleSizeReport();
}

function buildQueueItem(task) {
  const item = document.createElement('div');
  item.className = 'queue-item';

  const name = document.createElement('strong');
  name.textContent = task.name || 'Sync task';
  const due = document.createElement('small');
  due.textContent = formatDueAt(task.dueAt);
  const kind = document.createElement('span');
  kind.className = 'queue-kind';
  kind.textContent = task.label || task.kind || 'Task';

  item.append(name, due, kind);
  return item;
}

let sizeFrame = null;

function scheduleSizeReport() {
  if (sizeFrame) cancelAnimationFrame(sizeFrame);
  sizeFrame = requestAnimationFrame(() => {
    sizeFrame = null;
    if (!els.panel || !window.trayPanel || typeof window.trayPanel.resize !== 'function') return;
    const panelHeight = Math.ceil(els.panel.getBoundingClientRect().height);
    window.trayPanel.resize({ height: panelHeight });
  });
}

document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await window.trayPanel.command(button.dataset.command);
    } finally {
      button.disabled = false;
    }
  });
});

window.trayPanel.onActivity(renderActivity);
window.trayPanel.getActivity().then(renderActivity).catch(() => renderActivity());

if (window.ResizeObserver && els.panel) {
  new ResizeObserver(scheduleSizeReport).observe(els.panel);
}
