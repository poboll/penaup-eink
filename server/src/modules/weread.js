/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 *
 * 微信读书只在请求期间经过这里。这个模块不保存 Skill Key，也不把上游
 * 原始响应交给模板层；页面只拿到生成花生片 Pro 屏保所需的最小摘要。
 */

const DEFAULT_GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';
const DEFAULT_SKILL_VERSION = '1.0.4';
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_GATEWAY_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SHELF_BOOKS = 120;
const MAX_ENRICHED_BOOKS = 5;
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_RE = /^wrk-[A-Za-z0-9_-]{8,160}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/;
const BOOK_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;

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
  // WeRead returns numeric reading durations in seconds.
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

function dateFromChinaDateKey(value) {
  const match = cleanText(value, 32).match(DATE_RE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return utc;
}

function validMonth(value) {
  const month = cleanText(value, 16);
  return MONTH_RE.test(month) ? month : '';
}

function normalizeRequestedMonth(value) {
  if (value == null || value === '') return '';
  const month = validMonth(value);
  if (!month) throw errorWithCode('weread_month_invalid', '月份格式应为 YYYY-MM。');
  return month;
}

function normalizeRequestedWeekStart(value) {
  if (value == null || value === '') return '';
  const date = dateFromChinaDateKey(value);
  if (!date || date.getUTCDay() !== 1) throw errorWithCode('weread_week_invalid', '周起始日应为有效的周一。');
  return isoDate(date);
}

function weekRangeLabel(date) {
  const start = weekStartFromDate(date);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const startChina = chinaDate(start);
  const endChina = chinaDate(end);
  return `本周 · ${String(startChina.getUTCMonth() + 1).padStart(2, '0')}月${String(startChina.getUTCDate()).padStart(2, '0')}日—${String(endChina.getUTCMonth() + 1).padStart(2, '0')}月${String(endChina.getUTCDate()).padStart(2, '0')}日`;
}

function weekRangeLabelFromStart(value, fallbackDate = new Date()) {
  const start = value ? dateFromChinaDateKey(value) : null;
  return weekRangeLabel(start || fallbackDate);
}

function timestampMilliseconds(value) {
  const number = numericPart(value);
  if (number === null || number <= 0) return 0;
  return number < 1_000_000_000_000 ? number * 1000 : number;
}

function safeHttpsUrl(value) {
  const raw = cleanText(value, 512);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function normalizedBook(entry) {
  const book = entry?.book || entry?.albumInfo || {};
  const title = cleanText(book.title || book.name || entry?.title, 80);
  if (!title) return null;
  const progressValue = entry?.progress ?? book.progress;
  return {
    bookId: cleanText(book.bookId || entry?.bookId, 96),
    title,
    author: cleanText(book.author || book.authorName || entry?.author || '作者未知', 48) || '作者未知',
    coverUrl: safeHttpsUrl(book.cover || entry?.cover),
    readingMinutes: durationToMinutes(entry?.readTime ?? entry?.readingSeconds ?? entry?.readingTime),
    progress: Math.round(clamp(numberOr(progressValue), 0, 100)),
    summary: cleanText(entry?.markText || entry?.summary || entry?.excerpt, 180)
  };
}

function normalizeDailyReading(input, month) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const monthPrefix = String(month || '').replace('-', '');
  const byDay = new Map();
  Object.entries(input).forEach(([rawKey, value]) => {
    const key = cleanText(rawKey, 32);
    const digits = key.replace(/\D/g, '');
    let day = 0;
    let sortKey = 0;
    if (DATE_RE.test(key)) {
      const date = dateFromChinaDateKey(key);
      const dateMonth = date ? `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}` : '';
      if (!monthPrefix || dateMonth === monthPrefix) day = date?.getUTCDate() || 0;
      sortKey = date?.getTime() || 0;
    } else if (/^\d{8}$/.test(digits) && (!monthPrefix || digits.slice(0, 6) === monthPrefix)) {
      day = Number(digits.slice(6, 8));
      sortKey = Date.UTC(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)) - 1, day);
    } else if (/^\d{1,2}$/.test(key)) {
      day = Number(key);
      sortKey = day;
    } else if (/^\d{10}$|^\d{13}$/.test(digits)) {
      const timestamp = Number(digits) * (digits.length === 10 ? 1000 : 1);
      const date = chinaDate(new Date(timestamp));
      const dateMonth = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!monthPrefix || dateMonth === monthPrefix) day = date.getUTCDate();
      sortKey = timestamp;
    }
    const readingMinutes = durationToMinutes(value);
    if (Number.isInteger(day) && day >= 1 && day <= 31 && readingMinutes > 0) {
      const previous = byDay.get(day);
      if (!previous || readingMinutes > previous.readingMinutes) byDay.set(day, { readingMinutes, sortKey });
    }
  });
  return [...byDay.entries()]
    .sort((left, right) => (left[1].sortKey - right[1].sortKey) || (left[0] - right[0]))
    .map(([day, reading]) => ({ day, readingMinutes: reading.readingMinutes }))
    .slice(0, 31);
}

