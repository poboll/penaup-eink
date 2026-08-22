import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildApp } from '../src/app.js';
import { EventHub } from '../src/events.js';

function filmFixture(width = 600, height = 400) {
  const payloadSize = (width * height) / 2;
  const file = Buffer.alloc(32 + payloadSize);
  file.writeUInt32LE(payloadSize, 0);
  file.writeUInt16LE(width, 4);
  file.writeUInt16LE(height, 6);
  file[8] = 6;
  file.set([0x00, 0xFF, 0xFC, 0xE0, 0x03, 0x1C], 16);
  return file;
}

function tinyJpeg() { return Buffer.from([0xff, 0xd8, 0xff, 0xd9]); }

async function signIn(app, email) {
  const invite = await app.inject({ method: 'POST', url: '/api/v1/admin/invites', headers: { authorization: 'Bearer test-admin' }, payload: { email } });
  assert.equal(invite.statusCode, 200);
  const challenge = await app.inject({ method: 'POST', url: '/api/v1/auth/challenges', payload: { email, invite_token: invite.json().data.token } });
  assert.equal(challenge.statusCode, 202);
  const challengeData = challenge.json().data;
  const verified = await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { challenge_id: challengeData.challenge_id, code: challengeData.dev_code } });
  assert.equal(verified.statusCode, 200);
  return verified.json().data.access_token;
}

