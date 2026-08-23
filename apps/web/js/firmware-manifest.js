/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 *
 * Browser-side shape checks for a Penaup BLE OTA release manifest.
 * Signature verification stays in device-tool.js because the pinned public
 * key is a deployment concern; this file keeps the schema and file binding
 * rules identical between the page and its Node contract tests.
 */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PenaupFirmwareManifest = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var MODEL_KEYS = ['PENAUP_STD', 'PENAUP_PRO', 'PENAUP_MAX'];
    var VERSION_PATTERN = /^v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
    var FILENAME_PATTERN = /^[A-Za-z0-9._-]+\.bin$/;
    var HASH_PATTERN = /^[a-fA-F0-9]{64}$/;
    var KEY_ID_PATTERN = /^poboll-[A-Za-z0-9._-]+$/;
    var MESSAGE_PATTERN = /^penaup-firmware-v1:[a-fA-F0-9]{64}$/;
    var BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
    var ALLOWED_KEYS = {
        schema: true,
        product: true,
        release_status: true,
        version: true,
        models: true,
        protocol: true,
        filename: true,
        size: true,
        sha256: true,
        created_at: true,
        signature: true
    };
    var SIGNATURE_KEYS = { algorithm: true, key_id: true, message: true, value: true };

    function isObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function hasOnlyAllowedKeys(value) {
        return Object.keys(value).every(function (key) { return ALLOWED_KEYS[key] === true; });
    }

    function hasOnlySignatureKeys(value) {
        return Object.keys(value).every(function (key) { return SIGNATURE_KEYS[key] === true; });
    }

    function isSafePositiveInteger(value) {
        return Number.isSafeInteger(value) && value > 0;
    }

    function base64ByteLength(value) {
        if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) return 0;
        var padding = value.endsWith('==') ? 2 : (value.endsWith('=') ? 1 : 0);
        return (value.length / 4) * 3 - padding;
    }

    function validate(manifest, context) {
        context = context || {};
        var errors = [];
        var maxImageBytes = Number.isSafeInteger(context.maxImageBytes) && context.maxImageBytes > 0
            ? context.maxImageBytes
            : 1536 * 1024;

        if (!isObject(manifest)) return { ok: false, errors: ['发布清单必须是 JSON 对象'] };
        if (!hasOnlyAllowedKeys(manifest)) errors.push('清单包含未允许的字段');
        if (manifest.schema !== 'penaup-firmware-manifest/v1') errors.push('清单 schema 不匹配');
        if (manifest.product !== 'penaup') errors.push('不是 Penaup 固件');
        if (manifest.release_status !== 'draft' && manifest.release_status !== 'published') errors.push('release_status 必须是 draft 或 published');
        if (typeof manifest.version !== 'string' || !VERSION_PATTERN.test(manifest.version)) errors.push('版本号必须类似 v1.0.0');
        if (!Array.isArray(manifest.models) || manifest.models.length < 1) {
            errors.push('models 必须包含至少一个 Penaup 机型');
        } else {
            if (new Set(manifest.models).size !== manifest.models.length) errors.push('models 不能重复');
            if (manifest.models.some(function (model) { return MODEL_KEYS.indexOf(model) === -1; })) errors.push('models 包含未知机型');
            if (context.profileKey && manifest.models.indexOf(context.profileKey) === -1) errors.push('固件型号与当前设备不匹配');
        }
        if (manifest.protocol !== 'ble-v1') errors.push('BLE OTA 协议版本不匹配');
        if (typeof manifest.filename !== 'string' || !FILENAME_PATTERN.test(manifest.filename)) errors.push('清单 filename 不是安全的 .bin 文件名');
        if (context.firmwareName !== undefined && manifest.filename !== context.firmwareName) errors.push('清单文件名与镜像不匹配');
        if (!isSafePositiveInteger(manifest.size) || manifest.size > maxImageBytes) errors.push('清单 size 超过 OTA 分区可接受范围');
        if (context.firmwareSize !== undefined && manifest.size !== context.firmwareSize) errors.push('清单长度与镜像不匹配');
        if (typeof manifest.sha256 !== 'string' || !HASH_PATTERN.test(manifest.sha256)) errors.push('SHA-256 格式无效');
        if (manifest.created_at !== undefined && (typeof manifest.created_at !== 'string' || !Number.isFinite(Date.parse(manifest.created_at)))) errors.push('created_at 不是有效时间');

        if (manifest.release_status === 'published') {
            var signature = manifest.signature;
            if (!isObject(signature)) {
                errors.push('published 清单必须包含签名');
            } else {
                if (!hasOnlySignatureKeys(signature)) errors.push('签名包含未允许的字段');
                if (signature.algorithm !== 'Ed25519') errors.push('签名算法必须是 Ed25519');
                if (typeof signature.key_id !== 'string' || !KEY_ID_PATTERN.test(signature.key_id)) errors.push('签名 key_id 无效');
                if (typeof signature.message !== 'string' || !MESSAGE_PATTERN.test(signature.message)) errors.push('签名消息格式无效');
                if (typeof signature.value !== 'string' || !BASE64_PATTERN.test(signature.value) || base64ByteLength(signature.value) !== 64) errors.push('Ed25519 签名值无效');
                if (typeof manifest.sha256 === 'string' && HASH_PATTERN.test(manifest.sha256) && signature.message !== 'penaup-firmware-v1:' + manifest.sha256.toLowerCase()) {
                    errors.push('签名消息与固件 SHA-256 不一致');
                }
            }
        }

        return { ok: errors.length === 0, errors: errors };
    }

    return Object.freeze({
        MODEL_KEYS: MODEL_KEYS.slice(),
        validate: validate
    });
}));
