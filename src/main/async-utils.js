// Small async helpers shared by main-process modules.

/**
 * Run `worker` over `items` with at most `concurrency` in-flight promises.
 * The returned array preserves the input order so callers can rely on
 * `results[i]` matching `items[i]`. Empty input resolves to an empty array
 * without spawning any workers.
 *
 * Used to fan out per-file `fs.stat` calls in the restore-point destination
 * scan and the file-history retention walk — both of which became minutes-long
 * over SMB to a NAS when implemented as plain `await` loops.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, concurrency, worker) {
  if (!items || items.length === 0) return [];
  const limit = Math.max(1, Math.floor(Number(concurrency) || 1));
  const results = new Array(items.length);
  let cursor = 0;

  async function runOne() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const runnerCount = Math.min(limit, items.length);
  const runners = Array.from({ length: runnerCount }, runOne);
  await Promise.all(runners);
  return results;
}

/**
 * Reject with `label` if `promise` does not settle within `ms`. This does NOT
 * cancel the underlying work — it only stops the caller waiting, so a hung
 * filesystem handle (e.g. a dead SMB mount mid-scan) cannot wedge a sync run
 * and stall the scheduler forever. The abandoned promise is left to the
 * process-level unhandledRejection safety net in main.js.
 */
function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    // Deliberately NOT unref'd: Electron's main loop never exits on an empty
    // queue, and an unref'd timer lets a plain Node process (tests, Node 20)
    // drain the loop before the timeout can fire.
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { mapWithConcurrency, withTimeout };
