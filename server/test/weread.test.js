import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildApp } from '../src/app.js';
import { normalizeWereadSnapshot } from '../src/modules/weread.js';

function payload() {
  return {
    errcode: 0,
    readDays: 4,
    totalReadTime: 7320,
    readStat: [
      { stat: '读过的书', counts: '3' },
      { stat: '笔记', counts: '6' }
    ],
    readLongest: [
      { readTime: 3600, book: { bookId: 'book-1', title: '纸上的月光', author: '林简', cover: 'https://example.com/cover.jpg' } },
      { readTime: 1800, book: { bookId: 'book-2', title: '慢慢长大', author: '许南' } }
    ],
    readTimes: { '2026-08-18': 1800, '2026-08-19': 3600 }
  };
}

test('normalizes WeRead payload into the Pro wallpaper contract', () => {
  const snapshot = normalizeWereadSnapshot(payload(), 'monthly', new Date('2026-08-23T00:00:00.000Z'));
  assert.equal(snapshot.profile, 'PENAUP_PRO');
  assert.deepEqual(snapshot.screen, { width: 792, height: 528, panel: 'E6 3.68 inch' });
  assert.equal(snapshot.readingDays, 4);
  assert.equal(snapshot.readingMinutes, 122);
  assert.equal(snapshot.bookCount, 3);
  assert.equal(snapshot.noteCount, 6);
  assert.equal(snapshot.topBookDetails[0].title, '纸上的月光');
  assert.equal(snapshot.dailyReading[0].day, 18);
  assert.equal(snapshot.dailyReading[0].readingMinutes, 30);
  assert.doesNotMatch(JSON.stringify(snapshot), /errcode|readLongest|readTimes/);
});

test('normalizes WeRead strings with Chinese units without changing numeric seconds semantics', () => {
  const snapshot = normalizeWereadSnapshot({
    errcode: 0,
    readDays: '4天',
    totalReadTime: '120分钟',
    readStat: [
      { stat: '读过的书', counts: '3本' },
      { stat: '笔记', counts: '6条' }
    ],
    readLongest: [
      { readTime: '1小时', book: { title: '带单位的一页' } }
    ],
    readTimes: { '2026-08-18': '30分钟', '2026-08-19': '1800' }
  }, 'monthly', new Date('2026-08-23T00:00:00.000Z'));

  assert.equal(snapshot.readingMinutes, 120);
  assert.equal(snapshot.readingDays, 4);
  assert.equal(snapshot.bookCount, 3);
  assert.equal(snapshot.noteCount, 6);
  assert.equal(snapshot.topBookDetails[0].readingMinutes, 60);
  assert.equal(snapshot.dailyReading[0].readingMinutes, 30);
  assert.equal(snapshot.dailyReading[1].readingMinutes, 30);
});

test('WeRead proxy keeps the key out of the response and sends a no-store request', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-weread-'));
  const calls = [];
  const app = await buildApp({
    config: { dataDir: root, databasePath: path.join(root, 'penaup.db'), mediaDir: path.join(root, 'media'), mqttUrl: '' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, text: async () => JSON.stringify(payload()) };
    },
    logger: false
  });

  try {
    const missing = await app.inject({ method: 'POST', url: '/api/v1/integrations/weread/snapshot', payload: { mode: 'monthly' } });
    assert.equal(missing.statusCode, 400);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/weread/snapshot',
      headers: { 'x-penaup-weread-key': 'wrk-1234567890abcdef' },
      payload: { mode: 'monthly' }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json().data.profile, 'PENAUP_PRO');
    assert.doesNotMatch(response.body, /wrk-1234567890abcdef/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://i.weread.qq.com/api/agent/gateway');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer wrk-1234567890abcdef');
    assert.equal(JSON.parse(calls[0].options.body).api_name, '/readdata/detail');
    assert.equal(JSON.parse(calls[0].options.body).skill_version, '1.0.4');
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('WeRead proxy rejects malformed keys and unsupported modes before upstream access', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-weread-invalid-'));
  let called = false;
  const app = await buildApp({
    config: { dataDir: root, databasePath: path.join(root, 'penaup.db'), mediaDir: path.join(root, 'media'), mqttUrl: '' },
    fetchImpl: async () => { called = true; throw new Error('must not call'); },
    logger: false
  });
  try {
    const invalidKey = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/weread/snapshot',
      headers: { 'x-penaup-weread-key': 'not-a-key' },
      payload: { mode: 'monthly' }
    });
    assert.equal(invalidKey.statusCode, 400);
    const invalidMode = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/weread/snapshot',
      headers: { 'x-penaup-weread-key': 'wrk-1234567890abcdef' },
      payload: { mode: 'yearly' }
    });
    assert.equal(invalidMode.statusCode, 400);
    assert.equal(called, false);
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