test('health exposes Penaup runtime capabilities', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-runtime-'));
  const app = await buildApp({
    config: { dataDir: root, databasePath: path.join(root, 'test.db'), mediaDir: path.join(root, 'media'), mqttUrl: '' },
    logger: false
  });
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().ok, true);
  assert.equal(response.json().displayName, '花生片 Penaup');
  assert.equal(response.json().mqtt_connected, false);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('readyz verifies the database and media storage are writable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-ready-'));
  const app = await buildApp({
    config: { dataDir: root, databasePath: path.join(root, 'test.db'), mediaDir: path.join(root, 'media'), mqttUrl: '' },
    logger: false
  });
  const response = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, database: true, storage: true });
  assert.equal(response.headers['cache-control'], 'no-store');
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('SSE keeps a live connection and forwards EventHub updates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-sse-'));
  const events = new EventHub();
  const app = await buildApp({
    events,
    config: { dataDir: root, databasePath: path.join(root, 'test.db'), mediaDir: path.join(root, 'media'), mqttUrl: '' },
    logger: false
  });
  const controller = new AbortController();
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const port = app.server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/events/stream`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const initial = await reader.read();
    assert.match(decoder.decode(initial.value), /penaup connected/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    events.emit('transfer.updated', { deviceId: 'sse-device', transfer_id: 'sse-1' });
    const update = await reader.read();
    assert.match(decoder.decode(update.value), /transfer\.updated/);
    await reader.cancel();
  } finally {
    controller.abort();
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('admin console is served under the runtime namespace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-runtime-'));
  const app = await buildApp({
    config: {
      dataDir: root,
      databasePath: path.join(root, 'test.db'),
      mediaDir: path.join(root, 'media'),
      adminWebRoot: path.resolve('admin/dist'),
      mqttUrl: ''
    },
    logger: false
  });
  const response = await app.inject({ method: 'GET', url: '/admin/runtime.html' });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.body, /Penaup Runtime/);
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('product story and studio are served as separate web surfaces', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-runtime-'));
  const app = await buildApp({ config: { dataDir: root, databasePath: path.join(root, 'test.db'), mediaDir: path.join(root, 'media'), mqttUrl: '' }, logger: false });
  const story = await app.inject({ method: 'GET', url: '/' });
  assert.equal(story.statusCode, 200);
  assert.match(story.body, /把喜欢的画面/);
  const studio = await app.inject({ method: 'GET', url: '/studio/' });
  assert.equal(studio.statusCode, 200);
  assert.match(studio.body, /显影工具/);
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('device heartbeat provisions a token and consumes commands once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-runtime-'));
  const app = await buildApp({
    config: { dataDir: root, databasePath: path.join(root, 'test.db'), mediaDir: path.join(root, 'media'), mqttUrl: '' },
    logger: false
  });

  const first = await app.inject({ method: 'GET', url: '/api/v1/device/heartbeat?device_id=test-device&battery=87&state=idle' });
  assert.equal(first.statusCode, 200);
  const firstData = first.json().data;
  assert.equal(typeof firstData.token, 'string');
  assert.equal(firstData.commands.length, 0);

  const device = await app.inject({ method: 'GET', url: '/api/v1/admin/devices' });
  assert.equal(device.statusCode, 200);
  assert.equal(device.json().data[0].batteryPercent, 87);

  const statusWithoutToken = await app.inject({ method: 'GET', url: '/api/v1/device/status?device_id=test-device' });
  assert.equal(statusWithoutToken.statusCode, 401);
  const statusWithToken = await app.inject({ method: 'GET', url: `/api/v1/device/status?device_id=test-device&token=${firstData.token}` });
  assert.equal(statusWithToken.statusCode, 200);

  const command = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/devices/test-device/commands',
    payload: { cmd: 'set_config', params: { play_mode: 1 } }
  });
  assert.equal(command.statusCode, 200);
  const tooLongCommand = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/devices/test-device/commands',
    payload: { cmd: 'x'.repeat(129) }
  });
  assert.equal(tooLongCommand.statusCode, 400);
  assert.equal(tooLongCommand.json().error, 'command_too_long');

  const second = await app.inject({
    method: 'GET',
    url: `/api/v1/device/heartbeat?device_id=test-device&token=${firstData.token}`
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().data.commands[0].cmd, 'set_config');

  const third = await app.inject({
    method: 'GET',
    url: `/api/v1/device/heartbeat?device_id=test-device&token=${firstData.token}`
  });
  assert.equal(third.statusCode, 200);
  assert.equal(third.json().data.commands.length, 0);

  const missingToken = await app.inject({
    method: 'GET',
    url: '/api/v1/device/heartbeat?device_id=test-device'
  });
  assert.equal(missingToken.statusCode, 401);

  const wrongToken = await app.inject({
    method: 'GET',
    url: '/api/v1/device/heartbeat?device_id=test-device&token=wrong-token'
  });
  assert.equal(wrongToken.statusCode, 401);

  const events = await app.inject({ method: 'GET', url: '/api/v1/admin/events?limit=20' });
  assert.equal(events.statusCode, 200);
  assert.doesNotMatch(JSON.stringify(events.json()), new RegExp(firstData.token)); // token is never persisted in events

  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('accepts the exact STD, Pro and Max film profiles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-runtime-'));
  const app = await buildApp({
    config: { dataDir: root, databasePath: path.join(root, 'test.db'), mediaDir: path.join(root, 'media'), mqttUrl: '' },
    logger: false
  });
  const profiles = [[600, 400, 120032], [792, 528, 209120], [1200, 1600, 960032]];

  for (const [width, height, size] of profiles) {
    const form = new FormData();
    form.append('film', new Blob([filmFixture(width, height)], { type: 'application/octet-stream' }), `${width}x${height}.film`);
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/media', payload: form });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.size, size);
  }

  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('admin media upload is downloadable through the firmware latest.film alias', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-runtime-'));
  const app = await buildApp({
    config: { dataDir: root, databasePath: path.join(root, 'test.db'), mediaDir: path.join(root, 'media'), mqttUrl: '' },
    logger: false
  });

  const heartbeat = await app.inject({ method: 'GET', url: '/api/v1/device/heartbeat?device_id=download-device&battery=91' });
  const token = heartbeat.json().data.token;
  assert.equal(typeof token, 'string');

  const form = new FormData();
  form.append('film', new Blob([filmFixture()], { type: 'application/octet-stream' }), 'memory-shot.film');
  const uploaded = await app.inject({ method: 'POST', url: '/api/v1/admin/media', payload: form });
  assert.equal(uploaded.statusCode, 200);
  assert.equal(uploaded.json().data.name, 'memory-shot.film');

  const latest = await app.inject({
    method: 'GET',
    url: `/api/v1/device/film/latest.film?device_id=download-device&token=${token}`
  });
  assert.equal(latest.statusCode, 200);
  assert.equal(latest.headers['content-type'], 'application/octet-stream');
  assert.equal(latest.headers['content-disposition'], 'inline; filename="memory-shot.film"');
  assert.equal(latest.body.length, 120032);

  const invalid = new FormData();
  invalid.append('film', new Blob([Buffer.from('not-film')], { type: 'text/plain' }), 'notes.txt');
  const rejected = await app.inject({ method: 'POST', url: '/api/v1/admin/media', payload: invalid });
  assert.equal(rejected.statusCode, 415);

  const malformed = new FormData();
  malformed.append('film', new Blob([Buffer.from('not-a-film')], { type: 'application/octet-stream' }), 'broken.film');
  const malformedResponse = await app.inject({ method: 'POST', url: '/api/v1/admin/media', payload: malformed });
  assert.equal(malformedResponse.statusCode, 422);

  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('configured admin token protects management routes without affecting device heartbeat', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-runtime-'));
  const app = await buildApp({
    config: {
      dataDir: root,
      databasePath: path.join(root, 'test.db'),
      mediaDir: path.join(root, 'media'),
      adminToken: 'local-admin-token',
      mqttUrl: ''
    },
    logger: false
  });

  const denied = await app.inject({ method: 'GET', url: '/api/v1/admin/devices' });
  assert.equal(denied.statusCode, 401);
  const allowed = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/devices',
    headers: { authorization: 'Bearer local-admin-token' }
  });
  assert.equal(allowed.statusCode, 200);
  const heartbeat = await app.inject({ method: 'GET', url: '/api/v1/device/heartbeat?device_id=protected-device' });
  assert.equal(heartbeat.statusCode, 200);

  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('network listeners fail closed for management routes without an admin token', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-runtime-'));
  const app = await buildApp({
    logger: false,
    config: {
      host: '0.0.0.0',
      dataDir: root,
      databasePath: path.join(root, 'test.db'),
      mediaDir: path.join(root, 'media'),
      adminToken: ''
    }
  });
  const response = await app.inject({ method: 'GET', url: '/api/v1/admin/devices' });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, 'admin_token_required_for_network_listener');
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('production loopback runtime still requires an admin token behind a reverse proxy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-production-admin-'));
  const app = await buildApp({
    logger: false,
    config: {
      nodeEnv: 'production',
      host: '127.0.0.1',
      dataDir: root,
      databasePath: path.join(root, 'test.db'),
      mediaDir: path.join(root, 'media'),
      adminToken: ''
    }
  });
  const response = await app.inject({ method: 'GET', url: '/api/v1/admin/devices' });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, 'admin_token_required_for_network_listener');
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('invite-only email challenge issues bearer sessions and scopes resources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-runtime-'));
  const app = await buildApp({
    config: {
      dataDir: root,
      databasePath: path.join(root, 'test.db'),
      mediaDir: path.join(root, 'media'),
      adminToken: 'test-admin',
      authExposeDevCode: true,
      mqttUrl: ''
    },
    logger: false
  });

  const invite = await app.inject({ method: 'POST', url: '/api/v1/admin/invites', headers: { authorization: 'Bearer test-admin' }, payload: { email: 'owner@example.com' } });
  assert.equal(invite.statusCode, 200);
  const inviteToken = invite.json().data.token;
  const challenge = await app.inject({ method: 'POST', url: '/api/v1/auth/challenges', payload: { email: 'owner@example.com', invite_token: inviteToken } });
  assert.equal(challenge.statusCode, 202);
  const challengeData = challenge.json().data;
  assert.match(challengeData.dev_code, /^\d{6}$/);
  const verified = await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { challenge_id: challengeData.challenge_id, code: challengeData.dev_code } });
  assert.equal(verified.statusCode, 200);
  const reused = await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { challenge_id: challengeData.challenge_id, code: challengeData.dev_code } });
  assert.equal(reused.statusCode, 400);
  const accessToken = verified.json().data.access_token;
  assert.equal(verified.json().data.user.email, 'owner@example.com');

  const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(me.statusCode, 200);
  const heartbeat = await app.inject({ method: 'GET', url: '/api/v1/device/heartbeat?device_id=owner-device&model=PENAUP_PRO' });
  assert.equal(heartbeat.statusCode, 200);
  const devices = await app.inject({ method: 'GET', url: '/api/v1/devices', headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(devices.statusCode, 200);
  assert.equal(devices.json().data.length, 1);
  const claimed = await app.inject({ method: 'POST', url: '/api/v1/devices/owner-device/claim', headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(claimed.statusCode, 200);
  const album = await app.inject({ method: 'POST', url: '/api/v1/albums', headers: { authorization: `Bearer ${accessToken}` }, payload: { name: '今天留下' } });
  assert.equal(album.statusCode, 200);
  const transfer = await app.inject({ method: 'POST', url: '/api/v1/transfers', headers: { authorization: `Bearer ${accessToken}` }, payload: { device_id: 'owner-device' } });
  assert.equal(transfer.statusCode, 202);
  const transferId = transfer.json().data.transfer_id;
  const refreshing = await app.inject({ method: 'POST', url: `/api/v1/transfers/${transferId}/events`, headers: { authorization: `Bearer ${accessToken}` }, payload: { phase: 'refreshing', progress_hint: 1, completed_bytes: 10, total_bytes: 10 } });
  assert.equal(refreshing.statusCode, 200);
  const forgedSuccess = await app.inject({ method: 'POST', url: `/api/v1/transfers/${transferId}/events`, headers: { authorization: `Bearer ${accessToken}` }, payload: { phase: 'succeeded' } });
  assert.equal(forgedSuccess.statusCode, 409);
  assert.equal(forgedSuccess.json().error, 'device_confirmation_required');
  const updated = await app.inject({ method: 'POST', url: `/api/v1/transfers/${transferId}/events`, headers: { authorization: `Bearer ${accessToken}` }, payload: { phase: 'device_state_uncertain', detail: '设备刷新结果待确认' } });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().data.phase, 'device_state_uncertain');
  const rewritten = await app.inject({ method: 'POST', url: `/api/v1/transfers/${transferId}/events`, headers: { authorization: `Bearer ${accessToken}` }, payload: { phase: 'preparing', detail: '不应回到开始' } });
  assert.equal(rewritten.statusCode, 409);
  assert.equal(rewritten.json().error, 'transfer_terminal');
  const uncertainRetry = await app.inject({ method: 'POST', url: `/api/v1/transfers/${transferId}/retry`, headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(uncertainRetry.statusCode, 409);
  assert.equal(uncertainRetry.json().error, 'device_confirmation_required');

  const failedTransfer = await app.inject({ method: 'POST', url: '/api/v1/transfers', headers: { authorization: `Bearer ${accessToken}` }, payload: { device_id: 'owner-device' } });
  const failedTransferId = failedTransfer.json().data.transfer_id;
  const failed = await app.inject({ method: 'POST', url: `/api/v1/transfers/${failedTransferId}/events`, headers: { authorization: `Bearer ${accessToken}` }, payload: { phase: 'failed', detail: '连接中断' } });
  assert.equal(failed.statusCode, 200);
  const retried = await app.inject({ method: 'POST', url: `/api/v1/transfers/${failedTransferId}/retry`, headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(retried.statusCode, 202);
  assert.equal(retried.json().data.phase, 'preparing');
  assert.equal(retried.json().data.retry_of, failedTransferId);

  const cookieWriteWithoutCsrf = await app.inject({
    method: 'POST',
    url: '/api/v1/albums',
    headers: { authorization: 'Basic not-a-bearer', cookie: `penaup_session=${accessToken}; penaup_csrf=csrf-value` },
    payload: { name: '不应绕过 CSRF' }
  });
  assert.equal(cookieWriteWithoutCsrf.statusCode, 403);
  const cookieWriteWithCsrf = await app.inject({
    method: 'POST',
    url: '/api/v1/albums',
    headers: { cookie: `penaup_session=${accessToken}; penaup_csrf=csrf-value`, 'x-csrf-token': 'csrf-value' },
    payload: { name: 'Cookie 写入' }
  });
  assert.equal(cookieWriteWithCsrf.statusCode, 200);
  const refreshWithoutCsrf = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: `penaup_refresh=not-used; penaup_csrf=csrf-value` } });
  assert.equal(refreshWithoutCsrf.statusCode, 403);

  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('user resources, stream controls and AI adapter remain owner-scoped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-user-api-'));
  const calls = [];
  const app = await buildApp({
    config: {
      dataDir: root,
      databasePath: path.join(root, 'test.db'),
      mediaDir: path.join(root, 'media'),
      adminToken: 'test-admin',
      authExposeDevCode: true,
      aiBaseUrl: 'https://ai.example.test/v1',
      aiApiKey: 'test-secret',
      mqttUrl: ''
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, authorization: options.headers.Authorization, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ choices: [{ message: { content: '一张安静的花生片相纸' } }], usage: { total_tokens: 7 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    logger: false
  });

  try {
    const alice = await signIn(app, 'alice-api@example.com');
    const bob = await signIn(app, 'bob-api@example.com');
    const aliceHeaders = { authorization: `Bearer ${alice}` };
    const bobHeaders = { authorization: `Bearer ${bob}` };

    const aliceHeartbeat = await app.inject({ method: 'GET', url: '/api/v1/device/heartbeat?device_id=alice-api-device&model=PENAUP_STD' });
    assert.equal(aliceHeartbeat.statusCode, 200);
    const bobHeartbeat = await app.inject({ method: 'GET', url: '/api/v1/device/heartbeat?device_id=bob-api-device&model=PENAUP_PRO' });
    assert.equal(bobHeartbeat.statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/devices/alice-api-device/claim', headers: aliceHeaders })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/devices/bob-api-device/claim', headers: bobHeaders })).statusCode, 200);

    const invalidCommandParams = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/alice-api-device/commands',
      headers: aliceHeaders,
      payload: { cmd: 'set_config', params: ['not-an-object'] }
    });
    assert.equal(invalidCommandParams.statusCode, 400);
    assert.equal(invalidCommandParams.json().error, 'command_params_invalid');

    const albumResponse = await app.inject({ method: 'POST', url: '/api/v1/albums', headers: aliceHeaders, payload: { name: '只给 Alice 的一叠相纸' } });
    assert.equal(albumResponse.statusCode, 200);
    const albumId = albumResponse.json().data.id;
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/albums/${albumId}`, headers: bobHeaders })).statusCode, 404);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/albums/${albumId}`, headers: bobHeaders, payload: { name: '越权修改' } })).statusCode, 404);

    const photoForm = new FormData();
    photoForm.append('file', new Blob([tinyJpeg()], { type: 'image/jpeg' }), 'memory.jpg');
    const photo = await app.inject({ method: 'POST', url: `/api/v1/albums/${albumId}/photos`, headers: aliceHeaders, payload: photoForm });
    assert.equal(photo.statusCode, 201);
    const photoId = photo.json().data.id;
    const photos = await app.inject({ method: 'GET', url: `/api/v1/albums/${albumId}/photos`, headers: aliceHeaders });
    assert.equal(photos.statusCode, 200);
    assert.equal(photos.json().data.length, 1);
    const photoFile = await app.inject({ method: 'GET', url: `/api/v1/albums/${albumId}/photos/${photoId}/file`, headers: aliceHeaders });
    assert.equal(photoFile.statusCode, 200);
    assert.equal(photoFile.headers['content-type'], 'image/jpeg');
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/albums/${albumId}/photos/${photoId}/file`, headers: bobHeaders })).statusCode, 404);
    const mediaBeforeDelete = await app.inject({ method: 'GET', url: '/api/v1/media', headers: aliceHeaders });
    assert.equal(mediaBeforeDelete.statusCode, 200);
    assert.equal(mediaBeforeDelete.json().data.length, 1);
    const storedPhotoPath = path.join(root, mediaBeforeDelete.json().data[0].storedPath);
    const deletedPhoto = await app.inject({ method: 'DELETE', url: `/api/v1/albums/${albumId}/photos/${photoId}`, headers: aliceHeaders });
    assert.equal(deletedPhoto.statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/albums/${albumId}/photos`, headers: aliceHeaders })).json().data.length, 0);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/media', headers: aliceHeaders })).json().data.length, 0);
    await assert.rejects(fs.access(storedPhotoPath));

    const trailingAlbumForm = new FormData();
    trailingAlbumForm.append('file', new Blob([tinyJpeg()], { type: 'image/jpeg' }), '../trailing-photo.jpg');
    trailingAlbumForm.append('album_id', String(albumId));
    const trailingAlbumUpload = await app.inject({ method: 'POST', url: '/api/v1/media', headers: aliceHeaders, payload: trailingAlbumForm });
    assert.equal(trailingAlbumUpload.statusCode, 200);
    assert.equal(trailingAlbumUpload.json().data.albumId, albumId);
    const trailingMediaPath = path.join(root, trailingAlbumUpload.json().data.storedPath);

    const templateResponse = await app.inject({ method: 'POST', url: '/api/v1/templates', headers: aliceHeaders, payload: { name: '清晨', definition: { title: '今天也留下' } } });
    assert.equal(templateResponse.statusCode, 200);
    const templateId = templateResponse.json().data.id;
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/templates/${templateId}`, headers: bobHeaders })).statusCode, 404);
    const updatedTemplate = await app.inject({ method: 'PATCH', url: `/api/v1/templates/${templateId}`, headers: aliceHeaders, payload: { kind: 'memo' } });
    assert.equal(updatedTemplate.statusCode, 200);
    assert.equal(updatedTemplate.json().data.kind, 'memo');
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/templates/${templateId}`, headers: bobHeaders })).statusCode, 404);

    const streamResponse = await app.inject({ method: 'POST', url: '/api/v1/streams', headers: aliceHeaders, payload: { name: '书桌轮播', mode: 'server_push' } });
    assert.equal(streamResponse.statusCode, 200);
    const streamId = streamResponse.json().data.id;
    const item = await app.inject({ method: 'POST', url: `/api/v1/streams/${streamId}/items`, headers: aliceHeaders, payload: { template_id: templateId, duration_sec: 45 } });
    assert.equal(item.statusCode, 200);
    assert.equal(item.json().data.templateId, templateId);
    const bound = await app.inject({ method: 'POST', url: `/api/v1/streams/${streamId}/devices`, headers: aliceHeaders, payload: { device_ids: ['alice-api-device', 'bob-api-device'] } });
    assert.equal(bound.statusCode, 200);
    assert.deepEqual(bound.json().data.deviceIds, ['alice-api-device']);
    const timeline = await app.inject({ method: 'GET', url: `/api/v1/streams/${streamId}/timeline`, headers: aliceHeaders });
    assert.equal(timeline.statusCode, 200);
    assert.equal(timeline.json().data[0].end_sec, 45);

    const aiSettings = await app.inject({ method: 'PUT', url: '/api/v1/ai/settings', headers: aliceHeaders, payload: { provider: 'compatible', model: 'penaup-test' } });
    assert.equal(aiSettings.statusCode, 200);
    assert.equal(aiSettings.json().data.configured, true);
    const generated = await app.inject({ method: 'POST', url: '/api/v1/ai/generate', headers: aliceHeaders, payload: { prompt: '为一张相纸写一句克制的标题' } });
    assert.equal(generated.statusCode, 200);
    assert.equal(generated.json().data.content, '一张安静的花生片相纸');
    assert.equal(calls[0].authorization, 'Bearer test-secret');
    assert.equal(calls[0].body.messages[0].role, 'system');
    assert.match(calls[0].body.messages[0].content, /六种基础电子纸颜料/);
    assert.match(calls[0].body.messages[0].content, /48 种/);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/ai/settings', headers: bobHeaders })).json().data.provider, 'none');
    const deletedAlbum = await app.inject({ method: 'DELETE', url: `/api/v1/albums/${albumId}`, headers: aliceHeaders });
    assert.equal(deletedAlbum.statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/media', headers: aliceHeaders })).json().data.length, 0);
    await assert.rejects(fs.access(trailingMediaPath));
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('stream scheduler queues a film command and records push history', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-scheduler-'));
  const app = await buildApp({
    config: {
      dataDir: root,
      databasePath: path.join(root, 'test.db'),
      mediaDir: path.join(root, 'media'),
      adminToken: 'test-admin',
      authExposeDevCode: true,
      schedulerIntervalMs: 0,
      mqttUrl: ''
    },
    logger: false
  });
  try {
    const token = await signIn(app, 'scheduler@example.com');
    const headers = { authorization: `Bearer ${token}` };
    const heartbeat = await app.inject({ method: 'GET', url: '/api/v1/device/heartbeat?device_id=scheduler-device&model=PENAUP_STD' });
    const deviceToken = heartbeat.json().data.token;
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/devices/scheduler-device/claim', headers })).statusCode, 200);

    const film = new FormData();
    film.append('file', new Blob([filmFixture()], { type: 'application/octet-stream' }), 'morning.film');
    const uploaded = await app.inject({ method: 'POST', url: '/api/v1/media', headers, payload: film });
    assert.equal(uploaded.statusCode, 200);
    const mediaId = uploaded.json().data.id;
    const template = await app.inject({ method: 'POST', url: '/api/v1/templates', headers, payload: { name: '轮播相纸', definition: { film_media_id: mediaId } } });
    const templateId = template.json().data.id;
    const stream = await app.inject({ method: 'POST', url: '/api/v1/streams', headers, payload: { name: '自动显影', mode: 'server_push' } });
    const streamId = stream.json().data.id;
    const item = await app.inject({ method: 'POST', url: `/api/v1/streams/${streamId}/items`, headers, payload: { template_id: templateId, duration_sec: 30 } });
    assert.equal(item.statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/streams/${streamId}/devices`, headers, payload: { device_ids: ['scheduler-device'] } })).statusCode, 200);

    const push = await app.inject({ method: 'POST', url: `/api/v1/streams/${streamId}/push`, headers, payload: {} });
    assert.equal(push.statusCode, 202);
    assert.equal(push.json().data.results[0].ok, true);
    assert.equal(push.json().data.results[0].published, false);
    const history = await app.inject({ method: 'GET', url: '/api/v1/pushes', headers });
    assert.equal(history.statusCode, 200);
    assert.equal(history.json().data[0].method, 'scheduled');
    const nextHeartbeat = await app.inject({ method: 'GET', url: `/api/v1/device/heartbeat?device_id=scheduler-device&token=${deviceToken}` });
    assert.equal(nextHeartbeat.statusCode, 200);
    assert.equal(nextHeartbeat.json().data.commands[0].cmd, 'download_film');
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('relative stream scheduler advances one item at a time and loops', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-relative-scheduler-'));
  const app = await buildApp({
    config: {
      dataDir: root,
      databasePath: path.join(root, 'test.db'),
      mediaDir: path.join(root, 'media'),
      schedulerIntervalMs: 0,
      mqttUrl: ''
    },
    logger: false
  });
  try {
    const database = app.penaupRuntime.database;
    const user = database.createUser('relative-scheduler@example.com');
    const device = database.heartbeat({ deviceId: 'relative-scheduler-device', model: 'PENAUP_STD' });
    database.claimDevice(device.device.deviceId, user.id);
    const media = database.insertMedia({ userId: user.id, name: 'loop.film', storedPath: 'media/loop.film', mime: 'application/octet-stream', kind: 'film', size: 120032 });
    const firstTemplate = database.createTemplate({ userId: user.id, name: '第一张', definition: { film_media_id: media.id } });
    const secondTemplate = database.createTemplate({ userId: user.id, name: '第二张', definition: { film_media_id: media.id } });
    const stream = database.createStream({ userId: user.id, name: '两张相纸', mode: 'server_push' });
    const firstItem = database.createStreamItem(stream.id, { template_id: firstTemplate.id, duration_sec: 30 }, user.id);
    const secondItem = database.createStreamItem(stream.id, { template_id: secondTemplate.id, duration_sec: 30, position: 1 }, user.id);
    database.bindStreamDevices(stream.id, [device.device.deviceId], user.id);

    const firstTick = await app.penaupRuntime.scheduler.tick();
    assert.equal(firstTick.results.length, 1);
    assert.equal(firstTick.results[0].record.stream_item_id, firstItem.id);
    const immediateTick = await app.penaupRuntime.scheduler.tick(new Date(Date.now() + 1000).toISOString());
    assert.equal(immediateTick.results.length, 0);
    const secondTick = await app.penaupRuntime.scheduler.tick(new Date(Date.now() + 31000).toISOString());
    assert.equal(secondTick.results.length, 1);
    assert.equal(secondTick.results[0].record.stream_item_id, secondItem.id);
    const loopTick = await app.penaupRuntime.scheduler.tick(new Date(Date.now() + 62000).toISOString());
    assert.equal(loopTick.results.length, 1);
    assert.equal(loopTick.results[0].record.stream_item_id, firstItem.id);
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
