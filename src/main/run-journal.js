const fs = require('fs/promises');
const path = require('path');
const { sanitizeJobId } = require('./job-model');

const JOURNAL_SCHEMA_VERSION = 1;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'rolled-back', 'dismissed', 'superseded']);

function cleanId(input, fallback = 'run') {
  const value = String(input || fallback)
    .trim()
    .replace(/[^a-z0-9_.-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return value || fallback;
}

function createRunJournalStore({ basePath, now = () => new Date() } = {}) {
  if (!basePath) throw new Error('Run journal requires a base path.');
  const root = path.join(basePath, 'run-journals', 'jobs');
  let writeQueue = Promise.resolve();

  function getJournalPath(jobId, runId) {
    return path.join(root, sanitizeJobId(jobId), `${cleanId(runId)}.jsonl`);
  }

  function queueWrite(operation) {
    const queued = writeQueue.catch(() => {}).then(operation);
    writeQueue = queued;
    return queued;
  }

  async function appendEvent(journalPath, event) {
    await fs.mkdir(path.dirname(journalPath), { recursive: true });
    const handle = await fs.open(journalPath, 'a');
    try {
      await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async function createRun(meta = {}) {
    const jobId = sanitizeJobId(meta.jobId);
    const runId = cleanId(meta.runId || now().toISOString());
    const journalPath = getJournalPath(jobId, runId);
    const header = {
      type: 'header',
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      runId,
      jobId,
      jobName: String(meta.jobName || '').trim(),
      syncMode: String(meta.syncMode || 'oneWay'),
      trigger: String(meta.trigger || 'manual'),
      startedAt: (meta.startedAt instanceof Date ? meta.startedAt : new Date(meta.startedAt || now())).toISOString(),
      job: meta.job || null,
      sourcePaths: Array.isArray(meta.sourcePaths) ? meta.sourcePaths : [],
      targetDestinations: Array.isArray(meta.targetDestinations) ? meta.targetDestinations : []
    };

    await queueWrite(async () => {
      await fs.mkdir(path.dirname(journalPath), { recursive: true });
      const handle = await fs.open(journalPath, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify(header)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
    return { runId, jobId, path: journalPath, header };
  }

  function record(journal, event = {}) {
    const journalPath = typeof journal === 'string' ? journal : journal && journal.path;
    if (!journalPath) return Promise.reject(new Error('Missing journal path.'));
    return queueWrite(() => appendEvent(journalPath, {
      ...event,
      type: event.type || 'event',
      at: event.at || now().toISOString()
    }));
  }

  function plan(journal, operations) {
    return record(journal, {
      type: 'plan',
      operations: Array.isArray(operations) ? operations : []
    });
  }

  function recordOperation(journal, operationId, patch = {}) {
    return record(journal, {
      type: 'operation',
      operationId: cleanId(operationId, 'operation'),
      patch
    });
  }

  function finish(journal, status, result = {}) {
    const cleanStatus = TERMINAL_STATUSES.has(status) ? status : 'failed';
    return record(journal, {
      type: 'terminal',
      status: cleanStatus,
      completedAt: now().toISOString(),
      result
    });
  }

  async function readJournal(journalPath) {
    const raw = await fs.readFile(journalPath, 'utf8');
    const events = [];
    let corruptLines = 0;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { corruptLines += 1; }
    }
    const header = events.find((event) => event.type === 'header');
    if (!header) throw new Error('Journal header is missing.');
    const operations = new Map();
    for (const event of events) {
      if (event.type === 'plan') {
        for (const operation of Array.isArray(event.operations) ? event.operations : []) {
          const operationId = cleanId(operation.id, `operation-${operations.size + 1}`);
          operations.set(operationId, { ...operation, id: operationId, status: operation.status || 'planned' });
        }
      } else if (event.type === 'operation') {
        const operationId = cleanId(event.operationId, `operation-${operations.size + 1}`);
        operations.set(operationId, {
          ...(operations.get(operationId) || { id: operationId, status: 'unknown' }),
          ...(event.patch || {}),
          updatedAt: event.at || null
        });
      }
    }
    const terminal = [...events].reverse().find((event) => event.type === 'terminal') || null;
    return {
      ...header,
      path: journalPath,
      status: terminal ? terminal.status : 'interrupted',
      completedAt: terminal && terminal.completedAt || null,
      result: terminal && terminal.result || null,
      terminal,
      operations: Array.from(operations.values()),
      corruptLines,
      eventCount: events.length
    };
  }

  async function list({ incompleteOnly = false, limit = 100 } = {}) {
    await writeQueue.catch(() => {});
    let jobDirs = [];
    try { jobDirs = await fs.readdir(root, { withFileTypes: true }); } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    }
    const paths = [];
    for (const jobDir of jobDirs) {
      if (!jobDir.isDirectory()) continue;
      const jobPath = path.join(root, jobDir.name);
      let names = [];
      try { names = await fs.readdir(jobPath); } catch { continue; }
      for (const name of names) if (name.toLowerCase().endsWith('.jsonl')) paths.push(path.join(jobPath, name));
    }
    const journals = [];
    for (const journalPath of paths) {
      try {
        const journal = await readJournal(journalPath);
        if (!incompleteOnly || !TERMINAL_STATUSES.has(journal.status)) journals.push(journal);
      } catch {
        // An unreadable journal cannot safely drive recovery actions.
      }
    }
    journals.sort((a, b) => (Date.parse(b.startedAt || '') || 0) - (Date.parse(a.startedAt || '') || 0));
    return journals.slice(0, Math.max(1, Number(limit) || 100));
  }

  async function get(jobId, runId) {
    await writeQueue.catch(() => {});
    return readJournal(getJournalPath(jobId, runId));
  }

  return {
    root,
    getJournalPath,
    createRun,
    record,
    plan,
    recordOperation,
    finish,
    readJournal,
    list,
    get
  };
}

module.exports = {
  createRunJournalStore
};
