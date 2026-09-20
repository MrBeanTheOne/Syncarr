// One-way / mirror sync-run orchestration, extracted verbatim from src/main.js
// (executeSyncRun) into an injectable factory so the run lifecycle can be tested.
// Mirrors the createBackgroundScheduler / createSyncEngineRunner factory pattern:
// every main-process collaborator is injected via deps. The body is a
// behavior-preserving move — the ONLY change from the original is that the 8
// direct writes to the shared mutable run-state (activeRunId / activeProcess /
// activeCancellationRequest) now go through injected setters, so main.js stays
// the single source of truth that its cancellation/busy predicates still read.
//
// buildSyncResult and sendRunPhase remain LOCAL closures inside executeSyncRun
// (they capture per-run locals); they are intentionally NOT deps.
'use strict';

const { withTimeout } = require('./async-utils');

// Hard ceiling on each post-sync bookkeeping phase (history-manifest
// finalization, retention prune, restore-point indexing). A hung network
// handle in any of these must not wedge the run: the sync itself already
// finished, so after this long we abandon the phase, record it as failed,
// and let the run complete so the scheduler stays healthy.
const POST_SYNC_PHASE_TIMEOUT_MS = 15 * 60 * 1000;

function createSyncRun(deps) {
  const {
    assertCompareModeRunnable,
    assertSyncModeRunnable,
    isOperationSupported,
    buildUnsupportedOperationResult,
    getSyncEngine,
    isOperationBusy,
    BUSY_MESSAGE,
    parseRunRequest,
    pathIsDirectory,
    PATH_CHECK_TIMEOUT_MS,
    normalizeSyncMode,
    runTwoWaySyncRun,
    resolveDestinationAvailability,
    formatHistoryRunId,
    createEngineProgressState,
    emitSyncEvent,
    appendSkippedDestinationLog,
    throwIfRunCancelled,
    buildDestinationSourceRoots,
    runSyncEngineSequence,
    isActiveRunCancelled,
    makeCancelledRunResult,
    makeJobFingerprint,
    clearActiveRunState,
    reconcileNoChangeStatus,
    applyDestinationWarningStatus,
    buildRobocopyDryRunPreview,
    buildInternalComparePreview,
    resolveSkipOlderSource,
    makeSkippedOptionalPreviewSummary,
    buildCompareCompletionMessage,
    readConfig,
    writeConfig,
    trimSavedRunOutput,
    makePendingCompare,
    notifyJobRunIfNeeded,
    analyzeMultiDestinationHistoryPlan,
    checkStorageForDestinationPlans,
    isNoOpSyncPlan,
    makeNoOpRobocopySummary,
    buildNoOpSyncMessage,
    getRunJournalStore,
    getRunTrigger,
    makeJournalJobSnapshot,
    buildOneWayJournalOperations,
    createHistorySnapshot,
    isCancellationError,
    finishRunJournal,
    mergeEngineExitCodes,
    buildSyncCompletionMessage,
    finalizeHistoryManifest,
    runRetentionPolicy,
    emptyRetentionSummary,
    aggregateRetentionResults,
    createRestorePointManifest,
    app,
    setActiveRunId,
    setActiveProcess,
    setActiveCancellationRequest
  } = deps;

async function executeSyncRun(request = {}) {
  const {
    id,
    name,
    syncMode,
    twoWayConflictPolicy,
    sourcePath,
    sourcePaths,
    targetPath,
    targetDestinations,
    dryRun,
    excludePatterns,
    skipOlderSource,
    copySubfolders,
    historyEnabled,
    historyFolderName,
    freeSpaceCheckEnabled,
    minimumFreeGb,
    retentionEnabled,
    retentionMaxVersions,
    retentionMaxAgeDays,
    retentionKeepLatest,
    retentionPruneEmptyFolders,
    retentionPruneAfterSync,
    restorePointsEnabled,
    restorePointRetentionMax
  } = request || {};

  if (request && request.enabled === false) {
    return {
      ok: false,
      code: null,
      status: 'disabled',
      message: 'This job is disabled.',
      output: '',
      summary: null
    };
  }

  const modeMessage = dryRun ? assertCompareModeRunnable(syncMode) : assertSyncModeRunnable(syncMode, request || {});
  if (modeMessage) {
    return {
      ok: false,
      code: null,
      status: 'unsupported-sync-mode',
      message: modeMessage,
      output: modeMessage,
      summary: null
    };
  }

  if (!isOperationSupported(dryRun ? 'compare' : 'sync')) {
    return buildUnsupportedOperationResult(dryRun ? 'compare' : 'sync');
  }
  const syncEngine = getSyncEngine();
  const syncInterface = syncEngine.interface;

  if (isOperationBusy({
    allowBackgroundScheduler: request && request.backgroundScheduled === true,
    allowSmartWatcher: request && request.backgroundWatched === true
  })) {
    return {
      ok: false,
      code: null,
      status: 'busy',
      message: BUSY_MESSAGE,
      output: '',
      summary: null
    };
  }

  const { cleanSourcePaths, cleanDestinations, jobId, jobName, cleanHistoryFolderName, cleanTwoWayConflictPolicy, cleanExcludePatterns } = parseRunRequest(request);

  if (!cleanSourcePaths.length || !cleanDestinations.length) {
    return {
      ok: false,
      code: null,
      status: 'error',
      message: 'At least one source folder and one destination are required.',
      output: '',
      summary: null
    };
  }

  for (const candidateSource of cleanSourcePaths) {
    const sourceExists = await pathIsDirectory(candidateSource, { timeoutMs: PATH_CHECK_TIMEOUT_MS });
    if (!sourceExists) {
      return {
        ok: false,
        code: null,
        status: 'error',
        message: `Source folder does not exist or is not readable: ${candidateSource}`,
        output: '',
        summary: null
      };
    }
  }

  if (!dryRun && normalizeSyncMode(syncMode) === 'twoWay') {
    return await runTwoWaySyncRun({
      request,
      cleanSourcePaths,
      cleanDestinations,
      jobId,
      jobName,
      copySubfolders,
      historyEnabled,
      retentionEnabled,
      retentionMaxVersions,
      retentionMaxAgeDays,
      retentionKeepLatest,
      retentionPruneEmptyFolders,
      retentionPruneAfterSync,
      restorePointsEnabled,
      restorePointRetentionMax
    });
  }

  const destinationAvailability = await resolveDestinationAvailability(cleanDestinations, { allowCreatable: true });
  if (destinationAvailability.missingRequired.length) {
    return {
      ok: false,
      code: null,
      status: 'required-destination-missing',
      message: `Required destination is missing or unreadable: ${destinationAvailability.missingRequired.map((item) => `${item.label} (${item.path})`).join(', ')}`,
      output: '',
      summary: null,
      skippedDestinations: destinationAvailability.skipped,
      missingRequiredDestinations: destinationAvailability.missingRequired
    };
  }

  if (!destinationAvailability.available.length) {
    return {
      ok: false,
      code: null,
      status: 'no-destination-available',
      message: 'No destination is currently available. Optional destinations were skipped, but there was nowhere to sync.',
      output: '',
      summary: null,
      skippedDestinations: destinationAvailability.skipped
    };
  }

  const runStartedAt = new Date();
  const runId = formatHistoryRunId(runStartedAt);
  const availableDestinations = destinationAvailability.available;
  const skippedDestinations = destinationAvailability.skipped;

  // Fill the fields every executeSyncRun result shares (identical across all
  // outcome branches); callers pass the parts that vary, including their own
  // compareFingerprint.
  const buildSyncResult = (parts) => ({
    jobId,
    jobName,
    syncMode: normalizeSyncMode(syncMode),
    targetDestinations: cleanDestinations,
    skippedDestinations,
    compareCreatedAt: runStartedAt.toISOString(),
    ...parts
  });

  setActiveCancellationRequest(null);
  setActiveRunId(runId);
  const runProgressState = createEngineProgressState();

  const sendRunPhase = (latestText, kind = 'phase') => {
    emitSyncEvent({
      type: 'progress',
      runId,
      dryRun: Boolean(dryRun),
      progress: {
        kind,
        label: latestText,
        latestText,
        latestFile: runProgressState.latestFile || '',
        copied: runProgressState.copied,
        skipped: runProgressState.skipped,
        failed: runProgressState.failed,
        extra: runProgressState.extra
      }
    });
  };

  let historyPlan = null;
  let historySnapshots = [];
  let runJournal = null;
  let storageCheck = null;
  let skippedOutput = '';

  try {
    skippedOutput = appendSkippedDestinationLog(runId, Boolean(dryRun), skippedDestinations);
    sendRunPhase(dryRun ? 'Preparing compare plan…' : 'Preparing sync plan…', 'phase');
    throwIfRunCancelled(runId);

    if (dryRun) {
      const sourceRoots = buildDestinationSourceRoots({ sourcePaths: cleanSourcePaths, destinations: availableDestinations });
      const robocopyResult = await runSyncEngineSequence({
        runId,
        dryRun: true,
        sourceRoots,
        excludePatterns: cleanExcludePatterns,
        skipOlderSource: skipOlderSource !== false,
        copySubfolders: copySubfolders !== false,
        syncMode: normalizeSyncMode(syncMode),
        progressState: runProgressState
      });

      if (robocopyResult.canceled || isActiveRunCancelled(runId)) {
        const primaryTargetPath = cleanDestinations[0] ? cleanDestinations[0].path : targetPath;
        const cancelled = makeCancelledRunResult({
          runId,
          dryRun: true,
          output: skippedOutput + robocopyResult.output,
          summary: syncInterface.parseSummary(skippedOutput + robocopyResult.output),
          jobId,
          jobName,
          syncMode,
          targetDestinations: cleanDestinations,
          skippedDestinations,
          compareCreatedAt: runStartedAt.toISOString(),
          compareFingerprint: makeJobFingerprint({ syncMode, twoWayConflictPolicy: cleanTwoWayConflictPolicy, sourcePaths: cleanSourcePaths, targetPath: primaryTargetPath, targetDestinations: cleanDestinations, excludePatterns: cleanExcludePatterns, skipOlderSource, copySubfolders, historyEnabled, historyFolderName: cleanHistoryFolderName, freeSpaceCheckEnabled, minimumFreeGb })
        });
        emitSyncEvent({ type: 'complete', runId, dryRun: true, result: cancelled });
        clearActiveRunState();
        return cancelled;
      }

      clearActiveRunState();

      const combined = skippedOutput + robocopyResult.output;
      const code = robocopyResult.code;
      const summary = syncInterface.parseSummary(combined);
      const interpreted = reconcileNoChangeStatus({
        interpreted: syncInterface.interpretExitCode(code),
        fileCounts: syncInterface.getFileCounts(summary),
        summary,
        syncMode
      });
      const finalStatus = applyDestinationWarningStatus(interpreted, skippedDestinations);
      const preview = syncEngine.id === 'robocopy'
        ? buildRobocopyDryRunPreview({
            output: combined,
            sourceRoots,
            destinations: availableDestinations,
            historyEnabled: historyEnabled !== false,
            historyFolderName: cleanHistoryFolderName,
            syncMode: normalizeSyncMode(syncMode)
          })
        : await buildInternalComparePreview({
            sourcePaths: cleanSourcePaths,
            destinations: availableDestinations,
            skippedDestinations,
            excludePatterns: cleanExcludePatterns,
            skipOlderSource: resolveSkipOlderSource(syncMode, skipOlderSource),
            copySubfolders: copySubfolders !== false,
            historyEnabled: historyEnabled !== false,
            historyFolderName: cleanHistoryFolderName,
            syncMode: normalizeSyncMode(syncMode)
          });
      preview.summary = makeSkippedOptionalPreviewSummary(preview.summary, skippedDestinations);

      const primaryTargetPath = cleanDestinations[0] ? cleanDestinations[0].path : targetPath;
      const compareFingerprint = makeJobFingerprint({ syncMode, twoWayConflictPolicy: cleanTwoWayConflictPolicy, sourcePaths: cleanSourcePaths, targetPath: primaryTargetPath, targetDestinations: cleanDestinations, excludePatterns: cleanExcludePatterns, skipOlderSource, copySubfolders, historyEnabled, historyFolderName: cleanHistoryFolderName, freeSpaceCheckEnabled, minimumFreeGb });

      const previewResult = {
        ok: finalStatus.ok,
        message: finalStatus.ok
          ? buildCompareCompletionMessage({ syncMode: normalizeSyncMode(syncMode), previewSummary: preview.summary, finalStatus })
          : finalStatus.message,
        summary: preview.summary,
        files: preview.files,
        storage: { ok: true, checked: false, skipped: true, message: 'Free-space check runs during update sync.' },
        skippedDestinations
      };

      const result = buildSyncResult({
        ok: finalStatus.ok,
        code,
        status: finalStatus.status,
        message: finalStatus.ok ? previewResult.message : finalStatus.message,
        output: combined,
        summary,
        history: preview.summary,
        storage: previewResult.storage,
        retention: null,
        twoWayConflictPolicy: cleanTwoWayConflictPolicy,
        compareFingerprint,
        preview: previewResult
      });

      try {
        const config = await readConfig();
        const nextRuns = [
          {
            at: new Date().toISOString(),
            dryRun: true,
            code,
            status: finalStatus.status,
            ok: result.ok === true,
            message: result.message,
            output: trimSavedRunOutput(combined),
            sourcePath: cleanSourcePaths[0] || '',
            sourcePaths: cleanSourcePaths,
            targetPath: primaryTargetPath,
            targetDestinations: cleanDestinations,
            skippedDestinations,
            syncMode: normalizeSyncMode(syncMode),
            summary,
            history: result.history,
            storage: result.storage,
            retention: null,
            jobId,
            jobName
          },
          ...(config.lastRuns || [])
        ].slice(0, 20);

        const pendingCompares = { ...(config.pendingCompares || {}) };
        if (finalStatus.ok) {
          pendingCompares[jobId] = makePendingCompare({
            jobId,
            jobName,
            syncMode: normalizeSyncMode(syncMode),
            sourcePaths: cleanSourcePaths,
            targetPath: primaryTargetPath,
            targetDestinations: cleanDestinations,
            fingerprint: compareFingerprint,
            createdAt: runStartedAt,
            result: {
              ok: true,
              message: result.message,
              history: result.history,
              previewFiles: preview.files,
              storage: result.storage
            }
          });
        } else {
          delete pendingCompares[jobId];
        }

        await writeConfig({ ...config, lastRuns: nextRuns, pendingCompares });
      } catch {
        // Do not fail the compare result if its saved preview/log cannot be stored.
      }

      notifyJobRunIfNeeded({ request, result, dryRun: true }).catch(() => {});
      emitSyncEvent({
        type: 'complete',
        runId,
        dryRun: true,
        result
      });

      return result;
    }

    throwIfRunCancelled(runId);

    sendRunPhase('Analyzing file history and destination changes…', 'phase');
    historyPlan = await analyzeMultiDestinationHistoryPlan({
      sourcePaths: cleanSourcePaths,
      destinations: availableDestinations,
      skippedDestinations,
      excludePatterns: cleanExcludePatterns,
      skipOlderSource: resolveSkipOlderSource(syncMode, skipOlderSource),
      copySubfolders: copySubfolders !== false,
      historyEnabled: historyEnabled !== false,
      historyFolderName: cleanHistoryFolderName,
      syncMode: normalizeSyncMode(syncMode)
    });

    throwIfRunCancelled(runId);

    emitSyncEvent({
      type: 'history',
      phase: 'planned',
      runId,
      dryRun: Boolean(dryRun),
      syncMode: normalizeSyncMode(syncMode),
      history: { ...historyPlan.summary, syncMode: normalizeSyncMode(syncMode) },
      jobId,
      jobName,
      preview: {
        summary: historyPlan.summary,
        files: historyPlan.previewFiles
      }
    });

    if (freeSpaceCheckEnabled !== false) {
      throwIfRunCancelled(runId);
      sendRunPhase('Checking destination free space…', 'phase');
      storageCheck = await checkStorageForDestinationPlans({
        destinationPlans: historyPlan.destinationPlans,
        historyEnabled: historyEnabled !== false,
        minimumFreeGb
      });

      emitSyncEvent({
        type: 'storage',
        runId,
        dryRun: Boolean(dryRun),
        storage: storageCheck
      });

      if (!dryRun && storageCheck.checked && !storageCheck.enoughSpace) {
        setActiveRunId(null);
        const message = storageCheck.message || 'Not enough free space for this sync.';
        return {
          ok: false,
          code: null,
          status: 'space',
          message,
          output: message,
          summary: null,
          history: historyPlan.summary,
          storage: storageCheck,
          jobId,
          jobName,
          targetDestinations: cleanDestinations,
          skippedDestinations
        };
      }
    }

    if (!dryRun && isNoOpSyncPlan(historyPlan, syncMode, { copySubfolders: copySubfolders !== false })) {
      const noOpSummary = makeNoOpRobocopySummary(historyPlan.summary || {});
      const noOpStatus = applyDestinationWarningStatus(
        { ok: true, status: 'no-change', message: 'No sync changes to apply.' },
        skippedDestinations
      );
      const primaryTargetPath = cleanDestinations[0] ? cleanDestinations[0].path : targetPath;
      const compareFingerprint = makeJobFingerprint({ syncMode, twoWayConflictPolicy: cleanTwoWayConflictPolicy, sourcePaths: cleanSourcePaths, targetPath: primaryTargetPath, targetDestinations: cleanDestinations, excludePatterns: cleanExcludePatterns, skipOlderSource, copySubfolders, historyEnabled, historyFolderName: cleanHistoryFolderName, freeSpaceCheckEnabled, minimumFreeGb });
      let noOpHistorySummary = historyPlan.summary || {};
      try {
        const config = await readConfig();
        const pendingCompare = config && config.pendingCompares ? config.pendingCompares[jobId] : null;
        const pendingSummary = pendingCompare && pendingCompare.result ? pendingCompare.result.summary : null;
        if (pendingCompare && pendingCompare.fingerprint === compareFingerprint && pendingSummary) {
          noOpHistorySummary = {
            ...noOpHistorySummary,
            destinationOnly: Math.max(Number(noOpHistorySummary.destinationOnly || 0), Number(pendingSummary.destinationOnly || 0)),
            skippedOlder: Math.max(Number(noOpHistorySummary.skippedOlder || 0), Number(pendingSummary.skippedOlder || 0)),
            unchanged: Math.max(Number(noOpHistorySummary.unchanged || 0), Number(pendingSummary.unchanged || 0))
          };
        }
      } catch {
        // Pending compare details are only used to improve no-op wording.
      }

      const noOpMessage = buildNoOpSyncMessage({
        syncMode: normalizeSyncMode(syncMode),
        historySummary: noOpHistorySummary,
        skippedDestinations
      });
      const noOpOutput = [
        `--- SYNC ${runStartedAt.toLocaleString()} ---`,
        `Job: ${jobName || 'Sync job'}`,
        `Mode: ${normalizeSyncMode(syncMode)}`,
        '',
        noOpMessage,
        '',
        'No Robocopy write pass was started because the saved plan has no actionable file changes.',
        restorePointsEnabled === true ? 'Restore point creation skipped because the destination state did not change.' : '',
        ''
      ].filter((line) => line !== '').join('\n') + '\n';
      const resultHistory = {
        ...noOpHistorySummary,
        archived: 0,
        manifestPath: null,
        manifestPaths: []
      };
      const result = buildSyncResult({
        ok: noOpStatus.ok,
        code: 0,
        status: noOpStatus.status,
        message: noOpMessage,
        output: skippedOutput + noOpOutput,
        summary: noOpSummary,
        history: resultHistory,
        storage: storageCheck,
        retention: null,
        restorePoint: null,
        destinationResults: availableDestinations.map((destination) => ({
          destinationPath: destination.path,
          destinationLabel: destination.label,
          destinationRequired: destination.required !== false,
          destinationRole: destination.required !== false ? 'required' : 'optional',
          code: 0,
          status: 'skipped-no-change',
          message: 'No actionable changes for this destination.'
        })),
        compareFingerprint,
        noOp: true
      });

      try {
        const config = await readConfig();
        const nextRuns = [
          {
            at: new Date().toISOString(),
            dryRun: false,
            code: result.code,
            status: result.status,
            ok: result.ok === true,
            message: result.message,
            output: trimSavedRunOutput(result.output || ''),
            sourcePath: cleanSourcePaths[0] || '',
            sourcePaths: cleanSourcePaths,
            targetPath: primaryTargetPath,
            targetDestinations: cleanDestinations,
            skippedDestinations,
            destinationResults: result.destinationResults,
            summary: result.summary,
            history: result.history,
            storage: result.storage,
            retention: result.retention,
            restorePoint: null,
            syncMode: normalizeSyncMode(syncMode),
            jobId,
            jobName
          },
          ...(config.lastRuns || [])
        ].slice(0, 20);

        const pendingCompares = { ...(config.pendingCompares || {}) };
        delete pendingCompares[jobId];
        await writeConfig({ ...config, lastRuns: nextRuns, pendingCompares });
      } catch {
        // Do not fail the no-op sync result if history cannot be stored.
      }

      notifyJobRunIfNeeded({ request, result, dryRun: false }).catch(() => {});
      emitSyncEvent({
        type: 'complete',
        runId,
        dryRun: false,
        result
      });

      clearActiveRunState();
      return result;
    }

    if (!dryRun) {
      runJournal = await getRunJournalStore().createRun({
        runId,
        jobId,
        jobName,
        syncMode: normalizeSyncMode(syncMode),
        trigger: getRunTrigger(request),
        startedAt: runStartedAt,
        job: makeJournalJobSnapshot(request, { jobId, jobName, sourcePaths: cleanSourcePaths, targetDestinations: cleanDestinations }),
        sourcePaths: cleanSourcePaths,
        targetDestinations: cleanDestinations
      });
      await getRunJournalStore().plan(runJournal, buildOneWayJournalOperations(historyPlan));
    }

    if (!dryRun && historyEnabled !== false) {
      throwIfRunCancelled(runId);
      sendRunPhase('Archiving files before sync…', 'phase');
      for (const [destinationIndex, entry] of historyPlan.destinationPlans.entries()) {
        throwIfRunCancelled(runId);
        const destination = entry.destination;
        const snapshot = await createHistorySnapshot({
          plan: entry.plan,
          runId,
          createdAt: runStartedAt,
          sourcePath: cleanSourcePaths[0] || '',
          sourcePaths: cleanSourcePaths,
          sourceRoots: entry.sourceRoots,
          targetPath: destination.path,
          historyFolderName: cleanHistoryFolderName,
          jobId,
          jobName,
          targetDestination: destination,
          targetDestinations: cleanDestinations,
          onArchived: (item, archiveInfo) => getRunJournalStore().recordOperation(
            runJournal,
            `destination-${destinationIndex + 1}-archive-${archiveInfo.index + 1}`,
            {
              status: 'archived',
              archivePath: archiveInfo.archivedPath,
              before: archiveInfo.previous || item.previous || null
            }
          )
        });
        historySnapshots.push(snapshot);
      }

      const archived = historySnapshots.reduce((total, snapshot) => total + Number(snapshot.summary && snapshot.summary.archived || 0), 0);
      const manifestPaths = historySnapshots.map((snapshot) => snapshot.manifestPath).filter(Boolean);
      emitSyncEvent({
        type: 'history',
        phase: 'archived',
        runId,
        dryRun: false,
        syncMode: normalizeSyncMode(syncMode),
        history: {
          ...historyPlan.summary,
          syncMode: normalizeSyncMode(syncMode),
          archived,
          manifestPath: manifestPaths[0] || null,
          manifestPaths
        },
        jobId,
        jobName
      });
    }
  } catch (error) {
    setActiveRunId(null);
    if (isCancellationError(error)) {
      const cancelled = makeCancelledRunResult({
        runId,
        dryRun: Boolean(dryRun),
        output: skippedOutput,
        history: historyPlan ? historyPlan.summary : null,
        storage: storageCheck,
        jobId,
        jobName,
        syncMode,
        targetDestinations: cleanDestinations,
        skippedDestinations,
        compareCreatedAt: runStartedAt.toISOString()
      });
      emitSyncEvent({ type: 'complete', runId, dryRun: Boolean(dryRun), result: cancelled });
      await finishRunJournal(runJournal, 'cancelled', { message: cancelled.message });
      clearActiveRunState();
      return cancelled;
    }
    const message = `File history preparation failed; sync did not run. ${error.message || String(error)}`;
    await finishRunJournal(runJournal, 'failed', { message });
    emitSyncEvent({ type: 'error', runId, text: `${message}\n` });
    clearActiveRunState();
    return {
      ok: false,
      code: null,
      status: 'error',
      message,
      output: message,
      summary: null,
      history: historyPlan ? historyPlan.summary : null,
      targetDestinations: cleanDestinations,
      skippedDestinations
    };
  }

  let robocopyOutput = '';
  let code = 0;
  let statusCode = 0;
  let requiredRunFailure = null;
  let runCancelled = false;
  const destinationResults = [];

  for (const entry of historyPlan.destinationPlans) {
    if (isActiveRunCancelled(runId)) {
      runCancelled = true;
      break;
    }
    const destination = entry.destination;
    sendRunPhase(`Syncing ${destination.label || 'destination'}…`, 'phase');
    const destinationRoots = entry.sourceRoots.map((root) => ({ ...root, destination }));
    const destinationHeader = `\n--- Destination: ${destination.label || 'Destination'} (${destination.required !== false ? 'required' : 'optional'}) | ${destination.path} ---\n`;
    robocopyOutput += destinationHeader;
    emitSyncEvent({ type: 'stdout', runId, dryRun: false, text: destinationHeader });

    const destinationRobocopyResult = await runSyncEngineSequence({
      runId,
      dryRun: false,
      sourceRoots: destinationRoots,
      excludePatterns: cleanExcludePatterns,
      skipOlderSource: skipOlderSource !== false,
      copySubfolders: copySubfolders !== false,
      syncMode: normalizeSyncMode(syncMode),
      progressState: runProgressState
    });

    robocopyOutput += destinationRobocopyResult.output;
    if (destinationRobocopyResult.canceled || isActiveRunCancelled(runId)) {
      runCancelled = true;
      break;
    }
    const destinationCode = Number.isFinite(destinationRobocopyResult.code) ? destinationRobocopyResult.code : 16;
    code = mergeEngineExitCodes(syncEngine, code, destinationCode);
    const destinationStatus = syncInterface.interpretExitCode(destinationCode);
    if (destinationStatus.ok || destination.required !== false) {
      statusCode = mergeEngineExitCodes(syncEngine, statusCode, destinationCode);
    }
    const destinationResult = {
      destinationPath: destination.path,
      destinationLabel: destination.label,
      destinationRequired: destination.required !== false,
      destinationRole: destination.required !== false ? 'required' : 'optional',
      code: destinationCode,
      status: destinationStatus.ok ? 'success' : 'failed',
      message: destinationStatus.message
    };
    destinationResults.push(destinationResult);

    if (!destinationStatus.ok) {
      // A dropped NAS otherwise surfaces only as an opaque engine exit code.
      // Re-probe the destination so "went offline mid-run" is reported
      // distinctly from a genuine engine/data failure (audit M9).
      const stillReachable = await pathIsDirectory(destination.path, { timeoutMs: PATH_CHECK_TIMEOUT_MS });
      if (!stillReachable) {
        destinationStatus.message = `${destinationStatus.message} Destination appears to be offline or unreachable (it was reachable when the run started).`.trim();
        destinationResult.message = destinationStatus.message;
        destinationResult.offline = true;
      }
      if (destination.required === false) {
        const optionalFailure = {
          ...destination,
          available: true,
          creatable: false,
          reason: stillReachable ? 'optional-sync-failed' : 'optional-destination-offline',
          code: destinationCode,
          message: destinationStatus.message
        };
        skippedDestinations.push(optionalFailure);
        const skipText = `Optional destination failed and was skipped: ${destination.label} (${destination.path}) - ${destinationStatus.message}\n`;
        robocopyOutput += skipText;
        emitSyncEvent({ type: 'stdout', runId, dryRun: false, text: skipText });
        continue;
      }

      requiredRunFailure = { destination, code: destinationCode, interpreted: destinationStatus };
      break;
    }
  }

  setActiveProcess(null);
  setActiveRunId(null);

  sendRunPhase('Finalizing sync result…', 'phase');

  const combined = skippedOutput + robocopyOutput;
  const summary = syncInterface.parseSummary(combined);
  const interpreted = runCancelled
    ? { ok: false, status: 'cancelled', message: 'Sync cancelled by user.' }
    : requiredRunFailure
      ? {
          ok: false,
          status: requiredRunFailure.interpreted.status,
          message: `Required destination sync failed: ${requiredRunFailure.destination.label} (${requiredRunFailure.destination.path}). ${requiredRunFailure.interpreted.message}`
        }
      : reconcileNoChangeStatus({
          interpreted: syncInterface.interpretExitCode(statusCode),
          fileCounts: syncInterface.getFileCounts(summary),
          summary,
          syncMode
        });
  const finalStatus = runCancelled ? interpreted : applyDestinationWarningStatus(interpreted, skippedDestinations);
  const resultMessage = runCancelled
    ? 'Sync cancelled by user.'
    : buildSyncCompletionMessage({
        syncMode: normalizeSyncMode(syncMode),
        finalStatus,
        summary,
        getFileCounts: syncInterface.getFileCounts,
        skippedDestinations
      });

  for (const snapshot of historySnapshots) {
    if (!snapshot.manifestPath) continue;
    try {
      await withTimeout(finalizeHistoryManifest(snapshot.manifestPath, {
        completedAt: new Date().toISOString(),
        robocopyCode: code,
        robocopyStatus: interpreted.status,
        robocopyOk: interpreted.ok,
        robocopySummary: summary
      }), POST_SYNC_PHASE_TIMEOUT_MS, 'History manifest finalization');
    } catch {
      // The run result should still be reported if manifest finalization fails.
    }
  }

  let retentionResult = null;
  if (!dryRun && finalStatus.ok && retentionEnabled === true && retentionPruneAfterSync === true) {
    const retentionResults = [];
    for (const destination of availableDestinations) {
      try {
        retentionResults.push(await withTimeout(runRetentionPolicy({
          targetPath: destination.path,
          historyFolderName: cleanHistoryFolderName,
          retentionMaxVersions,
          retentionMaxAgeDays,
          retentionKeepLatest,
          retentionPruneEmptyFolders,
          jobId,
          apply: true
        }), POST_SYNC_PHASE_TIMEOUT_MS, `Retention prune for ${destination.path}`));
      } catch (error) {
        retentionResults.push({
          ok: false,
          message: error.message || String(error),
          summary: emptyRetentionSummary(),
          destination
        });
      }
    }
    retentionResult = aggregateRetentionResults(retentionResults);

    emitSyncEvent({
      type: 'retention',
      runId,
      retention: retentionResult
    });
  }

  const primaryTargetPath = cleanDestinations[0] ? cleanDestinations[0].path : targetPath;
  const compareFingerprint = makeJobFingerprint({ syncMode, twoWayConflictPolicy: cleanTwoWayConflictPolicy, sourcePaths: cleanSourcePaths, targetPath: primaryTargetPath, targetDestinations: cleanDestinations, excludePatterns: cleanExcludePatterns, skipOlderSource, copySubfolders, historyEnabled, historyFolderName: cleanHistoryFolderName, freeSpaceCheckEnabled, minimumFreeGb });

  const manifestPaths = historySnapshots.map((snapshot) => snapshot.manifestPath).filter(Boolean);
  const archived = historySnapshots.length
    ? historySnapshots.reduce((total, snapshot) => total + Number(snapshot.summary && snapshot.summary.archived || 0), 0)
    : Number(historyPlan.summary.archived || 0);
  const resultHistory = {
    ...historyPlan.summary,
    archived,
    manifestPath: manifestPaths[0] || historyPlan.summary.manifestPath || null,
    manifestPaths
  };

  let restorePoint = null;
  if (!dryRun && finalStatus.ok && restorePointsEnabled === true) {
    sendRunPhase('Creating lightweight restore point manifest…', 'phase');
    setActiveRunId(runId);
    try {
      restorePoint = await withTimeout(createRestorePointManifest({
        basePath: app.getPath('userData'),
        jobId,
        jobName,
        runId,
        syncMode: normalizeSyncMode(syncMode),
        createdAt: runStartedAt,
        sourcePaths: cleanSourcePaths,
        destinations: availableDestinations,
        excludePatterns: cleanExcludePatterns,
        historyFolderName: cleanHistoryFolderName,
        historySummary: resultHistory,
        robocopySummary: summary,
        status: finalStatus.status,
        message: resultMessage,
        maxRestorePoints: restorePointRetentionMax,
        onProgress: (progress) => {
          const scannedFiles = Number(progress && progress.scannedFiles || 0);
          const destinationLabel = progress && progress.destinationLabel ? progress.destinationLabel : 'destination';
          const currentPath = progress && progress.currentPath ? `: ${progress.currentPath}` : '';
          emitSyncEvent({
            type: 'progress',
            runId,
            dryRun: false,
            progress: {
              kind: 'phase',
              label: `Indexing restore point for ${destinationLabel}`,
              latestText: `Indexing restore point for ${destinationLabel} — ${scannedFiles.toLocaleString()} file(s) scanned${currentPath}`,
              latestFile: progress && progress.currentPath ? progress.currentPath : '',
              copied: runProgressState.copied,
              skipped: runProgressState.skipped,
              failed: runProgressState.failed,
              extra: runProgressState.extra
            }
          });
        }
      }), POST_SYNC_PHASE_TIMEOUT_MS, 'Restore point creation');
    } catch (error) {
      restorePoint = {
        ok: false,
        message: error && error.message ? error.message : String(error)
      };
    } finally {
      setActiveRunId(null);
    }

    emitSyncEvent({
      type: 'restore-point',
      runId,
      restorePoint,
      jobId,
      jobName
    });
  }

  const result = buildSyncResult({
    ok: finalStatus.ok,
    canceled: runCancelled || undefined,
    code: runCancelled ? null : code,
    status: finalStatus.status,
    message: resultMessage,
    output: combined,
    summary,
    history: resultHistory,
    storage: storageCheck,
    retention: retentionResult,
    restorePoint,
    destinationResults,
    compareFingerprint
  });

  try {
    const config = await readConfig();
    const nextRuns = [
      {
        at: new Date().toISOString(),
        dryRun: Boolean(dryRun),
        code: result.code,
        status: finalStatus.status,
        ok: result.ok === true,
        message: result.message,
        output: trimSavedRunOutput(combined),
        sourcePath: cleanSourcePaths[0] || '',
        sourcePaths: cleanSourcePaths,
        targetPath: primaryTargetPath,
        targetDestinations: cleanDestinations,
        skippedDestinations,
        destinationResults,
        summary,
        history: result.history,
        storage: result.storage,
        retention: result.retention,
        restorePoint: result.restorePoint || null,
        syncMode: normalizeSyncMode(syncMode),
        jobId,
        jobName
      },
      ...(config.lastRuns || [])
    ].slice(0, 20);

    const pendingCompares = { ...(config.pendingCompares || {}) };
    if (dryRun && finalStatus.ok) {
      pendingCompares[jobId] = makePendingCompare({
        jobId,
        jobName,
        syncMode: normalizeSyncMode(syncMode),
        sourcePaths: cleanSourcePaths,
        targetPath: primaryTargetPath,
        targetDestinations: cleanDestinations,
        fingerprint: compareFingerprint,
        createdAt: runStartedAt,
        result: {
          ok: finalStatus.ok,
          message: finalStatus.message,
          history: result.history,
          previewFiles: historyPlan.previewFiles,
          storage: result.storage
        }
      });
    } else {
      delete pendingCompares[jobId];
    }

    await writeConfig({ ...config, lastRuns: nextRuns, pendingCompares });
  } catch {
    // Do not fail the sync result if history cannot be stored.
  }

  notifyJobRunIfNeeded({ request, result, dryRun: Boolean(dryRun) }).catch(() => {});
  if (runJournal) {
    try {
      await finishRunJournal(runJournal, runCancelled ? 'cancelled' : (result.ok ? 'completed' : 'failed'), {
        message: result.message,
        status: result.status,
        summary: result.summary
      });
    } catch {
      // A journal-finalization failure must not throw past clearActiveRunState()
      // below and leave the app stuck "running"; the run result still stands.
    }
  }
  emitSyncEvent({
    type: 'complete',
    runId,
    dryRun: Boolean(dryRun),
    result
  });

  clearActiveRunState();
  return result;
}

  return { executeSyncRun };
}

module.exports = { createSyncRun };
