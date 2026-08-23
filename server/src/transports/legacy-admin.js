/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 *
 * Compatibility transport for the historical /api/v1/admin surface. New
 * clients should use the user-scoped routes in http.js; this adapter keeps
 * the recovered admin console useful during migration without reviving the
 * FastAPI process or its password database.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { getProfile } from '../../../packages/film-core/src/index.js';
import { serializeDevice } from '../db.js';
import { isImageMagic, isImageMime, mediaAbsolutePath, safeFilename, stripImageMetadata } from '../modules/media.js';
import { AI_PROVIDERS, sanitizeAiSettings } from '../modules/ai.js';

function body(request) { return request.body && typeof request.body === 'object' ? request.body : {}; }

function isoNow() { return new Date().toISOString(); }

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function adminAssetUrl(value) {
  const raw = String(value ?? '').trim().replaceAll(String.fromCharCode(92), '/');
  if (!raw || !/^[a-zA-Z0-9._/-]+$/.test(raw)) return '';
  const segments = raw.split('/').filter(Boolean);
  if (!segments.length || segments.includes('..')) return '';
  return '/assets/' + segments.join('/');
}

function adminTemplate(template) {
  if (!template) return null;
  return {
    id: template.id,
    name: template.name,
    kind: template.kind,
    is_builtin: Boolean(template.builtin),
    isBuiltin: Boolean(template.builtin),
    definition: template.definition,
    render_config: template.renderConfig,
    renderConfig: template.renderConfig,
    thumb_url: adminAssetUrl(template.thumbPath),
    created_at: template.createdAt,
    createdAt: template.createdAt
  };
}

function adminPhoto(config, photo) {
  if (!photo) return null;
  const fileUrl = `/api/v1/admin/photos/${photo.id}/file`;
  const safeStoredPath = photo.original_path && mediaAbsolutePath(config, photo.original_path)
    ? path.relative(config.dataDir, photo.original_path)
    : '';
  return {
    id: photo.id,
    album_id: photo.album_id,
    filename: photo.filename,
    width: photo.width,
    height: photo.height,
    sort: photo.sort,
    layout: photo.layout || '{}',
    created_at: photo.created_at,
    thumb_url: `${fileUrl}?variant=thumb`,
    original_url: `${fileUrl}?variant=original`,
    // New clients use a protected route; the path is intentionally not a
    // public static URL so an unguessable media file is never exposed.
    stored_path: safeStoredPath
  };
}

function adminAlbum(config, database, row, withPhotos = false) {
  if (!row) return null;
  const photos = database.listPhotos(row.id).map((photo) => adminPhoto(config, photo));
  const cover = photos.find((photo) => photo.id === row.cover_photo_id) || photos[0] || null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    cover_photo_id: row.cover_photo_id ?? null,
    photo_count: photos.length,
    created_at: row.created_at,
    cover_url: cover ? cover.thumb_url : '',
    photos: withPhotos ? photos : undefined,
    dither_type: row.dither_type || 'adaptive',
    dither_strength: row.dither_strength ?? 80
  };
}

function templateSvg(template, profileKey = 'PENAUP_STD') {
  const profile = getProfile(profileKey);
  const width = profile.screenWidth;
  const height = profile.screenHeight;
  const definition = template.definition && typeof template.definition === 'object' ? template.definition : {};
  const title = definition.title || definition.text || template.name || '花生片';
  const colors = ['#171816', '#fffefa', '#c95849', '#d4ad31', '#4d75b6', '#6f936e'];
  const barWidth = width / colors.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(template.name)}">
  <rect width="${width}" height="${height}" fill="#f5f5f0"/>
  <rect x="0" y="0" width="${width}" height="${Math.max(12, height * 0.018)}" fill="#171816"/>
  ${colors.map((color, index) => `<rect x="${Math.round(index * barWidth)}" y="${Math.round(height * 0.075)}" width="${Math.ceil(barWidth)}" height="${Math.max(10, height * 0.018)}" fill="${color}"/>`).join('')}
  <text x="${width * 0.08}" y="${height * 0.34}" fill="#171816" font-family="serif" font-size="${Math.max(28, Math.round(width * 0.075))}">${escapeXml(title)}</text>
  <text x="${width * 0.08}" y="${height * 0.46}" fill="#4d73ad" font-family="monospace" font-size="${Math.max(12, Math.round(width * 0.025))}">PENAUP / E-INK / ${escapeXml(profile.modelName)}</text>
  <text x="${width * 0.08}" y="${height * 0.86}" fill="#6d7068" font-family="monospace" font-size="${Math.max(11, Math.round(width * 0.022))}">${escapeXml(template.kind)} · 六色电子纸预览</text>
