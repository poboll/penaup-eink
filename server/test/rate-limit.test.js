import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';

import { buildApp } from '../src/app.js';
import { createRateLimiter } from '../src/rate-limit.js';

test('bounded rate limiter returns retry metadata and resets windows', () => {
  let currentTime = 1000;
  const limiter = createRateLimiter({ windowMs: 1000, max: 2, maxKeys: 2, now: () => currentTime });

  assert.deepEqual(limiter.consume('client-a'), { allowed: true, limit: 2, remaining: 1, retryAfterSeconds: 1 });
  assert.equal(limiter.consume('client-a').allowed, true);
  const rejected = limiter.consume('client-a');
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.remaining, 0);
  assert.equal(rejected.retryAfterSeconds, 1);

  currentTime = 2000;
  assert.equal(limiter.consume('client-a').allowed, true);
  assert.equal(limiter.consume('client-b').allowed, true);
  assert.equal(limiter.consume('client-c').allowed, true);
  assert.ok(limiter.size() <= 2);
});

test('runtime rate limits API bursts but leaves device heartbeat available', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-rate-runtime-'));
  const app = await buildApp({
    config: {
      dataDir: root,
      databasePath: path.join(root, 'penaup.db'),
      mediaDir: path.join(root, 'media'),
      adminToken: 'rate-test-admin',
      rateLimitMax: 2,
      rateLimitWindowMs: 60000,
      mqttUrl: ''
    },
    logger: false
  });
  try {
    const first = await app.inject({ method: 'GET', url: '/api/v1/admin/devices' });
    const second = await app.inject({ method: 'GET', url: '/api/v1/admin/devices' });
    const third = await app.inject({ method: 'GET', url: '/api/v1/admin/devices' });
    assert.equal(first.statusCode, 401);
    assert.equal(second.statusCode, 401);
    assert.equal(third.statusCode, 429);
    assert.equal(third.json().error, 'rate_limited');
    assert.equal(third.headers['retry-after'], '60');
    assert.equal(third.headers['x-ratelimit-remaining'], '0');

    const heartbeat = await app.inject({ method: 'GET', url: '/api/v1/device/heartbeat?device_id=rate-device' });
    assert.equal(heartbeat.statusCode, 200);
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
