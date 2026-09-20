const { execFile } = require('child_process');

function markHistoryFolderHidden(folderPath, { platform = process.platform, execFileFn = execFile } = {}) {
  if (platform !== 'win32' || !folderPath) return Promise.resolve({ ok: true, changed: false });

  return new Promise((resolve) => {
    try {
      execFileFn('attrib.exe', ['+H', folderPath], { windowsHide: true }, (error) => {
        resolve({
          ok: !error,
          changed: !error,
          message: error ? (error.message || String(error)) : ''
        });
      });
    } catch (error) {
      resolve({ ok: false, changed: false, message: error.message || String(error) });
    }
  });
}

module.exports = { markHistoryFolderHidden };
