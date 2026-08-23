// 一言 - 语录
var filmUtils = require('../../../utils/film-utils');
var bleTransfer = require('../../../utils/ble-transfer');
var transferView = require('../../../utils/transfer-view');
var app = getApp();

var FILM_HEADER_SIZE = filmUtils.FILM_HEADER_SIZE;

var frameColorSchemes = [
  { bg: '#ffffff', text: '#000000', accent: '#ff0000', author: '#000000' },
  { bg: '#ffffff', text: '#000000', accent: '#0000ff', author: '#000000' },
  { bg: '#ffffff', text: '#000000', accent: '#29cc14', author: '#000000' },
];

var localQuotes = [
  { text: '把今天留给明天看。', author: '花生片' },
  { text: '慢一点，画面会自己找到位置。', author: 'Penaup' },
  { text: '日常值得被好好保存。', author: '花生片' },
  { text: '光落在纸上，也落在心里。', author: 'Penaup' },
  { text: '留下一张，想起一整天。', author: '花生片' }
];

Page({
  data: {
    ditherChecked: true,
    customQuoteText: '',
    customQuoteAuthor: '',
    showCustomPanel: false,
    quoteText: '',
    quoteAuthor: '',
    showTransfer: false,
    transferStatus: '',
    transferProgress: 0,
    transferTitle: '',
    transferPhaseLabel: '',
    transferOutcome: 'pending',
    transferCanRetry: false,
    transferCanClose: false,
  },

  _canvas: null,
  _ctx: null,

  noop: function () {},

  onReady: function () {
    this._initCanvas();
  },

  onShow: function () {
    var that = this;
    if (!that._canvas) {
      setTimeout(function () { that._initCanvas(); }, 100);
    }
    // 首次进入自动获取语录
    if (!that.data.quoteText) {
      setTimeout(function () { that.fetchQuote(); }, 200);
    }
  },

  _initCanvas: function () {
    var that = this;
    if (that._canvas) return;
    var query = wx.createSelectorQuery();
    query.select('#canvas-quote').fields({ node: true, size: true }).exec(function (res) {
      if (!res || !res[0] || !res[0].node) return;
      var canvas = res[0].node;
      var ctx = canvas.getContext('2d');
      var CW = filmUtils.getCanvasWidth();
      var CH = filmUtils.getCanvasHeight();
      canvas.width = CW;
      canvas.height = CH;
      that._canvas = canvas;
      that._ctx = ctx;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, CW, CH);
    });
  },

  fetchQuote: function () {
    var that = this;
    var quote = localQuotes[Math.floor(Math.random() * localQuotes.length)];
    that.setData({
      quoteText: quote.text,
      quoteAuthor: quote.author
    });
    that.renderQuote();
  },

  renderQuote: function () {
    var that = this;
    var canvas = that._canvas;
    var ctx = that._ctx;
    if (!canvas || !ctx) return;

    var text = that.data.quoteText;
    var author = that.data.quoteAuthor;
    if (!text) return;

    var scheme = frameColorSchemes[Math.floor(Math.random() * frameColorSchemes.length)];
    var CW = filmUtils.getCanvasWidth();
    var CH = filmUtils.getCanvasHeight();
    // 模板始终在视觉相纸上绘制；Pro 是 528 × 792 竖向，film
    // 协议的 792 × 528 旋转只在 extractLandscapeData() 中发生。
    var w = CW;
    var h = CH;

    ctx.clearRect(0, 0, CW, CH);

    // 纯色背景
    ctx.fillStyle = scheme.bg;
    ctx.fillRect(0, 0, w, h);

    // 装饰引号
    ctx.font = '80px serif';
    ctx.fillStyle = scheme.accent;
    ctx.textAlign = 'left';
    ctx.fillText('\u201C', 5, 90);

    // 装饰线
    ctx.strokeStyle = scheme.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(45, 100);
    ctx.lineTo(100, 100);
    ctx.stroke();

    // 文字居中
    ctx.font = 'bold 30px serif';
    ctx.fillStyle = scheme.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var lines = filmUtils.wrapText(ctx, text, 30, w - 80);
    var zhLineHeight = 44;
    var zhTotalHeight = lines.length * zhLineHeight;
    var bottomSpace = author ? 130 : 60;
    var availableHeight = h - 100 - bottomSpace;
    var zhStartY = 100 + (availableHeight - zhTotalHeight) / 2;

    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], w / 2, zhStartY + i * zhLineHeight);
    }

    // 作者
    if (author) {
      ctx.font = 'bold 18px serif';
      ctx.fillStyle = scheme.author;
      ctx.fillText('\u2014\u2014 ' + author, w / 2, h - 130);
    }

    // 底部装饰线
    ctx.strokeStyle = scheme.accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 30, h - 65);
    ctx.lineTo(w / 2 + 30, h - 65);
    ctx.stroke();

    // 电量图标
    var batteryLevel = (app.globalData.batteryLevel || 0) / 100;
    var battX = w - 55, battY = 20;
    var battW = 35, battH = 18;
    var battR = 4;

    function drawRoundedRect(x, y, width, height, radius) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }

    drawRoundedRect(battX, battY, battW, battH, battR);
    ctx.strokeStyle = scheme.accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = scheme.accent;
    ctx.fillRect(battX + battW + 1, battY + 5, 3, battH - 10);

    drawRoundedRect(battX + 2, battY + 2, (battW - 4) * batteryLevel, battH - 4, 2);
    ctx.fillStyle = scheme.accent;
    ctx.fill();

    // 日期
    var now = new Date();
    var dateStr = now.getFullYear() + ' \u5E74 ' + ('0' + (now.getMonth() + 1)).slice(-2) + ' \u6708 ' + ('0' + now.getDate()).slice(-2) + ' \u65E5';
    ctx.font = '600 16px sans-serif';
    ctx.fillStyle = scheme.accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(dateStr, w / 2, h - 30);

    // Film 格式处理并回显
    var ditherType = that.data.ditherChecked ? 'floydSteinberg' : null;
    filmUtils.processAndDisplay(canvas, ctx, ditherType, 0.8, null);
  },

  toggleCustomPanel: function () {
    this.setData({ showCustomPanel: !this.data.showCustomPanel });
  },

  onCustomQuoteInput: function (e) {
    this.setData({ customQuoteText: e.detail.value });
  },

  onCustomAuthorInput: function (e) {
    this.setData({ customQuoteAuthor: e.detail.value });
  },

  generateCustomQuote: function () {
    var text = this.data.customQuoteText.trim();
    if (!text) {
      wx.showToast({ title: '请输入文字', icon: 'none' });
      return;
    }
    this.setData({
      quoteText: text,
      quoteAuthor: this.data.customQuoteAuthor.trim()
    });
    this.renderQuote();
  },

  toggleDither: function () {
    this.setData({ ditherChecked: !this.data.ditherChecked });
    if (this.data.quoteText) {
      this.renderQuote();
    }
  },

  sendToDevice: function () {
    var that = this;
    var canvas = that._canvas;
    var ctx = that._ctx;
    if (!canvas || !ctx) {
      wx.showToast({ title: '画布未就绪', icon: 'none' });
      return;
    }

    var imageData = filmUtils.extractLandscapeData(canvas);
    var processedData = filmUtils.processImageData(imageData);
    var header = filmUtils.generateFilmHeader();

    var totalSize = filmUtils.getFilmFileTotalSize();
    var fileData = new Uint8Array(totalSize);
    fileData.set(header, 0);
    fileData.set(processedData, FILM_HEADER_SIZE);

    that._pendingTransfer = { fileData: fileData, baseName: 'quote' };
    that._sendPendingTransfer();
  },

  _sendPendingTransfer: function () {
    var that = this;
    var pending = this._pendingTransfer;
    if (!pending) return;
    that.setData(transferView.beginning(pending.baseName));
    bleTransfer.sendFilm(pending.fileData, pending.baseName, {
      onStatus: function (event) { that.setData(transferView.fromEvent(event)); }
    }).catch(function (err) {
      console.error('Penaup quote transfer failed:', err);
    });
  },

  retryTransfer: function () {
    this._sendPendingTransfer();
  },

  closeTransfer: function () {
    this.setData(transferView.closed());
  },
});
