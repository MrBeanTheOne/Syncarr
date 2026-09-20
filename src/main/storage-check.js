// Free-space preflight, extracted from src/main.js. Self-contained: no
// main-process state. On Windows it probes real free space via
// GetDiskFreeSpaceEx (called from a short PowerShell shim) so UNC/mapped NAS
// targets report correctly; on other platforms the check is reported as
// unavailable and never blocks an operation.
//
// Public surface used by main.js + IPC: checkStorageForRequest /
// checkStorageForPlan / checkStorageForRestore. The remaining functions are
// the shared availability core and its Windows probe helpers, exported for
// unit testing.

const { spawn } = require('child_process');
const path = require('path');
const { clampNumber } = require('./job-model');
const { isWindows } = require('./platform');
const { pathsShareStorageRoot } = require('./fs-utils');
const { formatBytesForMessage } = require('./sync-messages');

// Upper bound on the Windows free-space probe. A dead UNC path / unmounted
// mapped drive can otherwise leave the probe (and the run) hanging forever.
const DISK_PROBE_TIMEOUT_MS = 15000;

async function checkStorageForRequest({ targetPath, estimatedWriteBytes, minimumFreeGb }) {
  if (!targetPath || !targetPath.trim()) {
    return {
      ok: false,
      checked: false,
      message: 'Target path is required before checking free space.'
    };
  }

  return checkStorageAvailability({
    pathToCheck: targetPath.trim(),
    estimatedWriteBytes: Number(estimatedWriteBytes) || 0,
    minimumFreeGb
  });
}

async function checkStorageForPlan({ targetPath, historyPlan, historyEnabled, minimumFreeGb }) {
  const summary = historyPlan && historyPlan.summary ? historyPlan.summary : {};
  const estimatedWriteBytes = Number(summary.copyBytes || 0) + (historyEnabled ? Number(summary.archiveBytes || 0) : 0);

  return checkStorageAvailability({
    pathToCheck: targetPath,
    estimatedWriteBytes,
    minimumFreeGb
  });
}

async function checkStorageForRestore({ targetPath, destinationRoot, destinationMode, restoreBytes, archiveBytes, minimumFreeGb }) {
  const checks = [];

  checks.push(await checkStorageAvailability({
    pathToCheck: destinationRoot,
    estimatedWriteBytes: Number(restoreBytes) || 0,
    minimumFreeGb
  }));

  if (archiveBytes && !pathsShareStorageRoot(destinationRoot, targetPath)) {
    checks.push(await checkStorageAvailability({
      pathToCheck: targetPath,
      estimatedWriteBytes: Number(archiveBytes) || 0,
      minimumFreeGb
    }));
  } else if (archiveBytes) {
    checks[0] = await checkStorageAvailability({
      pathToCheck: destinationRoot,
      estimatedWriteBytes: (Number(restoreBytes) || 0) + (Number(archiveBytes) || 0),
      minimumFreeGb
    });
  }

  const blocking = checks.find((check) => check.checked && !check.enoughSpace);
  const checked = checks.some((check) => check.checked);

  return {
    ok: !blocking,
    checked,
    destinationMode,
    checks,
    enoughSpace: !blocking,
    message: blocking
      ? blocking.message
      : checked
        ? 'Enough free space for this restore.'
        : 'Free-space check could not be completed.'
  };
}

async function checkStorageAvailability({ pathToCheck, estimatedWriteBytes, minimumFreeGb }) {
  const minFreeBytes = Math.round(clampNumber(minimumFreeGb, 0, 1024, 1) * 1024 ** 3);
  const estimated = Math.max(0, Math.round(Number(estimatedWriteBytes) || 0));

  if (!isWindows()) {
    return {
      ok: true,
      checked: false,
      enoughSpace: true,
      path: pathToCheck,
      estimatedWriteBytes: estimated,
      minFreeBytes,
      message: 'Free-space check is only available on Windows.'
    };
  }

  try {
    const disk = await getWindowsDiskSpace(pathToCheck);
    const requiredBytes = estimated + minFreeBytes;
    const enoughSpace = disk.freeBytes >= requiredBytes;

    return {
      ok: enoughSpace,
      checked: true,
      enoughSpace,
      path: pathToCheck,
      freeBytes: disk.freeBytes,
      totalBytes: disk.totalBytes,
      totalFreeBytes: disk.totalFreeBytes,
      estimatedWriteBytes: estimated,
      minFreeBytes,
      requiredBytes,
      message: enoughSpace
        ? 'Enough free space for this operation.'
        : `Not enough free space. Needs ${formatBytesForMessage(requiredBytes)} available, but found ${formatBytesForMessage(disk.freeBytes)}.`
    };
  } catch (error) {
    return {
      ok: true,
      checked: false,
      enoughSpace: true,
      path: pathToCheck,
      estimatedWriteBytes: estimated,
      minFreeBytes,
      message: `Free-space check could not be completed: ${error.message || String(error)}`
    };
  }
}

