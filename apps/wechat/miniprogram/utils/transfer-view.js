/* Copyright (c) 2026 poboll · Penaup transfer UI mapping */

var TERMINAL = {
  succeeded: true,
  failed: true,
  device_state_uncertain: true
};

var PHASE_LABELS = {
  idle: '等待开始',
  preparing: '01 / 落纸',
  discovering: '02 / 找到设备',
  connecting: '03 / 连接',
  handshaking: '04 / 握手',
  transferring: '05 / 写入',
  refreshing: '06 / 刷新',
  succeeded: '07 / 已确认',
  failed: '中断 / 可重试',
  device_state_uncertain: '待确认 / 设备刷新中'
};

function beginning(name) {
  return {
    showTransfer: true,
    transferTitle: '花生片正在显影',
    transferPhase: 'preparing',
    transferPhaseLabel: PHASE_LABELS.preparing,
    transferStatus: '相纸已经落入画布',
    transferProgress: 0,
    transferOutcome: 'pending',
    transferCanRetry: false,
    transferCanClose: false,
    transferBusy: true,
    transferFileName: name || ''
  };
}

function fromEvent(event) {
  event = event || {};
  var phase = event.phase || 'preparing';
  var terminal = !!TERMINAL[phase];
  // An uncertain refresh must not be resent automatically: the first write
  // may already be on the panel. Let the user inspect it before starting a
  // new transfer from the history screen.
  var retryable = phase === 'failed';
  var progress = Number(event.progress);
  if (!isFinite(progress)) progress = Number(event.progress_hint) * 100;
  if (!isFinite(progress)) progress = 0;
  return {
    showTransfer: true,
    transferTitle: event.card_title || (phase === 'failed' ? '这次没有写完' : '花生片正在显影'),
    transferPhase: phase,
    transferPhaseLabel: PHASE_LABELS[phase] || phase,
    transferStatus: event.detail || '',
    transferProgress: Math.max(0, Math.min(100, Math.round(progress))),
    transferOutcome: event.outcome || (phase === 'failed' ? 'failure' : 'pending'),
    transferCanRetry: retryable,
    transferCanClose: terminal,
    transferBusy: !terminal,
    transferFileName: event.file_name || ''
  };
}

function closed() {
  return {
    showTransfer: false,
    transferCanRetry: false,
    transferCanClose: false,
    transferBusy: false
  };
}

module.exports = {
  beginning: beginning,
  fromEvent: fromEvent,
  closed: closed,
  isTerminal: function (phase) { return !!TERMINAL[phase]; }
};