</svg>`;
}

function legacyStream(database, streamId) {
  const stream = database.legacyStream(streamId, true);
  if (!stream) return null;
  return { ...stream, items: stream.items || [] };
}

export function registerLegacyAdminRoutes(app, { config, database, auth, emit }) {
  const requireAdmin = auth.requireAdmin;

  app.get('/api/v1/admin/stats/dashboard', { preHandler: requireAdmin }, async () => ({
    ok: true,
    data: {
      devices: database.count('devices'),
      albums: database.count('albums'),
      templates: database.count('templates'),
      streams: database.count('streams')
    }
  }));

  app.get('/api/v1/admin/system/info', { preHandler: requireAdmin }, async () => ({
    ok: true,
    data: {
      version: '0.1.0',
      node: process.versions.node,
      platform: process.platform,
      data_dir: config.dataDir,
      server_time: isoNow()
    }
  }));

  app.get('/api/v1/admin/devices/:deviceId', { preHandler: requireAdmin }, async (request, reply) => {
    const row = database.getDeviceRecord(request.params.deviceId);
    if (!row) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    return { ok: true, data: serializeDevice(row) };
  });

  app.post('/api/v1/admin/devices/:deviceId/claim', { preHandler: requireAdmin }, async (request, reply) => {
    const row = database.getDeviceRecord(request.params.deviceId);
    if (!row) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    const input = body(request);
    database.raw.prepare('UPDATE devices SET name = ?, device_type = ?, claimed_at = ? WHERE id = ?').run(
      String(input.name || row.name || row.device_id).slice(0, 96),
      String(input.device_type || input.deviceType || row.device_type || 'unknown').slice(0, 64),
      isoNow(), row.id
    );
    const updated = database.getDeviceRecord(row.device_id);
    emit('device.claimed', row.device_id, { device: serializeDevice(updated) });
    return { ok: true, data: serializeDevice(updated) };
  });

  app.put('/api/v1/admin/devices/:deviceId', { preHandler: requireAdmin }, async (request, reply) => {
    const updated = database.updateDevice(request.params.deviceId, body(request));
    if (!updated) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    return { ok: true, data: updated };
  });

  app.delete('/api/v1/admin/devices/:deviceId', { preHandler: requireAdmin }, async (request, reply) => {
    if (!database.deleteDevice(request.params.deviceId)) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    return { ok: true, msg: '已删除' };
  });

  app.post('/api/v1/admin/devices/:deviceId/reset-token', { preHandler: requireAdmin }, async (request, reply) => {
    const updated = database.resetDeviceToken(request.params.deviceId);
    if (!updated) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    return { ok: true, data: updated };
  });

  app.post('/api/v1/admin/devices/:deviceId/set-config', { preHandler: requireAdmin }, async (request, reply) => {
    const command = database.queueDeviceConfig(request.params.deviceId, body(request));
    if (!command) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    emit('device.command', String(request.params.deviceId), { command, published: false });
    return { ok: true, msg: '配置已排队，等待设备下一次心跳', data: command };
  });

  app.post('/api/v1/admin/devices/:deviceId/sync-film', { preHandler: requireAdmin }, async (request, reply) => {
    const row = database.getDeviceRecord(request.params.deviceId);
    if (!row) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    const command = database.issueCommand(row.device_id, 'download_film', { filename: 'latest.film' });
    emit('device.command', row.device_id, { command, published: false });
    return { ok: true, msg: '已排队最新画面', data: command };
  });

  app.get('/api/v1/admin/devices/:deviceId/preview', { preHandler: requireAdmin }, async (request, reply) => {
    const row = database.getDeviceRecord(request.params.deviceId);
    if (!row) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    const profile = request.query?.device_type || row.device_type || 'PENAUP_STD';
    const preview = { name: row.name || row.device_id, kind: 'device', definition: { title: row.state || '花生片设备' } };
    return reply.type('image/svg+xml').header('Cache-Control', 'no-store').send(templateSvg(preview, profile));
  });

  app.get('/api/v1/admin/albums', { preHandler: requireAdmin }, async () => ({ ok: true, data: database.listAlbums(null).map((row) => adminAlbum(config, database, row)) }));

  app.post('/api/v1/admin/albums', { preHandler: requireAdmin }, async (request) => {
    const input = body(request);
    const album = database.createAlbum({ userId: null, name: input.name, description: input.description, ditherType: input.dither_type || input.ditherType, ditherStrength: input.dither_strength || input.ditherStrength });
    return { ok: true, data: adminAlbum(config, database, album) };
  });

  app.get('/api/v1/admin/albums/:albumId', { preHandler: requireAdmin }, async (request, reply) => {
    const album = database.getAlbum(request.params.albumId, null);
    if (!album) return reply.code(404).send({ ok: false, error: 'album_not_found' });
    return { ok: true, data: adminAlbum(config, database, album, true) };
  });

  app.put('/api/v1/admin/albums/:albumId', { preHandler: requireAdmin }, async (request, reply) => {
    const album = database.updateAlbum(request.params.albumId, body(request));
    if (!album) return reply.code(404).send({ ok: false, error: 'album_not_found' });
    return { ok: true, data: adminAlbum(config, database, album) };
  });

  app.delete('/api/v1/admin/albums/:albumId', { preHandler: requireAdmin }, async (request, reply) => {
    const removed = database.deleteAlbum(request.params.albumId);
    if (!removed) return reply.code(404).send({ ok: false, error: 'album_not_found' });
    for (const photo of removed.photos) {
      for (const candidate of [photo.original_path, photo.preview_path]) {
        const safePath = candidate && mediaAbsolutePath(config, candidate);
        if (safePath) await fs.promises.rm(safePath, { force: true });
      }
    }
    return { ok: true, msg: '已删除相册' };
  });

  app.post('/api/v1/admin/albums/:albumId/photos/batch', { preHandler: requireAdmin }, async (request, reply) => {
    const album = database.getAlbum(request.params.albumId, null);
    if (!album) return reply.code(404).send({ ok: false, error: 'album_not_found' });
    const results = [];
    for await (const part of request.files()) {
      if (!part.file || part.type !== 'file') continue;
      const originalName = safeFilename(part.filename || 'photo');
      if (!isImageMime(part.mimetype)) { part.file.resume(); continue; }
      const extension = path.extname(originalName).toLowerCase() || '.bin';
      const storedName = `photo-${crypto.randomUUID()}${extension}`;
      const storedPath = path.join(config.mediaDir, storedName);
      await pipeline(part.file, fs.createWriteStream(storedPath, { flags: 'wx' }));
      if (part.file.truncated) { await fs.promises.rm(storedPath, { force: true }); return reply.code(413).send({ ok: false, error: 'file_too_large' }); }
      const bytes = await fs.promises.readFile(storedPath);
      if (!isImageMagic(bytes, part.mimetype)) { await fs.promises.rm(storedPath, { force: true }); continue; }
      const stripped = stripImageMetadata(bytes, part.mimetype);
      if (!stripped.length) { await fs.promises.rm(storedPath, { force: true }); continue; }
      await fs.promises.writeFile(storedPath, stripped);
      const photo = database.insertPhoto({ albumId: album.id, filename: originalName, originalPath: path.relative(config.dataDir, storedPath), width: 0, height: 0 });
      results.push(adminPhoto(config, photo));
    }
    if (!results.length) return reply.code(400).send({ ok: false, error: 'no_supported_images' });
    emit('album.photos.created', null, { albumId: album.id, count: results.length });
    return { ok: true, data: results };
  });

  app.get('/api/v1/admin/photos/:photoId/file', { preHandler: requireAdmin }, async (request, reply) => {
    const photo = database.getPhoto(request.params.photoId);
    if (!photo) return reply.code(404).send({ ok: false, error: 'photo_not_found' });
    const absolute = mediaAbsolutePath(config, photo.original_path);
    if (!absolute || !fs.existsSync(absolute)) return reply.code(404).send({ ok: false, error: 'photo_file_not_found' });
    const ext = path.extname(photo.filename || '').toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return reply.type(mime).header('Cache-Control', 'private, no-store').send(fs.createReadStream(absolute));
  });

  app.delete('/api/v1/admin/photos/:photoId', { preHandler: requireAdmin }, async (request, reply) => {
    const photo = database.deletePhoto(request.params.photoId);
    if (!photo) return reply.code(404).send({ ok: false, error: 'photo_not_found' });
    for (const candidate of [photo.original_path, photo.preview_path]) {
      const safePath = candidate && mediaAbsolutePath(config, candidate);
      if (safePath) await fs.promises.rm(safePath, { force: true });
    }
    return { ok: true, msg: '已删除照片' };
  });

  app.put('/api/v1/admin/albums/:albumId/photos/sort', { preHandler: requireAdmin }, async (request, reply) => {
    if (!database.getAlbum(request.params.albumId, null)) return reply.code(404).send({ ok: false, error: 'album_not_found' });
    database.sortPhotos(request.params.albumId, body(request).photo_ids || body(request).photoIds || []);
    return { ok: true, msg: '排序已更新' };
  });

  app.put('/api/v1/admin/albums/:albumId/photos/:photoId/layout', { preHandler: requireAdmin }, async (request, reply) => {
    const photo = database.updatePhotoLayout(request.params.albumId, request.params.photoId, body(request));
    if (!photo) return reply.code(404).send({ ok: false, error: 'photo_not_found' });
    return { ok: true, msg: '布局已保存', layout: photo.layout };
  });

  app.get('/api/v1/admin/templates', { preHandler: requireAdmin }, async () => ({ ok: true, data: database.listTemplates(null).map(adminTemplate) }));

  app.post('/api/v1/admin/templates', { preHandler: requireAdmin }, async (request) => {
    const input = body(request);
    const template = database.createTemplate({ userId: null, name: input.name, kind: input.kind, definition: input.definition, renderConfig: input.render_config || input.renderConfig, thumbPath: input.thumb_path || input.thumbPath });
    return { ok: true, data: adminTemplate(template) };
  });

  app.get('/api/v1/admin/templates/:templateId', { preHandler: requireAdmin }, async (request, reply) => {
    const template = database.getTemplate(request.params.templateId, null);
    if (!template) return reply.code(404).send({ ok: false, error: 'template_not_found' });
    return { ok: true, data: adminTemplate(template) };
  });

  app.put('/api/v1/admin/templates/:templateId', { preHandler: requireAdmin }, async (request, reply) => {
    const template = database.updateTemplate(request.params.templateId, body(request));
    if (!template) return reply.code(404).send({ ok: false, error: 'template_not_found_or_builtin' });
    return { ok: true, data: adminTemplate(template) };
  });

  app.delete('/api/v1/admin/templates/:templateId', { preHandler: requireAdmin }, async (request, reply) => {
    if (!database.deleteTemplate(request.params.templateId)) return reply.code(404).send({ ok: false, error: 'template_not_found_or_builtin' });
    return { ok: true, msg: '已删除模板' };
  });

  async function renderTemplate(request, reply) {
    const template = database.getTemplate(request.params.templateId, null);
    if (!template) return reply.code(404).send({ ok: false, error: 'template_not_found' });
    const profile = request.query?.device_type || request.query?.profile || 'PENAUP_STD';
    return reply.type('image/svg+xml').header('Cache-Control', 'no-store').send(templateSvg(template, profile));
  }
  app.get('/api/v1/admin/templates/:templateId/preview', { preHandler: requireAdmin }, renderTemplate);
  app.post('/api/v1/admin/templates/:templateId/preview', { preHandler: requireAdmin }, renderTemplate);

  app.get('/api/v1/admin/streams', { preHandler: requireAdmin }, async () => ({ ok: true, data: database.listStreams(null).map((stream) => legacyStream(database, stream.id)) }));

  app.post('/api/v1/admin/streams', { preHandler: requireAdmin }, async (request) => {
    const input = body(request);
    const stream = database.createStream({ userId: null, name: input.name, mode: input.mode, enabled: input.enabled !== false });
    return { ok: true, data: legacyStream(database, stream.id) };
  });

  app.get('/api/v1/admin/streams/:streamId', { preHandler: requireAdmin }, async (request, reply) => {
    const stream = legacyStream(database, request.params.streamId);
    if (!stream) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
    return { ok: true, data: stream };
  });

  app.put('/api/v1/admin/streams/:streamId', { preHandler: requireAdmin }, async (request, reply) => {
    const current = database.legacyStream(request.params.streamId);
    if (!current) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
    const input = body(request);
    database.raw.prepare('UPDATE streams SET name = ?, mode = ?, enabled = ? WHERE id = ?').run(
      String(input.name ?? current.name).slice(0, 128), input.mode === 'server_push' ? 'server_push' : 'device_pull', input.enabled === false ? 0 : 1, Number(request.params.streamId)
    );
    return { ok: true, data: legacyStream(database, request.params.streamId) };
  });

  app.delete('/api/v1/admin/streams/:streamId', { preHandler: requireAdmin }, async (request, reply) => {
    const stream = database.legacyStream(request.params.streamId);
    if (!stream) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
    database.raw.prepare('UPDATE devices SET play_stream_id = NULL WHERE play_stream_id = ?').run(Number(request.params.streamId));
    database.raw.prepare('DELETE FROM stream_items WHERE stream_id = ?').run(Number(request.params.streamId));
    database.raw.prepare('DELETE FROM streams WHERE id = ?').run(Number(request.params.streamId));
    return { ok: true, msg: '已删除轮播流' };
  });

  app.post('/api/v1/admin/streams/:streamId/items', { preHandler: requireAdmin }, async (request, reply) => {
    const item = database.createStreamItem(request.params.streamId, body(request));
    if (!item) return reply.code(404).send({ ok: false, error: 'stream_or_template_not_found' });
    return { ok: true, data: item };
  });

  app.put('/api/v1/admin/streams/:streamId/items/:itemId', { preHandler: requireAdmin }, async (request, reply) => {
    const item = database.updateStreamItem(request.params.streamId, request.params.itemId, body(request));
    if (!item) return reply.code(404).send({ ok: false, error: 'stream_item_not_found' });
    return { ok: true, data: item };
  });

  app.delete('/api/v1/admin/streams/:streamId/items/:itemId', { preHandler: requireAdmin }, async (request, reply) => {
    if (!database.deleteStreamItem(request.params.streamId, request.params.itemId)) return reply.code(404).send({ ok: false, error: 'stream_item_not_found' });
    return { ok: true, msg: '已移除轮播项' };
  });

  app.post('/api/v1/admin/streams/:streamId/items/sort', { preHandler: requireAdmin }, async (request, reply) => {
    if (!database.legacyStream(request.params.streamId)) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
    database.sortStreamItems(request.params.streamId, body(request).item_ids || body(request).itemIds || []);
    return { ok: true, msg: '排序已更新' };
  });

  app.post('/api/v1/admin/streams/:streamId/devices', { preHandler: requireAdmin }, async (request, reply) => {
    if (!database.legacyStream(request.params.streamId)) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
    const deviceIds = database.bindStreamDevices(request.params.streamId, body(request).device_ids || body(request).deviceIds || []);
    return { ok: true, data: { device_ids: deviceIds } };
  });

  app.get('/api/v1/admin/streams/:streamId/timeline', { preHandler: requireAdmin }, async (request, reply) => {
    const stream = legacyStream(database, request.params.streamId);
    if (!stream) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
    let cursor = 0;
    const timeline = stream.items.filter((item) => item.enabled).map((item) => {
      const start = cursor;
      cursor += Math.max(1, Number(item.duration_sec) || 30);
      return { ...item, start_sec: start, end_sec: cursor };
    });
    return { ok: true, data: timeline };
  });

  app.get('/api/v1/admin/settings/ui', { preHandler: requireAdmin }, async () => ({ ok: true, data: database.getSetting('ui', null) || {} }));
  app.put('/api/v1/admin/settings/ui', { preHandler: requireAdmin }, async (request) => ({ ok: true, data: database.setSetting('ui', body(request), null) }));
  app.get('/api/v1/admin/settings/ai', { preHandler: requireAdmin }, async () => ({ ok: true, data: database.getSetting('ai', null) || { provider: 'none', model: '', configured: false } }));
  app.put('/api/v1/admin/settings/ai', { preHandler: requireAdmin }, async (request) => ({ ok: true, data: database.setSetting('ai', sanitizeAiSettings(body(request)), null) }));
  app.post('/api/v1/admin/settings/ai/test', { preHandler: requireAdmin }, async () => ({ ok: true, data: { ok: false, provider: 'none', detail: '当前只启用本地模板，尚未配置远程 AI provider' } }));

  const retiredPasswordAuth = async (_request, reply) => reply.code(410).send({ ok: false, error: 'password_auth_retired_use_admin_token', message: '旧密码登录已停用，请使用 PENAUP_ADMIN_TOKEN。' });
  app.put('/api/v1/admin/auth/password', { preHandler: requireAdmin }, retiredPasswordAuth);
  app.post('/api/v1/admin/auth/password', { preHandler: requireAdmin }, retiredPasswordAuth);

  app.post('/api/v1/admin/ai/template', { preHandler: requireAdmin }, async (request) => {
    const prompt = String(body(request).prompt || '').trim().slice(0, 500);
    const template = database.createTemplate({
      userId: null,
      name: prompt ? `花生片 · ${prompt.slice(0, 24)}` : '花生片 · 本地灵感',
      kind: 'custom',
      definition: { title: prompt || '今天也要留下这一刻', prompt, layers: [] },
      renderConfig: { dither_type: 'adaptive', dither_strength: 80 }
    });
    return { ok: true, data: adminTemplate(template) };
  });

  app.post('/api/v1/admin/ai/image', { preHandler: requireAdmin }, async (_request, reply) => reply.code(503).send({ ok: false, error: 'ai_provider_not_configured', message: '请先配置受信任的 AI provider；本地运行时不会伪造图片结果。' }));
  app.get('/api/v1/admin/ai/providers', { preHandler: requireAdmin }, async () => ({ ok: true, data: AI_PROVIDERS }));
}
