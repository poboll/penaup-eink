const assert = require('node:assert/strict');
const test = require('node:test');
const FilmCore = require('../dist/film-core.umd.cjs');

test('CommonJS consumers resolve the browser film contract', () => {
  assert.equal(FilmCore.getProfile('max').totalSize, 960032);
  assert.equal(FilmCore.BLE_CHUNK_SIZE, 192);
  assert.equal(FilmCore.isTerminalTransferPhase('succeeded'), true);
  assert.equal(FilmCore.isTransferPhaseAdvance('transferring', 'refreshing'), true);
  assert.equal(FilmCore.isTransferPhaseAdvance('refreshing', 'transferring'), false);
});
