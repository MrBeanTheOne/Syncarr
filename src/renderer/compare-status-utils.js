(function () {
  function buildLastScanHint({ compareDone, compareReadyAt, lastCompareScannedAt, formatRelativeAge }) {
    const scanAt = compareReadyAt || lastCompareScannedAt;

    if (!scanAt) {
      return { text: 'Never scanned', kind: 'idle' };
    }

    const scannedAt = new Date(scanAt).getTime();
    const ageMs = Number.isFinite(scannedAt) ? Date.now() - scannedAt : 0;
    const oldCompare = ageMs >= 30 * 60 * 1000;
    const relative = typeof formatRelativeAge === 'function'
      ? formatRelativeAge(scanAt)
      : 'recently';

    return {
      text: `Last scanned ${relative} ago`,
      kind: oldCompare || !compareDone ? 'warning' : 'ready'
    };
  }

  window.SyncarrCompareStatus = {
    buildLastScanHint
  };
}());