export function normalizeWereadKey(value) {
  const key = cleanText(value, 192);
  return KEY_RE.test(key) ? key : '';
}

export function normalizeWereadSnapshot(payload, mode = 'monthly', now = new Date(), options = {}) {
  const root = payload?.data && typeof payload.data === 'object' ? payload.data : (payload || {});
  if (Number(root.errcode) !== 0 && root.errcode !== undefined) {
    throw errorWithCode('weread_upstream_rejected', '微信读书暂时没有返回可用数据。');
  }

  const selectedMode = mode === 'weekly' ? 'weekly' : 'monthly';
  const requestedMonth = validMonth(options.month || root.month) || monthFromDate(now);
  const requestedWeek = normalizeRequestedWeekStart(options.weekStart || '') || isoDate(weekStartFromDate(now));
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
    .slice(0, 12);
  const readStat = Array.isArray(root.readStat) ? root.readStat : [];
  const readingMinutes = durationToMinutes(root.totalReadTime ?? root.readingSeconds);
  const readingDays = Math.max(0, Math.round(numberOr(root.readDays) || countStat(readStat, ['阅读', '天'])));
  const bookCount = Math.max(0, Math.round(numberOr(root.bookCount) || countStat(readStat, ['读过', '书']) || topBookDetails.length));
  const noteCount = Math.max(0, Math.round(numberOr(root.noteCount) || countStat(readStat, ['笔记', '划线'])));
  const periodKey = selectedMode === 'weekly' ? requestedWeek : requestedMonth;

  return {
    source: 'weread',
    mode: selectedMode,
    profile: 'PENAUP_PRO',
    screen: { width: 792, height: 528, panel: 'E6 3.68 inch' },
    periodKey,
    periodLabel: selectedMode === 'weekly' ? weekRangeLabelFromStart(requestedWeek, now) : monthRangeLabel(requestedMonth),
    readingDays,
    readingMinutes,
    bookCount,
    noteCount,
    topBookDetails,
    topBooks: topBookDetails.map((book) => book.title),
    // A week can cross two calendar months. Do not apply the monthly filter to
    // weekly data or the first/last day can disappear from the wallpaper.
    dailyReading: normalizeDailyReading(root.readTimes || root.dailyReadTimes, selectedMode === 'monthly' ? requestedMonth : ''),
    quote: selectedMode === 'weekly' ? '从这周读过的书里，挑一句话留给今天。' : '从这个月读过的书里，挑一句话留给今天。',
    enrichment: 'none',
    fetchedAt: new Date().toISOString()
  };
}

function normalizeGatewayRoot(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : (payload || {});
}

