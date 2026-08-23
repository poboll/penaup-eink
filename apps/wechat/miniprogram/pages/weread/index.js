/* Copyright (c) 2026 poboll · Penaup WeRead wallpaper lab */

var app = getApp();
var filmCore = require('../../utils/film-core');
var filmUtils = require('../../utils/film-utils');
var bleTransfer = require('../../utils/ble-transfer');
var transferView = require('../../utils/transfer-view');
var wereadApi = require('../../utils/weread-api');

// Visual paper is portrait; the .film header and BLE payload remain the
// historical 792 × 528 protocol orientation and are rotated by film-utils.
var WIDTH = 528;
var HEIGHT = 792;
var PROFILE = 'PENAUP_PRO';
var INK = '#292722';
var QUIET = '#6f6a60';
var PAPER = '#fafaf7';
var LINE = '#d7d8d2';
var BLUE = '#4d73ad';
var RED = '#ad5145';
var YELLOW = '#c49a24';
var GREEN = '#55765e';

function clean(value, fallback) {
  var text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text || (fallback || '');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function pad2(value) { return String(value < 10 ? '0' + value : value); }

function formatMinutes(minutes) {
  var value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return value + ' 分钟';
  return Math.floor(value / 60) + ' 小时 ' + (value % 60 ? (value % 60) + ' 分钟' : '');
}

function roundedRect(ctx, x, y, width, height, radius) {
  var r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawLines(ctx, value, x, y, maxWidth, lineHeight, maxLines) {
  var chars = Array.from(clean(value));
  var lines = [];
  var current = '';
  for (var i = 0; i < chars.length; i += 1) {
    var candidate = current + chars[i];
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = chars[i];
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (maxLines && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, Math.max(1, lines[maxLines - 1].length - 1)) + '…';
  }
  lines.forEach(function (line, index) { ctx.fillText(line, x, y + index * lineHeight); });
  return y + lines.length * lineHeight;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function demoSnapshot(mode) {
  var now = new Date();
  var year = now.getFullYear();
  var month = now.getMonth() + 1;
  var day = now.getDate();
  var monthly = mode === 'monthly';
  var weekStart = new Date(year, month - 1, day - 6);
  var books = [
    { bookId: 'demo-book-01', title: '山茶文具店', author: '小川糸', readingMinutes: 186, progress: 72, summary: '有些话不必急着说出口，写下来，便有了再次抵达的时间。' },
    { bookId: 'demo-book-02', title: '云边有个小卖部', author: '张嘉佳', readingMinutes: 124, progress: 48, summary: '每个人都有自己的路要走，慢一点也没有关系。' },
    { bookId: 'demo-book-03', title: '设计中的设计', author: '原研哉', readingMinutes: 93, progress: 36, summary: '留白不是空缺，而是让事物重新呼吸的地方。' }
  ];
  var minutes = [42, 18, 66, 31, 87, 24, 53];
  var dailyReading = [];
  if (monthly) {
    for (var monthDay = 1; monthDay <= daysInMonth(year, month); monthDay += 1) {
      var monthlyMinutes = monthDay % 5 === 0 ? 76 : monthDay % 3 === 0 ? 34 : monthDay % 2 === 0 ? 0 : 18;
      if (monthlyMinutes > 0) dailyReading.push({ day: monthDay, readingMinutes: monthlyMinutes });
    }
  } else {
    dailyReading = minutes.map(function (value, index) { return { day: Math.max(1, day - 6 + index), readingMinutes: value }; });
  }
  var readingMinutes = dailyReading.reduce(function (sum, item) { return sum + item.readingMinutes; }, 0);
  return {
    mode: monthly ? 'monthly' : 'weekly',
    profile: PROFILE,
    periodKey: monthly ? year + '-' + pad2(month) : weekStart.getFullYear() + '-' + pad2(weekStart.getMonth() + 1) + '-' + pad2(weekStart.getDate()),
    periodLabel: year + ' 年 ' + pad2(month) + ' 月 · 示例阅读',
    readingMinutes: readingMinutes,
    readingDays: dailyReading.filter(function (item) { return item.readingMinutes > 0; }).length,
    bookCount: books.length,
    noteCount: 12,
    dailyReading: dailyReading,
    topBooks: books.map(function (book) { return book.title; }),
    topBookDetails: books,
    quote: '把读过的书留给今天，明天再慢慢想起。',
    enrichment: 'demo'
  };
}

Page({
  data: {
    apiBaseUrl: wereadApi.readStoredBaseUrl(),
    skillKey: '',
    source: 'idle',
    mode: 'weekly',
    month: '',
    scene: 'weekly_receipt',
    renderingMode: 'layer',
    renderingModes: filmUtils.getRenderingModeOptions(),
    renderingModeNote: filmUtils.getRenderingModeDefinition('layer').description,
    phase: 'idle',
    phaseLabel: '纸面在等一段阅读',
    status: '可以先用示例数据看一眼，也可以连接你的微信读书书架。',
    statusTone: '',
    busy: false,
    hasPreview: false,
    hasFilm: false,
    stats: { readingMinutes: 0, readingDays: 0, bookCount: 0, noteCount: 0 },
    books: [],
    selectedBookIndex: 0,
    showTransfer: false,
    transferStatus: '',
    transferProgress: 0,
    transferTitle: '',
    transferPhaseLabel: '',
    transferOutcome: 'pending',
    transferCanRetry: false,
    transferCanClose: false,
    transferRenderingDetail: ''
  },

  _canvas: null,
  _ctx: null,
  _snapshot: null,
  _card: null,
  _film: null,
  _pendingTransfer: null,
  _renderRevision: 0,

  onReady: function () {
    var that = this;
    var month = new Date();
    this.setData({ month: month.getFullYear() + '-' + pad2(month.getMonth() + 1) });
    wx.createSelectorQuery().select('#weread-canvas').fields({ node: true, size: true }).exec(function (result) {
      if (!result || !result[0] || !result[0].node) return;
      that._canvas = result[0].node;
      that._canvas.width = WIDTH;
      that._canvas.height = HEIGHT;
      that._ctx = that._canvas.getContext('2d');
      that._drawEmpty();
    });
  },

  onUnload: function () {
    this._renderRevision += 1;
    this._canvas = null;
    this._ctx = null;
    this._snapshot = null;
    this._card = null;
    this._film = null;
  },

  onShareAppMessage: function () {
    return { title: '花生片 Penaup · 微信读书壁纸实验室', path: '/pages/weread/index' };
  },

  noop: function () {},

  _setPhase: function (phase, label) {
    this.setData({ phase: phase, phaseLabel: label || '纸面在等一段阅读' });
  },

  _setStatus: function (message, tone) {
    this.setData({ status: message, statusTone: tone || '' });
  },

  _invalidatePreview: function (message) {
    this._renderRevision += 1;
    this._film = null;
    this._drawEmpty();
    this.setData({ hasPreview: false, hasFilm: false, busy: false });
    this._setPhase(this._snapshot ? 'choose' : 'idle', message || '选择新的阅读范围后重新显影');
    this._setStatus(message || '时间范围已改变；点击“取回并显影”生成新的一页。');
  },

  _drawEmpty: function () {
    if (!this._ctx) return;
    var ctx = this._ctx;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    for (var y = 18; y < HEIGHT; y += 18) {
      ctx.globalAlpha = .22;
      ctx.beginPath();
      ctx.moveTo(0, y + .5);
      ctx.lineTo(WIDTH, y + .5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = QUIET;
    ctx.font = '400 28px "Huiwen Mincho", "Songti SC", serif';
    ctx.fillText('纸面在等一段阅读', 42, 82);
    ctx.font = '14px ui-monospace, Menlo, monospace';
    ctx.fillStyle = BLUE;
    ctx.fillText('PENAUP / E6 PRO / 528 × 792 VISUAL', 44, 116);
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(44, 144);
    ctx.lineTo(196, 144);
    ctx.stroke();
    ctx.fillStyle = QUIET;
    ctx.font = '16px "Huiwen Mincho", "Songti SC", serif';
    ctx.fillText('先取回记录，再让它慢慢显影。', 44, 184);
  },

  _drawBase: function () {
    var ctx = this._ctx;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalAlpha = .24;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    for (var y = 18; y < HEIGHT; y += 18) {
      ctx.beginPath();
      ctx.moveTo(0, y + .5);
      ctx.lineTo(WIDTH, y + .5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  _drawHeading: function (title, subtitle, label) {
    var ctx = this._ctx;
    ctx.fillStyle = BLUE;
    ctx.font = '12px ui-monospace, Menlo, monospace';
    ctx.fillText(label, 36, 40);
    ctx.fillStyle = INK;
    ctx.font = '400 38px "Huiwen Mincho", "Songti SC", serif';
    ctx.fillText(title, 36, 86);
    ctx.fillStyle = QUIET;
    ctx.font = '16px "Huiwen Mincho", "Songti SC", serif';
    drawLines(ctx, subtitle, 36, 116, WIDTH - 72, 22, 2);
    ctx.strokeStyle = LINE;
    ctx.beginPath();
    ctx.moveTo(36, 150);
    ctx.lineTo(WIDTH - 42, 150);
    ctx.stroke();
  },

  _drawWeekly: function (snapshot) {
    var ctx = this._ctx;
    this._drawHeading('本周读书', snapshot.periodLabel || '把一周阅读打印成一张小票。', 'PENAUP / WEEKLY RECEIPT');
    ctx.fillStyle = INK;
    ctx.font = '400 32px "Huiwen Mincho", "Songti SC", serif';
    ctx.fillText(String(snapshot.readingMinutes || 0), 36, 190);
    ctx.fillStyle = QUIET;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText('MINUTES', 37, 209);
    ctx.fillStyle = BLUE;
    ctx.font = '600 26px ui-monospace, Menlo, monospace';
    ctx.fillText(String(snapshot.readingDays || 0), 170, 190);
    ctx.fillStyle = QUIET;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText('DAYS', 171, 209);
    ctx.fillText('LAST SEVEN DAYS', 286, 172);
    var readings = (snapshot.dailyReading || []).slice(-7);
    var max = 1;
    readings.forEach(function (item) { max = Math.max(max, Number(item.readingMinutes) || 0); });
    var barWidth = readings.length ? 200 / readings.length : 0;
    readings.forEach(function (item, index) {
      var height = Math.max(4, ((Number(item.readingMinutes) || 0) / max) * 46);
      ctx.fillStyle = index === readings.length - 1 ? YELLOW : BLUE;
      ctx.fillRect(286 + index * barWidth, 218 - height, Math.max(7, barWidth - 5), height);
    });
    ctx.fillStyle = INK;
    ctx.font = '600 12px ui-monospace, Menlo, monospace';
    ctx.fillText('BOOKS IN THE MARGIN', 36, 278);
    var books = (snapshot.topBookDetails || []).slice(0, 4);
    books.forEach(function (book, index) {
      var y = 314 + index * 56;
      ctx.fillStyle = INK;
      ctx.font = '400 18px "Huiwen Mincho", "Songti SC", serif';
      ctx.fillText(String(index + 1 < 10 ? '0' + (index + 1) : index + 1), 36, y);
      ctx.fillText(clean(book.title, '未命名书籍').slice(0, 18), 72, y);
      ctx.fillStyle = QUIET;
      ctx.font = '12px "SF Pro Text", sans-serif';
      ctx.fillText(clean(book.author, '作者未知'), 72, y + 19);
      ctx.fillStyle = 'rgba(41,39,34,.14)';
      ctx.fillRect(72, y + 29, WIDTH - 108, 3);
      ctx.fillStyle = YELLOW;
      ctx.fillRect(72, y + 29, (WIDTH - 108) * (book.readingMinutes ? clamp(book.readingMinutes / 360, .04, 1) : clamp(book.progress / 100, .04, 1)), 3);
    });
    ctx.fillStyle = RED;
    ctx.fillRect(36, 550, 3, 72);
    ctx.fillStyle = INK;
    ctx.font = '400 21px "Huiwen Mincho", "Songti SC", serif';
    drawLines(ctx, '“' + (snapshot.quote || '把读过的每一页，留给今天。') + '”', 54, 574, WIDTH - 90, 28, 2);
    ctx.fillStyle = QUIET;
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.fillText(String(snapshot.bookCount || 0) + ' BOOKS  /  ' + String(snapshot.noteCount || 0) + ' NOTES', 36, 744);
    ctx.fillStyle = BLUE;
    ctx.textAlign = 'right';
    ctx.fillText('6 INKS · 48 COLOR FEELS · E6 PRO', WIDTH - 36, 744);
    ctx.textAlign = 'left';
  },

  _drawMonthly: function (snapshot) {
    var ctx = this._ctx;
    this._drawHeading('本月阅读', snapshot.periodLabel || '每天读过的书，在月历里留下小小的痕迹。', 'PENAUP / MONTHLY CALENDAR');
    var parts = String(snapshot.periodKey || '').split('-');
    var year = Number(parts[0]) || new Date().getFullYear();
    var month = Number(parts[1]) || new Date().getMonth() + 1;
    var left = 36;
    var top = 160;
    var width = WIDTH - 72;
    var cellWidth = width / 7;
    var totalDays = daysInMonth(year, month);
    var first = new Date(year, month - 1, 1).getDay();
    first = first === 0 ? 6 : first - 1;
    var rows = Math.ceil((first + totalDays) / 7);
    var cellHeight = Math.min(52, 292 / rows);
    var dayMap = {};
    (snapshot.dailyReading || []).forEach(function (item) { dayMap[item.day] = item.readingMinutes; });
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].forEach(function (label, index) {
      ctx.fillStyle = index === 6 ? RED : QUIET;
      ctx.fillText(label, left + index * cellWidth + 5, top - 11);
    });
    for (var day = 1; day <= totalDays; day += 1) {
      var offset = first + day - 1;
      var col = offset % 7;
      var row = Math.floor(offset / 7);
      var x = left + col * cellWidth;
      var y = top + row * cellHeight;
      ctx.strokeStyle = 'rgba(41,39,34,.16)';
      ctx.strokeRect(x, y, cellWidth, cellHeight);
      ctx.fillStyle = INK;
      ctx.font = '400 14px "Huiwen Mincho", "Songti SC", serif';
      ctx.fillText(String(day), x + 5, y + 17);
      if (dayMap[day]) {
        ctx.fillStyle = day % 3 === 0 ? GREEN : day % 2 === 0 ? BLUE : YELLOW;
        var bar = clamp(cellWidth * dayMap[day] / 90, 7, cellWidth - 16);
        ctx.fillRect(x + 5, y + cellHeight - 11, bar, 5);
        ctx.fillStyle = QUIET;
        ctx.font = '10px ui-monospace, Menlo, monospace';
        ctx.fillText(dayMap[day] + 'm', x + 5, y + cellHeight - 15);
      }
    }
    ctx.fillStyle = QUIET;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText('READING THREADS', left, 492);
    ctx.fillStyle = INK;
    ctx.font = '400 17px "Huiwen Mincho", "Songti SC", serif';
    drawLines(ctx, (snapshot.topBooks || []).join('  ·  ') || '等待书名落在日历边缘。', left, 520, WIDTH - 72, 26, 3);
    ctx.fillText(String(snapshot.bookCount || 0) + ' BOOKS  /  ' + String(snapshot.noteCount || 0) + ' NOTES', left, 744);
  },

  _drawBookshelf: function (snapshot) {
    var ctx = this._ctx;
    this._drawHeading('书架标本', snapshot.periodLabel || '读过的书，排成一面安静的墙。', 'PENAUP / BOOKSHELF SPECIMEN');
    var books = (snapshot.topBookDetails || []).slice(0, 9);
    var colors = [INK, BLUE, RED, GREEN, YELLOW, '#8e8067'];
    var shelves = [300, 466, 632];
    ctx.fillStyle = QUIET;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText(String(snapshot.bookCount || books.length) + ' BOOKS / A SMALL WALL OF READING', 36, 150);
    shelves.forEach(function (shelfY, shelfIndex) {
      ctx.fillStyle = 'rgba(41,39,34,.25)';
      ctx.fillRect(36, shelfY, WIDTH - 72, 5);
      var rowBooks = books.slice(shelfIndex * 3, shelfIndex * 3 + 3);
      var x = 58;
      rowBooks.forEach(function (book, index) {
        var title = clean(book.title, '无题');
        var bookWidth = 45 + ((title.length * 7 + index * 11) % 42);
        var bookHeight = 108 + ((index * 17 + shelfIndex * 13) % 31);
        var y = shelfY - bookHeight;
        ctx.fillStyle = colors[(index + shelfIndex) % colors.length];
        roundedRect(ctx, x, y, bookWidth, bookHeight, 3);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 5, y + 7, bookWidth - 10, bookHeight - 14);
        ctx.clip();
        ctx.translate(x + bookWidth / 2, shelfY - 10);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = PAPER;
        ctx.font = '400 14px "Huiwen Mincho", "Songti SC", serif';
        ctx.textAlign = 'center';
        ctx.fillText(title, 0, 4);
        ctx.restore();
        ctx.textAlign = 'left';
        x += bookWidth + 10;
      });
    });
    ctx.fillStyle = QUIET;
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.fillText(String(snapshot.bookCount || books.length) + ' BOOKS  /  ' + String(snapshot.noteCount || 0) + ' NOTES', 36, 744);
  },

  _drawCard: function (snapshot, card) {
    var ctx = this._ctx;
    var book = (snapshot.topBookDetails || [])[0] || {};
    var title = clean(card && card.title || book.title, '正在读的一本书');
    var author = clean(card && card.author || book.author, '作者未知');
    this._drawHeading('我的读书卡', '为一本正在读的书留一页。', 'PENAUP / READING CARD');
    ctx.fillStyle = RED;
    roundedRect(ctx, 36, 154, 184, 270, 4);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.font = '400 25px "Huiwen Mincho", "Songti SC", serif';
    drawLines(ctx, title, 54, 224, 148, 34, 5);
    ctx.font = '12px ui-monospace, Menlo, monospace';
    ctx.fillText(author, 54, 394);
    ctx.fillStyle = INK;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText('ONE BOOK / ONE PAGE', 244, 164);
    ctx.fillStyle = INK;
    ctx.font = '400 31px "Huiwen Mincho", "Songti SC", serif';
    drawLines(ctx, title, 244, 212, WIDTH - 280, 38, 3);
    ctx.fillStyle = QUIET;
    ctx.font = '14px "Huiwen Mincho", "Songti SC", serif';
    ctx.fillText(author + (card && card.category ? '  ·  ' + clean(card.category, 30) : ''), 244, 334);
    var cardProgress = card && Number(card.progress);
    var bookProgress = Number(book.progress);
    var progress = clamp(isFinite(cardProgress) ? cardProgress : isFinite(bookProgress) ? bookProgress : 0, 0, 100);
    ctx.fillStyle = 'rgba(41,39,34,.14)';
    ctx.fillRect(244, 366, WIDTH - 280, 7);
    ctx.fillStyle = YELLOW;
    ctx.fillRect(244, 366, (WIDTH - 280) * progress / 100, 7);
    ctx.fillStyle = QUIET;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText('READING PROGRESS', 244, 394);
    ctx.fillStyle = BLUE;
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(progress) + '%', WIDTH - 36, 394);
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.font = '400 22px "Huiwen Mincho", "Songti SC", serif';
    ctx.fillStyle = RED;
    ctx.fillRect(36, 488, 3, 96);
    ctx.fillStyle = INK;
    drawLines(ctx, '“' + clean(card && (card.excerpt || card.summary) || book.summary || snapshot.quote, '读过的每一页，都会在某天回来。') + '”', 54, 516, WIDTH - 90, 30, 3);
    ctx.fillStyle = QUIET;
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.fillText(String(snapshot.bookCount || 0) + ' BOOKS  /  ' + String(snapshot.noteCount || 0) + ' NOTES', 36, 744);
  },

  _drawSnapshot: function () {
    if (!this._ctx || !this._snapshot) return;
    this._drawBase();
    if (this.data.scene === 'monthly_calendar') this._drawMonthly(this._snapshot);
    else if (this.data.scene === 'bookshelf') this._drawBookshelf(this._snapshot);
    else if (this.data.scene === 'reading_card') this._drawCard(this._snapshot, this._card);
    else this._drawWeekly(this._snapshot);
  },

  _renderFilm: function (revision) {
    var that = this;
    if (!this._ctx || !this._snapshot) return Promise.reject(new Error('preview_not_ready'));
    if (revision !== this._renderRevision) return Promise.resolve(null);
    this._setPhase('developing', '六色显影正在扫描纸面');
    this.setData({ busy: true, hasFilm: false });
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (revision !== that._renderRevision) { resolve(null); return; }
        var previous = filmUtils.getDeviceType();
        try {
          filmUtils.setDeviceType(PROFILE);
          var definition = filmUtils.getRenderingModeDefinition(that.data.renderingMode);
          var imageData = that._ctx.getImageData(0, 0, WIDTH, HEIGHT);
          var dithered = filmUtils.applyDitherByType(imageData, definition.ditherType, definition.defaultStrength);
          var pixels = filmUtils.processImageData(dithered);
          var fileData = filmCore.createFilmFile(PROFILE, pixels);
          var validation = filmCore.validateFilmBuffer(fileData, PROFILE);
          if (!validation.valid) throw new Error('film_contract_invalid');
          if (revision !== that._renderRevision) { filmUtils.setDeviceType(previous); resolve(null); return; }
          var decoded = filmUtils.decodeProcessedData(pixels, WIDTH, HEIGHT);
          var output = that._ctx.createImageData(WIDTH, HEIGHT);
          output.data.set(decoded.data);
          that._ctx.putImageData(output, 0, 0);
          that._film = fileData;
          that.setData({ busy: false, hasPreview: true, hasFilm: true });
          that._setPhase('keep', '六色显影已完成');
          that._setStatus('这张 Pro 屏保已经显影。可以保存预览，或发送到已连接的花生片 Pro。', 'success');
          filmUtils.setDeviceType(previous);
          resolve(fileData);
        } catch (error) {
          filmUtils.setDeviceType(previous);
          if (revision !== that._renderRevision) { resolve(null); return; }
          that.setData({ busy: false, hasFilm: false });
          that._setPhase('failed', '显影失败，可保留草稿重试');
          that._setStatus('六色显影暂时失败，阅读数据和版式仍保留，可以重新尝试。', 'error');
          reject(error);
        }
      }, 40);
    });
  },

  _renderSnapshot: function () {
    var revision = ++this._renderRevision;
    this._drawSnapshot();
    this.setData({ hasPreview: true, hasFilm: false });
    return this._renderFilm(revision);
  },

  _booksForPicker: function (snapshot) {
    return (snapshot && snapshot.topBookDetails || []).map(function (book) {
      return { id: book.bookId || '', label: clean(book.title, '未命名书籍') + (book.author ? ' · ' + clean(book.author, 36) : '') };
    }).filter(function (book) { return !!book.id; });
  },

  _applySnapshot: function (snapshot) {
    this._snapshot = snapshot;
    this._card = null;
    var books = this._booksForPicker(snapshot);
    this.setData({
      stats: {
        readingMinutes: snapshot.readingMinutes,
        readingDays: snapshot.readingDays,
        bookCount: snapshot.bookCount,
        noteCount: snapshot.noteCount
      },
      books: books,
      selectedBookIndex: 0
    });
  },

  _friendlyError: function (error) {
    var code = error && error.code;
    return {
      weread_api_base_required: '请先填写花生片服务地址。',
      weread_api_base_invalid: '服务地址格式不对，需要 HTTP 或 HTTPS 地址。',
      weread_key_invalid: '请填入有效的微信读书 Skill Key。',
      weread_key_rejected: '这个 Key 似乎无效或已过期，请检查后重试。',
      weread_network_error: '花生片服务暂时无法连接，请检查地址或网络。',
      weread_rate_limited: '请求有点频繁，请稍等一分钟再试。',
      weread_timeout: '微信读书请求超时；当前草稿仍保留，可以稍后重试。'
    }[code] || '微信读书暂时不可用；当前草稿仍保留，可以稍后重试。';
  },

  onApiInput: function (event) { this.setData({ apiBaseUrl: clean(event.detail.value) }); },
  onKeyInput: function (event) { this.setData({ skillKey: clean(event.detail.value) }); },
  onMonthChange: function (event) { this.setData({ month: event.detail.value }); },
  saveApiBase: function () {
    try {
      var url = wereadApi.storeBaseUrl(this.data.apiBaseUrl);
      this.setData({ apiBaseUrl: url });
      wx.showToast({ title: '服务地址已保存', icon: 'success' });
    } catch (error) { this._setStatus(this._friendlyError(error), 'error'); }
  },
  clearApiBase: function () {
    wereadApi.clearStoredBaseUrl();
    this.setData({ apiBaseUrl: '' });
    this._setStatus('已清除本机保存的服务地址；临时 Key 从未写入本机。');
  },

  chooseScene: function (event) {
    var scene = event.currentTarget.dataset.scene || 'weekly_receipt';
    var requiredMode = event.currentTarget.dataset.mode;
    var modeChanged = requiredMode && requiredMode !== this.data.mode;
    var that = this;
    this._card = null;
    this.setData({ scene: scene, mode: modeChanged ? requiredMode : this.data.mode }, function () {
      if (modeChanged) {
        if (that.data.source === 'demo') { that.loadDemo(); return; }
        that._invalidatePreview('这张纸需要' + (that.data.mode === 'monthly' ? '本月' : '本周') + '数据；请重新取回并显影。');
        return;
      }
      that._setPhase(that._snapshot ? 'choose' : 'idle', that._snapshot ? '已换一张纸，准备重新显影' : '纸面在等一段阅读');
      if (that._snapshot) that._renderSnapshot().catch(function () {});
    });
  },

  chooseMode: function (event) {
    var mode = filmUtils.normalizeRenderingMode(event.currentTarget.dataset.mode);
    this.setData({ renderingMode: mode, renderingModeNote: filmUtils.getRenderingModeDefinition(mode).description });
    if (this._snapshot) this._renderSnapshot().catch(function () {});
  },

  choosePeriod: function (event) {
    var nextMode = event.currentTarget.dataset.mode === 'monthly' ? 'monthly' : 'weekly';
    if (nextMode === this.data.mode) return;
    var that = this;
    var nextScene = this.data.scene;
    if (nextMode === 'monthly' && nextScene === 'weekly_receipt') nextScene = 'monthly_calendar';
    if (nextMode === 'weekly' && nextScene === 'monthly_calendar') nextScene = 'weekly_receipt';
    this.setData({ mode: nextMode, scene: nextScene }, function () {
      if (that.data.source === 'demo') { that.loadDemo(); return; }
      that._invalidatePreview('时间范围已改变；请重新取回并显影，避免把旧的纸面误当成新范围。');
    });
  },

  loadDemo: function () {
    var that = this;
    if (!this._ctx) { wx.showToast({ title: '画布还没准备好', icon: 'none' }); return; }
    this._renderRevision += 1;
    var snapshot = demoSnapshot(this.data.mode);
    this._setPhase('fetching', '示例阅读轨迹已就位');
    this._setStatus('示例数据只在本地使用，不会连接微信读书。');
    this.setData({ busy: true, source: 'demo', hasPreview: false, hasFilm: false });
    this._applySnapshot(snapshot);
    setTimeout(function () {
      that._renderSnapshot().catch(function () {});
    }, 80);
  },

  connectSource: function () {
    var that = this;
    var key = wereadApi.normalizeSkillKey(this.data.skillKey);
    if (!key) { this._setStatus('请填入有效的微信读书 Skill Key。', 'error'); return; }
    try { wereadApi.storeBaseUrl(this.data.apiBaseUrl); } catch (error) { this._setStatus(this._friendlyError(error), 'error'); return; }
    this._setPhase('fetching', '正在确认微信读书书架');
    this._setStatus('正在确认 Skill，只读取书架数量，不保存书架内容。');
    this.setData({ busy: true, source: 'live' });
    wereadApi.createClient(this.data.apiBaseUrl).connect(key).then(function (summary) {
      that.setData({ busy: false });
      that._setPhase('choose', '书架已连接，选择一张纸');
      that._setStatus((summary.ebooks || 0) + ' 本电子书已经接上；现在选择时间范围和壁纸场景。', 'success');
    }).catch(function (error) {
      that.setData({ busy: false });
      that._setPhase('failed', '书架连接失败，可检查后重试');
      that._setStatus(that._friendlyError(error), 'error');
    });
  },

  fetchSnapshot: function () {
    var that = this;
    var key = wereadApi.normalizeSkillKey(this.data.skillKey);
    if (!key) { this._setStatus('请填入有效的微信读书 Skill Key。', 'error'); return; }
    try { wereadApi.storeBaseUrl(this.data.apiBaseUrl); } catch (error) { this._setStatus(this._friendlyError(error), 'error'); return; }
    this._setPhase('fetching', '正在取回阅读轨迹');
    this._setStatus('阅读记录会被整理成这一张纸，服务端不会保存 Key 或生成文件。');
    this._renderRevision += 1;
    this._film = null;
    this.setData({ busy: true, source: 'live', hasFilm: false });
    wereadApi.createClient(this.data.apiBaseUrl).snapshot(key, { mode: this.data.mode, month: this.data.month, enrich: true }).then(function (snapshot) {
      that._applySnapshot(snapshot);
      return that._loadCardIfNeeded(key);
    }).then(function () {
      return that._renderSnapshot();
    }).catch(function (error) {
      that.setData({ busy: false });
      that._setPhase('failed', '阅读数据未取回，当前草稿仍保留');
      that._setStatus(that._friendlyError(error), 'error');
    });
  },

  _loadCardIfNeeded: function (key) {
    var that = this;
    if (this.data.scene !== 'reading_card' || !this.data.books.length) return Promise.resolve();
    var book = this.data.books[this.data.selectedBookIndex] || this.data.books[0];
    if (!book || !book.id) return Promise.resolve();
    return wereadApi.createClient(this.data.apiBaseUrl).readingCard(key, book.id).then(function (card) {
      that._card = card;
    }).catch(function () {
      that._card = null;
      that._setStatus('统计已取回，但这本书的补充信息暂时不可用；仍然可以生成读书卡。', 'pending');
    });
  },

  onBookChange: function (event) {
    var index = Number(event.detail.value) || 0;
    this.setData({ selectedBookIndex: index });
    if (this._snapshot && this.data.scene === 'reading_card') {
      var key = wereadApi.normalizeSkillKey(this.data.skillKey);
      var book = this.data.books[index];
      if (!key || !book) { this._renderSnapshot().catch(function () {}); return; }
      var that = this;
      this._setPhase('fetching', '正在取回这本书的细节');
      wereadApi.createClient(this.data.apiBaseUrl).readingCard(key, book.id).then(function (card) {
        that._card = card;
        return that._renderSnapshot();
      }).catch(function () {
        that._card = null;
        return that._renderSnapshot();
      });
    }
  },

  savePreview: function () {
    var that = this;
    if (!this._canvas || !this.data.hasPreview) return;
    wx.canvasToTempFilePath({
      canvas: this._canvas,
      destWidth: WIDTH,
      destHeight: HEIGHT,
      fileType: 'png',
      success: function (result) {
        wx.saveImageToPhotosAlbum({
          filePath: result.tempFilePath,
          success: function () { that._setStatus('PNG 已留在相册；这张纸仍保留在当前草稿里。', 'success'); },
          fail: function () { that._setStatus('没有保存到相册；可以重新授权后再试。', 'error'); }
        });
      },
      fail: function () { that._setStatus('预览图片暂时没有生成成功，请重新尝试。', 'error'); }
    });
  },

  sendToDevice: function () {
    var that = this;
    if (!this._film) { this._setStatus('请先完成六色显影。', 'error'); return; }
    if (!app.globalData.isConnected) { wx.showToast({ title: '请先连接设备', icon: 'none' }); return; }
    var type = filmUtils.getDeviceTypeFromName(app.globalData.deviceType || filmUtils.DEFAULT_DEVICE_TYPE);
    if (type !== 'PENAUPPRO') { this._setStatus('这张屏保固定为花生片 Pro 528 × 792 竖向相纸（film 协议 792 × 528），请连接 Pro 后发送。', 'error'); return; }
    var baseName = 'weread-' + this.data.scene;
    this._pendingTransfer = { fileData: this._film, baseName: baseName };
    this.setData(transferView.beginning(baseName));
    this._setPhase('transferring', '正在通过 BLE 写入 Pro');
    bleTransfer.sendFilm(this._film, baseName, {
      renderingDetail: filmUtils.getRenderingModeDefinition(this.data.renderingMode).label,
      onStatus: function (event) { that.setData(transferView.fromEvent(event)); }
    }).then(function () {
      that._setPhase('pending', '已写入，等待电子纸刷新确认');
      that._setStatus('已经写入 Pro；电子纸刷新结果待确认，不把写入进度当成完成。', 'pending');
    }).catch(function () {
      that._setPhase('failed', '写入失败，可从当前显影结果重试');
    });
  },

  retryTransfer: function () {
    if (!this._pendingTransfer) return;
    this.setData(transferView.beginning(this._pendingTransfer.baseName));
    this.sendToDevice();
  },

  closeTransfer: function () { this.setData(transferView.closed()); }
});
