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

test('FastAPI import exposes help and rejects unknown options before opening a database', async () => {
  const help = await runMigration(['--help']);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /Usage: node server\/migrations\/import-fastapi\.mjs/);
  assert.match(help.stdout, /--source-db PATH/);

  const unknown = await runMigration(['--not-a-real-option']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /unknown option: --not-a-real-option/);
});

test('FastAPI import refuses a target inside the legacy source tree', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-migration-overlap-'));
  const sourceData = path.join(root, 'legacy-data');
  const sourceDb = path.join(sourceData, 'filmhub.db');
  try {
    await fs.mkdir(sourceData, { recursive: true });
    const legacy = new Database(sourceDb);
    legacy.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);');
    legacy.close();
    const result = await runMigration([
      '--source-db', sourceDb, '--source-data', sourceData,
      '--target-data', path.join(sourceData, 'target'), '--dry-run'
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /source and target paths overlap/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

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

test('FastAPI import preserves device, template, stream, settings and push relationships', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-migration-relations-'));
  const sourceData = path.join(root, 'legacy-data');
  const sourceDb = path.join(root, 'filmhub.db');
  const targetData = path.join(root, 'target-data');
  try {
    await fs.mkdir(sourceData, { recursive: true });
    const legacy = new Database(sourceDb);
    legacy.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, username TEXT);
      CREATE TABLE devices (
        id INTEGER PRIMARY KEY, device_id TEXT, name TEXT, device_type TEXT, token TEXT,
        is_claimed INTEGER, wifi_enable INTEGER, play_mode INTEGER, sleep_mode INTEGER,
        sleep_auto INTEGER, sleep_time INTEGER, ble_enable INTEGER, current_file_id INTEGER,
        heartbeat_interval INTEGER, play_stream_id INTEGER, battery_percent INTEGER,
        voltage_mv INTEGER, state TEXT, pending_config TEXT, pending_commands TEXT,
        last_heartbeat_at TEXT, last_ip TEXT, created_at TEXT, user_id INTEGER
      );
      CREATE TABLE templates (
        id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, kind TEXT, is_builtin INTEGER,
        definition TEXT, render_config TEXT, thumb_path TEXT
      );
      CREATE TABLE streams (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, mode TEXT, enabled INTEGER);
      CREATE TABLE stream_items (
        id INTEGER PRIMARY KEY, stream_id INTEGER, template_id INTEGER, position INTEGER,
        schedule_type TEXT, duration_sec INTEGER, start_at TEXT, enabled INTEGER
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE push_records (
        id INTEGER PRIMARY KEY, user_id INTEGER, device_id INTEGER, stream_item_id INTEGER,
        film_path TEXT, method TEXT, pushed_at TEXT
      );
    `);
    legacy.prepare('INSERT INTO users (id, email, username) VALUES (?, ?, ?)').run(7, 'relations@example.com', 'relations');
    legacy.prepare(`INSERT INTO templates
      (id, user_id, name, kind, is_builtin, definition, render_config, thumb_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(4, 7, '关系模板', 'memo', 0, JSON.stringify({ layers: [{ type: 'text', x: 2, y: 3 }] }), JSON.stringify({ dither: 'bayer' }), 'thumbs/relations.png');
    legacy.prepare('INSERT INTO streams (id, user_id, name, mode, enabled) VALUES (?, ?, ?, ?, ?)')
      .run(5, 7, '晚间片单', 'server_push', 1);
    legacy.prepare(`INSERT INTO stream_items
      (id, stream_id, template_id, position, schedule_type, duration_sec, start_at, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(6, 5, 4, 0, 'relative', 45, null, 1);
    legacy.prepare(`INSERT INTO devices
      (id, device_id, name, device_type, token, is_claimed, wifi_enable, play_mode, sleep_mode,
       sleep_auto, sleep_time, ble_enable, current_file_id, heartbeat_interval, play_stream_id,
       battery_percent, voltage_mv, state, pending_config, pending_commands, last_heartbeat_at,
       last_ip, created_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(9, 'PENAUP-RELATIONS-1', '关系设备', 'pro', 'legacy-device-token', 1, 1, 2, 0, 1, 22, 1, 4, 30, 5, 88, 3800, 'ready', '{}', '[]', '2026-08-23T00:00:00.000Z', '192.0.2.10', '2026-08-22T00:00:00.000Z', 7);
    legacy.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('ai', JSON.stringify({ provider: 'local', enabled: false }));
    legacy.prepare(`INSERT INTO push_records
      (id, user_id, device_id, stream_item_id, film_path, method, pushed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(8, 7, 9, 6, 'films/relations.film', 'push', '2026-08-23T00:01:00.000Z');
    const sourceCountsBefore = legacy.prepare("SELECT name, (SELECT COUNT(*) FROM \"users\") AS users FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    legacy.close();

    const dryRun = await runMigration([
      '--source-db', sourceDb, '--source-data', sourceData,
      '--target-data', targetData, '--dry-run', '--json'
    ]);
    assert.equal(dryRun.code, 0, dryRun.stderr);
    const dryReport = JSON.parse(dryRun.stdout);
    assert.equal(dryReport.users, 1);
    assert.equal(dryReport.devices, 1);
    assert.equal(dryReport.templates, 1);
    assert.equal(dryReport.streams, 1);
    assert.equal(dryReport.stream_items, 1);
    assert.equal(dryReport.settings, 1);
    assert.equal(dryReport.push_records, 1);

    const imported = await runMigration([
      '--source-db', sourceDb, '--source-data', sourceData,
      '--target-data', targetData, '--json'
    ]);
    assert.equal(imported.code, 0, imported.stderr);
    const report = JSON.parse(imported.stdout);
    assert.equal(report.media_imported, 0);
    assert.equal(report.warnings.length, 0);

    const database = new PenaupDatabase(path.join(targetData, 'penaup.db'));
    const user = database.raw.prepare('SELECT id FROM users WHERE email = ?').get('relations@example.com');
    assert.ok(user);
    const device = database.raw.prepare('SELECT * FROM devices WHERE device_id = ?').get('PENAUP-RELATIONS-1');
    assert.equal(device.user_id, user.id);
    assert.equal(device.model, 'pro');
    const template = database.raw.prepare('SELECT * FROM templates WHERE name = ?').get('关系模板');
    assert.deepEqual(JSON.parse(template.definition).layers[0], { type: 'text', x: 2, y: 3 });
    const stream = database.raw.prepare('SELECT * FROM streams WHERE name = ?').get('晚间片单');
    assert.equal(stream.user_id, user.id);
    assert.equal(device.play_stream_id, stream.id);
    const item = database.raw.prepare('SELECT * FROM stream_items WHERE stream_id = ?').get(stream.id);
    assert.equal(item.template_id, template.id);
    assert.deepEqual(database.getSetting('ai'), { provider: 'local', enabled: false });
    const push = database.raw.prepare('SELECT * FROM push_records WHERE user_id = ?').get(user.id);
    assert.equal(push.device_id, 'PENAUP-RELATIONS-1');
    assert.equal(push.stream_item_id, item.id);
    database.close();

    const sourceAfter = new Database(sourceDb, { readonly: true });
    const sourceCountsAfter = sourceAfter.prepare("SELECT name, (SELECT COUNT(*) FROM \"users\") AS users FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    sourceAfter.close();
    assert.deepEqual(sourceCountsAfter, sourceCountsBefore);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('FastAPI import refuses media paths outside the legacy source root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-migration-paths-'));
  const sourceData = path.join(root, 'legacy-data');
  const sourceDb = path.join(root, 'filmhub.db');
  const targetData = path.join(root, 'target-data');
  const outsideFile = path.join(root, 'outside.jpg');
  try {
    await fs.mkdir(path.join(sourceData, 'originals'), { recursive: true });
    await fs.writeFile(outsideFile, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await fs.symlink(outsideFile, path.join(sourceData, 'originals', 'escape.jpg'));
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
    legacy.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run(1, 'paths@example.com');
    legacy.prepare('INSERT INTO albums (id, user_id, name) VALUES (?, ?, ?)').run(2, 1, '路径安全');
    legacy.prepare(`INSERT INTO photos
      (id, user_id, album_id, filename, original_path, preview_path, film_path, width, height, layout, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(3, 1, 2, 'outside.jpg', '../outside.jpg', '', '', 2, 2, '{}', 0);
    legacy.prepare(`INSERT INTO photos
      (id, user_id, album_id, filename, original_path, preview_path, film_path, width, height, layout, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(4, 1, 2, 'escape.jpg', 'originals/escape.jpg', '', '', 2, 2, '{}', 1);
    legacy.close();

    const dryRun = await runMigration([
      '--source-db', sourceDb, '--source-data', sourceData,
      '--target-data', targetData, '--dry-run', '--json'
    ]);
    assert.equal(dryRun.code, 0, dryRun.stderr);
    const report = JSON.parse(dryRun.stdout);
    assert.equal(report.media_imported, 0);
    assert.equal(report.media.length, 2);
    assert.equal(report.media.every((entry) => entry.exists === false), true);
    assert.equal(report.warnings.filter((warning) => warning.includes('media file not found')).length, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