export function normalizeWereadShelf(payload) {
  const root = normalizeGatewayRoot(payload);
  if (Number(root.errcode) !== 0 && root.errcode !== undefined) throw errorWithCode('weread_upstream_rejected', '微信读书暂时没有返回可用书架。');
  const books = (Array.isArray(root.books) ? root.books : []).map((book) => ({
    bookId: cleanText(book?.bookId, 96),
    title: cleanText(book?.title || '未命名书籍', 80),
    author: cleanText(book?.author, 48),
    coverUrl: safeHttpsUrl(book?.cover),
    readUpdateTime: timestampMilliseconds(book?.readUpdateTime),
    finished: Number(book?.finishReading) === 1,
    mediaType: '电子书'
  })).filter((book) => book.title).slice(0, MAX_SHELF_BOOKS);
  const albums = (Array.isArray(root.albums) ? root.albums : []).map((album) => ({
    bookId: '',
    title: cleanText(album?.albumInfo?.name || '未命名有声书', 80),
    author: cleanText(album?.albumInfo?.authorName, 48),
    coverUrl: safeHttpsUrl(album?.albumInfo?.cover),
    readUpdateTime: 0,
    finished: false,
    mediaType: '有声书'
  })).filter((book) => book.title).slice(0, MAX_SHELF_BOOKS);
  const shelfBooks = [...books, ...albums].sort((left, right) => right.readUpdateTime - left.readUpdateTime).slice(0, MAX_SHELF_BOOKS);
  return {
    books: shelfBooks,
    total: books.length + albums.length + (root.mp ? 1 : 0),
    ebooks: books.length,
    audiobooks: albums.length,
    fetchedAt: new Date().toISOString()
  };
}

function normalizedNotes(highlights, reviews) {
  const highlightRoot = normalizeGatewayRoot(highlights);
  const reviewRoot = normalizeGatewayRoot(reviews);
  const chapterNames = new Map((Array.isArray(highlightRoot.chapters) ? highlightRoot.chapters : [])
    .filter((chapter) => chapter?.chapterUid !== undefined)
    .map((chapter) => [chapter.chapterUid, cleanText(chapter.title, 96)]));
  const reviewNotes = (Array.isArray(reviewRoot.reviews) ? reviewRoot.reviews : [])
    .map((entry) => entry?.review || {})
    .map((review) => ({
      thought: cleanText(review.content, 180),
      quote: cleanText(review.abstract, 220),
      chapter: cleanText(review.chapterName || (review.chapterUid !== undefined ? chapterNames.get(review.chapterUid) : '') || (review.chapterIdx !== undefined ? `第 ${review.chapterIdx} 章` : ''), 96),
      createdAt: timestampMilliseconds(review.createTime)
    }))
    .filter((note) => note.thought || note.quote);
  const reviewQuotes = new Set(reviewNotes.map((note) => note.quote).filter(Boolean));
  const highlightNotes = (Array.isArray(highlightRoot.updated) ? highlightRoot.updated : [])
    .filter((item) => (item?.type === undefined || item.type === 1) && cleanText(item?.markText, 220) && !reviewQuotes.has(cleanText(item?.markText, 220)))
    .map((item) => ({
      thought: '',
      quote: cleanText(item.markText, 220),
      chapter: cleanText(item.chapterUid !== undefined ? chapterNames.get(item.chapterUid) : '', 96),
      createdAt: timestampMilliseconds(item.createTime)
    }));
  return [...reviewNotes, ...highlightNotes]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 2)
    .map(({ thought, quote, chapter }) => ({ thought, quote, chapter }));
}

export function normalizeWereadReadingCard(bookInfo, highlights, reviews, progress) {
  const book = normalizeGatewayRoot(bookInfo);
  if (Number(book.errcode) !== 0 && book.errcode !== undefined) throw errorWithCode('weread_upstream_rejected', '这本书暂时无法生成读书卡。');
  const progressRoot = normalizeGatewayRoot(progress);
  const notes = normalizedNotes(highlights, reviews);
  return {
    source: 'weread',
    title: cleanText(book.title || book.name, 80) || '未命名书籍',
    author: cleanText(book.author, 48) || '作者未知',
    coverUrl: safeHttpsUrl(book.cover),
    category: cleanText(book.category, 48),
    summary: cleanText(book.intro, 360),
    progress: Math.round(clamp(numberOr(progressRoot.book?.progress), 0, 100)),
    readingSeconds: Math.max(0, Math.round(numberOr(progressRoot.book?.recordReadingTime))),
    excerpt: notes[0]?.quote || '',
    notes,
    fetchedAt: new Date().toISOString()
  };
}

