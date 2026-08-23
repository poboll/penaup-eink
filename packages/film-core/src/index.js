/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 *
 * Penaup .film contract. Keep this file independent from DOM, Node and
 * WeChat APIs so every client can consume the same binary contract.
 */

export const FILM_HEADER_SIZE = 32;
export const FILM_COLOR_COUNT = 6;
// The panel still stores six physical indexes. Rendering combinations create
// additional perceived tones without changing the .film binary contract.
export const COLOR_FEEL_LAYERS = 8;
export const PERCEIVED_COLOR_FEEL_COUNT = FILM_COLOR_COUNT * COLOR_FEEL_LAYERS;
export const COLOR_RENDERING_MODES = Object.freeze(['layer', 'dots', 'dither']);
export const COLOR_RENDERING_MODE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'layer',
    label: '叠色层次',
    shortLabel: '叠色',
    description: '用自适应显影保留柔和的明暗过渡，六色基底最多形成 48 种色彩观感。',
    ditherType: 'adaptive',
    defaultStrength: 1
  }),
  Object.freeze({
    id: 'dots',
    label: '网点',
    shortLabel: '网点',
    description: '用有序色点铺开中间调，颗粒更清楚；六色基底最多形成 48 种色彩观感。',
    ditherType: 'bayer',
    defaultStrength: 1.1
  }),
  Object.freeze({
    id: 'dither',
    label: '抖动',
    shortLabel: '抖动',
    description: '把误差分散到邻近像素，尽量保留细节；六色基底最多形成 48 种色彩观感。',
    ditherType: 'floydSteinberg',
    defaultStrength: 1
  })
]);
export const BLE_CHUNK_SIZE = 192;

// The table stores the legacy file-level source values. The firmware maps
// these values to its six EPD output codes while refreshing the panel.
export const COLOR_TABLE = Object.freeze([
  0x00, // black
  0xff, // white
  0xfc, // yellow
  0xe0, // red
  0x03, // blue
  0x1c  // green
]);

export const EPD_COLOR_CODES = Object.freeze([
  0x00, 0x11, 0x22, 0x33, 0x55, 0x66
]);

export const PALETTE = Object.freeze([
  Object.freeze({ id: 'black', name: '黑色', hex: '#000000', r: 0, g: 0, b: 0, index: 0, value: 0x00, epdCode: 0x00 }),
  Object.freeze({ id: 'white', name: '白色', hex: '#ffffff', r: 255, g: 255, b: 255, index: 1, value: 0xff, epdCode: 0x11 }),
  Object.freeze({ id: 'yellow', name: '黄色', hex: '#ffd400', r: 255, g: 212, b: 0, index: 2, value: 0xfc, epdCode: 0x22 }),
  Object.freeze({ id: 'red', name: '红色', hex: '#e00028', r: 224, g: 0, b: 40, index: 3, value: 0xe0, epdCode: 0x33 }),
  Object.freeze({ id: 'blue', name: '蓝色', hex: '#165dff', r: 22, g: 93, b: 255, index: 4, value: 0x03, epdCode: 0x55 }),
  Object.freeze({ id: 'green', name: '绿色', hex: '#29cc14', r: 41, g: 204, b: 20, index: 5, value: 0x1c, epdCode: 0x66 })
]);

const PROFILE_LIST = [
  {
    id: 'std',
    key: 'PENAUP_STD',
    aliases: ['PENAUP', 'PENAUPSTD', 'STD', 'FRAMEFILM', 'FRAMEFILMSTD', '600X400'],
    displayName: '花生片',
    modelName: 'Penaup STD',
    screenWidth: 600,
    screenHeight: 400,
    canvasWidth: 400,
    canvasHeight: 600,
    pixelLayout: 'rotated',
    bodySize: 120000,
    totalSize: 120032,
    panel: 'E6 3.6 inch'
  },
  {
    id: 'pro',
    key: 'PENAUP_PRO',
    aliases: ['PENAUPPRO', 'PRO', 'FRAMEFILMPRO', '792X528'],
    displayName: '花生片 Pro',
    modelName: 'Penaup Pro',
    screenWidth: 792,
    screenHeight: 528,
    canvasWidth: 528,
    canvasHeight: 792,
    pixelLayout: 'row-major',
    bodySize: 209088,
    totalSize: 209120,
    panel: 'E6 3.68 inch'
  },
  {
    id: 'max',
    key: 'PENAUP_MAX',
    aliases: ['PENAUPMAX', 'MAX', 'FRAMEFILMMAX', '1200X1600', '1600X1200'],
    displayName: '花生片 Max',
    modelName: 'Penaup Max',
    screenWidth: 1200,
    screenHeight: 1600,
    canvasWidth: 1200,
    canvasHeight: 1600,
    pixelLayout: 'row-major',
    bodySize: 960000,
    totalSize: 960032,
    panel: 'E6 7.09 inch dual panel'
  }
];

