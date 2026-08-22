// 模板 - 天气
var filmUtils = require('../../../utils/film-utils');
var tplWeather = require('../../../utils/tpl-weather');
var sender = require('../../../utils/template-sender');
var e6pro = require('../../../utils/e6pro');
var transferView = require('../../../utils/transfer-view');
var app = getApp();

Page({
  data: {
    schemes: tplWeather.SCHEMES,
    schemeIndex: 0,
    cityLabel: '',
    showTransfer: false,
    transferStatus: '',
    transferProgress: 0,
    transferPhaseLabel: '',
    transferCanRetry: false,
    transferCanClose: false
  },

  _canvas: null,
  _ctx: null,
  _data: null,

  noop: function () {},

  onReady: function () {
    this._initCanvas();
  },

  onShow: function () {
    var that = this;
    if (!that._data) {
      that._data = tplWeather.getDemoData();
      that.setData({ cityLabel: that._data.city });
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
    if (!that._canvas || !that._ctx || !that._data) return;
    var canvas = that._canvas;
    var ctx = that._ctx;
    e6pro.processTemplate(canvas, ctx, function (rec, W, H) {
      tplWeather.render(rec, W, H, that._data, that.data.schemes[that.data.schemeIndex]);
    });
  },

  useDemo: function () {
    var that = this;
    that._data = tplWeather.getDemoData();
    that.setData({ cityLabel: that._data.city });
    that._render();
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
    that._pendingTransfer = { fileData: fileData, baseName: 'tpl-weather' };
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
