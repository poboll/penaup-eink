/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
/* Generated browser/WeChat build of packages/film-core/src/index.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PenaupFilmCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FILM_HEADER_SIZE = 32;
  var FILM_COLOR_COUNT = 6;
  // Six physical indexes can form more perceived tones through rendering.
  var COLOR_FEEL_LAYERS = 8;
  var PERCEIVED_COLOR_FEEL_COUNT = FILM_COLOR_COUNT * COLOR_FEEL_LAYERS;
  var COLOR_RENDERING_MODES = ['layer', 'dots', 'dither'];
  var BLE_CHUNK_SIZE = 192;
  var COLOR_TABLE = [0x00, 0xff, 0xfc, 0xe0, 0x03, 0x1c];
  var EPD_COLOR_CODES = [0x00, 0x11, 0x22, 0x33, 0x55, 0x66];
  var PALETTE = [
    { id: 'black', name: '黑色', hex: '#000000', r: 0, g: 0, b: 0, index: 0, value: 0x00, epdCode: 0x00 },
    { id: 'white', name: '白色', hex: '#ffffff', r: 255, g: 255, b: 255, index: 1, value: 0xff, epdCode: 0x11 },
    { id: 'yellow', name: '黄色', hex: '#ffd400', r: 255, g: 212, b: 0, index: 2, value: 0xfc, epdCode: 0x22 },
    { id: 'red', name: '红色', hex: '#e00028', r: 224, g: 0, b: 40, index: 3, value: 0xe0, epdCode: 0x33 },
    { id: 'blue', name: '蓝色', hex: '#165dff', r: 22, g: 93, b: 255, index: 4, value: 0x03, epdCode: 0x55 },
    { id: 'green', name: '绿色', hex: '#29cc14', r: 41, g: 204, b: 20, index: 5, value: 0x1c, epdCode: 0x66 }
  ];
  var profiles = [
    { id: 'std', key: 'PENAUP_STD', aliases: ['PENAUP', 'PENAUPSTD', 'STD', 'FRAMEFILM', 'FRAMEFILMSTD', '600X400'], displayName: '花生片', modelName: 'Penaup STD', screenWidth: 600, screenHeight: 400, canvasWidth: 400, canvasHeight: 600, pixelLayout: 'rotated', bodySize: 120000, totalSize: 120032, panel: 'E6 3.6 inch' },
    { id: 'pro', key: 'PENAUP_PRO', aliases: ['PENAUPPRO', 'PRO', 'FRAMEFILMPRO', '792X528'], displayName: '花生片 Pro', modelName: 'Penaup Pro', screenWidth: 792, screenHeight: 528, canvasWidth: 528, canvasHeight: 792, pixelLayout: 'row-major', bodySize: 209088, totalSize: 209120, panel: 'E6 3.68 inch' },
    { id: 'max', key: 'PENAUP_MAX', aliases: ['PENAUPMAX', 'MAX', 'FRAMEFILMMAX', '1200X1600', '1600X1200'], displayName: '花生片 Max', modelName: 'Penaup Max', screenWidth: 1200, screenHeight: 1600, canvasWidth: 1200, canvasHeight: 1600, pixelLayout: 'row-major', bodySize: 960000, totalSize: 960032, panel: 'E6 7.09 inch dual panel' }
  ];
  var aliases = {};
  var PROFILES = {};
  profiles.forEach(function (profile) {
    PROFILES[profile.key] = profile;
    aliases[profile.key] = profile.key;
    aliases[profile.id.toUpperCase()] = profile.key;
    profile.aliases.forEach(function (alias) { aliases[alias] = profile.key; });
  });
  var TRANSFER_PHASES = ['idle', 'preparing', 'discovering', 'connecting', 'handshaking', 'transferring', 'refreshing', 'succeeded', 'failed', 'device_state_uncertain'];
  var TERMINAL_TRANSFER_PHASES = ['succeeded', 'failed', 'device_state_uncertain'];
  var TRANSFER_PHASE_ORDER = {
    idle: 0,
    preparing: 1,
    discovering: 2,
    connecting: 3,
    handshaking: 4,
    transferring: 5,
    refreshing: 6,
    succeeded: 7,
    failed: 7,
    device_state_uncertain: 7
  };

  function normalizeProfileKey(value) {
    var normalized = String(value || 'PENAUP_STD').trim().toUpperCase().replace(/[ -]/g, '');
    return aliases[normalized] || 'PENAUP_STD';
  }
  function getProfile(value) { if (value && typeof value === 'object' && value.key && PROFILES[value.key]) return PROFILES[value.key]; return PROFILES[normalizeProfileKey(value)]; }
  function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('film data must be an ArrayBuffer or Uint8Array');
  }
  function pixelIndex(x, y, profileOrKey) {
    var profile = getProfile(profileOrKey);
    if (x % 1 || y % 1 || x < 0 || y < 0 || x >= profile.screenWidth || y >= profile.screenHeight) throw new RangeError('pixel coordinate outside film profile');
    return profile.pixelLayout === 'rotated' ? (x * profile.screenHeight) + (profile.screenHeight - 1 - y) : (y * profile.screenWidth) + x;
  }
  function createFilmHeader(profileOrKey) {
    var profile = getProfile(profileOrKey);
    var header = new Uint8Array(FILM_HEADER_SIZE);
    var view = new DataView(header.buffer);
    view.setUint32(0, profile.bodySize, true);
    view.setUint16(4, profile.screenWidth, true);
    view.setUint16(6, profile.screenHeight, true);
    header[8] = FILM_COLOR_COUNT;
    header.set(COLOR_TABLE, 0x10);
    return header;
  }
  function createFilmFile(profileOrKey, pixelData) {
    var profile = getProfile(profileOrKey);
    var pixels = asBytes(pixelData);
    if (pixels.byteLength !== profile.bodySize) throw new RangeError('film pixel data size mismatch');
    var file = new Uint8Array(profile.totalSize);
    file.set(createFilmHeader(profile), 0);
    file.set(pixels, FILM_HEADER_SIZE);
    return file;
  }
  function parseFilmHeader(input) {
    var bytes = asBytes(input);
    if (bytes.byteLength < FILM_HEADER_SIZE) throw new RangeError('film header required');
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { fileSize: view.getUint32(0, true), screenWidth: view.getUint16(4, true), screenHeight: view.getUint16(6, true), colorCount: bytes[8], colorTable: Array.prototype.slice.call(bytes.slice(0x10, 0x20)) };
  }
  function validateFilmBuffer(input, expectedProfile) {
    var bytes;
    try { bytes = asBytes(input); } catch (error) { return { valid: false, error: 'film_data_required' }; }
    if (bytes.byteLength < FILM_HEADER_SIZE) return { valid: false, error: 'film_header_required' };
    var header = parseFilmHeader(bytes);
    var profile = null;
    for (var profileIndex = 0; profileIndex < profiles.length; profileIndex += 1) {
      if (profiles[profileIndex].screenWidth === header.screenWidth && profiles[profileIndex].screenHeight === header.screenHeight) {
        profile = PROFILES[profiles[profileIndex].key];
        break;
      }
    }
    var expectedKey = expectedProfile == null ? null : aliases[String(expectedProfile || '').trim().toUpperCase().replace(/[ -]/g, '')] || null;
    if (!profile || (expectedProfile != null && (!expectedKey || profile.key !== expectedKey))) return { valid: false, error: 'film_profile_unsupported', header: header };
    if (header.colorCount !== FILM_COLOR_COUNT) return { valid: false, error: 'film_color_count_unsupported', header: header, profile: profile };
    if (header.fileSize !== profile.bodySize || bytes.byteLength !== profile.totalSize) return { valid: false, error: 'film_size_mismatch', header: header, profile: profile };
    for (var index = 0; index < COLOR_TABLE.length; index += 1) if (header.colorTable[index] !== COLOR_TABLE[index]) return { valid: false, error: 'film_color_table_mismatch', header: header, profile: profile };
    var pixels = bytes.slice(FILM_HEADER_SIZE);
    for (var i = 0; i < pixels.length; i += 1) if ((pixels[i] >> 4) > 5 || (pixels[i] & 15) > 5) return { valid: false, error: 'film_palette_index_invalid', header: header, profile: profile, byteOffset: i };
    return { valid: true, header: header, profile: profile, pixels: pixels };
  }
  function packColorIndexes(indexes) {
    var source = Array.prototype.slice.call(indexes || []);
    var result = new Uint8Array(Math.ceil(source.length / 2));
    source.forEach(function (value, index) {
      var colorIndex = Number(value);
      if (colorIndex % 1 || colorIndex < 0 || colorIndex > 5) throw new RangeError('film palette index must be 0..5');
      if (index % 2 === 0) result[index >> 1] = colorIndex << 4;
      else result[index >> 1] |= colorIndex;
    });
    return result;
  }
  function unpackColorIndexes(pixelData) {
    var bytes = asBytes(pixelData);
    var result = new Uint8Array(bytes.length * 2);
    bytes.forEach(function (value, index) { result[index * 2] = value >> 4; result[index * 2 + 1] = value & 15; });
    return result;
  }
  function isTerminalTransferPhase(phase) {
    return TERMINAL_TRANSFER_PHASES.indexOf(phase) >= 0;
  }
  function isTransferPhaseAdvance(currentPhase, nextPhase) {
    if (TRANSFER_PHASES.indexOf(currentPhase) < 0 || TRANSFER_PHASES.indexOf(nextPhase) < 0) return false;
    return TRANSFER_PHASE_ORDER[nextPhase] >= TRANSFER_PHASE_ORDER[currentPhase];
  }
  function toTransferEvent(input) {
    input = input || {};
    var phase = TRANSFER_PHASES.indexOf(input.phase) >= 0 ? input.phase : 'idle';
    var number = function (value) { return Math.max(0, Number(value) || 0); };
    return { transfer_id: String(input.transfer_id || input.transferId || ''), device_id: String(input.device_id || input.deviceId || ''), phase: phase, completed_bytes: number(input.completed_bytes == null ? input.completedBytes : input.completed_bytes), total_bytes: number(input.total_bytes == null ? input.totalBytes : input.total_bytes), progress_hint: Math.max(0, Math.min(1, Number(input.progress_hint == null ? input.progressHint : input.progress_hint) || 0)), outcome: input.outcome || (phase === 'succeeded' ? 'success' : phase === 'failed' ? 'failure' : phase === 'device_state_uncertain' ? 'uncertain' : 'pending'), detail: String(input.detail || ''), updated_at: input.updated_at || input.updatedAt || new Date().toISOString(), card_title: String(input.card_title || input.cardTitle || '花生片正在显影'), rendering_detail: String(input.rendering_detail || input.renderingDetail || '') };
  }
  return { FILM_HEADER_SIZE: FILM_HEADER_SIZE, FILM_COLOR_COUNT: FILM_COLOR_COUNT, COLOR_FEEL_LAYERS: COLOR_FEEL_LAYERS, PERCEIVED_COLOR_FEEL_COUNT: PERCEIVED_COLOR_FEEL_COUNT, COLOR_RENDERING_MODES: COLOR_RENDERING_MODES, BLE_CHUNK_SIZE: BLE_CHUNK_SIZE, COLOR_TABLE: COLOR_TABLE, EPD_COLOR_CODES: EPD_COLOR_CODES, PALETTE: PALETTE, PROFILES: PROFILES, TRANSFER_PHASES: TRANSFER_PHASES, TERMINAL_TRANSFER_PHASES: TERMINAL_TRANSFER_PHASES, normalizeProfileKey: normalizeProfileKey, getProfile: getProfile, pixelIndex: pixelIndex, createFilmHeader: createFilmHeader, createFilmFile: createFilmFile, parseFilmHeader: parseFilmHeader, validateFilmBuffer: validateFilmBuffer, packColorIndexes: packColorIndexes, unpackColorIndexes: unpackColorIndexes, toTransferEvent: toTransferEvent, isTerminalTransferPhase: isTerminalTransferPhase, isTransferPhaseAdvance: isTransferPhaseAdvance };
}));
