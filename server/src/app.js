import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';

import { createConfig, ensureRuntimeDirectories } from './config.js';
import { PenaupDatabase, tokensMatch } from './db.js';
import { EventHub } from './events.js';
import { createMqttBridge } from './mqtt.js';
import { createAuthService } from './modules/auth.js';
import { createEmailDelivery } from './modules/email.js';
import { createAiService } from './modules/ai.js';
import { TaskQueue } from './queue.js';
import { createStreamScheduler } from './scheduler.js';
import { registerHttpRoutes } from './transports/http.js';
import { registerLegacyAdminRoutes } from './transports/legacy-admin.js';
import { validateFilmBuffer } from '../../packages/film-core/src/index.js';
import { mediaAbsolutePath } from './modules/media.js';

function bearerToken(request) {
  const header = request.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function safeFilename(value) {
  const base = path.basename(String(value || 'untitled.film'));
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96);
  return safe || 'untitled.film';
}

function isFilmFilename(value) {
  return safeFilename(value).toLowerCase().endsWith('.film');
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requestBody(request) {
  return request.body && typeof request.body === 'object' ? request.body : {};
}

function bodyTooLarge(input, limit = 96 * 1024) {
  try { return Buffer.byteLength(JSON.stringify(input || {}), 'utf8') > limit; } catch { return true; }
}

function redactedRequestUrl(value) {
  const raw = String(value || '');
  try {
    const url = new URL(raw, 'http://penaup.local');
    for (const key of ['token', 'access_token', 'refresh_token', 'code', 'dev_code']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]');
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return raw.replace(/([?&](?:token|access_token|refresh_token|code|dev_code)=)[^&]*/gi, '$1[redacted]');
  }
}

const defaultLogger = (config) => ({
  level: config.logLevel,
  serializers: {
    req: (request) => ({
      method: request.method,
      url: redactedRequestUrl(request.url),
      hostname: request.hostname,
      remoteAddress: request.ip
    })
  },
  redact: ['req.headers.authorization', 'req.headers.cookie']
});

async function validateFilmFile(filename) {
  const buffer = await fs.promises.readFile(filename);
  const checked = validateFilmBuffer(buffer);
  if (!checked.valid) return checked;
  return { valid: true, width: checked.profile.screenWidth, height: checked.profile.screenHeight, size: buffer.byteLength, profile: checked.profile.key };
}

export async function buildApp(options = {}) {
  const config = createConfig(options.config);
  await ensureRuntimeDirectories(config);
  const database = options.database || new PenaupDatabase(config.databasePath);
  const events = options.events || new EventHub();
  const app = Fastify({ logger: options.logger === undefined ? defaultLogger(config) : options.logger, bodyLimit: 2 * 1024 * 1024 });
  const emailDelivery = createEmailDelivery({ database, config });
  const auth = createAuthService({ database, config, emailDelivery, logger: app?.log });
  const ai = createAiService({ config, database, fetchImpl: options.fetchImpl });
  const queue = options.queue || new TaskQueue({ concurrency: 1, maxSize: 100 });
  const runtime = { config, database, events, mqtt: null, auth, ai, queue, scheduler: null };

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=()');
    reply.header('Content-Security-Policy', [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "worker-src 'self' blob:"
    ].join('; '));
    if (config.nodeEnv === 'production' || config.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const origin = request.headers.origin;
    const allowed = String(config.allowedOrigins || '').split(',').map((value) => value.trim()).filter(Boolean);
    if (origin && allowed.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Vary', 'Origin');
    }
    return payload;
  });

  app.options('/*', async (request, reply) => {
    const origin = request.headers.origin;
    const allowed = String(config.allowedOrigins || '').split(',').map((value) => value.trim()).filter(Boolean);
    if (origin && allowed.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-CSRF-Token');
      reply.header('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
    }
    return reply.code(204).send();
  });

  // The runtime upload endpoint consumes one film at a time, while the
  // recovered admin console still supports importing a photo batch.
  await app.register(multipart, { limits: { fileSize: config.originalUploadLimit, files: 20 } });
  if (fs.existsSync(config.webRoot)) {
    await app.register(fastifyStatic, { root: config.webRoot, prefix: '/', index: ['index.html'] });
  }
  if (fs.existsSync(config.assetsRoot)) {
    await app.register(fastifyStatic, { root: config.assetsRoot, prefix: '/assets/', decorateReply: false });
  }
  if (fs.existsSync(config.adminWebRoot)) {
    await app.register(fastifyStatic, {
      root: config.adminWebRoot,
      prefix: '/admin/',
      index: ['runtime.html'],
      decorateReply: false
    });
  }

  const requireAdmin = auth.requireAdmin;

  const emit = (type, deviceId, payload) => {
    database.appendEvent(type, deviceId, payload);
    events.emit(type, { deviceId, ...payload });
  };

  runtime.mqtt = createMqttBridge(config, { onState: (deviceId, payload) => {
    // MQTT 状态不能绕过设备 token，也不能凭 topic 自动创建设备。
    if (!payload || typeof payload.token !== 'string' || !payload.token) return;
    const { token, ...state } = payload;
    const result = database.heartbeat({ ...state, deviceId, token, ip: 'mqtt' });
    if (!result.authenticated) return;
    emit('device.state', deviceId, { device: database.getDevice(deviceId), source: 'mqtt' });
  } });
  runtime.scheduler = createStreamScheduler({ config, database, queue, mqtt: runtime.mqtt, emit });
  app.decorate('penaupRuntime', runtime);

  await auth.register(app);
  registerHttpRoutes(app, { config, database, events, mqtt: runtime.mqtt, auth, ai, queue, scheduler: runtime.scheduler, emit });
  registerLegacyAdminRoutes(app, { config, database, auth, emit });
  runtime.scheduler.start();

  app.get('/health', async () => ({
    ok: true,
    product: 'Penaup',
    displayName: '花生片 Penaup',
    runtime: 'node',
    mqtt: runtime.mqtt.enabled,
    mqtt_connected: runtime.mqtt.connected,
    mqtt_status: runtime.mqtt.getStatus(),
    now: new Date().toISOString()
  }));

  app.get('/api/v1/admin/devices', { preHandler: requireAdmin }, async () => ({ ok: true, data: database.listDevices() }));
  app.get('/api/v1/admin/events', { preHandler: requireAdmin }, async (request) => ({ ok: true, data: database.listEvents(request.query?.limit) }));
  app.get('/api/v1/admin/media', { preHandler: requireAdmin }, async () => ({ ok: true, data: database.listMedia() }));

  app.post('/api/v1/admin/devices/:deviceId/commands', { preHandler: requireAdmin }, async (request, reply) => {
    const deviceId = request.params.deviceId;
    if (!database.getDevice(deviceId)) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    const body = requestBody(request);
    if (bodyTooLarge(body)) return reply.code(413).send({ ok: false, error: 'request_too_large' });
    const command = typeof body.cmd === 'string' ? body.cmd : body.command;
    if (!command) return reply.code(400).send({ ok: false, error: 'command_required' });
    if (command.length > 128) return reply.code(400).send({ ok: false, error: 'command_too_long' });
    const params = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {};
    const issued = database.issueCommand(deviceId, command, params);
    const published = await runtime.mqtt.publishCommand(deviceId, issued);
    emit('device.command', deviceId, { command: issued, published });
    return { ok: true, data: { ...issued, published } };
  });

  app.post('/api/v1/admin/media', { preHandler: requireAdmin }, async (request, reply) => {
    const part = await request.file();
    if (!part) return reply.code(400).send({ ok: false, error: 'file_required' });
    const name = safeFilename(part.filename);
    if (!isFilmFilename(name)) {
      part.file.resume();
      return reply.code(415).send({ ok: false, error: 'film_file_required' });
    }
    const storedName = `${crypto.randomUUID()}-${name}`;
    const absolutePath = path.join(config.mediaDir, storedName);
    try {
      await pipeline(part.file, fs.createWriteStream(absolutePath, { flags: 'wx' }));
    } catch (error) {
      await fs.promises.rm(absolutePath, { force: true });
      throw error;
    }
    if (part.file.truncated) {
      await fs.promises.rm(absolutePath, { force: true });
      return reply.code(413).send({ ok: false, error: 'file_too_large' });
    }
    const filmCheck = await validateFilmFile(absolutePath);
    if (!filmCheck.valid) {
      await fs.promises.rm(absolutePath, { force: true });
      return reply.code(422).send({ ok: false, error: filmCheck.error });
    }
    const stat = await fs.promises.stat(absolutePath);
    const media = database.insertMedia({
      name,
      storedPath: path.relative(config.dataDir, absolutePath),
      mime: 'application/octet-stream',
      size: stat.size
    });
    emit('media.created', null, { media });
    return { ok: true, data: media };
  });

  const requireEventsAccess = async (request, reply) => {
    if (auth.adminTokenMatches(request)) { request.penaupAdmin = true; return; }
    return auth.requireUser(request, reply);
  };

  app.get('/api/v1/events/stream', { preHandler: requireEventsAccess }, async (request, reply) => {
    reply.hijack();
    const response = reply.raw;
    const origin = request.headers.origin;
    const allowedOrigins = String(config.allowedOrigins || '').split(',').map((value) => value.trim()).filter(Boolean);
    const corsHeaders = origin && allowedOrigins.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' }
      : {};
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'geolocation=(), microphone=()',
      ...(config.nodeEnv === 'production' || config.cookieSecure
        ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
        : {}),
      ...corsHeaders
    });
    response.write(': penaup connected\n\n');
    const unsubscribe = events.subscribe((event) => {
      if (!request.penaupAdmin) {
        const eventUserId = event.payload && event.payload.userId;
        const eventDeviceId = event.payload && (event.payload.deviceId || event.deviceId);
        const owned = eventUserId === request.penaupUser.id || (eventDeviceId && database.getDevice(eventDeviceId)?.ownerId === request.penaupUser.id);
        if (!owned) return;
      }
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), 15000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.get('/api/v1/device/heartbeat', async (request, reply) => {
    const query = request.query || {};
    if (!query.device_id) return reply.code(400).send({ ok: false, error: 'device_id_required' });
    const result = database.heartbeat({
      deviceId: query.device_id,
      token: query.token,
      model: query.model || query.device_type,
      battery: numberOr(query.battery, -1),
      voltageMv: numberOr(query.voltage_mv, 0),
      state: query.state || 'idle',
      wifiConnected: String(query.wifi_connected || query.wifi_connect || '') === '1',
      heartbeatInterval: numberOr(query.heartbeat_interval, config.heartbeatInterval),
      ip: request.ip
    });
    if (!result.authenticated) return reply.code(401).send({ ok: false, error: 'device_token_invalid' });
    emit('device.heartbeat', query.device_id, {
      device: database.getDevice(query.device_id),
      provisioned: result.provisioned
    });
    return {
      code: 0,
      msg: 'ok',
      data: {
        server_time: Math.floor(Date.now() / 1000),
        heartbeat_interval: result.device.heartbeatInterval,
        token: result.provisioned ? result.device.token : undefined,
        commands: result.commands
      }
    };
  });

  app.get('/api/v1/device/status', async (request, reply) => {
    const deviceId = request.query?.device_id;
    const token = request.query?.token || bearerToken(request);
    const deviceWithToken = database.getDevice(deviceId, true);
    if (!deviceWithToken || !tokensMatch(deviceWithToken.token, token)) {
      return reply.code(401).send({ ok: false, error: 'device_auth_required' });
    }
    const device = database.getDevice(deviceId);
    if (!device) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    return { ok: true, data: device };
  });

  const sendDeviceMedia = async (request, reply, media) => {
    const deviceId = request.query?.device_id;
    const token = request.query?.token || bearerToken(request);
    const device = database.getDevice(deviceId, true);
    if (!device || !tokensMatch(device.token, token)) return reply.code(401).send({ ok: false, error: 'device_auth_required' });
    media = typeof media === 'function' ? media(deviceId) : media;
    if (!media) return reply.code(404).send({ ok: false, error: 'media_not_found' });
    const file = mediaAbsolutePath(config, media.stored_path);
    if (!file || !fs.existsSync(file)) {
      return reply.code(404).send({ ok: false, error: 'media_not_found' });
    }
    return reply
      .type(media.mime || 'application/octet-stream')
      .header('Content-Disposition', `inline; filename="${safeFilename(media.name)}"`)
      .send(fs.createReadStream(file));
  };

  app.get('/api/v1/device/film/latest.film', async (request, reply) => {
    return sendDeviceMedia(request, reply, (deviceId) => database.latestFilmForDevice(deviceId));
  });

  app.get('/api/v1/device/film/:filename', async (request, reply) => {
    const filename = safeFilename(request.params.filename);
    return sendDeviceMedia(request, reply, (deviceId) => database.filmForDeviceByFilename(deviceId, filename));
  });

  app.addHook('onClose', async () => {
    runtime.scheduler.stop();
    await runtime.mqtt.close();
    if (!options.queue) runtime.queue.close();
    if (!options.database) database.close();
  });
  return app;
}