export const PROFILES = Object.freeze(PROFILE_LIST.reduce((result, profile) => {
  result[profile.key] = Object.freeze({ ...profile, aliases: Object.freeze(profile.aliases.slice()) });
  return result;
}, {}));

const PROFILE_ALIASES = PROFILE_LIST.reduce((result, profile) => {
  result[profile.key] = profile.key;
  result[profile.id.toUpperCase()] = profile.key;
  profile.aliases.forEach((alias) => { result[alias] = profile.key; });
  return result;
}, {});

export const TRANSFER_PHASES = Object.freeze([
  'idle',
  'preparing',
  'discovering',
  'connecting',
  'handshaking',
  'transferring',
  'refreshing',
  'succeeded',
  'failed',
  'device_state_uncertain'
]);

export const TERMINAL_TRANSFER_PHASES = Object.freeze([
  'succeeded',
  'failed',
  'device_state_uncertain'
]);

const TRANSFER_PHASE_ORDER = Object.freeze({
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
});

function knownProfileKey(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[ -]/g, '');
  return PROFILE_ALIASES[normalized] || null;
}

export function normalizeProfileKey(value) {
  return knownProfileKey(value) || 'PENAUP_STD';
}

export function getProfile(value) {
  if (value && typeof value === 'object' && value.key && PROFILES[value.key]) return PROFILES[value.key];
  return PROFILES[normalizeProfileKey(value)];
}

export function pixelIndex(x, y, profileOrKey) {
  const profile = getProfile(profileOrKey);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= profile.screenWidth || y >= profile.screenHeight) {
    throw new RangeError('pixel coordinate outside film profile');
  }
  if (profile.pixelLayout === 'rotated') return (x * profile.screenHeight) + (profile.screenHeight - 1 - y);
  return (y * profile.screenWidth) + x;
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('film data must be an ArrayBuffer or Uint8Array');
}

export function createFilmHeader(profileOrKey) {
  const profile = getProfile(profileOrKey);
  const header = new Uint8Array(FILM_HEADER_SIZE);
  const view = new DataView(header.buffer);
  view.setUint32(0, profile.bodySize, true);
  view.setUint16(4, profile.screenWidth, true);
  view.setUint16(6, profile.screenHeight, true);
  header[8] = FILM_COLOR_COUNT;
  header.set(COLOR_TABLE, 0x10);
  return header;
}

export function createFilmFile(profileOrKey, pixelData) {
  const profile = getProfile(profileOrKey);
  const pixels = toUint8Array(pixelData);
  if (pixels.byteLength !== profile.bodySize) throw new RangeError('film pixel data size mismatch');
  const file = new Uint8Array(profile.totalSize);
  file.set(createFilmHeader(profile), 0);
  file.set(pixels, FILM_HEADER_SIZE);
  return file;
}

export function parseFilmHeader(input) {
  const bytes = toUint8Array(input);
  if (bytes.byteLength < FILM_HEADER_SIZE) throw new RangeError('film header required');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colorTable = Array.from(bytes.slice(0x10, 0x20));
  return {
    fileSize: view.getUint32(0, true),
    screenWidth: view.getUint16(4, true),
    screenHeight: view.getUint16(6, true),
    colorCount: bytes[8],
    colorTable
  };
}

