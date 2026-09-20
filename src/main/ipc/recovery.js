const { previewRunRollback, applyRunRollback } = require('../run-recovery');
const { BUSY_MESSAGE } = require('../job-model');

function register(ipcMain, deps) {
  const {
    getRunJournalStore,
    getConfigHealth,
    readConfig,
    executeSyncRun,
    resetTwoWayStateForRecovery,
    isOperationBusy,
    setActiveRunId,
    clearActiveRunId
  } = deps;

  const load = async (request) => getRunJournalStore().get(request && request.jobId, request && request.runId);

  ipcMain.handle('recovery:status', async () => {
    try {
      await readConfig();
      return {
        ok: true,
        config: getConfigHealth(),
        runs: await getRunJournalStore().list({ incompleteOnly: true, limit: 100 })
      };
    } catch (error) {
      return { ok: false, message: error.message || String(error), config: getConfigHealth(), runs: [] };
    }
  });

  ipcMain.handle('recovery:previewRollback', async (_event, request) => {
    try {
      const run = await load(request);
      return { ...(await previewRunRollback(run)), run };
    } catch (error) {
      return { ok: false, ready: false, message: error.message || String(error) };
    }
  });

  ipcMain.handle('recovery:rollback', async (_event, request) => {
    if (isOperationBusy()) return { ok: false, status: 'busy', message: BUSY_MESSAGE };
    const recoveryRunId = `rollback-${request && request.runId || 'run'}`;
    setActiveRunId(recoveryRunId);
    try {
      const store = getRunJournalStore();
      const run = await load(request);
      return await applyRunRollback(run, {
        journalStore: store,
        afterApply: run.syncMode === 'twoWay' ? () => resetTwoWayStateForRecovery(run) : null
      });
    } catch (error) {
      return { ok: false, applied: false, status: 'error', message: error.message || String(error) };
    } finally {
      clearActiveRunId();
    }
  });

  ipcMain.handle('recovery:resume', async (_event, request) => {
    if (isOperationBusy()) return { ok: false, status: 'busy', message: BUSY_MESSAGE };
    try {
      const store = getRunJournalStore();
      const run = await load(request);
      if (!run.job) return { ok: false, status: 'missing-job', message: 'This journal does not contain the saved job settings needed to resume.' };
      const result = await executeSyncRun({ ...run.job, dryRun: false, enabled: true, recoveryResume: true });
      // Supersede the old journal only when the resume genuinely ran (it has
      // its own journal now, even on failure). A CANCELLED resume reconciled
      // nothing — the original journal must stay interrupted so rollback
      // remains available (audit M3).
      const resumeRan = result && result.jobId && result.syncMode
        && result.canceled !== true && result.status !== 'cancelled';
      if (resumeRan) {
        await store.finish(run, 'superseded', {
          message: `A recovery resume was started. ${result.message || ''}`.trim(),
          resumedStatus: result.status || null
        });
      }
      return result;
    } catch (error) {
      return { ok: false, status: 'error', message: error.message || String(error) };
    }
  });

  ipcMain.handle('recovery:dismiss', async (_event, request) => {
    try {
      const run = await load(request);
      await getRunJournalStore().finish(run, 'dismissed', { message: 'Dismissed by user without changing files.' });
      return { ok: true, message: 'Interrupted run dismissed. No files were changed.' };
    } catch (error) {
      return { ok: false, message: error.message || String(error) };
    }
  });
}

module.exports = { register };
