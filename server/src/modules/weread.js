/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 *
 * 微信读书只在请求期间经过这里。这个模块不保存 Skill Key，也不把上游
 * 原始响应交给模板层；页面只拿到生成 3.68 英寸屏保所需的最小摘要。
 */

const DEFAULT_GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';
const DEFAULT_SKILL_VERSION = '1.0.4';
const DEFAULT_TIMEOUT_MS = 15000;
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;
const KEY_RE = /^wrk-[A-Za-z0-9_-]{16,160}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function errorWithCode(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function cleanText(value, maxLength) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

function numericPart(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = cleanText(value, 64).replace(/,/g, '');
  if (!text) return null;
  const match = text.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function numberOr(value, fallback = 0) {
  const number = numericPart(value);
  return number === null ? fallback : number;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function durationToMinutes(value) {
  const number = numericPart(value);
  if (number === null) return 0;
  if (typeof value === 'string') {
    const unit = value.toLowerCase();
    if (/小时|小時|hour|hr|\bh\b/.test(unit)) return Math.max(0, Math.round(number * 60));
    if (/分钟|分鐘|minute|min/.test(unit)) return Math.max(0, Math.round(number));
    if (/秒|second|sec|\bs\b/.test(unit)) return Math.max(0, Math.round(number / 60));
  }
  return Math.max(0, Math.round(number / 60));
}

function countStat(readStat, keywords) {
  if (!Array.isArray(readStat)) return 0;
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const item = readStat.find((entry) => normalizedKeywords.some((keyword) => cleanText(entry?.stat, 32).toLowerCase().includes(keyword)));
  return Math.max(0, Math.round(numberOr(item?.counts)));
}

function chinaDate(date = new Date()) {
  return new Date(date.getTime() + CHINA_TIME_OFFSET_MS);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function monthFromDate(date) {
  return isoDate(chinaDate(date)).slice(0, 7);
}

function monthRangeLabel(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${year}年${String(monthNumber).padStart(2, '0')}月`;
}

function weekStartFromDate(date) {
  const current = chinaDate(date);
  const day = current.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  current.setUTCDate(current.getUTCDate() + offset);
  current.setUTCHours(0, 0, 0, 0);
  return new Date(current.getTime() - CHINA_TIME_OFFSET_MS);
}

function weekRangeLabel(date) {
  const start = weekStartFromDate(date);
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
  const startChina = chinaDate(start);
  const endChina = chinaDate(end);
  return `本周 · ${String(startChina.getUTCMonth() + 1).padStart(2, '0')}月${String(startChina.getUTCDate()).padStart(2, '0')}日—${String(endChina.getUTCMonth() + 1).padStart(2, '0')}月${String(endChina.getUTCDate()).padStart(2, '0')}日`;
}

function normalizedBook(entry) {
  const book = entry?.book || entry?.albumInfo || {};
  const title = cleanText(book.title || book.name || entry?.title, 80);
  if (!title) return null;
  return {
    bookId: cleanText(book.bookId || entry?.bookId, 96),
    title,
    author: cleanText(book.author || book.authorName || entry?.author || '作者未知', 48) || '作者未知',
    coverUrl: cleanText(book.cover || entry?.cover, 512),
    readingMinutes: durationToMinutes(entry?.readTime ?? entry?.readingSeconds ?? entry?.readingTime),
    progress: Math.round(clamp(numberOr(entry?.progress), 0, 100)),
    summary: cleanText(entry?.markText || entry?.summary || entry?.excerpt, 180)
  };
}

function normalizeDailyReading(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  return Object.entries(input)
    .map(([key, value]) => {
      const dayFromKey = String(key).match(/(?:^|-)\d{4}-\d{2}-(\d{2})$/)?.[1] || String(key).match(/^\d{1,2}$/)?.[0];
      const day = Number(dayFromKey);
      return { day, readingMinutes: durationToMinutes(value) };
    })
    .filter((entry) => Number.isInteger(entry.day) && entry.day >= 1 && entry.day <= 31 && entry.readingMinutes > 0)
    .sort((left, right) => left.day - right.day)
    .slice(0, 31);
}

export function normalizeWereadKey(value) {
  const key = cleanText(value, 192);
  return KEY_RE.test(key) ? key : '';
}

export function normalizeWereadSnapshot(payload, mode = 'monthly', now = new Date()) {
  const root = payload?.data && typeof payload.data === 'object' ? payload.data : (payload || {});
  if (Number(root.errcode) !== 0 && root.errcode !== undefined) {
    throw errorWithCode('weread_upstream_rejected', '微信读书暂时没有返回可用数据。');
  }

  const selectedMode = mode === 'weekly' ? 'weekly' : 'monthly';
  const requestedMonth = MONTH_RE.test(String(root.month || '')) ? root.month : monthFromDate(now);
  const longest = Array.isArray(root.readLongest) ? root.readLongest : [];
  const seen = new Set();
  const topBookDetails = longest
    .map(normalizedBook)
    .filter((book) => {
      if (!book) return false;
      const identity = (book.bookId || book.title).toLocaleLowerCase();
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .slice(0, 8);
  const readStat = Array.isArray(root.readStat) ? root.readStat : [];
  const readingMinutes = durationToMinutes(root.totalReadTime ?? root.readingSeconds);
  const readingDays = Math.max(0, Math.round(numberOr(root.readDays) || countStat(readStat, ['阅读', '天'])));
  const bookCount = Math.max(0, Math.round(numberOr(root.bookCount) || countStat(readStat, ['读过', '书']) || topBookDetails.length));
  const noteCount = Math.max(0, Math.round(numberOr(root.noteCount) || countStat(readStat, ['笔记', '划线'])));
  const periodKey = selectedMode === 'weekly' ? isoDate(weekStartFromDate(now)) : requestedMonth;

  return {
    source: 'weread',
    mode: selectedMode,
    profile: 'PENAUP_PRO',
    screen: { width: 792, height: 528, panel: 'E6 3.68 inch' },
    periodKey,
    periodLabel: selectedMode === 'weekly' ? weekRangeLabel(now) : monthRangeLabel(requestedMonth),
    readingDays,
    readingMinutes,
    bookCount,
    noteCount,
    topBookDetails,
    topBooks: topBookDetails.map((book) => book.title),
    dailyReading: normalizeDailyReading(root.readTimes || root.dailyReadTimes),
    quote: selectedMode === 'weekly' ? '从这周读过的书里，挑一页留给今天。' : '从这个月读过的书里，挑一页留给今天。',
    fetchedAt: new Date().toISOString()
  };
}

function validGatewayUrl(value) {
  try {
    const url = new URL(value || DEFAULT_GATEWAY_URL);
    if (url.protocol !== 'https:') throw new Error('https_required');
    return url.toString();
  } catch (error) {
    throw errorWithCode('weread_gateway_invalid', '微信读书服务地址配置无效。', error);
  }
}

export function createWereadService({ config = {}, fetchImpl = globalThis.fetch } = {}) {
  const gatewayUrl = validGatewayUrl(config.wereadGatewayUrl || DEFAULT_GATEWAY_URL);
  const skillVersion = cleanText(config.wereadSkillVersion || DEFAULT_SKILL_VERSION, 32) || DEFAULT_SKILL_VERSION;
  const timeoutMs = Math.max(3000, Math.min(60000, Number(config.wereadTimeoutMs || DEFAULT_TIMEOUT_MS)));

  async function snapshot({ skillKey, mode = 'monthly', month } = {}) {
    const key = normalizeWereadKey(skillKey);
    if (!key) throw errorWithCode('weread_key_invalid', '请输入有效的微信读书 Skill Key。');
    if (typeof fetchImpl !== 'function') throw errorWithCode('weread_not_configured', '微信读书服务暂不可用。');
    const selectedMode = mode === 'weekly' ? 'weekly' : mode === 'monthly' ? 'monthly' : '';
    if (!selectedMode) throw errorWithCode('weread_mode_invalid', '只支持周报或月报。');

    const body = {
      api_name: '/readdata/detail',
      mode: selectedMode,
      skill_version: skillVersion
    };
    if (selectedMode === 'monthly' && MONTH_RE.test(String(month || ''))) {
      const [year, monthNumber] = month.split('-').map(Number);
      body.baseTime = Math.floor((Date.UTC(year, monthNumber - 1, 1) - CHINA_TIME_OFFSET_MS) / 1000);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(gatewayUrl, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw errorWithCode('weread_timeout', '微信读书请求超时，请稍后重试。');
      throw errorWithCode('weread_unavailable', '微信读书服务暂时不可用，请稍后重试。', error);
    } finally {
      clearTimeout(timeout);
    }

    let responseText = '';
    try { responseText = await response.text(); } catch (error) { throw errorWithCode('weread_bad_response', '微信读书返回内容无法读取。', error); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw errorWithCode('weread_key_rejected', '微信读书 Key 无效或已过期。');
      throw errorWithCode('weread_upstream_error', '微信读书暂时无法返回数据，请稍后重试。');
    }
    let payload;
    try { payload = JSON.parse(responseText); } catch (error) { throw errorWithCode('weread_bad_response', '微信读书返回的数据格式异常。', error); }
    return normalizeWereadSnapshot(payload, selectedMode);
  }

  return { snapshot, gatewayUrl, skillVersion };
}

function bodyObject(request) {
  return request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
}

export function registerWereadRoutes(app, { service }) {
  app.post('/api/v1/integrations/weread/snapshot', async (request, reply) => {
    const body = bodyObject(request);
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 12 * 1024) {
      return reply.code(413).send({ ok: false, error: 'request_too_large' });
    }
    const key = request.headers['x-penaup-weread-key'];
    const mode = body.mode || 'monthly';
    try {
      const data = await service.snapshot({ skillKey: key, mode, month: body.month });
      return reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache').send({ ok: true, data });
    } catch (error) {
      const status = {
        weread_key_invalid: 400,
        weread_mode_invalid: 400,
        weread_key_rejected: 401,
        weread_timeout: 504,
        weread_bad_response: 502,
        weread_upstream_error: 502,
        weread_upstream_rejected: 502,
        weread_unavailable: 503,
        weread_gateway_invalid: 503,
        weread_not_configured: 503
      }[error?.code] || 502;
      return reply.code(status).header('Cache-Control', 'no-store').send({ ok: false, error: error?.code || 'weread_unavailable', message: error?.message || '微信读书暂时不可用。' });
    }
  });
}
