import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import { buildApp } from '../src/app.js';
import { PenaupDatabase } from '../src/db.js';
import { mediaAbsolutePath, stripImageMetadata } from '../src/modules/media.js';

function filmFixture() {
  const file = Buffer.alloc(120032);
  file.writeUInt32LE(120000, 0);
  file.writeUInt16LE(600, 4);
  file.writeUInt16LE(400, 6);
  file[8] = 6;
  file.set([0x00, 0xff, 0xfc, 0xe0, 0x03, 0x1c], 16);
  return file;
}

test('settings are isolated by user after the legacy key-only migration', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-settings-'));
  const filename = path.join(root, 'legacy.db');
  const legacy = new Database(filename);
  legacy.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, user_id INTEGER, value TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT '')");
  legacy.prepare('INSERT INTO settings (key, user_id, value, updated_at) VALUES (?, ?, ?, ?)').run('ui', 7, '{"theme":"paper"}', new Date().toISOString());
  legacy.close();

  const database = new PenaupDatabase(filename);
  assert.deepEqual(database.getSetting('ui', 7), { theme: 'paper' });
  database.setSetting('ui', { theme: 'ink' }, 8);
  assert.deepEqual(database.getSetting('ui', 7), { theme: 'paper' });
  assert.deepEqual(database.getSetting('ui', 8), { theme: 'ink' });
  assert.ok(database.raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings_legacy_v1'").get());
  database.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('device film routes cannot read another owner media', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-device-media-'));
  const mediaDir = path.join(root, 'media');
  await fs.mkdir(mediaDir, { recursive: true });
  const database = new PenaupDatabase(path.join(root, 'penaup.db'));
  const alice = database.createUser('alice@example.com');
  const bob = database.createUser('bob@example.com');
  const heartbeat = database.heartbeat({ deviceId: 'alice-device', token: undefined, model: 'PENAUP_STD' });
  database.claimDevice('alice-device', alice.id);
  const globalPath = path.join(mediaDir, 'global.film');
  const alicePath = path.join(mediaDir, 'alice.film');
  const bobPath = path.join(mediaDir, 'bob.film');
  await fs.writeFile(globalPath, filmFixture());
  await fs.writeFile(alicePath, filmFixture());
  await fs.writeFile(bobPath, filmFixture());
  database.insertMedia({ userId: null, name: 'global.film', storedPath: 'media/global.film', mime: 'application/octet-stream', kind: 'film', size: 120032 });
  database.insertMedia({ userId: alice.id, name: 'alice.film', storedPath: 'media/alice.film', mime: 'application/octet-stream', kind: 'film', size: 120032 });
  database.insertMedia({ userId: bob.id, name: 'bob.film', storedPath: 'media/bob.film', mime: 'application/octet-stream', kind: 'film', size: 120032 });

  const app = await buildApp({ database, config: { dataDir: root, mediaDir, databasePath: path.join(root, 'penaup.db'), mqttUrl: '' }, logger: false });
  const latest = await app.inject({ method: 'GET', url: `/api/v1/device/film/latest.film?device_id=alice-device&token=${heartbeat.device.token}` });
  assert.equal(latest.statusCode, 200);
  assert.equal(latest.headers['content-disposition'], 'inline; filename="alice.film"');
  const bobFile = await app.inject({ method: 'GET', url: `/api/v1/device/film/bob.film?device_id=alice-device&token=${heartbeat.device.token}` });
  assert.equal(bobFile.statusCode, 404);
  await app.close();
  database.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('device media route rejects a symlink that escapes the media directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-symlink-media-'));
  const mediaDir = path.join(root, 'media');
  const outsideDir = path.join(root, 'outside');
  await fs.mkdir(mediaDir, { recursive: true });
  await fs.mkdir(outsideDir, { recursive: true });
  const outsideFile = path.join(outsideDir, 'secret.film');
  await fs.writeFile(outsideFile, filmFixture());
  await fs.symlink(outsideFile, path.join(mediaDir, 'escape.film'));

  assert.equal(mediaAbsolutePath({ dataDir: root, mediaDir }, 'media/escape.film'), null);

  const database = new PenaupDatabase(path.join(root, 'penaup.db'));
  const heartbeat = database.heartbeat({ deviceId: 'symlink-device', model: 'PENAUP_STD' });
  database.insertMedia({ name: 'escape.film', storedPath: 'media/escape.film', mime: 'application/octet-stream', kind: 'film', size: 120032 });
  const app = await buildApp({ database, config: { dataDir: root, mediaDir, databasePath: path.join(root, 'penaup.db'), mqttUrl: '' }, logger: false });
  const response = await app.inject({ method: 'GET', url: `/api/v1/device/film/latest.film?device_id=symlink-device&token=${heartbeat.device.token}` });
  assert.equal(response.statusCode, 404);
  await app.close();
  database.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('image metadata stripping removes EXIF APP1 without storing base metadata', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x01, 0x02, 0xff, 0xd9]);
  const stripped = stripImageMetadata(jpeg, 'image/jpeg');
  assert.deepEqual([...stripped], [0xff, 0xd8, 0xff, 0xd9]);
});

test('auth challenge limits are enforced independently per email and IP', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-auth-limits-'));
  const app = await buildApp({
    config: {
      dataDir: root,
      databasePath: path.join(root, 'penaup.db'),
      mediaDir: path.join(root, 'media'),
      adminToken: 'test-admin',
      authExposeDevCode: true,
      mqttUrl: ''
    },
    logger: false
  });
  try {
    const inviteFor = async (email) => {
      const response = await app.inject({ method: 'POST', url: '/api/v1/admin/invites', headers: { authorization: 'Bearer test-admin' }, payload: { email } });
      assert.equal(response.statusCode, 200);
      return response.json().data.token;
    };
    const challengeFor = (email, token, remoteAddress) => app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenges',
      remoteAddress,
      payload: { email, invite_token: token }
    });

    const email = 'rate-email@example.com';
    const emailInvite = await inviteFor(email);
    for (let index = 0; index < 5; index += 1) {
      assert.equal((await challengeFor(email, emailInvite, `198.51.100.${index + 1}`)).statusCode, 202);
    }
    assert.equal((await challengeFor(email, emailInvite, '198.51.100.20')).statusCode, 429);

    const sharedIp = '203.0.113.10';
    for (let index = 0; index < 5; index += 1) {
      const otherEmail = `rate-ip-${index}@example.com`;
      const otherInvite = await inviteFor(otherEmail);
      assert.equal((await challengeFor(otherEmail, otherInvite, sharedIp)).statusCode, 202);
    }
    const finalEmail = 'rate-ip-final@example.com';
    const finalInvite = await inviteFor(finalEmail);
    assert.equal((await challengeFor(finalEmail, finalInvite, sharedIp)).statusCode, 429);
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
