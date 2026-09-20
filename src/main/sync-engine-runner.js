// Sync-engine invocation layer extracted from src/main.js. This is the shared
// run-the-engine core that both compare (runCompareOnly) and sync
// (executeSyncRun / runTwoWaySyncRun) sit on top of: it dispatches through the
// SyncEngine interface, spawns the engine per source root, streams decoded
// output into progress + sync events, and aggregates exit codes.
//
// A factory because it collaborates with main-process run state: it emits sync
// events, checks the cancellation singleton, registers the live child process
// (setActiveProcess) so a cancel can kill it, and reuses the cancel-message and
// process-tree-kill helpers. Everything else is imported.

const fs = require('fs/promises');
const { ROBOCOPY_COMPARE_TIMEOUT_MS } = require('./job-model');
const { getSyncEngine, mergeEngineExitCodes } = require('./sync-engine-registry');
const { quoteForDisplay } = require('./sync-messages');

function createSyncEngineRunner({
  emitSyncEvent,
  isActiveRunCancelled,
  cancelMessageFor,
  requestProcessTreeKill,
  setActiveProcess
}) {
  function createEngineProgressState() {
    return {
      copied: 0,
      skipped: 0,
      failed: 0,
      extra: 0,
      latestText: '',
      latestFile: ''
    };
  }

  async function runSyncEngineSequence({ runId, dryRun, sourceRoots, excludePatterns, skipOlderSource, copySubfolders, syncMode, progressState }) {
    // Dispatch through the SyncEngine interface registered for the current
    // platform. The engine modules are engine-agnostic so the rest of this
    // function is identical for Robocopy (Windows) and rsync (Linux/macOS).
    const engine = getSyncEngine();
    const iface = engine.interface;

    let output = '';
    let aggregateCode = 0;
    let progressRemainder = '';
    const cumulativeProgress = progressState || createEngineProgressState();

    const readProgress = (text) => {
      progressRemainder += text;
      const lines = progressRemainder.split(/\r?\n/);
      progressRemainder = lines.pop() || '';

      for (const line of lines) {
        const progress = iface.parseProgressLine(line);
        if (!progress) continue;

        const nextProgress = iface.applyProgress(cumulativeProgress, progress);
        emitSyncEvent({
          type: 'progress',
          runId,
          dryRun,
          progress: nextProgress
        });
      }
    };

    for (const root of sourceRoots) {
      if (isActiveRunCancelled(runId)) {
        const message = `${cancelMessageFor(Boolean(dryRun))}\n`;
        return { output: output + message, code: 16, canceled: true };
      }

      // Compare must not create missing destination folders. Sync can create them.
      if (!dryRun) {
        try {
          await fs.mkdir(root.destinationPath, { recursive: true });
        } catch (error) {
          // A destination that vanished mid-run (NAS unmount, permission loss)
          // must NOT reject out of the whole sequence: that would propagate an
          // unhandled rejection past executeSyncRun, skip clearActiveRunState(),
          // and leave the app wedged at "running". Surface it as a fatal
          // per-destination result (code 16) so the normal failed-destination
          // handling reports it and the run finalizes cleanly.
          const detail = error && error.message ? error.message : String(error);
          const message = `\nCould not prepare destination "${root.destinationPath}": ${detail}\n`;
          emitSyncEvent({ type: 'error', runId, dryRun, text: message });
          return { output: output + message, code: 16, canceled: false };
        }
      }

      let args;
      try {
        args = iface.buildArgs({
          sourcePath: root.sourcePath,
          targetPath: root.destinationPath,
          dryRun,
          excludePatterns,
          skipOlderSource,
          copySubfolders,
          syncMode
        });
      } catch (error) {
        // buildArgs rejects a path/exclude that would inject an engine switch.
        // Contain it as a fatal per-destination result (like the mkdir guard)
        // rather than letting it reject out of the run and wedge active state.
        const detail = error && error.message ? error.message : String(error);
        const message = `\n${detail}\n`;
        emitSyncEvent({ type: 'error', runId, dryRun, text: message });
        return { output: output + message, code: 16, canceled: false };
      }

      emitSyncEvent({
        type: 'start',
        runId,
        dryRun,
        sourceRoot: root,
        command: `${engine.command} ${args.map(quoteForDisplay).join(' ')}`
      });

      const prefix = sourceRoots.length > 1 ? `\n--- Source ${root.index + 1}/${sourceRoots.length}: ${root.sourcePath} -> ${root.destinationPath} ---\n` : '';
      if (prefix) {
        output += prefix;
        emitSyncEvent({ type: 'stdout', runId, dryRun, text: prefix });
      }

      const result = await runSingleEngineInvocation({
        engine,
        iface,
        args,
        runId,
        dryRun,
        readProgress,
        timeoutMs: dryRun ? ROBOCOPY_COMPARE_TIMEOUT_MS : 0
      });

      output += result.output;
      if (result.canceled || isActiveRunCancelled(runId)) {
        return { output, code: 16, canceled: true };
      }

      const code = Number.isFinite(result.code) ? result.code : 16;
      aggregateCode = mergeEngineExitCodes(engine, aggregateCode, code);

      if (!iface.interpretExitCode(code).ok) {
        break;
      }
    }

    if (progressRemainder.trim()) {
      const progress = iface.parseProgressLine(progressRemainder);
      if (progress) {
        emitSyncEvent({
          type: 'progress',
          runId,
          dryRun,
          progress: iface.applyProgress(cumulativeProgress, progress)
        });
      }
    }

    return { output, code: aggregateCode };
  }

  function runSingleEngineInvocation({ engine, iface, args, runId, dryRun = false, readProgress, timeoutMs = 0 }) {
    return new Promise((resolve) => {
      const child = iface.spawn(args);
      setActiveProcess(child);
      if (isActiveRunCancelled(runId)) requestProcessTreeKill(child);

      const stdoutDecoder = iface.createOutputDecoder();
      const stderrDecoder = iface.createOutputDecoder();
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timeoutTimer = null;
      let forceResolveTimer = null;
      let endedResolveTimer = null;
      let exitResolveTimer = null;
      let observedExitCode = null;

      const getCombinedOutput = () => stdout + (stderr ? `\n${stderr}` : '');

      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (forceResolveTimer) clearTimeout(forceResolveTimer);
        if (endedResolveTimer) clearTimeout(endedResolveTimer);
        if (exitResolveTimer) clearTimeout(exitResolveTimer);
        setActiveProcess(null);
        resolve(result);
      };

      const emitText = (type, text) => {
        if (!text) return;
        emitSyncEvent({ type, runId, dryRun, text });
      };

      const appendText = (stream, chunk) => {
        const text = stream === 'stderr' ? stderrDecoder.write(chunk) : stdoutDecoder.write(chunk);
        if (!text) return;
        if (stream === 'stderr') stderr += text;
        else stdout += text;
        if (typeof readProgress === 'function') readProgress(text);
        emitText(stream, text);
        scheduleEndedResolve();
      };

      const flushDecoders = () => {
        const tailOut = stdoutDecoder.end();
        if (tailOut) {
          stdout += tailOut;
          if (typeof readProgress === 'function') readProgress(tailOut);
          emitText('stdout', tailOut);
        }

        const tailErr = stderrDecoder.end();
        if (tailErr) {
          stderr += tailErr;
          if (typeof readProgress === 'function') readProgress(tailErr);
          emitText('stderr', tailErr);
        }
      };

      const finishFromProcessEnd = (code, reasonText = '') => {
        flushDecoders();

        if (isActiveRunCancelled(runId)) {
          const message = `\n${cancelMessageFor(Boolean(dryRun))}\n`;
          emitText('stdout', message);
          finish({ code: 16, output: getCombinedOutput() + message, canceled: true });
          return;
        }

        const finalCode = Number.isFinite(code) ? code : iface.inferExitCodeFromOutput(getCombinedOutput());
        finish({ code: finalCode, output: getCombinedOutput() + reasonText });
      };

      const scheduleEndedResolve = () => {
        // The "Ended :" marker is Robocopy-specific. rsync doesn't emit it,
        // so this branch never fires for non-Robocopy engines — that's fine,
        // rsync exits cleanly and the close handler picks up normally.
        if (settled || timeoutMs || endedResolveTimer) return;
        const combined = getCombinedOutput();
        if (!/\bEnded\s*:/i.test(combined)) return;
        endedResolveTimer = setTimeout(() => {
          if (settled) return;
          const message = `\n${engine.label} printed its Ended line but the process did not close cleanly. Syncarr finalized the run from the completed output.\n`;
          emitText('stdout', message);
          try { child.kill('SIGTERM'); } catch { /* Process may already be gone. */ }
          finishFromProcessEnd(iface.inferExitCodeFromOutput(getCombinedOutput()), message);
        }, 5000);
      };

      child.stdout.on('data', (chunk) => appendText('stdout', chunk));
      child.stderr.on('data', (chunk) => appendText('stderr', chunk));

      child.on('error', (error) => {
        const message = error.message || String(error);
        emitText('error', `${message}\n`);
        finish({ code: 16, output: getCombinedOutput() + `\n${message}\n` });
      });

      child.on('exit', (code) => {
        observedExitCode = Number.isFinite(code) ? code : null;
        if (settled || exitResolveTimer) return;

        // Treat exit as authoritative after a short drain period so the UI
        // cannot hang forever after the copy has already finished. Robocopy
        // is the engine that hits this path in practice because its stdio
        // pipes can stay open briefly after the process exits on Windows.
        exitResolveTimer = setTimeout(() => {
          if (settled) return;
          const message = `\n${engine.label} process exited but its output stream did not close cleanly. Syncarr finalized the run from the process exit.\n`;
          emitText('stdout', message);
          finishFromProcessEnd(observedExitCode, message);
        }, 2500);
      });

      child.on('close', (code) => {
        finishFromProcessEnd(Number.isFinite(code) ? code : observedExitCode);
      });

      if (timeoutMs && timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          const message = `${engine.label} compare timed out after ${Math.round(timeoutMs / 1000)} seconds. Check for an unavailable source, destination, mapped drive, or network share.`;
          emitText('error', `\n${message}\n`);
          try {
            child.kill('SIGTERM');
          } catch {
            // Fall through to forced resolve below.
          }
          forceResolveTimer = setTimeout(() => {
            finish({ code: 16, output: getCombinedOutput() + `\n${message}\n` });
          }, 2500);
        }, timeoutMs);
      }
    });
  }

  return {
    createEngineProgressState,
    runSyncEngineSequence,
    runSingleEngineInvocation
  };
}

module.exports = { createSyncEngineRunner };