export function validateFilmBuffer(input, expectedProfile) {
  let bytes;
  try { bytes = toUint8Array(input); } catch (error) { return { valid: false, error: 'film_data_required' }; }
  if (bytes.byteLength < FILM_HEADER_SIZE) return { valid: false, error: 'film_header_required' };
  const header = parseFilmHeader(bytes);
  const profileDefinition = PROFILE_LIST.find((candidate) => candidate.screenWidth === header.screenWidth && candidate.screenHeight === header.screenHeight);
  const profile = profileDefinition ? PROFILES[profileDefinition.key] : null;
  const expectedKey = expectedProfile == null ? null : knownProfileKey(expectedProfile);
  if (!profile || (expectedProfile != null && (!expectedKey || profile.key !== expectedKey))) {
    return { valid: false, error: 'film_profile_unsupported', header };
  }
  if (header.colorCount !== FILM_COLOR_COUNT) return { valid: false, error: 'film_color_count_unsupported', header, profile };
  if (header.fileSize !== profile.bodySize || bytes.byteLength !== profile.totalSize) {
    return { valid: false, error: 'film_size_mismatch', header, profile };
  }
  for (let index = 0; index < COLOR_TABLE.length; index += 1) {
    if (header.colorTable[index] !== COLOR_TABLE[index]) return { valid: false, error: 'film_color_table_mismatch', header, profile };
  }
  const pixels = bytes.slice(FILM_HEADER_SIZE);
  for (let index = 0; index < pixels.length; index += 1) {
    if ((pixels[index] >> 4) > 5 || (pixels[index] & 0x0f) > 5) {
      return { valid: false, error: 'film_palette_index_invalid', header, profile, byteOffset: index };
    }
  }
  return { valid: true, header, profile, pixels };
}

export function packColorIndexes(indexes) {
  const source = Array.from(indexes || []);
  const result = new Uint8Array(Math.ceil(source.length / 2));
  source.forEach((value, index) => {
    const colorIndex = Number(value);
    if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex > 5) throw new RangeError('film palette index must be 0..5');
    if (index % 2 === 0) result[index >> 1] = colorIndex << 4;
    else result[index >> 1] |= colorIndex;
  });
  return result;
}

export function unpackColorIndexes(pixelData) {
  const bytes = toUint8Array(pixelData);
  const result = new Uint8Array(bytes.length * 2);
  bytes.forEach((value, index) => {
    result[index * 2] = value >> 4;
    result[index * 2 + 1] = value & 0x0f;
  });
  return result;
}

export function toTransferEvent(input = {}) {
  const phase = TRANSFER_PHASES.includes(input.phase) ? input.phase : 'idle';
  return {
    transfer_id: String(input.transfer_id || input.transferId || ''),
    device_id: String(input.device_id || input.deviceId || ''),
    phase,
    completed_bytes: Math.max(0, Number(input.completed_bytes ?? input.completedBytes ?? 0) || 0),
    total_bytes: Math.max(0, Number(input.total_bytes ?? input.totalBytes ?? 0) || 0),
    progress_hint: Math.max(0, Math.min(1, Number(input.progress_hint ?? input.progressHint ?? 0) || 0)),
    outcome: input.outcome || (phase === 'succeeded' ? 'success' : phase === 'failed' ? 'failure' : phase === 'device_state_uncertain' ? 'uncertain' : 'pending'),
    detail: String(input.detail || ''),
    updated_at: input.updated_at || input.updatedAt || new Date().toISOString(),
    card_title: String(input.card_title || input.cardTitle || '花生片正在显影'),
    rendering_detail: String(input.rendering_detail || input.renderingDetail || '')
  };
}

export function isTerminalTransferPhase(phase) {
  return TERMINAL_TRANSFER_PHASES.includes(phase);
}

export function isTransferPhaseAdvance(currentPhase, nextPhase) {
  if (!TRANSFER_PHASES.includes(currentPhase) || !TRANSFER_PHASES.includes(nextPhase)) return false;
  return TRANSFER_PHASE_ORDER[nextPhase] >= TRANSFER_PHASE_ORDER[currentPhase];
}