function allowedGatewayHosts(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return new Set(values.map((item) => cleanText(item, 255).toLowerCase()).filter(Boolean));
}

function validGatewayUrl(value, allowedHosts) {
  try {
    const url = new URL(value || DEFAULT_GATEWAY_URL);
    if (url.protocol !== 'https:') throw new Error('https_required');
    if (url.username || url.password || url.search || url.hash) throw new Error('gateway_url_must_not_contain_credentials_or_query');
    const hostname = url.hostname.toLowerCase();
    if (allowedHosts.size && !allowedHosts.has(hostname)) throw new Error('gateway_host_not_allowed');
    return url.toString();
  } catch (error) {
    throw errorWithCode('weread_gateway_invalid', '微信读书服务地址配置无效。', error);
  }
}

function isReturnedHtml(value) {
  return /^\s*(?:<!doctype\s+html|<html\b)/i.test(value);
}

export function createWereadService({ config = {}, fetchImpl = globalThis.fetch } = {}) {
  const gatewayAllowedHosts = allowedGatewayHosts(config.wereadGatewayAllowedHosts || 'i.weread.qq.com');
  const gatewayUrl = validGatewayUrl(config.wereadGatewayUrl || DEFAULT_GATEWAY_URL, gatewayAllowedHosts);
  const skillVersion = cleanText(config.wereadSkillVersion || DEFAULT_SKILL_VERSION, 32) || DEFAULT_SKILL_VERSION;
  const timeoutMs = Math.max(3000, Math.min(60000, Number(config.wereadTimeoutMs || DEFAULT_TIMEOUT_MS)));

  async function callGateway(skillKey, apiName, params = {}) {
    const key = normalizeWereadKey(skillKey);
    if (!key) throw errorWithCode('weread_key_invalid', '请输入有效的微信读书 Skill Key。');
    if (typeof fetchImpl !== 'function') throw errorWithCode('weread_not_configured', '微信读书服务暂不可用。');
    const body = { api_name: apiName, ...params, skill_version: skillVersion };
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
    if (Buffer.byteLength(responseText, 'utf8') > MAX_GATEWAY_RESPONSE_BYTES) throw errorWithCode('weread_response_too_large', '微信读书返回内容过大，已停止处理。');
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw errorWithCode('weread_key_rejected', '微信读书 Key 无效或已过期。');
      throw errorWithCode('weread_upstream_error', '微信读书暂时无法返回数据，请稍后重试。');
    }
    if (isReturnedHtml(responseText)) throw errorWithCode('weread_bad_response', '微信读书服务暂时返回了异常页面，请稍后重试。');
    let payload;
    try { payload = JSON.parse(responseText); } catch (error) { throw errorWithCode('weread_bad_response', '微信读书返回的数据格式异常。', error); }
    const root = normalizeGatewayRoot(payload);
    if (root.upgrade_info?.message) throw errorWithCode('weread_skill_upgrade_required', '微信读书 Skill 需要升级，请稍后重试。');
    if (Number(root.errcode) !== 0 && root.errcode !== undefined) throw errorWithCode('weread_upstream_rejected', '微信读书暂时没有返回可用数据。');
    return payload;
  }

  async function snapshot({ skillKey, mode = 'monthly', month, weekStart, enrich = false } = {}) {
    const selectedMode = mode === 'weekly' ? 'weekly' : mode === 'monthly' ? 'monthly' : '';
    if (!selectedMode) throw errorWithCode('weread_mode_invalid', '只支持周报或月报。');
    const selectedMonth = selectedMode === 'monthly' ? normalizeRequestedMonth(month) : '';
    const selectedWeek = selectedMode === 'weekly' ? normalizeRequestedWeekStart(weekStart) : '';
    const body = { mode: selectedMode };
    if (selectedMonth) {
      const [year, monthNumber] = selectedMonth.split('-').map(Number);
      body.baseTime = Math.floor((Date.UTC(year, monthNumber - 1, 1) - CHINA_TIME_OFFSET_MS) / 1000);
    } else if (selectedWeek) {
      const monday = dateFromChinaDateKey(selectedWeek);
      body.baseTime = Math.floor((Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()) - CHINA_TIME_OFFSET_MS) / 1000);
    }
    const payload = await callGateway(skillKey, '/readdata/detail', body);
    let result = normalizeWereadSnapshot(payload, selectedMode, new Date(), { month: selectedMonth, weekStart: selectedWeek });
    if (!enrich) return result;
    result = await enrichSnapshot(result, skillKey, selectedMode);
    return result;
  }

  async function bookshelf({ skillKey } = {}) {
    return normalizeWereadShelf(await callGateway(skillKey, '/shelf/sync'));
  }

  async function connect({ skillKey } = {}) {
    const shelf = await bookshelf({ skillKey });
    return { source: 'weread', skillVersion, total: shelf.total, ebooks: shelf.ebooks, audiobooks: shelf.audiobooks, fetchedAt: shelf.fetchedAt };
  }

  async function readingCard({ skillKey, bookId } = {}) {
    const id = cleanText(bookId, 128);
    if (!BOOK_ID_RE.test(id)) throw errorWithCode('weread_book_id_invalid', '书籍编号格式无效。');
    const [book, highlights, reviews, progress] = await Promise.all([
      callGateway(skillKey, '/book/info', { bookId: id }),
      callGateway(skillKey, '/book/bookmarklist', { bookId: id }).catch(() => null),
      callGateway(skillKey, '/review/list/mine', { bookid: id, count: 20 }).catch(() => null),
      callGateway(skillKey, '/book/getprogress', { bookId: id }).catch(() => null)
    ]);
    return normalizeWereadReadingCard(book, highlights, reviews, progress);
  }

  async function enrichSnapshot(snapshotValue, skillKey, mode) {
    let shelf = null;
    try { shelf = await bookshelf({ skillKey }); } catch { return { ...snapshotValue, enrichment: 'partial' }; }
    const month = snapshotValue.periodKey.slice(0, 7);
    const existing = [...snapshotValue.topBookDetails];
    const seen = new Set(existing.map((book) => (book.bookId || book.title).toLocaleLowerCase()));
    const supplemental = shelf.books
      .filter((book) => book.mediaType === '电子书' && book.title)
      .filter((book) => {
        if (mode === 'monthly' && book.readUpdateTime) {
          const [year, monthNumber] = month.split('-').map(Number);
          const start = Date.UTC(year, monthNumber - 1, 1) - CHINA_TIME_OFFSET_MS;
          const end = Date.UTC(year, monthNumber, 1) - CHINA_TIME_OFFSET_MS;
          if (book.readUpdateTime < start || book.readUpdateTime >= end) return false;
        }
        const id = (book.bookId || book.title).toLocaleLowerCase();
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, Math.max(0, Math.min(8, snapshotValue.bookCount) - existing.length));
    const merged = [...existing, ...supplemental].slice(0, 12);
    const enriched = await Promise.all(merged.slice(0, MAX_ENRICHED_BOOKS).map(async (book) => {
      if (!book.bookId) return book;
      const [highlights, progress] = await Promise.all([
        callGateway(skillKey, '/book/bookmarklist', { bookId: book.bookId }).catch(() => null),
        callGateway(skillKey, '/book/getprogress', { bookId: book.bookId }).catch(() => null)
      ]);
      const highlight = normalizedNotes(highlights, null)[0];
      const progressRoot = normalizeGatewayRoot(progress);
      return {
        ...book,
        progress: Math.round(clamp(numberOr(progressRoot.book?.progress ?? book.progress), 0, 100)),
        summary: highlight?.quote || book.summary || ''
      };
    }));
    return { ...snapshotValue, topBookDetails: enriched, topBooks: enriched.map((book) => book.title), enrichment: 'complete' };
  }

  return { snapshot, connect, bookshelf, readingCard, callGateway, gatewayUrl, skillVersion };
}

