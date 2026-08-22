const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'penaup-wechat-'));
const storage = Object.create(null);

global.wx = {
  env: { USER_DATA_PATH: userDataPath },
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = value; },
  removeStorageSync(key) { delete storage[key]; },
  base64ToArrayBuffer(value) { return Uint8Array.from(Buffer.from(value, 'base64')).buffer; },
  getFileSystemManager() {
    return {
      mkdirSync(dir) { fs.mkdirSync(dir, { recursive: true }); },
      writeFileSync(file, data) { fs.writeFileSync(file, Buffer.from(data)); },
      readFileSync(file) { return fs.readFileSync(file).buffer; },
      unlinkSync(file) { fs.unlinkSync(file); }
    };
  }
};

const transfer = require('../utils/ble-transfer');

function makeApp(failAt) {
  const calls = [];
  return {
    calls,
    globalData: { isConnected: true },
    sendBlePacket(packet) {
      calls.push(packet);
      if (failAt && calls.length === failAt) return Promise.reject(new Error('mock disconnect'));
      return Promise.resolve();
    }
  };
}

test('BLE film transfer uses 192-byte chunks and ends in uncertain state', async () => {
  const app = makeApp();
  global.getApp = () => app;
  const events = [];
  const result = await transfer.sendFilm(new Uint8Array(400), 'story-card', {
    onStatus(event) { events.push(event); }
  });

  assert.equal(result.phase, 'device_state_uncertain');
  assert.equal(events.at(-1).phase, 'device_state_uncertain');
  assert.equal(events.some((event) => event.phase === 'refreshing'), true);
  assert.equal(events.some((event) => event.phase === 'succeeded'), false);
  const dataPackets = app.calls.filter((packet) => packet[1] === 0x02);
  assert.deepEqual(dataPackets.map((packet) => packet[2]), [192, 192, 16]);
});

test('silent transfer preserves the batch-playback STOP flag', async () => {
  const app = makeApp();
  global.getApp = () => app;

  await transfer.sendFilm(new Uint8Array(1), 'batch-card', { silent: true });

  const stopPacket = app.calls.at(-1);
  assert.equal(stopPacket[1], 0x04);
  assert.equal(stopPacket[2], 1);
  assert.equal(stopPacket[3], 1);
});

test('BLE write failure reports a retryable failed state', async () => {
  const app = makeApp(4);
  global.getApp = () => app;
  const events = [];

  await assert.rejects(
    transfer.sendFilm(new Uint8Array(400), 'retry-card', { onStatus(event) { events.push(event); } }),
    (error) => error.transferPhase === 'failed'
  );

  const failed = events.at(-1);
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.canRetry, true);
  assert.match(failed.detail, /草稿还在/);
});

test.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
