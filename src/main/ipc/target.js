// Target reachability + writability test. Writes a small `.syncarr-test-*.tmp`
// file inside the target then removes it — same logic that lived in main.js.

const path = require('path');
const fs = require('fs/promises');

function register(ipcMain) {
  ipcMain.handle('target:test', async (_event, targetPath) => {
    if (!targetPath || !targetPath.trim()) {
      return { ok: false, message: 'Target path is empty.' };
    }

    const cleanTarget = targetPath.trim();
    const testName = `.syncarr-test-${Date.now()}.tmp`;
    const testPath = path.join(cleanTarget, testName);

    try {
      const stats = await fs.stat(cleanTarget);
      if (!stats.isDirectory()) {
        return { ok: false, message: 'Target exists but is not a folder.' };
      }

      await fs.writeFile(testPath, `syncarr test ${new Date().toISOString()}\n`, 'utf8');
      await fs.unlink(testPath);
      return { ok: true, message: 'Target is reachable and writable.' };
    } catch (error) {
      return {
        ok: false,
        message: error && error.message ? error.message : String(error)
      };
    }
  });
}

module.exports = { register };
