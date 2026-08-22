// 模板 - 每日一签
var filmUtils = require('../../../utils/film-utils');
var tplSign = require('../../../utils/tpl-sign');
var sender = require('../../../utils/template-sender');
var e6pro = require('../../../utils/e6pro');
var transferView = require('../../../utils/transfer-view');
var app = getApp();

Page({
  data: {
    schemes: tplSign.SCHEMES,
    schemeIndex: 0,
    showTransfer: false,
    transferStatus: '',
    transferProgress: 0,
    transferPhaseLabel: '',
    transferCanRetry: false,
    transferCanClose: false
  },

  _canvas: null,
  _ctx: null,
  _sign: null,

  noop: function () {},

  onReady: function () {
    this._initCanvas();
  },

  onShow: function () {
    var that = this;
    if (!that._sign) {
      that._sign = tplSign.getRandomSign();
    }
    if (!that._canvas) {
      setTimeout(function () { that._initCanvas(); }, 100);
    }
  },

  _initCanvas: function () {
    var that = this;
    if (that._canvas) return;
    var query = wx.createSelectorQuery();
    query.select('#canvas-tpl').fields({ node: true, size: true }).exec(function (res) {
      if (!res || !res[0] || !res[0].node) return;
      var canvas = res[0].node;
      var ctx = canvas.getContext('2d');
      canvas.width = filmUtils.getCanvasWidth();
      canvas.height = filmUtils.getCanvasHeight();
      that._canvas = canvas;
      that._ctx = ctx;
      that._render();
    });
  },

  _render: function () {
    var that = this;
    if (!that._canvas || !that._ctx || !that._sign) return;
    var canvas = that._canvas;
    var ctx = that._ctx;
    // imgStrategy='adaptive'：印章条走自适应抖动（保留主题色网点质感），文字层保持清晰
    e6pro.processTemplate(canvas, ctx, function (rec, W, H) {
      tplSign.render(rec, W, H, that._sign, that.data.schemes[that.data.schemeIndex]);
    }, { imgStrategy: 'adaptive' });
  },

  refreshSign: function () {
    this._sign = tplSign.getRandomSign();
    this._render();
  },

  selectScheme: function (e) {
    this.setData({ schemeIndex: Number(e.currentTarget.dataset.idx) });
    this._render();
  },

  sendToDevice: function () {
    var that = this;
    if (!that._canvas) {
      wx.showToast({ title: '画布未就绪', icon: 'none' });
      return;
    }
    var fileData = e6pro.canvasToFilmData(that._canvas);
    that._pendingTransfer = { fileData: fileData, baseName: 'tpl-sign' };
    that._sendPendingTransfer();
  },

  _sendPendingTransfer: function () {
    var that = this;
    if (!this._pendingTransfer) return;
    that.setData(transferView.beginning(that._pendingTransfer.baseName));
    sender.sendToDevice(that._pendingTransfer.fileData, that._pendingTransfer.baseName, function (event) {
      that.setData(transferView.fromEvent(event));
    }).catch(function (error) {
      console.error('Penaup template transfer failed:', error);
    });
  },

  retryTransfer: function () { this._sendPendingTransfer(); },

  closeTransfer: function () {
    this.setData(transferView.closed());
  }
});
