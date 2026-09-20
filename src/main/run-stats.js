function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return Math.max(0, number);
  }
  return 0;
}

function sumFields(object, fields) {
  const source = object && typeof object === 'object' ? object : {};
  let found = false;
  let total = 0;
  for (const field of fields) {
    if (source[field] === null || source[field] === undefined || source[field] === '') continue;
    const number = Number(source[field]);
    if (!Number.isFinite(number)) continue;
    found = true;
    total += Math.max(0, number);
  }
  return found ? total : null;
}

function extractRunStats({ job, result, dryRun } = {}) {
  const summary = result && result.summary && typeof result.summary === 'object' ? result.summary : {};
  const files = summary.files && typeof summary.files === 'object' ? summary.files : {};
  const bytes = summary.bytes && typeof summary.bytes === 'object' ? summary.bytes : {};
  const history = result && result.history && typeof result.history === 'object' ? result.history : {};
  const mode = String((result && result.syncMode) || (job && job.syncMode) || 'oneWay');
  const twoWay = mode === 'twoWay' || summary.twoWay === true || history.twoWay === true;

  let copied;
  let deleted;
  let failed;
  let skipped;

  if (twoWay) {
    const summaryCopies = sumFields(summary, ['copyToDest', 'copyToSource']);
    const historyCopies = sumFields(history, ['copyToDest', 'copyToSource']);
    const summaryDeletes = sumFields(summary, ['deleteOnDest', 'deleteOnSource']);
    const historyDeletes = sumFields(history, ['deleteOnDest', 'deleteOnSource']);
    copied = firstNumber(summaryCopies, summary.wouldCopy, historyCopies, history.wouldCopy, files.copied, summary.copied);
    deleted = firstNumber(summaryDeletes, historyDeletes, summary.deleted, history.deleted, history.destinationOnly);
    failed = firstNumber(summary.errors, history.errors, files.failed, summary.failed);
    skipped = firstNumber(files.skipped, summary.skipped, history.unchanged);
  } else {
    copied = firstNumber(files.copied, summary.copied, history.copied);
    deleted = mode === 'mirror'
      ? firstNumber(files.extras, files.deleted, summary.extras, summary.deleted, history.deleted)
      : 0;
    failed = firstNumber(files.failed, summary.failed, history.errors);
    skipped = firstNumber(files.skipped, summary.skipped, history.skippedOlder);
  }

  const archived = firstNumber(history.archived, summary.archived);
  const copyBytes = firstNumber(bytes.copied, summary.copyBytes, history.copyBytes);
  const archiveBytes = firstNumber(history.archiveBytes, summary.archiveBytes);
  const conflicts = firstNumber(history.conflicts, summary.conflicts);

  let plannedCopies = firstNumber(history.wouldCopy, summary.wouldCopy, copied);
  let plannedDeletes = 0;
  if (twoWay) {
    plannedDeletes = firstNumber(
      sumFields(history, ['deleteOnDest', 'deleteOnSource']),
      sumFields(summary, ['deleteOnDest', 'deleteOnSource']),
      deleted
    );
  } else if (mode === 'mirror') {
    plannedDeletes = firstNumber(history.destinationOnly, history.deleted, deleted);
  }
  const plannedActions = dryRun
    ? (mode === 'mirror' || twoWay
        ? firstNumber(history.previewFiles, summary.previewFiles, plannedCopies + plannedDeletes)
        : plannedCopies)
    : copied + deleted;

  return {
    mode,
    copied,
    deleted,
    skipped,
    failed,
    archived,
    copyBytes,
    archiveBytes,
    conflicts,
    plannedCopies,
    plannedDeletes,
    plannedActions
  };
}

module.exports = { extractRunStats };