async function getWindowsDiskSpace(pathToCheck) {
  const candidates = getDiskSpacePathCandidates(pathToCheck);
  const errors = [];

  for (const candidate of candidates) {
    try {
      return await queryWindowsDiskSpace(candidate);
    } catch (error) {
      errors.push(`${candidate}: ${error.message || String(error)}`);
    }
  }

  throw new Error(errors.join(' | ') || 'No disk-space probe paths were available.');
}

function queryWindowsDiskSpace(pathToCheck) {
  const script = `
$ErrorActionPreference = 'Stop'
$Path = $env:SYNCARR_DISK_PATH
if ([string]::IsNullOrWhiteSpace($Path)) {
  throw "SYNCARR_DISK_PATH was not provided"
}
$signature = @"
using System;
using System.Runtime.InteropServices;
public static class SyncarrDiskSpace {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool GetDiskFreeSpaceEx(string lpDirectoryName, out ulong lpFreeBytesAvailable, out ulong lpTotalNumberOfBytes, out ulong lpTotalNumberOfFreeBytes);
}
"@
Add-Type -TypeDefinition $signature
$free = [UInt64]0
$total = [UInt64]0
$totalFree = [UInt64]0
$ok = [SyncarrDiskSpace]::GetDiskFreeSpaceEx($Path, [ref]$free, [ref]$total, [ref]$totalFree)
if (-not $ok) {
  $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  throw "GetDiskFreeSpaceEx failed with code $code"
}
[pscustomobject]@{
  ok = $true
  path = $Path
  freeBytes = [double]$free
  totalBytes = [double]$total
  totalFreeBytes = [double]$totalFree
} | ConvertTo-Json -Compress
`;

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      env: {
        ...process.env,
        SYNCARR_DISK_PATH: pathToCheck
      },
      windowsHide: true,
      shell: false
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    // The probe can hang indefinitely against a dead UNC path or an unmounted
    // mapped drive, freezing the "checking free space" phase. Bound it so the
    // caller (checkStorageAvailability) turns a stall into a normal
    // "check could not be completed" result instead of a hung run.
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(arg);
    };

    timer = setTimeout(() => {
      try { child.kill(); } catch { /* Process may already be gone. */ }
      done(reject, new Error(`Free-space probe timed out after ${Math.round(DISK_PROBE_TIMEOUT_MS / 1000)}s; the path may be unreachable.`));
    }, DISK_PROBE_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => done(reject, error));

    child.on('close', (code) => {
      if (code !== 0) {
        done(reject, new Error(stderr.trim() || `PowerShell exited with code ${code}.`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        done(resolve, {
          ok: Boolean(parsed.ok),
          path: parsed.path,
          probedPath: pathToCheck,
          freeBytes: Number(parsed.freeBytes) || 0,
          totalBytes: Number(parsed.totalBytes) || 0,
          totalFreeBytes: Number(parsed.totalFreeBytes) || 0
        });
      } catch (error) {
        done(reject, error);
      }
    });
  });
}

function getDiskSpacePathCandidates(inputPath) {
  const raw = String(inputPath || '').trim();
  if (!raw) return [];

  const candidates = [];
  const add = (candidate) => {
    const clean = String(candidate || '').trim();
    if (!clean) return;
    candidates.push(clean);
    candidates.push(ensureTrailingPathSeparator(clean));
  };

  add(raw);

  if (/^[a-z]:$/i.test(raw)) {
    add(`${raw}\\`);
  }

  try {
    add(path.resolve(raw));
  } catch {
    // Keep the raw path candidates when resolution fails.
  }

  try {
    const resolved = path.resolve(raw);
    const parsed = path.parse(resolved);
    if (parsed.root) add(parsed.root);

    let current = resolved;
    for (let i = 0; i < 8; i += 1) {
      const parent = path.dirname(current);
      if (!parent || parent === current) break;
      add(parent);
      current = parent;
    }
  } catch {
    // Parent fallbacks are best effort.
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ensureTrailingPathSeparator(inputPath) {
  if (!inputPath) return inputPath;
  if (/[\\/]$/.test(inputPath)) return inputPath;

  if (/^[a-z]:$/i.test(inputPath)) {
    return `${inputPath}\\`;
  }

  return `${inputPath}\\`;
}

module.exports = {
  checkStorageForRequest,
  checkStorageForPlan,
  checkStorageForRestore,
  checkStorageAvailability,
  getDiskSpacePathCandidates,
  ensureTrailingPathSeparator
};
