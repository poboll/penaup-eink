/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 *
 * Browser-side namespaced BLE contract for Penaup maintenance tools.
 * FrameFilm constants remain here only as compatibility values; product UI
 * must use the Penaup name. Keep this file aligned with service_ble.h.
 */
(function (global) {
    'use strict';

    var SERVICE_UUID = '00002000-0000-1000-8000-00805f9b34fb';
    var CHARACTERISTIC_UUID = '00002001-0000-1000-8000-00805f9b34fb';
    var CMD_HEAD = 0x55;
    var CHUNK_SIZE = 192;
    var CONTROL_DELAY = 80;
    var DATA_DELAY = 8;

    var COMMANDS = Object.freeze({
        OTA_LEN: 0x10,
        OTA_DATA: 0x11,
        OTA_START: 0x12,
        OTA_STOP: 0x13,
        RESET: 0x22,
        POWER_READ: 0x23,
        REBOOT: 0x24,
        WIFI_ENABLE: 0x30,
        WIFI_ENABLE_GET: 0x31,
        WIFI_SSID: 0x32,
        WIFI_SSID_GET: 0x33,
        WIFI_PASSWORD: 0x34,
        WIFI_PASSWORD_GET: 0x35,
        FILM_API_URL: 0x36,
        FILM_API_URL_GET: 0x37,
        WIFI_CONNECT: 0x38,
        WIFI_DISCONNECT: 0x39,
        WIFI_CONNECT_GET: 0x3A,
        WIFI_CLEAR: 0x3B,
        HEARTBEAT_INTERVAL: 0x40,
        HEARTBEAT_INTERVAL_GET: 0x41
    });

    var PROFILES = Object.freeze({
        PENAUP_STD: Object.freeze({
            key: 'PENAUP_STD',
            displayName: '花生片 STD',
            width: 600,
            height: 400,
            aliases: ['PENAUP', 'FRAMEFILM']
        }),
        PENAUP_PRO: Object.freeze({
            key: 'PENAUP_PRO',
            displayName: '花生片 Pro',
            width: 792,
            height: 528,
            aliases: ['PENAUP_PRO', 'FRAMEFILMPRO']
        }),
        PENAUP_MAX: Object.freeze({
            key: 'PENAUP_MAX',
            displayName: '花生片 Max',
            width: 1200,
            height: 1600,
            aliases: ['PENAUP_MAX', 'FRAMEFILMMAX']
        })
    });

    function toUint8Array(value) {
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return new Uint8Array(value || []);
    }

    function checksum(bytes, length) {
        var data = toUint8Array(bytes);
        var end = Number.isInteger(length) ? Math.min(length, data.length) : data.length;
        var sum = 0;
        for (var i = 0; i < end; i += 1) sum = (sum + data[i]) & 0xFF;
        return sum;
    }

    function createPacket(channel, payload) {
        var data = toUint8Array(payload);
        if (data.length > 255) throw new Error('BLE 命令数据不能超过 255 字节');
        var packet = new Uint8Array(data.length + 4);
        packet[0] = CMD_HEAD;
        packet[1] = channel & 0xFF;
        packet[2] = data.length;
        packet.set(data, 3);
        packet[packet.length - 1] = checksum(packet, packet.length - 1);
        return packet;
    }

    function createCommand(channel, value) {
        if (value === undefined || value === null) return createPacket(channel, []);
        if (typeof value === 'number') return createPacket(channel, [value & 0xFF]);
        return createPacket(channel, value);
    }

    function createUint32Command(channel, value) {
        var number = Number(value);
        if (!Number.isSafeInteger(number) || number < 0 || number > 0xFFFFFFFF) {
            throw new Error('数值不在 32 位无符号范围内');
        }
        return createPacket(channel, [
            (number >>> 24) & 0xFF,
            (number >>> 16) & 0xFF,
            (number >>> 8) & 0xFF,
            number & 0xFF
        ]);
    }

    function asciiBytes(value, maxLength, includeNull) {
        var text = String(value == null ? '' : value);
        var limit = Math.max(1, Number(maxLength) || 64) - (includeNull ? 1 : 0);
        var bytes = [];
        for (var i = 0; i < text.length && bytes.length < limit; i += 1) {
            var code = text.charCodeAt(i);
            if (code < 0x20 || code > 0x7E) throw new Error('设备协议只接受 ASCII 文本');
            bytes.push(code);
        }
        if (includeNull) bytes.push(0);
        return new Uint8Array(bytes);
    }

    function decodeAscii(payload) {
        var data = toUint8Array(payload);
        var text = '';
        for (var i = 0; i < data.length && data[i] !== 0; i += 1) {
            text += String.fromCharCode(data[i]);
        }
        return text;
    }

    function parseFrame(value) {
        var data = toUint8Array(value);
        if (data.length < 4 || data[0] !== CMD_HEAD) return { valid: false, error: 'invalid_header' };
        var length = data[2];
        var total = length + 4;
        if (data.length < total) return { valid: false, error: 'incomplete_frame' };
        if (checksum(data, total - 1) !== data[total - 1]) return { valid: false, error: 'invalid_checksum' };
        return {
            valid: true,
            channel: data[1],
            length: length,
            payload: data.slice(3, 3 + length),
            raw: data.slice(0, total)
        };
    }

    function profileForName(name) {
        var upper = String(name || '').toUpperCase();
        if (upper.indexOf('MAX') !== -1) return PROFILES.PENAUP_MAX;
        if (upper.indexOf('PRO') !== -1) return PROFILES.PENAUP_PRO;
        return PROFILES.PENAUP_STD;
    }

    global.PenaupBleProtocol = Object.freeze({
        SERVICE_UUID: SERVICE_UUID,
        CHARACTERISTIC_UUID: CHARACTERISTIC_UUID,
        CMD_HEAD: CMD_HEAD,
        CHUNK_SIZE: CHUNK_SIZE,
        CONTROL_DELAY: CONTROL_DELAY,
        DATA_DELAY: DATA_DELAY,
        COMMANDS: COMMANDS,
        PROFILES: PROFILES,
        checksum: checksum,
        createPacket: createPacket,
        createCommand: createCommand,
        createUint32Command: createUint32Command,
        asciiBytes: asciiBytes,
        decodeAscii: decodeAscii,
        parseFrame: parseFrame,
        profileForName: profileForName
    });
}(window));