function bodyObject(request) {
  return request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
}

function allowedOrigin(request, config = {}) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const allowed = String(config.allowedOrigins || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  try { return new URL(origin).host === request.headers.host; } catch { return false; }
}

function createRouteLimiter(limit = 20, windowMs = 60_000) {
  const buckets = new Map();
  return function allow(key) {
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      if (buckets.size > 4096) {
        for (const [bucketKey, bucket] of buckets) if (now - bucket.startedAt >= windowMs) buckets.delete(bucketKey);
      }
      buckets.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
}

function commonResponse(reply, status, body) {
  return reply.code(status).header('Cache-Control', 'no-store').header('Pragma', 'no-cache').send(body);
}

function statusForError(error) {
  return {
    weread_key_invalid: 400,
    weread_mode_invalid: 400,
    weread_month_invalid: 400,
    weread_week_invalid: 400,
    weread_book_id_invalid: 400,
    origin_not_allowed: 403,
    weread_key_rejected: 401,
    weread_timeout: 504,
    weread_bad_response: 502,
    weread_response_too_large: 502,
    weread_upstream_error: 502,
    weread_upstream_rejected: 502,
    weread_skill_upgrade_required: 502,
    weread_unavailable: 503,
    weread_gateway_invalid: 503,
    weread_not_configured: 503
  }[error?.code] || 502;
}

export function registerWereadRoutes(app, { service, config = {} }) {
  const allowRequest = createRouteLimiter(20, 60_000);
  const run = async (request, reply, suffix, work) => {
    if (!allowedOrigin(request, config)) return commonResponse(reply, 403, { ok: false, error: 'origin_not_allowed' });
    if (!allowRequest(`${request.ip || 'unknown'}:${suffix}`)) return commonResponse(reply, 429, { ok: false, error: 'weread_rate_limited' });
    try {
      const data = await work();
      return reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache').send({ ok: true, data });
    } catch (error) {
      return commonResponse(reply, statusForError(error), { ok: false, error: error?.code || 'weread_unavailable', message: error?.message || '微信读书暂时不可用。' });
    }
  };

  app.post('/api/v1/integrations/weread/connect', async (request, reply) => run(request, reply, 'connect', () => service.connect({ skillKey: request.headers['x-penaup-weread-key'] })));
  app.post('/api/v1/integrations/weread/bookshelf', async (request, reply) => run(request, reply, 'bookshelf', () => service.bookshelf({ skillKey: request.headers['x-penaup-weread-key'] })));

  app.post('/api/v1/integrations/weread/snapshot', async (request, reply) => {
    const body = bodyObject(request);
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 12 * 1024) return commonResponse(reply, 413, { ok: false, error: 'request_too_large' });
    return run(request, reply, 'snapshot', () => service.snapshot({
      skillKey: request.headers['x-penaup-weread-key'],
      mode: body.mode || 'monthly',
      month: body.month,
      weekStart: body.week_start || body.weekStart,
      enrich: body.enrich === true
    }));
  });

  app.post('/api/v1/integrations/weread/reading-card', async (request, reply) => {
    const body = bodyObject(request);
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 8 * 1024) return commonResponse(reply, 413, { ok: false, error: 'request_too_large' });
    return run(request, reply, 'reading-card', () => service.readingCard({ skillKey: request.headers['x-penaup-weread-key'], bookId: body.book_id || body.bookId }));
  });
}
