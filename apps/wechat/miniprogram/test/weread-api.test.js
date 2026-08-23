const assert = require('node:assert/strict');
const test = require('node:test');

const weread = require('../utils/weread-api');

test('WeRead mini program helper validates base URLs and temporary keys', () => {
  assert.equal(weread.normalizeBaseUrl('https://penaup.example.com/'), 'https://penaup.example.com');
  assert.equal(weread.normalizeBaseUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  assert.equal(weread.normalizeSkillKey('wrk-1234567890abcdef'), 'wrk-1234567890abcdef');
  assert.equal(weread.normalizeSkillKey('not-a-key'), '');
  assert.throws(() => weread.normalizeBaseUrl('https://example.com/?key=secret'), /服务地址/);
  assert.throws(() => weread.normalizeBaseUrl('https://user@example.com'), /服务地址/);
});

test('WeRead mini program helper keeps the key in a header and normalizes the snapshot', async () => {
  const calls = [];
  global.wx = {
    request(options) {
      calls.push(options);
      options.success({
        statusCode: 200,
        data: {
          ok: true,
          data: {
            profile: 'PENAUP_PRO',
            periodLabel: '2026 年 8 月',
            readingMinutes: 61,
            readingDays: 2,
            bookCount: 1,
            topBookDetails: [{ bookId: 'book-1', title: '纸上的月光', author: '林简' }],
            dailyReading: [{ day: 18, readingMinutes: 30 }]
          }
        }
      });
    }
  };

  const snapshot = await weread.createClient('https://penaup.example.com').snapshot('wrk-1234567890abcdef', { mode: 'monthly', month: '2026-08', enrich: true });
  assert.equal(snapshot.profile, 'PENAUP_PRO');
  assert.equal(snapshot.topBookDetails[0].title, '纸上的月光');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://penaup.example.com/api/v1/integrations/weread/snapshot');
  assert.equal(calls[0].header['X-Penaup-WeRead-Key'], 'wrk-1234567890abcdef');
  assert.doesNotMatch(calls[0].url, /wrk-/);
  assert.deepEqual(calls[0].data, { mode: 'monthly', enrich: true, month: '2026-08' });
});

test('WeRead mini program helper rejects a missing base before wx.request', async () => {
  let called = false;
  global.wx = { request() { called = true; } };
  await assert.rejects(
    weread.createClient('').connect('wrk-1234567890abcdef'),
    (error) => error.code === 'weread_api_base_required'
  );
  assert.equal(called, false);
});
