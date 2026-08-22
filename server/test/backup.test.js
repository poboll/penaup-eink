import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import test from 'node:test';

import { PenaupDatabase } from '../src/db.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backupScript = path.join(repoRoot, 'deploy', 'backup.sh');
const restoreScript = path.join(repoRoot, 'deploy', 'restore.sh');

function runScript(script, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [script, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('backup and restore preserve SQLite data and media with rollback', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-backup-'));
  const sourceData = path.join(root, 'source-data');
  const backupData = path.join(root, 'backups');
  const restoredData = path.join(root, 'restored-data');
  await fs.mkdir(path.join(sourceData, 'media'), { recursive: true });

  try {
    const database = new PenaupDatabase(path.join(sourceData, 'penaup.db'));
    const user = database.createUser('backup@example.com');
    await fs.writeFile(path.join(sourceData, 'media', 'memory.film'), Buffer.from('film-fixture'));
    database.insertMedia({
      userId: user.id,
      name: 'memory.film',
      storedPath: 'media/memory.film',
      mime: 'application/octet-stream',
      kind: 'film',
      size: 12
    });
    database.close();

    const backup = await runScript(backupScript, [], { PENAUP_DATA_DIR: sourceData, PENAUP_BACKUP_DIR: backupData });
    assert.equal(backup.code, 0, backup.stderr);
    const backupEntries = await fs.readdir(backupData);
    assert.equal(backupEntries.length, 1);
    const backupDir = path.join(backupData, backupEntries[0]);
    assert.ok((await fs.stat(path.join(backupDir, 'penaup.db'))).isFile());
    assert.ok((await fs.stat(path.join(backupDir, 'media.tar.gz'))).isFile());

    const restored = await runScript(restoreScript, [backupDir, restoredData], {});
    assert.equal(restored.code, 0, restored.stderr);
    const restoredDatabase = new PenaupDatabase(path.join(restoredData, 'penaup.db'));
    const restoredUser = restoredDatabase.raw.prepare('SELECT id FROM users WHERE email = ?').get('backup@example.com');
    assert.ok(restoredUser);
    assert.equal(restoredDatabase.listMedia(restoredUser.id).length, 1);
    restoredDatabase.close();
    assert.equal(await fs.readFile(path.join(restoredData, 'media', 'memory.film'), 'utf8'), 'film-fixture');

    const forced = await runScript(restoreScript, [backupDir, restoredData, '--force'], {});
    assert.equal(forced.code, 0, forced.stderr);
    const rollback = (await fs.readdir(root)).find((name) => name.startsWith('restored-data.before-restore-'));
    assert.ok(rollback);
    assert.ok((await fs.stat(path.join(root, rollback, 'penaup.db'))).isFile());
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
