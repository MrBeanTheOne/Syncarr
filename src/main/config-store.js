const path = require('path');
const fs = require('fs/promises');
const { normalizeConfig } = require('./job-model');

function createConfigStore(app) {
  let writeQueue = Promise.resolve();
  let health = { ok: true, recovered: false, source: 'primary', message: '' };

  function getConfigPath() {
    return path.join(app.getPath('userData'), 'syncarr-config.json');
  }

  function getTempPath() {
    return `${getConfigPath()}.tmp`;
  }

  function getBackupPaths() {
    return [1, 2, 3].map((index) => path.join(app.getPath('userData'), `syncarr-config.backup-${index}.json`));
  }

  async function readJson(candidatePath) {
    return normalizeConfig(JSON.parse(await fs.readFile(candidatePath, 'utf8')));
  }

  async function readConfig() {
    await writeQueue.catch(() => {});
    try {
      const config = await readJson(getConfigPath());
      health = { ok: true, recovered: false, source: 'primary', message: '' };
      return config;
    } catch (primaryError) {
      const candidates = [
        { path: getTempPath(), source: 'temporary file' },
        ...getBackupPaths().map((backupPath, index) => ({ path: backupPath, source: `backup ${index + 1}` }))
      ];
      for (const candidate of candidates) {
        try {
          const config = await readJson(candidate.path);
          health = {
            ok: true,
            recovered: true,
            source: candidate.source,
            message: `The primary configuration could not be read. Syncarr recovered ${candidate.source}.`
          };
          return config;
        } catch {
          // Try the next recovery candidate.
        }
      }

      health = {
        ok: false,
        recovered: false,
        source: 'defaults',
        message: `No readable configuration or backup was found: ${primaryError.message || String(primaryError)}`
      };
      return normalizeConfig({});
    }
  }

  async function rotateBackups() {
    const backups = getBackupPaths();
    await fs.rm(backups[2], { force: true }).catch(() => {});
    await fs.rename(backups[1], backups[2]).catch((error) => {
      if (!error || error.code !== 'ENOENT') throw error;
    });
    await fs.rename(backups[0], backups[1]).catch((error) => {
      if (!error || error.code !== 'ENOENT') throw error;
    });
    await fs.copyFile(getConfigPath(), backups[0]).catch((error) => {
      if (!error || error.code !== 'ENOENT') throw error;
    });
  }

  async function replacePrimary(tempPath) {
    try {
      await fs.rename(tempPath, getConfigPath());
    } catch (error) {
      if (!error || !['EEXIST', 'EPERM'].includes(error.code)) throw error;
      await fs.rm(getConfigPath(), { force: true });
      await fs.rename(tempPath, getConfigPath());
    }
  }

  function writeConfig(config) {
    const normalized = normalizeConfig(config);
    const operation = writeQueue.catch(() => {}).then(async () => {
      const configPath = getConfigPath();
      const tempPath = getTempPath();
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      const handle = await fs.open(tempPath, 'w');
      try {
        await handle.writeFile(JSON.stringify(normalized, null, 2), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rotateBackups();
      await replacePrimary(tempPath);
      health = { ok: true, recovered: false, source: 'primary', message: '' };
      return normalized;
    });
    writeQueue = operation;
    return operation;
  }

  return {
    getConfigPath,
    getTempPath,
    getBackupPaths,
    getHealth: () => ({ ...health }),
    readConfig,
    writeConfig
  };
}

module.exports = {
  createConfigStore
};
