// Restore-point IPC: list, read manifest, preview a restore plan, and run
// a restore to a custom folder. Restore is operation-busy gated.

const { BUSY_MESSAGE } = require('../job-model');

function register(ipcMain, deps) {
  const {
    app,
    listRestorePoints,
    readRestorePointManifest,
    previewRestorePointPlan,
    restoreRestorePointToFolder,
    checkStorageForRequest,
    isOperationBusy,
    setActiveRunId,
    clearActiveRunId,
    formatHistoryRunId,
    emitSyncEvent,
    pathAllowlist
  } = deps;

  ipcMain.handle('restorePoints:list', async (_event, request) => {
    return await listRestorePoints({
      basePath: app.getPath('userData'),
      jobId: request && request.jobId,
      limit: request && request.limit
    });
  });

  ipcMain.handle('restorePoints:read', async (_event, request) => {
    return await readRestorePointManifest({
      basePath: app.getPath('userData'),
      jobId: request && request.jobId,
      restorePointId: request && request.restorePointId,
      maxFilesPerDestination: request && request.maxFilesPerDestination
    });
  });

  ipcMain.handle('restorePoints:previewPlan', async (_event, request) => {
    return await previewRestorePointPlan({
      basePath: app.getPath('userData'),
      jobId: request && request.jobId,
      restorePointId: request && request.restorePointId,
      destinationIndex: request && request.destinationIndex,
      relativePath: request && request.relativePath,
      filePath: request && request.filePath,
      restoreFolder: request && request.restoreFolder
    });
  });

  ipcMain.handle('restorePoints:restoreToFolder', async (_event, request) => {
    if (isOperationBusy()) {
      return { ok: false, status: 'busy', message: BUSY_MESSAGE };
    }

    const restoreFolder = String(request && request.restoreFolder || '').trim();
    // A restore folder inside a configured source/destination would resurrect
    // restored files into the live sync pipeline on the next run (audit M5).
    if (pathAllowlist && restoreFolder && await pathAllowlist.isRootAllowed(restoreFolder)) {
      return {
        ok: false,
        status: 'unsafe-target',
        message: 'Choose a restore folder outside your configured sync sources and destinations — restoring inside one would feed the restored files back into the next sync.'
      };
    }

    const restoreRunId = `restore-point-${formatHistoryRunId(new Date())}`;
    setActiveRunId(restoreRunId);
    try {
      const preview = await previewRestorePointPlan({
        basePath: app.getPath('userData'),
        jobId: request && request.jobId,
        restorePointId: request && request.restorePointId,
        destinationIndex: request && request.destinationIndex,
        relativePath: request && request.relativePath,
        filePath: request && request.filePath,
        restoreFolder
      });
      if (!preview.ok || !preview.plan || !preview.plan.ready) {
        return { ok: false, status: 'not-ready', message: preview.message || preview.plan && preview.plan.message || 'Restore point is not ready.', plan: preview.plan || null };
      }

      const storage = request && request.freeSpaceCheckEnabled === false
        ? { ok: true, checked: false, skipped: true, message: 'Free-space check is disabled.' }
        : await checkStorageForRequest({
            targetPath: restoreFolder,
            estimatedWriteBytes: Number(preview.plan.totals && preview.plan.totals.bytesPlanned || 0),
            minimumFreeGb: request && request.minimumFreeGb
          });
      if (storage.checked && !storage.enoughSpace) {
        return { ok: false, status: 'space', message: storage.message || 'Not enough free space for this restore.', plan: preview.plan, storage };
      }

      const result = await restoreRestorePointToFolder({
        basePath: app.getPath('userData'),
        jobId: request && request.jobId,
        restorePointId: request && request.restorePointId,
        destinationIndex: request && request.destinationIndex,
        relativePath: request && request.relativePath,
        filePath: request && request.filePath,
        restoreFolder,
        onProgress: (progress) => {
          emitSyncEvent({ type: 'restore-point-progress', runId: restoreRunId, progress });
        }
      });
      return { ...result, runId: restoreRunId, storage };
    } catch (error) {
      return { ok: false, status: 'error', message: error.message || String(error) };
    } finally {
      clearActiveRunId();
    }
  });
}

module.exports = { register };
