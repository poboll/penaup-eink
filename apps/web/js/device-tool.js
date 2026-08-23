/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 *
 * Penaup browser maintenance tool. This file deliberately keeps the BLE
 * state machine local to the page: a write acknowledgement is never treated
 * as a display, reboot, or firmware success signal.
 */
(function (global, document) {
    'use strict';

    var P = global.PenaupBleProtocol;
    var G = global.PenaupReconnectGuard;
    if (!P || !G) return;

    var state = {
        device: null,
        server: null,
        service: null,
        characteristic: null,
        profile: P.PROFILES.PENAUP_STD,
        connected: false,
        phase: 'idle',
        busy: false,
        operation: null,
        queue: Promise.resolve(),
        waiters: {},
        reconnectExpected: false,
        reconnectObserved: false,
        reconnectTimer: null,
        reconnectAttempts: 0,
        lastRefresh: null,
        wifiEnabled: null,
        wifiConnected: null,
        battery: null,
        ota: {
            manifestFile: null,
            firmwareFile: null,
            manifest: null,
            valid: false,
            bytesSent: 0
        }
    };

    var COMMANDS = P.COMMANDS;
    // The shared partition table reserves 1536 KiB for each OTA slot. Keep a
    // browser-side upper bound so a signed-looking local file cannot exhaust
    // memory or start an impossible BLE transfer.
    var MAX_OTA_IMAGE_BYTES = 1536 * 1024;
    var PINNED_FIRMWARE_KEY_ID = global.PENAUP_FIRMWARE_PUBLIC_KEY_ID || 'poboll-release-2026';
    var phaseCopy = {
        idle: ['等待靠近', '扫描设备后，页面会在这里把连接过程讲清楚。'],
        discovering: ['正在发现', '请在浏览器选择器中选择花生片；取消不会改变设备。'],
        connecting: ['正在连接', '正在打开 Penaup BLE 服务，先保持设备在身边。'],
        handshaking: ['正在回读', '连接已经建立，正在读取型号、电量和网络状态。'],
        refreshing: ['重新获取中', '正在向设备询问最新状态。'],
        transferring: ['正在写入', '数据正在通过 BLE 分块写入，请不要关闭页面或离开设备。'],
        succeeded: ['已确认', '设备重新广播并成功回读，维护流程可以结束。'],
        failed: ['需要重试', '这一步没有完成，可以保留设备连接后再次尝试。'],
        device_state_uncertain: ['状态待确认', '命令已经发出，但设备是否完成需要重新广播并回读确认。']
    };

    function byId(id) { return document.getElementById(id); }
    function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
    function delay(ms) { return new Promise(function (resolve) { global.setTimeout(resolve, ms); }); }
    function nowText() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    function setText(id, value) { var node = byId(id); if (node) node.textContent = value == null ? '—' : String(value); }
    function isConnected() { return !!(state.connected && state.characteristic && state.device && state.device.gatt && state.device.gatt.connected); }

    function log(kind, message) {
        var container = byId('activity-log');
        if (!container) return;
        var empty = container.querySelector('.empty-note');
        if (empty) empty.remove();
        var entry = document.createElement('div');
        entry.className = 'activity-entry ' + (kind || 'info');
        var time = document.createElement('time');
        time.textContent = nowText();
        var category = document.createElement('span');
        category.className = 'activity-kind';
        category.textContent = kind === 'error' ? 'ERROR' : (kind === 'warn' ? 'WAITING' : 'PENAUP');
        var detail = document.createElement('span');
        detail.textContent = String(message);
        entry.appendChild(time);
        entry.appendChild(category);
        entry.appendChild(detail);
        container.appendChild(entry);
        while (container.children.length > 80) container.removeChild(container.firstChild);
        container.scrollTop = container.scrollHeight;
    }

    var messageTimer = null;
    function showMessage(message, kind, duration) {
        var node = byId('tool-message');
        if (!node) return;
        node.hidden = false;
        node.className = 'tool-message ' + (kind || 'info');
        node.textContent = message;
        if (messageTimer) global.clearTimeout(messageTimer);
        messageTimer = global.setTimeout(function () { node.hidden = true; }, duration || 5200);
    }

    function setPhase(phase, title, detail) {
        state.phase = phase;
        var copy = phaseCopy[phase] || phaseCopy.idle;
        setText('phase-title', title || copy[0]);
        setText('phase-detail', detail || copy[1]);
        document.body.dataset.phase = phase;
        var phaseNumber = { discovering: '01', connecting: '02', handshaking: '03', refreshing: '03', idle: '04', succeeded: '04', transferring: '05', failed: '!!', device_state_uncertain: '??' }[phase] || '00';
        setText('phase-number', phaseNumber);
        var order = { discovering: 1, connecting: 2, handshaking: 3, refreshing: 3, idle: 4, succeeded: 4 }[phase] || 0;
        all('[data-phase-item]').forEach(function (item) {
            var itemOrder = { discovering: 1, connecting: 2, handshaking: 3, idle: 4 }[item.getAttribute('data-phase-item')];
            item.classList.toggle('is-current', itemOrder === order && phase !== 'succeeded');
            item.classList.toggle('is-done', order > itemOrder || phase === 'succeeded');
        });
    }

    function setConnectionStatus(title, detail, kind) {
        setText('connection-status', title);
        setText('connection-detail', detail);
        var dot = byId('connection-dot');
        if (dot) dot.className = 'status-dot ' + (kind || '');
    }

    function applyReconnectGate(gate) {
        state.reconnectExpected = gate.expected;
        state.reconnectObserved = gate.observed;
    }

    function beginReconnectExpectation() { applyReconnectGate(G.begin()); }
    function observeReconnectDisconnect() { applyReconnectGate(G.observe(state.reconnectExpected)); }
    function clearReconnectExpectation() { applyReconnectGate(G.clear()); }

    function updateBrowserCapabilities() {
        var bluetooth = !!global.navigator.bluetooth;
        var serial = !!global.navigator.serial;
        var capability = byId('browser-capability');
        if (capability) {
            capability.textContent = bluetooth ? 'Web Bluetooth 可用' : '需要 Chromium';
            capability.classList.toggle('locked', !bluetooth);
        }
        var serialTitle = byId('serial-title');
        var serialDetail = byId('serial-detail');
        if (serialTitle) serialTitle.textContent = serial ? '浏览器支持 Web Serial' : '当前浏览器没有 Web Serial';
        if (serialDetail) serialDetail.textContent = serial
            ? '能力探测已通过，但仓库没有猜测 bootloader 地址或串口协议。正式刷写必须由对应固件发布包与硬件门禁共同开启。'
            : '可以继续使用 BLE 设备工具。USB 串口刷写需要支持 Web Serial 的 Chromium，且仍需对应 bootloader 协议。';
        var scan = byId('scan-button');
        if (scan && !bluetooth) scan.disabled = true;
        ['manifest-input', 'firmware-input'].forEach(function (id) { var input = byId(id); if (input) input.disabled = !bluetooth; });
        if (!bluetooth) {
            setConnectionStatus('浏览器暂不支持 Web Bluetooth', '请使用支持 Web Bluetooth 的 Chromium 浏览器，或改用微信小程序。', 'error');
            setPhase('failed', '需要支持 BLE 的浏览器', '此页面不会降级成虚假的连接状态。');
            log('warn', '当前浏览器不提供 Web Bluetooth。');
        }
    }

    function setConnectedControls() {
        var connected = isConnected();
        var locked = state.busy || state.reconnectExpected;
        ['disconnect-button', 'refresh-button', 'wifi-enabled', 'wifi-ssid', 'wifi-password', 'film-api-url', 'heartbeat-interval', 'save-network-button', 'wifi-connect-button', 'wifi-disconnect-button', 'clear-network-button', 'reboot-button', 'reset-button'].forEach(function (id) {
            var node = byId(id);
            if (node) node.disabled = !connected || locked;
        });
        var networkState = byId('network-form-state');
        if (networkState) {
            networkState.textContent = connected ? (locked ? '等待确认' : '已连接') : '未连接';
            networkState.classList.toggle('locked', !connected || locked);
        }
        var scan = byId('scan-button');
        if (scan) {
            scan.disabled = state.busy || !global.navigator.bluetooth;
            scan.textContent = state.reconnectExpected ? '等待设备重新广播' : (state.busy ? '正在处理…' : '⌁ 扫描花生片');
        }
        var reconnect = byId('reconnect-button');
        if (reconnect) reconnect.hidden = !state.reconnectExpected || !state.device;
        if (reconnect) {
            reconnect.disabled = !state.reconnectObserved || state.busy;
            reconnect.textContent = state.reconnectObserved ? '重新连接并确认' : '等待设备重新广播';
        }
        var otaInputDisabled = !global.navigator.bluetooth;
        ['manifest-input', 'firmware-input'].forEach(function (id) { var input = byId(id); if (input) input.disabled = otaInputDisabled || state.busy; });
        var startOta = byId('start-ota-button');
        if (startOta) startOta.disabled = !state.ota.valid || !connected || state.busy || state.reconnectExpected;
    }

    function updateDeviceIdentity() {
        var name = state.device && state.device.name ? state.device.name : '已连接设备';
        state.profile = P.profileForName(name);
        setText('device-name', name);
        setText('device-id', state.device && state.device.id ? state.device.id : 'BLE 会话设备');
        setText('device-model', state.profile.displayName);
        setText('device-resolution', state.profile.width + ' × ' + state.profile.height + ' px');
        var list = byId('device-list');
        if (!list) return;
        list.textContent = '';
        var item = document.createElement('div');
        item.className = 'device-item';
        var text = document.createElement('div');
        var strong = document.createElement('strong');
        strong.textContent = name;
        var sub = document.createElement('span');
        sub.textContent = state.profile.displayName + ' · ' + state.profile.width + '×' + state.profile.height;
        text.appendChild(strong);
        text.appendChild(sub);
        var badge = document.createElement('span');
        badge.className = 'capability-pill';
        badge.textContent = isConnected() ? '已连接' : '已选择';
        item.appendChild(text);
        item.appendChild(badge);
        list.appendChild(item);
    }

    function updateStatusCards() {
        setText('device-battery', state.battery == null ? '—' : state.battery + '%');
        setText('battery-detail', state.battery == null ? '通过 BLE 回读' : '最近一次成功回读');
        if (state.wifiEnabled == null) {
            setText('device-wifi', '—');
            setText('wifi-detail', '状态还没有回读');
        } else if (!state.wifiEnabled) {
            setText('device-wifi', '已关闭');
            setText('wifi-detail', 'Wi-Fi 配置未启用');
        } else if (state.wifiConnected === true) {
            setText('device-wifi', '已连接');
            setText('wifi-detail', '设备正在使用 Wi-Fi');
        } else if (state.wifiConnected === false) {
            setText('device-wifi', '未连接');
            setText('wifi-detail', 'Wi-Fi 已启用，当前未连接');
        } else {
            setText('device-wifi', '已启用');
            setText('wifi-detail', '连接状态还没有回读');
        }
    }

    function settleWaiters(frame) {
        var queue = state.waiters[frame.channel];
        if (!queue || !queue.length) return;
        var waiter = queue.shift();
        if (waiter && waiter.timer) global.clearTimeout(waiter.timer);
        if (waiter) waiter.resolve(frame);
    }

    function rejectWaiters(reason) {
        var error = reason instanceof Error ? reason : new Error(String(reason || 'BLE 会话已断开'));
        Object.keys(state.waiters).forEach(function (channel) {
            var queue = state.waiters[channel] || [];
            state.waiters[channel] = [];
            queue.forEach(function (waiter) {
                if (waiter && waiter.timer) global.clearTimeout(waiter.timer);
                if (waiter && waiter.reject) waiter.reject(error);
            });
        });
    }

    function waitForResponse(channel, timeout) {
        return new Promise(function (resolve, reject) {
            var waiter = { resolve: resolve, reject: reject, timer: null };
            waiter.timer = global.setTimeout(function () {
                var queue = state.waiters[channel] || [];
                var index = queue.indexOf(waiter);
                if (index >= 0) queue.splice(index, 1);
                reject(new Error('等待设备回读超时: 0x' + channel.toString(16)));
            }, timeout || 1600);
            if (!state.waiters[channel]) state.waiters[channel] = [];
            state.waiters[channel].push(waiter);
        });
    }

    function handleFrame(frame) {
        settleWaiters(frame);
        var payload = frame.payload;
        if (frame.channel === COMMANDS.POWER_READ && payload.length >= 1) {
            state.battery = Math.min(100, payload[0]);
        } else if (frame.channel === COMMANDS.WIFI_ENABLE_GET && payload.length >= 1) {
            state.wifiEnabled = payload[0] === 1;
            var enabled = byId('wifi-enabled');
            if (enabled) enabled.checked = state.wifiEnabled;
        } else if (frame.channel === COMMANDS.WIFI_SSID_GET) {
            setValue('wifi-ssid', P.decodeAscii(payload));
        } else if (frame.channel === COMMANDS.FILM_API_URL_GET) {
            setValue('film-api-url', P.decodeAscii(payload));
        } else if (frame.channel === COMMANDS.WIFI_CONNECT_GET && payload.length >= 1) {
            state.wifiConnected = payload[0] === 1;
        } else if (frame.channel === COMMANDS.HEARTBEAT_INTERVAL_GET && payload.length >= 1) {
            setValue('heartbeat-interval', payload[0]);
        }
        updateStatusCards();
    }

    function setValue(id, value) { var node = byId(id); if (node && document.activeElement !== node) node.value = value == null ? '' : String(value); }

    function onNotification(event) {
        var frame = P.parseFrame(event.target.value);
        if (!frame.valid) {
            log('warn', '收到无法校验的 BLE 数据：' + frame.error);
            return;
        }
        handleFrame(frame);
    }

    async function attachCharacteristic() {
        state.server = await state.device.gatt.connect();
        state.service = await state.server.getPrimaryService(P.SERVICE_UUID);
        state.characteristic = await state.service.getCharacteristic(P.CHARACTERISTIC_UUID);
        if (!state.characteristic.properties.write && !state.characteristic.properties.writeWithoutResponse) throw new Error('设备特征值不支持写入');
        if (state.characteristic.properties.notify || state.characteristic.properties.indicate) {
            await state.characteristic.startNotifications();
            state.characteristic.addEventListener('characteristicvaluechanged', onNotification);
        }
        state.connected = true;
        updateDeviceIdentity();
        setConnectedControls();
    }

    function enqueueWrite(fn) {
        var next = state.queue.then(fn, fn);
        state.queue = next.catch(function () {});
        return next;
    }

    function writePacket(packet, waitMs) {
        if (!isConnected()) return Promise.reject(new Error('设备未连接'));
        return enqueueWrite(async function () {
            if (state.characteristic.writeValueWithResponse) await state.characteristic.writeValueWithResponse(packet);
            else if (state.characteristic.writeValueWithoutResponse) await state.characteristic.writeValueWithoutResponse(packet);
            else await state.characteristic.writeValue(packet);
            await delay(waitMs == null ? P.CONTROL_DELAY : waitMs);
        });
    }

    async function sendCommand(channel, payload, waitMs) {
        return writePacket(P.createPacket(channel, payload || []), waitMs);
    }

    async function query(channel, payload) {
        var response = waitForResponse(channel, 1800);
        await sendCommand(channel, payload || []);
        return response;
    }

    async function refreshDeviceState(options) {
        options = options || {};
        if (!isConnected()) return false;
        setPhase('refreshing', '重新获取中', '正在向设备询问最新状态。');
        var critical = false;
        var queries = [
            { channel: COMMANDS.POWER_READ, apply: function (frame) { critical = frame.payload.length >= 1; } },
            { channel: COMMANDS.WIFI_ENABLE_GET },
            { channel: COMMANDS.WIFI_SSID_GET },
            { channel: COMMANDS.WIFI_CONNECT_GET },
            { channel: COMMANDS.FILM_API_URL_GET },
            { channel: COMMANDS.HEARTBEAT_INTERVAL_GET }
        ];
        for (var i = 0; i < queries.length; i += 1) {
            try {
                var frame = await query(queries[i].channel);
                if (queries[i].apply) queries[i].apply(frame);
            } catch (error) {
                log('warn', '设备没有回读 0x' + queries[i].channel.toString(16) + '，可能是旧固件或正在重启。');
            }
        }
        state.lastRefresh = new Date();
        setText('last-refresh', '最近回读 ' + state.lastRefresh.toLocaleTimeString());
        updateStatusCards();
        if (options.confirmation) {
            if (!G.canConfirm(state.reconnectExpected, state.reconnectObserved)) {
                setPhase('device_state_uncertain', '仍需重新连接', '设备还没有经历可观察的断开和重新广播；当前回读不能作为重启或升级完成证据。');
                setConnectionStatus('状态待确认', '先等设备断开并重新广播，再进行回读确认。', 'warn');
                log('warn', '拒绝在未观察到断开时确认维护操作。');
                return false;
            }
            if (critical && isConnected()) {
                clearReconnectExpectation();
                state.operation = null;
                setPhase('succeeded', '设备状态已确认', '设备重新广播并成功回读，维护流程可以结束。');
                setConnectionStatus('已连接 · 状态已确认', '可以继续设置网络或回到工作台。', 'active');
                showMessage('设备已重新连接，状态确认完成。', 'success');
                log('info', '重新连接并成功回读设备状态。');
                setConnectedControls();
                return true;
            }
            setPhase('device_state_uncertain', '状态待确认', '设备已经重新连接，但还没有得到足够的状态回读。');
            return false;
        }
        if (critical) {
            setPhase('idle', '设备已就绪', '状态已经回到页面；下一步可以整理网络或开始显影。');
            setConnectionStatus('已连接 · 状态已回读', '设备信息来自当前 BLE 会话。', 'active');
        } else {
            setPhase('device_state_uncertain', '状态待确认', '连接还在，但设备没有完整回读；可以再次获取。');
            setConnectionStatus('已连接 · 回读不完整', '请确认设备没有正在重启，再重新获取状态。', 'warn');
        }
        log(critical ? 'info' : 'warn', critical ? '设备状态回读完成。' : '设备连接成功，但状态回读不完整。');
        return critical;
    }

    async function connectSelected(options) {
        options = options || {};
        if (!state.device) throw new Error('还没有选择设备');
        if (options.confirmation && !G.canConfirm(state.reconnectExpected, state.reconnectObserved)) {
            setPhase('device_state_uncertain', '仍需重新连接', '设备还没有经历可观察的断开和重新广播；当前连接不能被当作维护完成。');
            setConnectionStatus('等待设备重新广播', '请等设备先断开，再点击“重新连接并确认”。', 'warn');
            return false;
        }
        state.busy = true;
        setConnectedControls();
        setPhase('connecting');
        setConnectionStatus('正在连接', '正在打开花生片 BLE 服务。', 'warn');
        await attachCharacteristic();
        setPhase('handshaking');
        setConnectionStatus('已连接 · 正在回读', '正在读取型号、电量和网络状态。', 'warn');
        var confirmed = await refreshDeviceState({ confirmation: !!options.confirmation });
        state.busy = false;
        setConnectedControls();
        return confirmed;
    }

    async function scanDevice() {
        if (state.busy || !global.navigator.bluetooth) return;
        state.busy = true;
        setConnectedControls();
        setPhase('discovering');
        setConnectionStatus('正在扫描', '请从浏览器选择器中选择花生片。', 'warn');
        log('info', '打开 Web Bluetooth 设备选择器。');
        try {
            state.device = await global.navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'PENAUP', services: [P.SERVICE_UUID] }, { namePrefix: 'FRAMEFILM', services: [P.SERVICE_UUID] }],
                optionalServices: [P.SERVICE_UUID]
            });
            state.device.addEventListener('gattserverdisconnected', onDisconnected);
            clearReconnectExpectation();
            await connectSelected();
            log('info', '已选择 ' + (state.device.name || '花生片设备') + '。');
        } catch (error) {
            var cancelled = error && (error.name === 'NotFoundError' || error.name === 'AbortError');
            state.connected = false;
            setConnectionStatus(cancelled ? '已取消扫描' : '连接失败', cancelled ? '没有选择设备，可以再次扫描。' : (error.message || '设备没有连上，请重试。'), cancelled ? '' : 'error');
            setPhase(cancelled ? 'idle' : 'failed', cancelled ? '等待靠近' : '连接失败', cancelled ? '扫描不会改变设备。' : '请确认设备已唤醒，并检查浏览器权限。');
            log(cancelled ? 'warn' : 'error', cancelled ? '用户取消设备选择。' : '设备连接失败：' + (error.message || 'unknown_error'));
            if (!cancelled) showMessage('设备连接失败，请确认花生片已唤醒。', 'error');
        } finally {
            state.busy = false;
            setConnectedControls();
        }
    }

    function onDisconnected() {
        rejectWaiters(new Error('BLE 会话已断开，设备回读已取消'));
        state.connected = false;
        state.server = null;
        state.service = null;
        state.characteristic = null;
        if (state.reconnectExpected) observeReconnectDisconnect();
        setConnectedControls();
        if (state.reconnectExpected) {
            setConnectionStatus('设备已离开连接', '正在等待重新广播；不会把断开本身当作成功。', 'warn');
            setPhase('device_state_uncertain', '等待重新广播', '命令已发出，等设备回来后会再次回读状态。');
            log('warn', '设备断开，进入状态待确认。');
            beginReconnectWatch();
        } else {
            setConnectionStatus('设备已断开', '可以重新扫描花生片。', '');
            setPhase('idle', '等待靠近', '设备离开了当前会话，页面保留你的工具位置。');
            log('warn', 'BLE 会话已断开。');
        }
    }

    async function reconnectExisting() {
        if (!state.device || state.busy) return false;
        if (!G.canConfirm(state.reconnectExpected, state.reconnectObserved)) {
            setPhase('device_state_uncertain', '等待设备先断开', '当前连接仍然存在；只有看到设备断开并重新广播后，才允许确认维护结果。');
            setConnectionStatus('等待设备重新广播', '不要把当前连接上的回读当作重启或升级完成。', 'warn');
            log('warn', '重新连接按钮尚未满足断开证据门禁。');
            return false;
        }
        state.busy = true;
        setConnectedControls();
        try {
            await connectSelected({ confirmation: true });
        } catch (error) {
            log('warn', '本次重新连接还没有成功：' + (error.message || 'device_unavailable'));
            setPhase('device_state_uncertain', '仍在等待设备', '可以让设备保持唤醒，再点击“重新连接并确认”。');
            setConnectionStatus('等待设备重新连接', '没有把这次尝试当作成功。', 'warn');
        } finally {
            state.busy = false;
            setConnectedControls();
        }
    }

    function beginReconnectWatch() {
        if (state.reconnectTimer) return;
        state.reconnectAttempts = 0;
        state.reconnectTimer = global.setTimeout(autoReconnect, 2800);
    }

    async function autoReconnect() {
        state.reconnectTimer = null;
        if (!state.reconnectExpected || !state.device || state.connected) return;
        if (state.busy) {
            state.reconnectTimer = global.setTimeout(autoReconnect, 1200);
            return;
        }
        state.reconnectAttempts += 1;
        if (state.reconnectAttempts > 12) {
            setPhase('device_state_uncertain', '还没有找到设备', '自动等待结束；设备回来后，可以手动重新连接并确认。');
            setConnectedControls();
            return;
        }
        try {
            await reconnectExisting();
        } catch (error) {
            // Keep the user-facing state calm while the device reboots.
        }
        if (state.reconnectExpected && !state.connected) state.reconnectTimer = global.setTimeout(autoReconnect, 1800);
    }

    async function disconnectDevice() {
        if (state.reconnectTimer) global.clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
        clearReconnectExpectation();
        state.operation = null;
        if (state.device && state.device.gatt && state.device.gatt.connected) state.device.gatt.disconnect();
        else onDisconnected();
    }

    function asciiPayload(value, maxLength) { return P.asciiBytes(value, maxLength, true); }

    async function saveNetwork(event) {
        event.preventDefault();
        if (!isConnected() || state.busy) return;
        var ssid = byId('wifi-ssid').value.trim();
        var password = byId('wifi-password').value;
        var apiUrl = byId('film-api-url').value.trim();
        var interval = byId('heartbeat-interval').value.trim();
        if (ssid.length > 63 || password.length > 63 || apiUrl.length > 127) {
            showMessage('SSID、密码或 API 地址超过设备协议长度。', 'error');
            return;
        }
        if (interval && (!/^\d+$/.test(interval) || Number(interval) < 5 || Number(interval) > 180)) {
            showMessage('心跳间隔需要在 5–180 秒之间。', 'error');
            return;
        }
        state.busy = true;
        setConnectedControls();
        try {
            await sendCommand(COMMANDS.WIFI_ENABLE, [byId('wifi-enabled').checked ? 1 : 0]);
            if (ssid) await sendCommand(COMMANDS.WIFI_SSID, asciiPayload(ssid, 64));
            if (password) await sendCommand(COMMANDS.WIFI_PASSWORD, asciiPayload(password, 64));
            if (apiUrl) await sendCommand(COMMANDS.FILM_API_URL, asciiPayload(apiUrl, 128));
            if (interval) await sendCommand(COMMANDS.HEARTBEAT_INTERVAL, [Number(interval)]);
            setValue('wifi-password', '');
            showMessage('网络设置已写入，正在回读确认。', 'success');
            log('info', '网络设置已通过 BLE 写入，开始回读。');
            await refreshDeviceState();
        } catch (error) {
            setPhase('failed', '网络设置没有完成', '请确认设备仍在连接，再检查输入后重试。');
            log('error', '网络设置失败：' + (error.message || 'write_failed'));
            showMessage('网络设置失败：' + (error.message || 'write_failed'), 'error');
        } finally {
            state.busy = false;
            setConnectedControls();
        }
    }

    async function wifiAction(channel, label) {
        if (!isConnected() || state.busy) return;
        state.busy = true;
        setConnectedControls();
        try {
            await sendCommand(channel);
            state.wifiConnected = channel === COMMANDS.WIFI_CONNECT ? null : false;
            setText('wifi-detail', label + '，正在回读');
            log('info', label + '命令已发送。');
            await delay(600);
            await refreshDeviceState();
        } catch (error) {
            log('error', label + '失败：' + (error.message || 'command_failed'));
            showMessage(label + '失败，请重试。', 'error');
        } finally {
            state.busy = false;
            setConnectedControls();
        }
    }

    async function clearNetwork() {
        if (!isConnected() || state.busy) return;
        if (!global.confirm('确定要清除花生片的全部网络配置吗？此操作会断开 Wi-Fi。')) return;
        state.busy = true;
        setConnectedControls();
        try {
            await sendCommand(COMMANDS.WIFI_CLEAR);
            state.wifiEnabled = false;
            state.wifiConnected = false;
            setValue('wifi-ssid', '');
            setValue('wifi-password', '');
            setValue('film-api-url', '');
            setValue('heartbeat-interval', '');
            var enabled = byId('wifi-enabled');
            if (enabled) enabled.checked = false;
            setPhase('device_state_uncertain', '网络配置已清除，等待回读', '清除命令没有返回成功回执，页面会用下一次状态回读确认结果。');
            setConnectionStatus('已写入清除命令', '正在确认设备的网络状态。', 'warn');
            showMessage('网络清除命令已发送，正在确认。', 'warn');
            log('warn', '已发送 WIFI_CLEAR / 0x3B；等待状态回读。');
            await delay(500);
            await refreshDeviceState();
        } catch (error) {
            setPhase('failed', '网络清除没有完成', '设备可能正在切换网络状态，请重新获取后再试。');
            log('error', '网络清除失败：' + (error.message || 'command_failed'));
            showMessage('网络清除失败，请重试。', 'error');
        } finally {
            state.busy = false;
            setConnectedControls();
        }
    }

    async function maintenanceCommand(channel, label, confirmation) {
        if (!isConnected() || state.busy) return;
        if (!global.confirm(confirmation)) return;
        beginReconnectExpectation();
        state.operation = label;
        state.busy = true;
        setPhase('device_state_uncertain', label + '命令已发送', '设备将离开当前连接；重新广播并回读后，页面才会显示完成。');
        setConnectionStatus('等待设备重新广播', '不会把 BLE 写入成功冒充为设备完成。', 'warn');
        setConnectedControls();
        try {
            await sendCommand(channel);
            log('warn', label + '命令已写入；等待设备重启和状态确认。');
            showMessage(label + '命令已发送，等待设备回来。', 'warn');
            beginReconnectWatch();
        } catch (error) {
            clearReconnectExpectation();
            setPhase('failed', label + '没有发送成功', '请确认设备仍在附近，再重新连接后重试。');
            setConnectionStatus('命令发送失败', error.message || 'BLE 写入失败', 'error');
            log('error', label + '失败：' + (error.message || 'command_failed'));
            showMessage(label + '失败，请重试。', 'error');
        } finally {
            state.busy = false;
            setConnectedControls();
        }
    }

    function bytesToHex(buffer) {
        var bytes = new Uint8Array(buffer);
        var output = '';
        for (var i = 0; i < bytes.length; i += 1) output += bytes[i].toString(16).padStart(2, '0');
        return output;
    }

    function base64ToBytes(value) {
        var binary = global.atob(String(value || ''));
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    async function verifyPinnedSignature(manifest) {
        var signature = manifest && manifest.signature;
        var publicKey = global.PENAUP_FIRMWARE_PUBLIC_KEY_JWK || null;
        if (!signature || signature.algorithm !== 'Ed25519' || !signature.value || !signature.key_id) return { ok: false, reason: '发布清单没有 Ed25519 签名信息' };
        if (signature.key_id !== PINNED_FIRMWARE_KEY_ID) return { ok: false, reason: '固件签名 key_id 不是网页固定发布密钥' };
        if (!publicKey) return { ok: false, reason: '当前网页尚未配置 poboll 固件发布公钥' };
        if (!global.crypto || !global.crypto.subtle) return { ok: false, reason: '浏览器没有 Web Crypto 签名验证能力' };
        var expectedMessage = 'penaup-firmware-v1:' + String(manifest.sha256 || '').toLowerCase();
        if (signature.message !== expectedMessage) return { ok: false, reason: '签名消息与固件 SHA-256 不一致' };
        try {
            var key = await global.crypto.subtle.importKey('jwk', publicKey, { name: 'Ed25519' }, false, ['verify']);
            var valid = await global.crypto.subtle.verify({ name: 'Ed25519' }, key, base64ToBytes(signature.value), new TextEncoder().encode(expectedMessage));
            return valid ? { ok: true } : { ok: false, reason: '固件签名校验失败' };
        } catch (error) {
            return { ok: false, reason: '固件签名无法验证' };
        }
    }

    async function validateOtaPackage() {
        var manifestFile = state.ota.manifestFile;
        var firmwareFile = state.ota.firmwareFile;
        state.ota.valid = false;
        var note = byId('ota-validation');
        var lock = byId('ota-lock-state');
        if (lock) { lock.textContent = '本地校验中'; lock.classList.add('locked'); }
        if (!manifestFile || !firmwareFile) {
            if (note) { note.textContent = '请选择 manifest.json 与对应的 .bin；当前仓库没有可直接刷写的正式发布包。'; note.className = 'validation-note'; }
            setConnectedControls();
            return false;
        }
        try {
            if (manifestFile.size > 256 * 1024) throw new Error('manifest 文件过大');
            var manifest = JSON.parse(await manifestFile.text());
            state.ota.manifest = manifest;
            var errors = [];
            if (manifest.schema !== 'penaup-firmware-manifest/v1') errors.push('清单 schema 不匹配');
            if (manifest.product !== 'penaup') errors.push('不是 Penaup 固件');
            if (manifest.release_status !== 'published') errors.push('清单仍是草稿，未发布');
            if (!Array.isArray(manifest.models) || manifest.models.indexOf(state.profile.key) === -1) errors.push('固件型号与当前设备不匹配');
            if (manifest.protocol !== 'ble-v1') errors.push('BLE OTA 协议版本不匹配');
            if (manifest.filename !== firmwareFile.name) errors.push('清单文件名与镜像不匹配');
            if (!Number.isSafeInteger(firmwareFile.size) || firmwareFile.size < 1 || firmwareFile.size > MAX_OTA_IMAGE_BYTES) errors.push('镜像长度超过 OTA 分区可接受范围');
            if (Number(manifest.size) !== firmwareFile.size) errors.push('清单长度与镜像不匹配');
            if (!/^[a-f0-9]{64}$/i.test(String(manifest.sha256 || ''))) errors.push('SHA-256 格式无效');
            if (!/^[a-zA-Z0-9._-]+\.bin$/.test(firmwareFile.name)) errors.push('镜像文件名不安全');
            var digest = await global.crypto.subtle.digest('SHA-256', await firmwareFile.arrayBuffer());
            var actualHash = bytesToHex(digest);
            if (actualHash !== String(manifest.sha256 || '').toLowerCase()) errors.push('SHA-256 校验失败');
            var signature = await verifyPinnedSignature(manifest);
            if (!signature.ok) errors.push(signature.reason);
            if (errors.length) throw new Error(errors.join('；'));
            state.ota.valid = true;
            if (note) { note.textContent = '本地校验通过：' + manifest.version + ' · ' + state.profile.displayName + ' · SHA-256 ' + actualHash.slice(0, 12) + '…'; note.className = 'validation-note valid'; }
            if (lock) { lock.textContent = '签名已确认'; lock.classList.remove('locked'); }
            setText('ota-status', '可以开始安全刷写');
            log('info', '固件清单、长度、哈希和签名门禁全部通过。');
        } catch (error) {
            if (note) { note.textContent = error.message || '固件包校验失败'; note.className = 'validation-note invalid'; }
            if (lock) { lock.textContent = '刷写已锁定'; lock.classList.add('locked'); }
            setText('ota-status', '等待可验证的正式包');
            log('warn', '固件包未通过刷写门禁：' + (error.message || 'validation_failed'));
        }
        setConnectedControls();
        return state.ota.valid;
    }

    function updateOtaProgress(message, progress) {
        setText('ota-status', message);
        setText('ota-progress', Math.max(0, Math.min(100, progress)) + '%');
        var bar = byId('ota-progress-bar');
        if (bar) bar.style.width = Math.max(0, Math.min(100, progress)) + '%';
    }

    async function startOta(event) {
        event.preventDefault();
        if (!state.ota.valid || !isConnected() || state.busy) return;
        var manifest = state.ota.manifest;
        if (!global.confirm('确认给 ' + state.profile.displayName + ' 写入 ' + manifest.version + '？设备会重启，过程中请保持页面打开。')) return;
        state.busy = true;
        beginReconnectExpectation();
        state.operation = '固件升级';
        state.ota.bytesSent = 0;
        setConnectedControls();
        setPhase('transferring', '正在写入固件', 'BLE 会按 192 B 数据分块写入；请保持设备和页面靠近。');
        updateOtaProgress('准备写入 ' + manifest.version, 0);
        try {
            var bytes = new Uint8Array(await state.ota.firmwareFile.arrayBuffer());
            await sendCommand(COMMANDS.OTA_LEN, [
                (bytes.length >>> 24) & 0xFF,
                (bytes.length >>> 16) & 0xFF,
                (bytes.length >>> 8) & 0xFF,
                bytes.length & 0xFF
            ]);
            for (var offset = 0; offset < bytes.length; offset += P.CHUNK_SIZE) {
                var chunk = bytes.slice(offset, Math.min(offset + P.CHUNK_SIZE, bytes.length));
                await writePacket(P.createPacket(COMMANDS.OTA_DATA, chunk), P.DATA_DELAY);
                state.ota.bytesSent = offset + chunk.length;
                updateOtaProgress('写入中 ' + state.ota.bytesSent + ' / ' + bytes.length + ' B', Math.round(state.ota.bytesSent * 100 / bytes.length));
            }
            await sendCommand(COMMANDS.OTA_STOP);
            updateOtaProgress('固件已写入，等待重新广播与状态确认', 100);
            setPhase('device_state_uncertain', '等待设备重新广播', 'OTA_STOP 已发送；只有重新连接并成功回读后，才会显示升级完成。');
            setConnectionStatus('固件已写入 · 待确认', '设备正在重启，页面不会提前宣布成功。', 'warn');
            showMessage('固件已写入，等待设备重新广播与状态确认。', 'warn', 9000);
            log('warn', 'OTA_STOP 已发送；进入重新广播和状态确认阶段。');
            beginReconnectWatch();
        } catch (error) {
            state.ota.valid = false;
            setConnectedControls();
            if (state.ota.bytesSent > 0) {
                setPhase('device_state_uncertain', '固件传输中断，状态待确认', '不要断电；让设备重新广播后重新获取状态，并确认当前固件版本。');
                log('error', 'OTA 在 ' + state.ota.bytesSent + ' B 处中断：' + (error.message || 'write_failed'));
                showMessage('固件传输中断，设备状态待确认。', 'error', 9000);
                beginReconnectWatch();
            } else {
                clearReconnectExpectation();
                setPhase('failed', '固件没有写入', '文件仍保留在本地，可以检查连接后重试。');
                log('error', 'OTA 没有开始：' + (error.message || 'write_failed'));
                showMessage('固件没有写入：' + (error.message || 'write_failed'), 'error');
            }
        } finally {
            state.busy = false;
            setConnectedControls();
        }
    }

    function bind() {
        updateBrowserCapabilities();
        setPhase('idle');
        updateStatusCards();
        byId('scan-button')?.addEventListener('click', scanDevice);
        byId('disconnect-button')?.addEventListener('click', disconnectDevice);
        byId('reconnect-button')?.addEventListener('click', reconnectExisting);
        byId('refresh-button')?.addEventListener('click', function () { refreshDeviceState(); });
        byId('network-form')?.addEventListener('submit', saveNetwork);
        byId('wifi-connect-button')?.addEventListener('click', function () { wifiAction(COMMANDS.WIFI_CONNECT, 'Wi-Fi 连接'); });
        byId('wifi-disconnect-button')?.addEventListener('click', function () { wifiAction(COMMANDS.WIFI_DISCONNECT, 'Wi-Fi 断开'); });
        byId('clear-network-button')?.addEventListener('click', clearNetwork);
        byId('reboot-button')?.addEventListener('click', function () { maintenanceCommand(COMMANDS.REBOOT, '重启', '确认重启花生片吗？网络和照片设置会保留。'); });
        byId('reset-button')?.addEventListener('click', function () { maintenanceCommand(COMMANDS.RESET, '恢复出厂', '确认恢复出厂吗？设备会清除参数并重启，操作不可在此页面撤销。'); });
        byId('manifest-input')?.addEventListener('change', function (event) { state.ota.manifestFile = event.target.files[0] || null; setText('manifest-name', state.ota.manifestFile ? state.ota.manifestFile.name : '尚未选择'); validateOtaPackage(); });
        byId('firmware-input')?.addEventListener('change', function (event) { state.ota.firmwareFile = event.target.files[0] || null; setText('firmware-name', state.ota.firmwareFile ? state.ota.firmwareFile.name : '尚未选择'); validateOtaPackage(); });
        byId('ota-form')?.addEventListener('submit', startOta);
        setConnectedControls();
        log('info', '花生片设备工具已打开。');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
}(window, document));
