/* Copyright (c) 2026 poboll · Penaup BLE film transfer contract */

// The device protocol has no trustworthy EPD-refresh acknowledgement after
// FILE_STOP. Keep the transport pipeline honest: a successful STOP is an
// uncertain device state, never a UI success.
var bleUtils = require('./ble-utils');
var recentUtils = require('./recent-utils');

var BLE_CTRL_DELAY = bleUtils.BLE_CTRL_DELAY;
var BLE_DATA_DELAY = bleUtils.BLE_DATA_DELAY;
var BLE_CHUNK_SIZE = bleUtils.BLE_CHUNK_SIZE;

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function safeFileName(name) {
  var value = String(name || 'peanaup').replace(/[^a-zA-Z0-9._-]/g, '_');
  value = value.replace(/\.film$/i, '').slice(0, 48);
  return (value || 'peanaup') + '.film';
}

function errorText(error) {
  return error && (error.errMsg || error.message) || '未知错误';
}

function emit(handler, event) {
  if (typeof handler !== 'function') return;
  // Keep the old two-argument callback shape usable for external template
  // pages while all Penaup pages use the richer event object.
  if (handler.length >= 2) handler(event.detail, event.progress, event);
  else handler(event);
}

function eventFor(phase, detail, progress, totalBytes, fileName, extra) {
  var event = {
    phase: phase,
    detail: detail,
    progress: Math.max(0, Math.min(100, Number(progress) || 0)),
    completed_bytes: phase === 'transferring' ? (extra && extra.completedBytes || 0) : (phase === 'refreshing' || phase === 'device_state_uncertain' ? totalBytes : 0),
    total_bytes: totalBytes,
    progress_hint: Math.max(0, Math.min(1, (Number(progress) || 0) / 100)),
    outcome: phase === 'failed' ? 'failure' : (phase === 'device_state_uncertain' ? 'uncertain' : 'pending'),
    card_title: phase === 'failed' ? '这次没有写完' : (phase === 'device_state_uncertain' ? '相纸已写入，等待确认' : '花生片正在显影'),
    rendering_detail: '黑、白、红、黄、蓝、绿',
    file_name: fileName
  };
  if (extra) {
    for (var key in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) event[key] = extra[key];
    }
  }
  return event;
}

function sendFilm(fileData, baseName, options) {
  options = options || {};
  var app = getApp();
  var totalBytes = fileData && fileData.length || 0;
  var fileName = safeFileName(baseName);
  var notify = options.onStatus;
  var step = 0;
  var lastProgress = -1;
  var stopped = false;

  function report(phase, detail, progress, extra) {
    var event = eventFor(phase, detail, progress, totalBytes, fileName, extra);
    if (options.renderingDetail) event.rendering_detail = String(options.renderingDetail);
    emit(notify, event);
    return event;
  }

  function fail(error) {
    var reason = errorText(error);
    if (error && error.transferPhase === 'failed') return Promise.reject(error);
    var wrapped = error instanceof Error ? error : new Error(reason);
    wrapped.transferPhase = 'failed';
    wrapped.transferState = eventFor('failed', '写入中断：' + reason + '。原图和草稿还在。', lastProgress < 0 ? 0 : lastProgress, totalBytes, fileName, {
      error: reason,
      canRetry: true
    });
    report('failed', wrapped.transferState.detail, wrapped.transferState.progress, {
      error: reason,
      canRetry: true
    });
    return Promise.reject(wrapped);
  }

  if (!fileData || totalBytes <= 0) {
    var invalid = new Error('相纸数据为空');
    invalid.transferPhase = 'failed';
    report('failed', '相纸数据为空。请回到画布重新制作。', 0, { error: invalid.message, canRetry: false });
    return Promise.reject(invalid);
  }

  // Persist a retryable copy before the first BLE write. Storage only keeps
  // the path and metadata; the film bytes stay in USER_DATA_PATH.
  try { recentUtils.saveDraft(fileName, fileData); } catch (draftError) {
    // The page still owns fileData, so a live retry remains possible.
  }

  if (!app.globalData.isConnected) {
    var disconnected = new Error('请先连接蓝牙设备');
    disconnected.transferPhase = 'failed';
    report('failed', '设备尚未连接。请先连接花生片，再重试。', 0, { error: disconnected.message, canRetry: true });
    return Promise.reject(disconnected);
  }

  report('preparing', '相纸已经落入画布', 0);

  return Promise.resolve()
    .then(function () {
      report('handshaking', '正在和花生片握手', 2);
      return app.sendBlePacket(bleUtils.buildFileStartPacket());
    })
    .then(function () {
      step = 1;
      return delay(BLE_CTRL_DELAY);
    })
    .then(function () {
      report('handshaking', '正在写入相纸名字', 4);
      return app.sendBlePacket(bleUtils.buildFileNamePacket(fileName));
    })
    .then(function () {
      step = 2;
      return delay(BLE_CTRL_DELAY);
    })
    .then(function () {
      report('handshaking', '正在确认相纸尺寸', 5);
      return app.sendBlePacket(bleUtils.buildFileLenPacket(totalBytes));
    })
    .then(function () {
      step = 3;
      return delay(BLE_CTRL_DELAY);
    })
    .then(function () {
      report('transferring', '正在写入六色相纸', 5, { completedBytes: 0 });
      var offset = 0;

      function sendChunk() {
        if (offset >= totalBytes) return Promise.resolve();
        var end = Math.min(offset + BLE_CHUNK_SIZE, totalBytes);
        var chunk = fileData.slice(offset, end);
        return app.sendBlePacket(bleUtils.buildFileDataPacket(chunk)).then(function () {
          offset = end;
          var dataProgress = Math.min(98, Math.floor(5 + (offset / totalBytes) * 93));
          if (dataProgress !== lastProgress) {
            lastProgress = dataProgress;
            report('transferring', '正在写入六色相纸', dataProgress, { completedBytes: offset });
          }
          return delay(BLE_DATA_DELAY);
        }).then(sendChunk);
      }
      return sendChunk();
    })
    .then(function () {
      step = 4;
      report('transferring', '正在发送结束指令', 99, { completedBytes: totalBytes });
      return app.sendBlePacket(bleUtils.buildFileStopPacket(!!options.silent));
    })
    .then(function () {
      stopped = true;
      report('refreshing', '电子纸正在刷新，等待可信回执', 100, { completedBytes: totalBytes });
      var uncertain = report('device_state_uncertain', '已写入，等待电子纸刷新确认。设备回执可用后再标记成功。', 100, {
        completedBytes: totalBytes,
        canRetry: true
      });
      // Keep the retryable draft and also expose the item in recent history.
      try { recentUtils.addRecent(fileName, fileData, { status: 'device_state_uncertain' }); } catch (recentError) {}
      return {
        phase: uncertain.phase,
        outcome: uncertain.outcome,
        fileName: fileName,
        fileData: fileData,
        event: uncertain
      };
    })
    .catch(function (error) {
      if (stopped) return Promise.reject(error);
      return fail(error);
    });
}

module.exports = {
  sendFilm: sendFilm,
  safeFileName: safeFileName,
  errorText: errorText
};
