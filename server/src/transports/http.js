/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateFilmBuffer, getProfile } from '../../../packages/film-core/src/index.js';
import { ownedDevice } from '../modules/devices.js';
import { safeFilename, isImageMime, mediaAbsolutePath } from '../modules/media.js';
import { albumPayload } from '../modules/albums.js';
import { templatePayload } from '../modules/templates.js';
import { streamPayload } from '../modules/streams.js';
import { sanitizeAiSettings } from '../modules/ai.js';
import { nextTransferEvent, normalizeTransfer, TRANSFER_PHASES } from '../modules/transfer.js';
import { storeUploadedMedia } from '../modules/upload.js';

function requestBody(request) { return request.body && typeof request.body === 'object' ? request.body : {}; }
function userId(request) { return request.penaupUser && request.penaupUser.id; }
function resourceId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function bodyTooLarge(input, limit = 96 * 1024) {
  try { return Buffer.byteLength(JSON.stringify(input || {}), 'utf8') > limit; } catch { return true; }
}
function multipartField(fields, names) {
  for (const name of names) {
    const field = fields?.[name];
    if (field === undefined) continue;
    return field && typeof field === 'object' && 'value' in field ? field.value : field;
  }
  return '';
}
async function removeStoredFiles(config, paths) {
  for (const candidate of new Set(paths.filter(Boolean))) {
    const safePath = mediaAbsolutePath(config, candidate);
    if (safePath) await fs.promises.rm(safePath, { force: true });
  }
}
function publicPhoto(photo, albumId) {
  return {
    id: photo.id, albumId: Number(albumId), filename: photo.filename, width: photo.width, height: photo.height,
    layout: typeof photo.layout === 'string' ? (() => { try { return JSON.parse(photo.layout || '{}'); } catch { return {}; } })() : (photo.layout || {}),
    sort: photo.sort, createdAt: photo.created_at || photo.createdAt,
    originalUrl: `/api/v1/albums/${Number(albumId)}/photos/${photo.id}/file`
  };
}
function publicAlbum(database, album, includePhotos = false) {
  if (!album) return null;
  const value = {
    id: album.id, name: album.name, description: album.description || '',
    coverPhotoId: album.cover_photo_id == null ? null : album.cover_photo_id,
    ditherType: album.ditherType || album.dither_type || 'adaptive',
    ditherStrength: album.ditherStrength ?? album.dither_strength ?? 80,
    createdAt: album.createdAt || album.created_at
  };
  if (includePhotos) value.photos = database.listPhotos(album.id).map((photo) => publicPhoto(photo, album.id));
  return value;
}
function publicStream(database, stream, includeItems = false) {
  if (!stream) return null;
  const value = { id: stream.id, name: stream.name, mode: stream.mode, enabled: Boolean(stream.enabled), createdAt: stream.createdAt || stream.created_at };
  if (includeItems) value.items = database.listStreamItems(stream.id).map((item) => ({
    id: item.id, streamId: item.stream_id, templateId: item.template_id, position: item.position,
    scheduleType: item.schedule_type, durationSec: item.duration_sec, startAt: item.start_at, enabled: Boolean(item.enabled)
  }));
  return value;
}

