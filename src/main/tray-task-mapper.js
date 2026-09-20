'use strict';

// Pure mappers from scheduler/job state into the tray window's task shape, and
// from a run result into a tray icon state. isCancelledRun is injected (it lives
// in main.js's cancellation cluster) so this module stays free of that coupling.

const { normalizeJob, RUN_STATUS } = require('./job-model');

function createTrayTaskMapper({ isCancelledRun }) {
  function scheduledTaskToTrayTask(task, index = 0, total = 0) {
    const schedule = task && task.schedule ? task.schedule : normalizeJob(task && task.job || {}).schedule;
    const kind = schedule.mode === 'sync' ? 'sync' : 'compare';
    const watched = task && task.reason === 'watch';
    const progressTotal = watched ? 0 : Number(task && task.stats && task.stats.changes || 0);
    return {
      id: task && task.job && task.job.id,
      name: task && task.job && task.job.name || 'Sync job',
      kind,
      label: watched ? `Watch ${kind}` : (kind === 'sync' ? 'Sync' : 'Compare'),
      scheduled: !watched,
      watchTriggered: watched,
      dueAt: task && task.dueAt,
      queuePosition: index + 1,
      queueTotal: total,
      progress: {
        indeterminate: true,
        total: progressTotal
      }
    };
  }

  function trayStatusForResult(result) {
    if (isCancelledRun(result)) return 'cancelled';
    if (String(result && result.status || '').toLowerCase() === RUN_STATUS.CONFLICTS) return 'warning';
    if (!result || result.ok !== true) return 'error';
    return result.warning || result.status === RUN_STATUS.WARNING ? 'warning' : 'success';
  }

  return { scheduledTaskToTrayTask, trayStatusForResult };
}

module.exports = { createTrayTaskMapper };
