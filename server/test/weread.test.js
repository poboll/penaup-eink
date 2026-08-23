import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildApp } from '../src/app.js';
import {
  createWereadService,
  normalizeWereadReadingCard,
  normalizeWereadShelf,
  normalizeWereadSnapshot
} from '../src/modules/weread.js';

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

test('normalizes date-key variants and keeps shelf fields bounded', () => {
  const snapshot = normalizeWereadSnapshot({
    errcode: 0,
    month: '2026-08',
    readTimes: {
      '20260818': 1800,
      '18': 3600,
      '1755475200': 60,
      '2026-07-31': 7200
    }
  }, 'monthly', new Date('2026-08-23T00:00:00.000Z'));
  assert.deepEqual(snapshot.dailyReading, [{ day: 18, readingMinutes: 60 }]);

  const shelf = normalizeWereadShelf({
    errcode: 0,
    books: [{ bookId: 'book-1', title: '纸上的月光', author: '林简', cover: 'http://insecure.example/cover.jpg', finishReading: 1, readUpdateTime: 1755475200 }],
    albums: [{ albumInfo: { name: '一段声音', authorName: '播客', cover: 'https://example.com/audio.jpg' } }]
  });
  assert.equal(shelf.books[0].coverUrl, '');
  assert.equal(shelf.books[1].mediaType, '有声书');
  assert.equal(shelf.ebooks, 1);
});

test('keeps a selected cross-month week label and reading order', () => {
  const snapshot = normalizeWereadSnapshot({
    errcode: 0,
    readTimes: { '2026-08-31': 1800, '2026-09-01': 3600 }
  }, 'weekly', new Date('2026-09-05T00:00:00.000Z'), { weekStart: '2026-08-31' });

  assert.equal(snapshot.periodKey, '2026-08-31');
  assert.equal(snapshot.periodLabel, '本周 · 08月31日—09月06日');
  assert.deepEqual(snapshot.dailyReading, [
    { day: 31, readingMinutes: 30 },
    { day: 1, readingMinutes: 60 }
  ]);
});

test('does not allow a custom WeRead gateway to receive a key without explicit host approval', () => {
  assert.throws(
    () => createWereadService({ config: { wereadGatewayUrl: 'https://mirror.example/gateway' }, fetchImpl: async () => {} }),
    (error) => error.code === 'weread_gateway_invalid'
  );

  const service = createWereadService({
    config: {
      wereadGatewayUrl: 'https://mirror.example/gateway',
      wereadGatewayAllowedHosts: 'mirror.example'
    },
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ errcode: 0 }) })
  });
  assert.equal(service.gatewayUrl, 'https://mirror.example/gateway');
});

test('normalizes a reading card without exposing upstream response fields', () => {
  const card = normalizeWereadReadingCard(
    { errcode: 0, title: '纸上的月光', author: '林简', intro: '一段书的简介', category: '文学' },
    { errcode: 0, chapters: [{ chapterUid: 7, title: '第一章' }], updated: [{ type: 1, markText: '把日子过成一页纸。', chapterUid: 7, createTime: 1755475200 }] },
    { errcode: 0, reviews: [] },
    { errcode: 0, book: { progress: 61, recordReadingTime: 3600 } }
  );
  assert.equal(card.title, '纸上的月光');
  assert.equal(card.progress, 61);
  assert.equal(card.notes[0].chapter, '第一章');
  assert.doesNotMatch(JSON.stringify(card), /errcode|chapters|updated|recordReadingTime/);
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

test('WeRead lab exposes bounded connect, bookshelf and reading-card routes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-weread-lab-'));
  const calls = [];
  const app = await buildApp({
    config: { dataDir: root, databasePath: path.join(root, 'penaup.db'), mediaDir: path.join(root, 'media'), mqttUrl: '' },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body.api_name);
      const payloads = {
        '/shelf/sync': { errcode: 0, books: [{ bookId: 'book-1', title: '纸上的月光', author: '林简' }] },
        '/book/info': { errcode: 0, title: '纸上的月光', author: '林简', intro: '简介' },
        '/book/bookmarklist': { errcode: 0, updated: [{ type: 1, markText: '一页摘录', createTime: 1 }] },
        '/review/list/mine': { errcode: 0, reviews: [] },
        '/book/getprogress': { errcode: 0, book: { progress: 50, recordReadingTime: 60 } }
      };
      return { ok: true, status: 200, text: async () => JSON.stringify(payloads[body.api_name] || { errcode: 0 }) };
    },
    logger: false
  });
  try {
    const headers = { 'x-penaup-weread-key': 'wrk-1234567890abcdef' };
    const connect = await app.inject({ method: 'POST', url: '/api/v1/integrations/weread/connect', headers, payload: {} });
    assert.equal(connect.statusCode, 200);
    assert.deepEqual(connect.json().data.ebooks, 1);
    const shelf = await app.inject({ method: 'POST', url: '/api/v1/integrations/weread/bookshelf', headers, payload: {} });
    assert.equal(shelf.statusCode, 200);
    assert.equal(shelf.json().data.books[0].title, '纸上的月光');
    const card = await app.inject({ method: 'POST', url: '/api/v1/integrations/weread/reading-card', headers, payload: { book_id: 'book-1' } });
    assert.equal(card.statusCode, 200);
    assert.equal(card.json().data.progress, 50);
    const invalidMonth = await app.inject({ method: 'POST', url: '/api/v1/integrations/weread/snapshot', headers, payload: { mode: 'monthly', month: '2026-13' } });
    assert.equal(invalidMonth.statusCode, 400);
    assert.ok(calls.includes('/book/info'));
    assert.doesNotMatch(card.body, /wrk-1234567890abcdef/);
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('WeRead lab rejects a cross-origin request before using the key', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-weread-origin-'));
  let called = false;
  const app = await buildApp({
    config: { dataDir: root, databasePath: path.join(root, 'penaup.db'), mediaDir: path.join(root, 'media'), mqttUrl: '' },
    fetchImpl: async () => { called = true; throw new Error('must not call'); },
    logger: false
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/weread/connect',
      headers: { origin: 'https://attacker.example', host: '127.0.0.1:8787', 'x-penaup-weread-key': 'wrk-1234567890abcdef' },
      payload: {}
    });
    assert.equal(response.statusCode, 403);
    assert.equal(called, false);
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('WeRead CORS preflight advertises the temporary key header only for an allowed origin', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-weread-preflight-'));
  const app = await buildApp({
    config: {
      dataDir: root,
      databasePath: path.join(root, 'penaup.db'),
      mediaDir: path.join(root, 'media'),
      mqttUrl: '',
      allowedOrigins: 'https://studio.penaup.example'
    },
    logger: false
  });
  try {
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/integrations/weread/snapshot',
      headers: {
        origin: 'https://studio.penaup.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-penaup-weread-key, content-type'
      }
    });
    assert.equal(allowed.statusCode, 204);
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://studio.penaup.example');
    assert.match(allowed.headers['access-control-allow-headers'], /X-Penaup-WeRead-Key/);

    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/integrations/weread/snapshot',
      headers: {
        origin: 'https://attacker.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-penaup-weread-key'
      }
    });
    assert.equal(denied.statusCode, 204);
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
    assert.equal(denied.headers['access-control-allow-headers'], undefined);
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
