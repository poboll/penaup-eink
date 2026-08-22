const assert = require('node:assert/strict');
const test = require('node:test');

const film = require('../utils/film-utils');

test('Penaup device aliases resolve to the three firmware profiles', () => {
  assert.equal(film.getDeviceTypeFromName('PENAUP'), 'PENAUP');
  assert.equal(film.getDeviceTypeFromName('FRAMEFILMPRO'), 'PENAUPPRO');
  assert.equal(film.getDeviceTypeFromName('PENAUPMAX'), 'PENAUPMAX');
  assert.equal(film.getDeviceTypeFromName('old-framefilm-max'), 'PENAUPMAX');
});

test('Max uses the firmware file orientation and exact film size', () => {
  film.setDeviceType('PENAUPMAX');
  const config = film.getDeviceConfig();
  assert.deepEqual(
    {
      screenWidth: config.screenWidth,
      screenHeight: config.screenHeight,
      canvasWidth: config.canvasWidth,
      canvasHeight: config.canvasHeight,
      pixelLayout: config.pixelLayout,
      isPortraitPanel: config.isPortraitPanel
    },
    {
      screenWidth: 1200,
      screenHeight: 1600,
      canvasWidth: 1200,
      canvasHeight: 1600,
      pixelLayout: 'row-major',
      isPortraitPanel: false
    }
  );
  assert.equal(film.getFilmFileTotalSize(), 960032);

  const header = film.generateFilmHeader();
  assert.equal(header.length, 32);
  assert.deepEqual(Array.from(header.slice(0, 9)), [0x00, 0xA6, 0x0E, 0x00, 0xB0, 0x04, 0x40, 0x06, 0x06]);
});

test('legacy default still produces the STD film size', () => {
  film.setDeviceType('FRAMEFILM');
  assert.equal(film.getDeviceType(), 'PENAUP');
  assert.equal(film.getFilmFileTotalSize(), 120032);
});
