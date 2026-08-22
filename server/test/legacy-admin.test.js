import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildApp } from '../src/app.js';

function adminHeaders() {
  return { authorization: 'Bearer legacy-admin' };
}

function tinyJpeg() {
  // The compatibility transport validates the container magic before the
  // optional image pipeline is introduced; this is enough for a route test.
  return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
}

test('legacy admin routes keep device, album, template and stream workflows usable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-legacy-admin-'));
  const app = await buildApp({
    config: {
      host: '127.0.0.1',
      dataDir: root,
      databasePath: path.join(root, 'penaup.db'),
      mediaDir: path.join(root, 'media'),
      adminToken: 'legacy-admin',
      mqttUrl: ''
    },
    logger: false
  });

  try {
    const heartbeat = await app.inject({ method: 'GET', url: '/api/v1/device/heartbeat?device_id=legacy-device&model=PENAUP_STD' });
    assert.equal(heartbeat.statusCode, 200);

    const update = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/devices/legacy-device',
      headers: adminHeaders(),
      payload: {
        play_mode: 2,
        sleep_time: 90,
        current_file_id: 7,
        heartbeat_interval: 31,
        play_stream_id: 0
      }
    });
    assert.equal(update.statusCode, 200);
    assert.equal(update.json().data.play_mode, 2);
    assert.equal(update.json().data.sleep_time, 90);
    assert.equal(update.json().data.current_file_id, 7);
    assert.equal(update.json().data.heartbeat_interval, 31);
    assert.equal(update.json().data.play_stream_id, null);
    assert.equal(update.json().data.is_claimed, false);

    const claimed = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/devices/legacy-device/claim',
      headers: adminHeaders(),
      payload: { name: '书桌上的花生片', device_type: 'pro' }
    });
    assert.equal(claimed.statusCode, 200);
    assert.equal(claimed.json().data.is_claimed, true);

    const album = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/albums',
      headers: adminHeaders(),
      payload: { name: '八月片单', description: '留给电子纸的两帧' }
    });
    assert.equal(album.statusCode, 200);
    const albumId = album.json().data.id;

    const upload = new FormData();
    upload.append('files', new Blob([tinyJpeg()], { type: 'image/jpeg' }), 'first.jpg');
    upload.append('files', new Blob([tinyJpeg()], { type: 'image/jpeg' }), 'second.jpg');
    const photos = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/albums/${albumId}/photos/batch`,
      headers: adminHeaders(),
      payload: upload
    });
    assert.equal(photos.statusCode, 200);
    assert.equal(photos.json().data.length, 2);

    const albumWithPhotos = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/albums/${albumId}`,
      headers: adminHeaders()
    });
    assert.equal(albumWithPhotos.statusCode, 200);
    assert.equal(albumWithPhotos.json().data.photos.length, 2);
    const photoUrl = albumWithPhotos.json().data.photos[0].original_url;
    const photo = await app.inject({ method: 'GET', url: photoUrl, headers: adminHeaders() });
    assert.equal(photo.statusCode, 200);
    assert.equal(photo.headers['content-type'], 'image/jpeg');

    const template = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/templates',
      headers: adminHeaders(),
      payload: { name: '清晨一帧', kind: 'custom', definition: { title: '今天也要留下这一刻' } }
    });
    assert.equal(template.statusCode, 200);
    const templateId = template.json().data.id;
    const preview = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/templates/${templateId}/preview?device_type=pro`,
      headers: adminHeaders()
    });
    assert.equal(preview.statusCode, 200);
    assert.match(preview.headers['content-type'], /image\/svg\+xml/);

    const stream = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/streams',
      headers: adminHeaders(),
      payload: { name: '晨间轮播', mode: 'device_pull' }
    });
    assert.equal(stream.statusCode, 200);
    const streamId = stream.json().data.id;
    const item = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/streams/${streamId}/items`,
      headers: adminHeaders(),
      payload: { template_id: templateId, duration_sec: 60 }
    });
    assert.equal(item.statusCode, 200);
    assert.equal(item.json().data.template_id, templateId);

    const retiredPassword = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/auth/password',
      headers: adminHeaders(),
      payload: { old_password: 'x', new_password: 'y' }
    });
    assert.equal(retiredPassword.statusCode, 410);
    assert.equal(retiredPassword.json().error, 'password_auth_retired_use_admin_token');

    const ai = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai/image',
      headers: adminHeaders(),
      payload: { prompt: '一只猫' }
    });
    assert.equal(ai.statusCode, 503);
    assert.equal(ai.json().error, 'ai_provider_not_configured');
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
