// File-history IPC: list archived versions, restore one, and wipe a job's
// history cache. Restore and delete are operation-busy gated — they cannot
// run while another compare/sync/restore is in progress.

const {
  sanitizeJobId,
  sanitizeHistoryFolderName,
  HISTORY_FOLDER_NAME,
  normalizeHistoryLocations,
  BUSY_MESSAGE
} = require('../job-model');

function register(ipcMain, deps) {
  const {
    app,
    listHistoryVersions,
    restoreHistoryVersion,
    deleteHistoryCacheForJob,
    emptyJobHistoryDeleteSummary,
    aggregateJobHistoryDeleteSummaries,
    formatHistoryRunId,
    isOperationBusy,
    setActiveRunId,
    clearActiveRunId,
    deleteRestorePointsForJob,
    pathAllowlist
  } = deps;

  ipcMain.handle('history:list', async (_event, request) => {
    try {
      return await listHistoryVersions(request || {});
    } catch (error) {
      return {
        ok: false,
        message: error.message || String(error),
        versions: [],
        manifestsRead: 0,
        manifestErrors: 0,
        files: 0
      };
    }
  });

  ipcMain.handle('history:restore', async (_event, request) => {
    if (isOperationBusy()) {
      return {
        ok: false,
        status: 'busy',
        message: BUSY_MESSAGE
      };
    }

    // Inverse of the H12 gate, for the WRITE side (audit M5): an "Other
    // target" folder typed INSIDE a configured source/destination would feed
    // the restored file (often one deleted on purpose) straight back into the
    // sync pipeline on the next run. 'original'/'backup' modes exist for
    // restoring into the job itself — those stay gated the other way (H12).
    if (pathAllowlist && request && request.destinationMode === 'folder') {
      const restoreFolder = String(request.restoreFolder || '').trim();
      if (restoreFolder && await pathAllowlist.isRootAllowed(restoreFolder)) {
        return {
          ok: false,
          status: 'unsafe-target',
          message: 'Choose a restore folder outside your configured sync sources and destinations — restoring inside one would feed the file back into the next sync. Use "Original source" or "Backup target" to restore into the job itself.'
        };
      }
    }

    const restoreRunId = `restore-${formatHistoryRunId(new Date())}`;
    setActiveRunId(restoreRunId);

    try {
      return await restoreHistoryVersion({ ...(request || {}), restoreRunId });
    } catch (error) {
      return {
        ok: false,
        status: 'error',
        message: error.message || String(error)
      };
    } finally {
      clearActiveRunId();
    }
  });

  ipcMain.handle('history:deleteJobCache', async (_event, request) => {
    const jobId = sanitizeJobId(request && request.jobId);
    const historyFolderName = sanitizeHistoryFolderName((request && request.historyFolderName) || HISTORY_FOLDER_NAME);
    const destinations = normalizeHistoryLocations(request || {});

    if (!jobId) {
      return { ok: false, message: 'Missing job id.', summary: emptyJobHistoryDeleteSummary(), results: [] };
    }

    if (!destinations.length) {
      return { ok: true, message: 'No destinations to clean.', summary: emptyJobHistoryDeleteSummary(), results: [] };
    }

    const results = [];
    for (const destination of destinations) {
      try {
        // Root-trust guard (H12): only wipe history under a configured
        // destination, never an arbitrary renderer-supplied root.
        if (pathAllowlist) await pathAllowlist.assertRootAllowed(destination.path, 'history destination');
        results.push(await deleteHistoryCacheForJob({
          targetPath: destination.path,
          historyFolderName,
          jobId,
          pruneEmptyFolders: request && request.pruneEmptyFolders !== false,
          destination
        }));
      } catch (error) {
        results.push({
          ok: false,
          destination,
          message: error.message || String(error),
          summary: emptyJobHistoryDeleteSummary()
        });
      }
    }

    const summary = aggregateJobHistoryDeleteSummaries(results.map((result) => result.summary));
    const failed = results.filter((result) => !result.ok);
    const restorePoints = await deleteRestorePointsForJob({
      basePath: app.getPath('userData'),
      jobId
    });
    return {
      ok: failed.length === 0,
      message: failed.length
        ? `History cleanup completed with ${failed.length} destination error(s).`
        : `History cleanup removed ${summary.archivedFilesDeleted} archived file(s), ${summary.manifestsDeleted} manifest(s), and ${restorePoints.deletedManifests || 0} restore point(s).`,
      summary: {
        ...summary,
        restorePointsDeleted: restorePoints.deletedManifests || 0
      },
      results,
      restorePoints
    };
  });
}

module.exports = { register };
