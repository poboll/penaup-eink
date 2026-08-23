/* Copyright (c) 2026 poboll · Penaup WeRead request boundary */

// The mini program never talks to the upstream gateway directly. Keeping the
// API surface here makes the temporary Skill Key a header-only value and lets
// the server remain the single place that normalizes WeRead responses.
var STORAGE_KEY = 'penaup.weread.apiBaseUrl';
var ROUTES = {
  connect: '/api/v1/integrations/weread/connect',
  bookshelf: '/api/v1/integrations/weread/bookshelf',
  snapshot: '/api/v1/integrations/weread/snapshot',
  readingCard: '/api/v1/integrations/weread/reading-card'
};

function clean(value, maxLength) {
  var text = String(value == null ? '' : value).trim();
  if (maxLength && text.length > maxLength) return text.slice(0, maxLength);
  return text;
}

function errorWithCode(code, message) {
  var error = new Error(message || code);
  error.code = code;
  return error;
}

function normalizeBaseUrl(value) {
  var text = clean(value, 256).replace(/\/+$/, '');
  if (!text) return '';
  if (!/^https?:\/\//i.test(text) || /[\s?#]/.test(text) || /@/.test(text)) {
    throw errorWithCode('weread_api_base_invalid', '服务地址需要是没有参数的 HTTP 或 HTTPS 地址。');
  }
  return text;
}

function normalizeSkillKey(value) {
  var key = clean(value, 180);
  return /^wrk-[A-Za-z0-9_-]{8,160}$/.test(key) ? key : '';
}

function readStoredBaseUrl() {
  try { return normalizeBaseUrl(wx.getStorageSync(STORAGE_KEY) || ''); } catch (error) { return ''; }
}

function storeBaseUrl(value) {
  var normalized = normalizeBaseUrl(value);
  if (!normalized) throw errorWithCode('weread_api_base_required', '请先填写花生片服务地址。');
  try { wx.setStorageSync(STORAGE_KEY, normalized); } catch (error) {}
  return normalized;
}

function clearStoredBaseUrl() {
  try { wx.removeStorageSync(STORAGE_KEY); } catch (error) {}
}

function request(baseUrl, routeName, skillKey, body) {
  var base = normalizeBaseUrl(baseUrl);
  var key = normalizeSkillKey(skillKey);
  var path = ROUTES[routeName];
  if (!base) return Promise.reject(errorWithCode('weread_api_base_required', '请先填写花生片服务地址。'));
  if (!key) return Promise.reject(errorWithCode('weread_key_invalid', '请填入有效的微信读书 Skill Key。'));
  if (!path) return Promise.reject(errorWithCode('weread_route_invalid', '读书服务路径无效。'));

  return new Promise(function (resolve, reject) {
    wx.request({
      url: base + path,
      method: 'POST',
      timeout: 15000,
      dataType: 'json',
      header: {
        'Content-Type': 'application/json',
        'X-Penaup-WeRead-Key': key
      },
      data: body || {},
      success: function (response) {
        var payload = response && response.data && typeof response.data === 'object' ? response.data : {};
        if (!response || response.statusCode < 200 || response.statusCode >= 300 || payload.ok !== true) {
          reject(errorWithCode(payload.error || 'weread_unavailable', payload.message || '微信读书暂时不可用，请稍后重试。'));
          return;
        }
        resolve(payload.data || {});
      },
      fail: function () {
        reject(errorWithCode('weread_network_error', '花生片服务暂时无法连接，请检查地址或网络。'));
      }
    });
  });
}

function normalizeSnapshot(snapshot) {
  snapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  var details = Array.isArray(snapshot.topBookDetails) ? snapshot.topBookDetails.slice(0, 12) : [];
  var books = details.map(function (book) {
    book = book || {};
    return {
      bookId: clean(book.bookId, 128),
      title: clean(book.title, 80) || '未命名书籍',
      author: clean(book.author, 60),
      progress: Math.max(0, Math.min(100, Number(book.progress) || 0)),
      readingMinutes: Math.max(0, Math.round(Number(book.readingMinutes) || 0)),
      summary: clean(book.summary, 220)
    };
  });
  return {
    profile: 'PENAUP_PRO',
    mode: snapshot.mode === 'weekly' ? 'weekly' : 'monthly',
    periodKey: clean(snapshot.periodKey, 16),
    periodLabel: clean(snapshot.periodLabel, 80) || '一段阅读记录',
    readingMinutes: Math.max(0, Math.round(Number(snapshot.readingMinutes) || 0)),
    readingDays: Math.max(0, Math.round(Number(snapshot.readingDays) || 0)),
    bookCount: Math.max(0, Math.round(Number(snapshot.bookCount) || books.length)),
    noteCount: Math.max(0, Math.round(Number(snapshot.noteCount) || 0)),
    dailyReading: (Array.isArray(snapshot.dailyReading) ? snapshot.dailyReading : []).slice(0, 31).map(function (item) {
      return { day: Math.max(1, Math.round(Number(item && item.day) || 1)), readingMinutes: Math.max(0, Math.round(Number(item && item.readingMinutes) || 0)) };
    }),
    topBooks: books.map(function (book) { return book.title; }),
    topBookDetails: books,
    quote: clean(snapshot.quote, 220),
    enrichment: clean(snapshot.enrichment, 20) || 'none'
  };
}

function createClient(baseUrl) {
  var base = normalizeBaseUrl(baseUrl);
  return {
    connect: function (key) { return request(base, 'connect', key, {}).then(function (data) { return data; }); },
    bookshelf: function (key) { return request(base, 'bookshelf', key, {}).then(function (data) { return data; }); },
    snapshot: function (key, options) {
      options = options || {};
      var body = { mode: options.mode === 'weekly' ? 'weekly' : 'monthly', enrich: options.enrich === true };
      if (body.mode === 'monthly' && options.month) body.month = clean(options.month, 7);
      if (body.mode === 'weekly' && options.weekStart) body.week_start = clean(options.weekStart, 10);
      return request(base, 'snapshot', key, body).then(normalizeSnapshot);
    },
    readingCard: function (key, bookId) {
      return request(base, 'readingCard', key, { book_id: clean(bookId, 128) });
    }
  };
}

module.exports = {
  ROUTES: ROUTES,
  normalizeBaseUrl: normalizeBaseUrl,
  normalizeSkillKey: normalizeSkillKey,
  normalizeSnapshot: normalizeSnapshot,
  readStoredBaseUrl: readStoredBaseUrl,
  storeBaseUrl: storeBaseUrl,
  clearStoredBaseUrl: clearStoredBaseUrl,
  createClient: createClient
};