export function registerHttpRoutes(app, { config, database, events, mqtt, auth, ai, queue, scheduler, emit }) {
  const requireUser = auth.requireUser;
  const requireUserOrAdmin = auth.requireUserOrAdmin;
  const requireAdmin = auth.requireAdmin;

  async function publishQueued(deviceId, command, label = 'device-command') {
    if (!queue) return mqtt.publishCommand(deviceId, command);
    return queue.add(() => mqtt.publishCommand(deviceId, command), label);
  }

  app.get('/api/v1/devices', { preHandler: requireUser }, async (request) => ({ ok: true, data: database.listDevices(userId(request), true) }));

  app.post('/api/v1/devices/:id/claim', { preHandler: requireUser }, async (request, reply) => {
    const device = database.claimDevice(request.params.id, userId(request));
    if (!device) return reply.code(409).send({ ok: false, error: 'device_claimed_or_not_found' });
    emit('device.claimed', request.params.id, { device });
    return { ok: true, data: device };
  });

  app.post('/api/v1/devices/:id/commands', { preHandler: requireUser }, async (request, reply) => {
    const device = ownedDevice(database, request.params.id, userId(request));
    if (!device) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    const input = requestBody(request); const command = typeof input.cmd === 'string' ? input.cmd : input.command;
    if (!command) return reply.code(400).send({ ok: false, error: 'command_required' });
    if (command.length > 128) return reply.code(400).send({ ok: false, error: 'command_too_long' });
    const issued = database.issueCommand(request.params.id, command, input.params || {});
    let published;
    try { published = await publishQueued(request.params.id, issued); }
    catch (error) { return reply.code(503).send({ ok: false, error: error?.message === 'task_queue_full' ? 'task_queue_full' : 'device_command_unavailable' }); }
    emit('device.command', request.params.id, { command: issued, published, userId: userId(request) });
    return { ok: true, data: { ...issued, published } };
  });

  app.post('/api/v1/devices/:id/sync', { preHandler: requireUser }, async (request, reply) => {
    const device = ownedDevice(database, request.params.id, userId(request));
    if (!device) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    const latestFilm = database.latestFilm(userId(request));
    if (!latestFilm) return reply.code(404).send({ ok: false, error: 'latest_film_not_found' });
    const command = database.issueCommand(device.deviceId, 'download_film', { filename: latestFilm.name, media_id: latestFilm.id });
    let published;
    try { published = await publishQueued(device.deviceId, command, 'device-sync'); }
    catch (error) { return reply.code(503).send({ ok: false, error: error?.message === 'task_queue_full' ? 'task_queue_full' : 'device_command_unavailable' }); }
    emit('device.sync', device.deviceId, { device, latestFilm, command, published, userId: userId(request) });
    return { ok: true, data: { device, latestFilm, command, published } };
  });

  app.get('/api/v1/media', { preHandler: requireUser }, async (request) => ({ ok: true, data: database.listMedia(userId(request)) }));

  app.post('/api/v1/media', { preHandler: requireUser }, async (request, reply) => {
    const part = await request.file();
    if (!part) return reply.code(400).send({ ok: false, error: 'file_required' });
    const albumId = resourceId(multipartField(part.fields, ['album_id', 'albumId']));
    if (albumId && !database.getAlbum(albumId, userId(request))) {
      part.file.resume();
      return reply.code(404).send({ ok: false, error: 'album_not_found' });
    }
    const result = await storeUploadedMedia({ part, config, database, userId: userId(request), albumId });
    if (!result.ok) return reply.code(result.status).send({ ok: false, error: result.error });
    const trailingAlbumId = resourceId(multipartField(part.fields, ['album_id', 'albumId']));
    if (trailingAlbumId && !database.getAlbum(trailingAlbumId, userId(request))) {
      await removeStoredFiles(config, [result.storedPath]);
      database.deleteMedia(result.media.id, userId(request));
      return reply.code(404).send({ ok: false, error: 'album_not_found' });
    }
    const media = trailingAlbumId && trailingAlbumId !== albumId
      ? database.setMediaAlbum(result.media.id, trailingAlbumId, userId(request))
      : result.media;
    emit('media.created', null, { media, userId: userId(request) });
    return { ok: true, data: media };
  });

  app.get('/api/v1/media/:id/download', { preHandler: requireUser }, async (request, reply) => {
    const media = database.getMedia(Number(request.params.id), userId(request));
    if (!media) return reply.code(404).send({ ok: false, error: 'media_not_found' });
    const absolute = mediaAbsolutePath(config, media.storedPath);
    if (!absolute || !fs.existsSync(absolute)) return reply.code(404).send({ ok: false, error: 'media_file_not_found' });
    return reply.type(media.mime).header('Content-Disposition', `inline; filename="${safeFilename(media.name)}"`).send(fs.createReadStream(absolute));
  });

  app.post('/api/v1/albums', { preHandler: requireUser }, async (request, reply) => {
    const input = requestBody(request);
    if (bodyTooLarge(input)) return reply.code(413).send({ ok: false, error: 'request_too_large' });
    return { ok: true, data: publicAlbum(database, database.createAlbum({ userId: userId(request), ...albumPayload(input) })) };
  });
  app.get('/api/v1/albums', { preHandler: requireUser }, async (request) => ({ ok: true, data: database.listAlbums(userId(request)).map((album) => publicAlbum(database, album)) }));
  app.get('/api/v1/albums/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = resourceId(request.params.id);
    const album = id && database.getAlbum(id, userId(request));
    if (!album) return reply.code(404).send({ ok: false, error: 'album_not_found' });
    return { ok: true, data: publicAlbum(database, album, true) };
  });
  for (const method of ['put', 'patch']) {
    app[method]('/api/v1/albums/:id', { preHandler: requireUser }, async (request, reply) => {
      const id = resourceId(request.params.id);
      const input = requestBody(request);
      if (!id) return reply.code(404).send({ ok: false, error: 'album_not_found' });
      if (bodyTooLarge(input)) return reply.code(413).send({ ok: false, error: 'request_too_large' });
      const album = database.updateAlbum(id, input, userId(request));
      if (!album) return reply.code(404).send({ ok: false, error: 'album_not_found' });
      return { ok: true, data: publicAlbum(database, album) };
    });
  }
  app.delete('/api/v1/albums/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = resourceId(request.params.id);
    const removed = id && database.deleteAlbum(id, userId(request));
    if (!removed) return reply.code(404).send({ ok: false, error: 'album_not_found' });
    await removeStoredFiles(config, [
      ...removed.photos.flatMap((photo) => [photo.original_path, photo.film_path, photo.preview_path]),
      ...removed.media.map((media) => media.stored_path)
    ]);
    return { ok: true, data: { id } };
  });
  app.get('/api/v1/albums/:id/photos', { preHandler: requireUser }, async (request, reply) => {
    const id = resourceId(request.params.id);
    if (!id || !database.getAlbum(id, userId(request))) return reply.code(404).send({ ok: false, error: 'album_not_found' });
    return { ok: true, data: database.listPhotosForUser(id, userId(request)).map((photo) => publicPhoto(photo, id)) };
  });
  app.post('/api/v1/albums/:id/photos', { preHandler: requireUser }, async (request, reply) => {
    const albumId = resourceId(request.params.id);
    if (!albumId || !database.getAlbum(albumId, userId(request))) return reply.code(404).send({ ok: false, error: 'album_not_found' });
    const part = await request.file();
    if (!part) return reply.code(400).send({ ok: false, error: 'file_required' });
    if (!isImageMime(part.mimetype)) { part.file.resume(); return reply.code(415).send({ ok: false, error: 'image_required' }); }
    const result = await storeUploadedMedia({ part, config, database, userId: userId(request), albumId });
    if (!result.ok) return reply.code(result.status).send({ ok: false, error: result.error });
    const photo = database.insertPhoto({ userId: userId(request), albumId, filename: safeFilename(part.filename, 'photo.jpg'), originalPath: result.storedPath });
    emit('album.photo.created', null, { albumId, photoId: photo.id, mediaId: result.media.id, userId: userId(request) });
    return reply.code(201).send({ ok: true, data: publicPhoto(photo, albumId) });
  });
  app.get('/api/v1/albums/:id/photos/:photoId/file', { preHandler: requireUser }, async (request, reply) => {
    const albumId = resourceId(request.params.id);
    const photoId = resourceId(request.params.photoId);
    const photo = albumId && photoId && database.getPhotoForUser(photoId, albumId, userId(request));
    if (!photo) return reply.code(404).send({ ok: false, error: 'photo_not_found' });
    const absolute = mediaAbsolutePath(config, photo.original_path);
    if (!absolute || !fs.existsSync(absolute)) return reply.code(404).send({ ok: false, error: 'photo_file_not_found' });
    const mime = String(path.extname(photo.filename || '').toLowerCase()) === '.png' ? 'image/png' : String(path.extname(photo.filename || '').toLowerCase()) === '.webp' ? 'image/webp' : 'image/jpeg';
    return reply.type(mime).header('Cache-Control', 'private, no-store').send(fs.createReadStream(absolute));
  });
  app.delete('/api/v1/albums/:id/photos/:photoId', { preHandler: requireUser }, async (request, reply) => {
    const albumId = resourceId(request.params.id);
    const photoId = resourceId(request.params.photoId);
    if (!albumId || !photoId || !database.getAlbum(albumId, userId(request))) return reply.code(404).send({ ok: false, error: 'photo_not_found' });
    const removed = database.deletePhoto(photoId, userId(request));
    if (!removed || Number(removed.photo.album_id) !== albumId) return reply.code(404).send({ ok: false, error: 'photo_not_found' });
    await removeStoredFiles(config, [
      removed.photo.original_path, removed.photo.film_path, removed.photo.preview_path,
      ...removed.media.map((media) => media.stored_path)
    ]);
    return { ok: true, data: { id: photoId } };
  });
  app.post('/api/v1/albums/:id/photos/sort', { preHandler: requireUser }, async (request, reply) => {
    const albumId = resourceId(request.params.id);
    const input = requestBody(request);
    if (!albumId || !database.getAlbum(albumId, userId(request))) return reply.code(404).send({ ok: false, error: 'album_not_found' });
    if (!Array.isArray(input.photo_ids || input.photoIds) || (input.photo_ids || input.photoIds).length > 500) return reply.code(400).send({ ok: false, error: 'photo_ids_required' });
    database.sortPhotos(albumId, input.photo_ids || input.photoIds);
    return { ok: true, data: database.listPhotosForUser(albumId, userId(request)).map((photo) => publicPhoto(photo, albumId)) };
  });
  for (const method of ['put', 'patch']) {
    app[method]('/api/v1/albums/:id/photos/:photoId/layout', { preHandler: requireUser }, async (request, reply) => {
      const albumId = resourceId(request.params.id);
      const photoId = resourceId(request.params.photoId);
      const input = requestBody(request);
      if (!albumId || !photoId || !database.getAlbum(albumId, userId(request))) return reply.code(404).send({ ok: false, error: 'photo_not_found' });
      if (bodyTooLarge(input)) return reply.code(413).send({ ok: false, error: 'request_too_large' });
      const photo = database.updatePhotoLayout(albumId, photoId, input);
      if (!photo || Number(photo.user_id) !== Number(userId(request))) return reply.code(404).send({ ok: false, error: 'photo_not_found' });
      return { ok: true, data: publicPhoto(photo, albumId) };
    });
  }

  app.post('/api/v1/templates', { preHandler: requireUser }, async (request, reply) => {
    const input = requestBody(request);
    if (bodyTooLarge(input)) return reply.code(413).send({ ok: false, error: 'request_too_large' });
    return { ok: true, data: database.createTemplate({ userId: userId(request), ...templatePayload(input) }) };
  });
  app.get('/api/v1/templates', { preHandler: requireUser }, async (request) => ({ ok: true, data: database.listTemplates(userId(request)) }));
  app.get('/api/v1/templates/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = resourceId(request.params.id);
    const template = id && database.getTemplate(id, userId(request));
    if (!template) return reply.code(404).send({ ok: false, error: 'template_not_found' });
    return { ok: true, data: template };
  });
  for (const method of ['put', 'patch']) {
    app[method]('/api/v1/templates/:id', { preHandler: requireUser }, async (request, reply) => {
      const id = resourceId(request.params.id);
      const input = requestBody(request);
      if (!id) return reply.code(404).send({ ok: false, error: 'template_not_found' });
      if (bodyTooLarge(input)) return reply.code(413).send({ ok: false, error: 'request_too_large' });
      const template = database.updateTemplate(id, input, userId(request));
      if (!template) return reply.code(404).send({ ok: false, error: 'template_not_found_or_builtin' });
      return { ok: true, data: template };
    });
  }
  app.delete('/api/v1/templates/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = resourceId(request.params.id);
    if (!id || !database.deleteTemplate(id, userId(request))) return reply.code(404).send({ ok: false, error: 'template_not_found_or_builtin' });
    return { ok: true, data: { id } };
  });
  app.get('/api/v1/templates/:id/preview', { preHandler: requireUser }, async (request, reply) => {
    const template = database.getTemplate(resourceId(request.params.id), userId(request));
    if (!template) return reply.code(404).send({ ok: false, error: 'template_not_found' });
    return { ok: true, data: { template, rendering: 'client_film_core', profile: getProfile(request.query?.profile || 'PENAUP_STD') } };
  });

  app.post('/api/v1/streams', { preHandler: requireUser }, async (request, reply) => {
    const input = requestBody(request);
    if (bodyTooLarge(input)) return reply.code(413).send({ ok: false, error: 'request_too_large' });
    return { ok: true, data: publicStream(database, database.createStream({ userId: userId(request), ...streamPayload(input) })) };
  });
  app.get('/api/v1/streams', { preHandler: requireUser }, async (request) => ({ ok: true, data: database.listStreams(userId(request)).map((stream) => publicStream(database, stream)) }));
  app.get('/api/v1/streams/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = resourceId(request.params.id);
    const stream = id && database.getStream(id, userId(request));
    if (!stream) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
    return { ok: true, data: publicStream(database, stream, true) };
  });
  for (const method of ['put', 'patch']) {
    app[method]('/api/v1/streams/:id', { preHandler: requireUser }, async (request, reply) => {
      const id = resourceId(request.params.id);
      const input = requestBody(request);
      if (!id) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
      if (bodyTooLarge(input)) return reply.code(413).send({ ok: false, error: 'request_too_large' });
      const stream = database.updateStream(id, input, userId(request));
      if (!stream) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
      return { ok: true, data: publicStream(database, stream, true) };
    });
  }
  app.delete('/api/v1/streams/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = resourceId(request.params.id);
    const removed = id && database.deleteStream(id, userId(request));
    if (!removed) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
    return { ok: true, data: removed };
  });
  app.post('/api/v1/streams/:id/items', { preHandler: requireUser }, async (request, reply) => {
    const id = resourceId(request.params.id);
    const input = requestBody(request);
    if (!id || !database.getStream(id, userId(request))) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
    if (bodyTooLarge(input)) return reply.code(413).send({ ok: false, error: 'request_too_large' });
    const item = database.createStreamItem(id, input, userId(request));
    if (!item) return reply.code(404).send({ ok: false, error: 'stream_or_template_not_found' });
    return { ok: true, data: publicStream(database, database.getStream(id, userId(request)), true).items.find((value) => value.id === item.id) };
  });
  for (const method of ['put', 'patch']) {
    app[method]('/api/v1/streams/:id/items/:itemId', { preHandler: requireUser }, async (request, reply) => {
      const streamId = resourceId(request.params.id);
      const itemId = resourceId(request.params.itemId);
      const input = requestBody(request);
      if (!streamId || !itemId || !database.getStream(streamId, userId(request))) return reply.code(404).send({ ok: false, error: 'stream_item_not_found' });
      if (bodyTooLarge(input)) return reply.code(413).send({ ok: false, error: 'request_too_large' });
      const item = database.updateStreamItem(streamId, itemId, input, userId(request));
      if (!item) return reply.code(404).send({ ok: false, error: 'stream_item_not_found' });
      return { ok: true, data: publicStream(database, database.getStream(streamId, userId(request)), true).items.find((value) => value.id === item.id) };
    });
  }
  app.delete('/api/v1/streams/:id/items/:itemId', { preHandler: requireUser }, async (request, reply) => {
    const streamId = resourceId(request.params.id);
    const itemId = resourceId(request.params.itemId);
    if (!streamId || !itemId || !database.deleteStreamItem(streamId, itemId, userId(request))) return reply.code(404).send({ ok: false, error: 'stream_item_not_found' });
    return { ok: true, data: { id: itemId } };
  });
  app.post('/api/v1/streams/:id/items/sort', { preHandler: requireUser }, async (request, reply) => {
    const streamId = resourceId(request.params.id);
    const input = requestBody(request);
    const itemIds = input.item_ids || input.itemIds;
    if (!streamId || !database.getStream(streamId, userId(request))) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
    if (!Array.isArray(itemIds) || itemIds.length > 500) return reply.code(400).send({ ok: false, error: 'item_ids_required' });
    database.sortStreamItems(streamId, itemIds, userId(request));
    return { ok: true, data: publicStream(database, database.getStream(streamId, userId(request)), true).items };
  });
  app.post('/api/v1/streams/:id/devices', { preHandler: requireUser }, async (request, reply) => {
    const streamId = resourceId(request.params.id);
    const input = requestBody(request);
    const deviceIds = input.device_ids || input.deviceIds;
    if (!streamId || !database.getStream(streamId, userId(request))) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
    if (!Array.isArray(deviceIds) || deviceIds.length > 100) return reply.code(400).send({ ok: false, error: 'device_ids_required' });
    return { ok: true, data: { deviceIds: database.bindStreamDevices(streamId, deviceIds, userId(request)) } };
  });
  app.post('/api/v1/streams/:id/push', { preHandler: requireUser }, async (request, reply) => {
    const streamId = resourceId(request.params.id);
    const input = requestBody(request);
    const itemId = input.item_id ?? input.itemId ?? null;
    if (!streamId || !database.getStream(streamId, userId(request))) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
    if (itemId != null && !resourceId(itemId)) return reply.code(400).send({ ok: false, error: 'stream_item_invalid' });
    try {
      const result = await queue.add(() => scheduler.dispatchStream(streamId, userId(request), itemId == null ? null : resourceId(itemId)), 'manual-stream-push');
      return reply.code(202).send({ ok: true, data: result });
    } catch (error) {
      return reply.code(503).send({ ok: false, error: error?.message === 'task_queue_full' ? 'task_queue_full' : 'stream_push_unavailable' });
    }
  });
  app.get('/api/v1/streams/:id/timeline', { preHandler: requireUser }, async (request, reply) => {
    const streamId = resourceId(request.params.id);
    const stream = streamId && database.getStream(streamId, userId(request));
    if (!stream) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
    let cursor = 0;
    const timeline = database.listStreamItems(streamId).filter((item) => item.enabled).map((item) => {
      const start = cursor;
      cursor += Math.max(1, Number(item.duration_sec) || 30);
      return { ...item, start_sec: start, end_sec: cursor };
    });
    return { ok: true, data: timeline };
  });
  app.get('/api/v1/pushes', { preHandler: requireUser }, async (request) => ({ ok: true, data: database.listPushRecords(userId(request), { deviceId: request.query?.device_id || request.query?.deviceId, streamId: request.query?.stream_id || request.query?.streamId, limit: request.query?.limit }) }));
  app.get('/api/v1/streams/:id/pushes', { preHandler: requireUser }, async (request, reply) => {
    const streamId = resourceId(request.params.id);
    if (!streamId || !database.getStream(streamId, userId(request))) return reply.code(404).send({ ok: false, error: 'stream_not_found' });
    return { ok: true, data: database.listPushRecords(userId(request), { streamId, limit: request.query?.limit }) };
  });

  app.post('/api/v1/transfers', { preHandler: requireUser }, async (request, reply) => {
    const input = requestBody(request); const deviceId = String(input.device_id || input.deviceId || '');
    const device = database.getDevice(deviceId); if (!device || device.ownerId !== userId(request)) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    const mediaId = Number(input.media_id || input.mediaId || 0) || null;
    const media = mediaId ? database.getMedia(mediaId, userId(request)) : null;
    if (mediaId && !media) return reply.code(404).send({ ok: false, error: 'media_not_found' });
    const transferId = crypto.randomUUID();
    const transfer = database.createTransfer({ transferId, userId: userId(request), deviceId, mediaId, phase: 'preparing', totalBytes: media?.size || 0, cardTitle: input.card_title || '花生片正在显影', renderingDetail: input.rendering_detail || '相纸已经落入画布' });
    emit('transfer.updated', deviceId, { transfer: normalizeTransfer(transfer), userId: userId(request) });
    return reply.code(202).send({ ok: true, data: transfer });
  });

  app.get('/api/v1/transfers', { preHandler: requireUser }, async (request) => ({ ok: true, data: database.listTransfers(userId(request), request.query?.limit) }));

  app.get('/api/v1/transfers/:id', { preHandler: requireUser }, async (request, reply) => {
    const transfer = database.getTransfer(request.params.id, userId(request));
    if (!transfer) return reply.code(404).send({ ok: false, error: 'transfer_not_found' });
    return { ok: true, data: transfer };
  });

  app.post('/api/v1/transfers/:id/retry', { preHandler: requireUser }, async (request, reply) => {
    const current = database.getTransfer(request.params.id, userId(request));
    if (!current) return reply.code(404).send({ ok: false, error: 'transfer_not_found' });
    if (current.phase === 'device_state_uncertain') return reply.code(409).send({ ok: false, error: 'device_confirmation_required' });
    if (current.phase !== 'failed') return reply.code(409).send({ ok: false, error: 'transfer_not_retryable' });
    const device = database.getDevice(current.device_id);
    if (!device || device.ownerId !== userId(request)) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    const transferId = crypto.randomUUID();
    const retry = database.createTransfer({
      transferId,
      userId: userId(request),
      deviceId: current.device_id,
      mediaId: current.media_id,
      phase: 'preparing',
      totalBytes: current.total_bytes,
      cardTitle: current.card_title,
      renderingDetail: '失败的显影已保留，正在重新落纸'
    });
    emit('transfer.updated', current.device_id, { transfer: normalizeTransfer(retry), userId: userId(request), retryOf: current.transfer_id });
    return reply.code(202).send({ ok: true, data: { ...retry, retry_of: current.transfer_id } });
  });

  app.post('/api/v1/transfers/:id/events', { preHandler: requireUser }, async (request, reply) => {
    const current = database.getTransfer(request.params.id, userId(request));
    if (!current) return reply.code(404).send({ ok: false, error: 'transfer_not_found' });
    const input = requestBody(request);
    if (input.phase && !TRANSFER_PHASES.includes(input.phase)) return reply.code(400).send({ ok: false, error: 'transfer_phase_invalid' });
    let next;
    try {
      next = nextTransferEvent({ ...current, transfer_id: request.params.id, device_id: current.device_id }, input, { source: 'user' });
    } catch (error) {
      return reply.code(409).send({ ok: false, error: error.code || 'transfer_transition_invalid' });
    }
    if (next.phase === current.phase && next.updated_at === current.updated_at) return { ok: true, data: current };
    const transfer = database.updateTransfer(request.params.id, next, userId(request));
    emit('transfer.updated', transfer.device_id, { transfer, userId: userId(request) });
    return { ok: true, data: transfer };
  });

  app.get('/api/v1/settings', { preHandler: requireUser }, async (request) => ({ ok: true, data: database.getSetting('ui', userId(request)) || { reduced_motion: false, default_profile: 'PENAUP_STD' } }));
  app.put('/api/v1/settings', { preHandler: requireUser }, async (request) => ({ ok: true, data: database.setSetting('ui', requestBody(request), userId(request)) }));
  app.get('/api/v1/ai/providers', { preHandler: requireUser }, async () => ({ ok: true, data: ai.providerState() }));
  app.get('/api/v1/ai/settings', { preHandler: requireUser }, async (request) => ({ ok: true, data: ai.settings(userId(request)) }));
  app.put('/api/v1/ai/settings', { preHandler: requireUser }, async (request, reply) => {
    const input = requestBody(request);
    if (bodyTooLarge(input)) return reply.code(413).send({ ok: false, error: 'request_too_large' });
    const safe = sanitizeAiSettings(input);
    database.setSetting('ai', safe, userId(request));
    return { ok: true, data: ai.settings(userId(request)) };
  });
  app.post('/api/v1/ai/generate', { preHandler: requireUser }, async (request, reply) => {
    const input = requestBody(request);
    if (bodyTooLarge(input, 16 * 1024)) return reply.code(413).send({ ok: false, error: 'request_too_large' });
    const result = await ai.generate(userId(request), input);
    if (!result.ok) return reply.code(result.status || 503).send({ ok: false, error: result.error, detail: result.detail });
    return result;
  });

  app.get('/api/v1/admin/invites/list', { preHandler: requireAdmin }, async () => ({ ok: true, data: database.raw.prepare('SELECT id, email, expires_at, used_at, created_at FROM invites ORDER BY id DESC LIMIT 100').all() }));
  app.get('/api/v1/admin/transfers', { preHandler: requireAdmin }, async () => ({ ok: true, data: database.raw.prepare('SELECT * FROM transfers ORDER BY updated_at DESC LIMIT 100').all() }));
}
