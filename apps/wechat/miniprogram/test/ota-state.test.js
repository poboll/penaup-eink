const assert = require('node:assert/strict');
const test = require('node:test');

const ota = require('../utils/ota-state');

test('OTA_STOP enters an uncertain state instead of reporting success', () => {
  const state = ota.afterStop();
  assert.equal(state.state, ota.OTA_STATES.DEVICE_STATE_UNCERTAIN);
  assert.equal(state.progress, 100);
  assert.equal(state.canRetry, true);
  assert.match(state.status, /等待重新连接并回读/);
});

test('only a later device confirmation can enter succeeded', () => {
  const state = ota.afterConfirmation();
  assert.equal(state.state, ota.OTA_STATES.SUCCEEDED);
  assert.equal(state.canRetry, false);
  assert.match(state.status, /运行状态已确认/);
});

test('disconnect after any OTA write preserves a retryable uncertain session', () => {
  const state = ota.afterDisconnect(ota.OTA_STATES.TRANSFERRING);
  assert.equal(state.state, ota.OTA_STATES.DEVICE_STATE_UNCERTAIN);
  assert.equal(ota.keepsSession(state.state), true);
  assert.equal(state.canRetry, true);
});

test('a failed write before OTA starts remains a failed state', () => {
  assert.equal(ota.afterFailure(0).state, ota.OTA_STATES.FAILED);
  assert.equal(ota.afterFailure(128).state, ota.OTA_STATES.DEVICE_STATE_UNCERTAIN);
});
