import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import { PenaupDatabase } from '../src/db.js';

const serverRoot = path.resolve(new URL('..', import.meta.url).pathname);
const migration = path.join(serverRoot, 'migrations', 'import-fastapi.mjs');

function filmFixture() {
  const file = Buffer.alloc(120032);
  file.writeUInt32LE(120000, 0);
  file.writeUInt16LE(600, 4);
  file.writeUInt16LE(400, 6);
  file[8] = 6;
  file.set([0x00, 0xff, 0xfc, 0xe0, 0x03, 0x1c], 16);
  return file;
}

function runMigration(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [migration, ...args], { cwd: serverRoot });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('FastAPI import keeps original and valid film as separate media records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-migration-'));
  const sourceData = path.join(root, 'legacy-data');
  const sourceDb = path.join(root, 'filmhub.db');
  const targetData = path.join(root, 'target-data');
  try {
    await fs.mkdir(path.join(sourceData, 'originals'), { recursive: true });
    await fs.mkdir(path.join(sourceData, 'films'), { recursive: true });
    await fs.writeFile(path.join(sourceData, 'originals', '1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await fs.writeFile(path.join(sourceData, 'films', '1.film'), filmFixture());

    const legacy = new Database(sourceDb);
    legacy.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
      CREATE TABLE albums (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, description TEXT, dither_type TEXT, dither_strength INTEGER);
      CREATE TABLE photos (
        id INTEGER PRIMARY KEY, user_id INTEGER, album_id INTEGER, filename TEXT,
        original_path TEXT, preview_path TEXT, film_path TEXT, width INTEGER,
        height INTEGER, layout TEXT, sort INTEGER
      );
    `);
    legacy.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run(7, 'owner@example.com');
    legacy.prepare('INSERT INTO albums (id, user_id, name, description, dither_type, dither_strength) VALUES (?, ?, ?, ?, ?, ?)')
      .run(8, 7, '八月片单', '留给电子纸的一帧', 'adaptive', 80);
    legacy.prepare(`INSERT INTO photos
      (id, user_id, album_id, filename, original_path, preview_path, film_path, width, height, layout, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(9, 7, 8, 'memory.jpg', 'originals/1.jpg', '', 'films/1.film', 2, 2, '{}', 0);
    legacy.close();

    const dryRun = await runMigration([
      '--source-db', sourceDb, '--source-data', sourceData,
      '--target-data', targetData, '--dry-run', '--json'
    ]);
    assert.equal(dryRun.code, 0, dryRun.stderr);
    const dryReport = JSON.parse(dryRun.stdout);
    assert.equal(dryReport.media_imported, 0);
    assert.equal(dryReport.media[0].film.valid, true);
    assert.equal(dryReport.media[0].film.profile, 'PENAUP_STD');

    const imported = await runMigration([
      '--source-db', sourceDb, '--source-data', sourceData,
      '--target-data', targetData, '--json'
    ]);
    assert.equal(imported.code, 0, imported.stderr);
    const report = JSON.parse(imported.stdout);
    assert.equal(report.media_imported, 2);
    assert.equal(report.photos_imported, 1);

    const database = new PenaupDatabase(path.join(targetData, 'penaup.db'));
    const user = database.raw.prepare('SELECT id FROM users WHERE email = ?').get('owner@example.com');
    const media = database.listMedia(user.id);
    assert.equal(media.length, 2);
    assert.deepEqual(new Set(media.map((item) => item.kind)), new Set(['original', 'film']));
    const film = media.find((item) => item.kind === 'film');
    assert.equal(film.profile, 'PENAUP_STD');
    await Promise.all(media.map(async (item) => assert.ok((await fs.stat(path.join(targetData, item.storedPath))).isFile())));
    const photo = database.raw.prepare('SELECT original_path, film_path FROM photos WHERE id = 1').get();
    assert.ok(photo.original_path);
    assert.ok(photo.film_path);
    assert.ok((await fs.stat(photo.film_path)).isFile());
    database.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
