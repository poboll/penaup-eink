import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLOR_TABLE,
  COLOR_FEEL_LAYERS,
  FILM_HEADER_SIZE,
  FILM_COLOR_COUNT,
  PERCEIVED_COLOR_FEEL_COUNT,
  COLOR_RENDERING_MODES,
  COLOR_RENDERING_MODE_DEFINITIONS,
  getProfile,
  createFilmFile,
  validateFilmBuffer,
  pixelIndex,
  toTransferEvent
} from '../src/index.js';

test('six physical colors expose the shared 48-feel rendering contract', () => {
  assert.equal(FILM_COLOR_COUNT, 6);
  assert.equal(COLOR_FEEL_LAYERS, 8);
  assert.equal(PERCEIVED_COLOR_FEEL_COUNT, 48);
  assert.deepEqual(COLOR_RENDERING_MODES, ['layer', 'dots', 'dither']);
  assert.deepEqual(COLOR_RENDERING_MODE_DEFINITIONS.map((mode) => mode.id), COLOR_RENDERING_MODES);
  assert.equal(COLOR_RENDERING_MODE_DEFINITIONS[1].ditherType, 'bayer');
  assert.ok(COLOR_RENDERING_MODE_DEFINITIONS.every((mode) => mode.description.includes('48')));
});

test('all Penaup profiles produce and validate the documented sizes', () => {
  for (const key of ['PENAUP_STD', 'PENAUP_PRO', 'PENAUP_MAX']) {
    const profile = getProfile(key);
    const file = createFilmFile(profile, new Uint8Array(profile.bodySize));
    const checked = validateFilmBuffer(file, key);
    assert.equal(file.byteLength, profile.totalSize);
    assert.equal(checked.valid, true);
    assert.deepEqual(checked.header.colorTable.slice(0, 6), COLOR_TABLE);
  }
});

test('legacy profile aliases and STD rotated index remain compatible', () => {
  assert.equal(getProfile('FrameFilmPro').key, 'PENAUP_PRO');
  assert.equal(getProfile('1600 x 1200').key, 'PENAUP_MAX');
  assert.equal(pixelIndex(0, 0, 'STD'), 399);
  assert.equal(pixelIndex(0, 399, 'STD'), 0);
});

test('film validator rejects malformed headers and palette nibbles', () => {
  const profile = getProfile('std');
  const file = createFilmFile(profile, new Uint8Array(profile.bodySize));
  file[8] = 5;
  assert.equal(validateFilmBuffer(file).error, 'film_color_count_unsupported');
  file[8] = 6;
  file[FILM_HEADER_SIZE] = 0xf0;
  assert.equal(validateFilmBuffer(file).error, 'film_palette_index_invalid');
});

test('film validator rejects unknown dimensions instead of defaulting to STD', () => {
  const file = createFilmFile('std', new Uint8Array(getProfile('std').bodySize));
  file[4] = 1;
  file[5] = 0;
  file[6] = 1;
  file[7] = 0;
  assert.equal(validateFilmBuffer(file).error, 'film_profile_unsupported');
});

test('transfer event is safe for iOS Live Activity mapping', () => {
  const event = toTransferEvent({ transferId: 't-1', deviceId: 'd-1', phase: 'device_state_uncertain', completedBytes: 5, totalBytes: 10 });
  assert.deepEqual(event, {
    transfer_id: 't-1', device_id: 'd-1', phase: 'device_state_uncertain', completed_bytes: 5, total_bytes: 10,
    progress_hint: 0, outcome: 'uncertain', detail: '', updated_at: event.updated_at, card_title: '花生片正在显影', rendering_detail: ''
  });
});
