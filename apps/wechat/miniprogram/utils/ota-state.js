/* Copyright (c) 2026 poboll · Penaup OTA state contract */

// A BLE write acknowledgement only proves that the phone handed bytes to the
// characteristic. It does not prove that the device accepted the image,
// rebooted, or came back with a working application. Keep these transitions
// small and pure so the page can be tested without the WeChat runtime.
var OTA_STATES = {
  IDLE: 'idle',
  TRANSFERRING: 'transferring',
  DEVICE_STATE_UNCERTAIN: 'device_state_uncertain',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed'
};

function afterStop() {
  return {
    state: OTA_STATES.DEVICE_STATE_UNCERTAIN,
    progress: 100,
    status: '固件已写入，等待重新连接并回读确认',
    canRetry: true
  };
}

function afterConfirmation() {
  return {
    state: OTA_STATES.SUCCEEDED,
    progress: 100,
    status: '设备已重新连接并回读，运行状态已确认',
    canRetry: false
  };
}

function afterFailure(bytesSent) {
  if (Number(bytesSent) > 0) {
    return {
      state: OTA_STATES.DEVICE_STATE_UNCERTAIN,
      progress: 0,
      status: '传输中断，设备状态待确认；请重新连接后回读',
      canRetry: true
    };
  }
  return {
    state: OTA_STATES.FAILED,
    progress: 0,
    status: '固件没有写入，可以检查连接后重试',
    canRetry: true
  };
}

function afterDisconnect(state) {
  if (state === OTA_STATES.TRANSFERRING || state === OTA_STATES.DEVICE_STATE_UNCERTAIN) {
    return {
      state: OTA_STATES.DEVICE_STATE_UNCERTAIN,
      status: '设备已断开，等待重新连接并回读确认',
      canRetry: true
    };
  }
  return { state: state || OTA_STATES.IDLE };
}

function keepsSession(state) {
  return state === OTA_STATES.TRANSFERRING || state === OTA_STATES.DEVICE_STATE_UNCERTAIN;
}

module.exports = {
  OTA_STATES: OTA_STATES,
  afterStop: afterStop,
  afterConfirmation: afterConfirmation,
  afterFailure: afterFailure,
  afterDisconnect: afterDisconnect,
  keepsSession: keepsSession
};
