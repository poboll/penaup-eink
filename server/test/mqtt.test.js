/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import mqtt from 'mqtt';

import { buildApp } from '../src/app.js';

const hasMosquitto = spawnSync('mosquitto', ['-h'], { stdio: 'ignore' }).status === 0;

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('mqtt_live_timeout');
}

test('MQTT 5 bridge accepts authenticated state and publishes commands', { skip: !hasMosquitto }, async () => {
  const port = await unusedPort();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-mqtt-test-'));
  const broker = spawn('mosquitto', ['-p', String(port)], { stdio: 'ignore' });
  let app;
  let external;
  try {
    await waitFor(async () => new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
    }));

    app = await buildApp({
      config: {
        host: '127.0.0.1',
        port: 0,
        dataDir: root,
        databasePath: path.join(root, 'penaup.db'),
        mediaDir: path.join(root, 'media'),
        adminToken: 'mqtt-test-admin',
        mqttUrl: `mqtt://127.0.0.1:${port}`,
        mqttTopicPrefix: 'penaup/device'
      },
      logger: false
    });
    external = mqtt.connect(`mqtt://127.0.0.1:${port}`, { protocolVersion: 5, clientId: `penaup-test-${process.pid}` });
    await new Promise((resolve, reject) => { external.once('connect', resolve); external.once('error', reject); });
    await waitFor(() => app.penaupRuntime.mqtt.getStatus().connected);

    const heartbeat = await app.inject({ method: 'GET', url: '/api/v1/device/heartbeat?device_id=mqtt-test-device&model=PENAUP_PRO' });
    assert.equal(heartbeat.statusCode, 200);
    const token = heartbeat.json().data.token;
    assert.ok(token);

    const commandPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('mqtt_command_timeout')), 5000);
      external.subscribe('penaup/device/mqtt-test-device/command', (error) => {
        if (error) { clearTimeout(timer); reject(error); return; }
        external.once('message', (topic, payload) => {
          if (topic !== 'penaup/device/mqtt-test-device/command') return;
          clearTimeout(timer);
          resolve(JSON.parse(payload.toString('utf8')));
        });
      });
    });

    external.publish('penaup/device/mqtt-test-device/state', JSON.stringify({
      token, battery: 74, state: 'idle', wifiConnected: true
    }), { qos: 1 });
    await waitFor(async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/devices',
        headers: { authorization: 'Bearer mqtt-test-admin' }
      });
      return response.json().data[0]?.batteryPercent === 74;
    });

    const command = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/devices/mqtt-test-device/commands',
      headers: { authorization: 'Bearer mqtt-test-admin' },
      payload: { cmd: 'refresh_display', params: { reason: 'integration-test' } }
    });
    assert.equal(command.statusCode, 200);
    assert.equal(command.json().data.published, true);
    const received = await commandPromise;
    assert.equal(received.cmd, 'refresh_display');
    assert.deepEqual(received.params, { reason: 'integration-test' });
    assert.equal((await app.inject({ method: 'GET', url: '/health' })).json().mqtt_connected, true);
  } finally {
    if (external) external.end(true);
    if (app) await app.close();
    broker.kill('SIGTERM');
    await fs.rm(root, { recursive: true, force: true });
  }
});
