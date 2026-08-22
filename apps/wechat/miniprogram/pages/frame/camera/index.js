// 定影 - 拍照上传
var filmUtils = require('../../../utils/film-utils');
var bleTransfer = require('../../../utils/ble-transfer');
var transferView = require('../../../utils/transfer-view');

var FILM_HEADER_SIZE = filmUtils.FILM_HEADER_SIZE;

function fitImageToCanvas(imgW, imgH, canvasW, canvasH) {
  var ratio = Math.max(canvasW / imgW, canvasH / imgH);
  var w = imgW * ratio;
  var h = imgH * ratio;
  var x = (canvasW - w) / 2;
  var y = (canvasH - h) / 2;
  return { x: x, y: y, w: w, h: h };
}

Page({
  data: {
    sendDisabled: true,
    showTransfer: false,
    transferStatus: '',
    transferProgress: 0,
    transferTitle: '',
    transferPhaseLabel: '',
    transferOutcome: 'pending',
    transferCanRetry: false,
    transferCanClose: false,
    showFileName: false,
    isEditingName: false,
    customFileName: '',
  },

  _canvas: null,
  _ctx: null,

  noop: function () {},

  onReady: function () {
    this._initCanvas();
  },

  _initCanvas: function () {
    var that = this;
    if (that._canvas) return;
    var query = wx.createSelectorQuery();
    query.select('#canvas-camera').fields({ node: true, size: true }).exec(function (res) {
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

  openCamera: function () {
    var that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      success: function (res) {
        var tempFilePath = res.tempFiles[0].tempFilePath;
        that._loadImage(tempFilePath);
      }
    });
  },

  _loadImage: function (tempFilePath) {
    var that = this;
    var canvas = that._canvas;
    var ctx = that._ctx;
    if (!canvas || !ctx) {
      wx.showToast({ title: '画布未就绪', icon: 'none' });
      return;
    }

    var CW = filmUtils.getCanvasWidth();
    var CH = filmUtils.getCanvasHeight();

    var img = canvas.createImage();
    img.onload = function () {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, CW, CH);

      var fit = fitImageToCanvas(img.width, img.height, CW, CH);
      ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);

      try {
        filmUtils.processAndDisplay(canvas, ctx, 'adaptive', 1.0, 1.2);
      } catch (e) {
        console.error('processAndDisplay error:', e);
      }

      that.setData({ sendDisabled: false, showFileName: true, customFileName: filmUtils.generateRandomFilename('camera'), isEditingName: false });
    };
    img.onerror = function () {
      wx.showToast({ title: '图片加载失败', icon: 'none' });
    };
    img.src = tempFilePath;
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

    that._pendingTransfer = { fileData: fileData, baseName: that.data.customFileName || filmUtils.generateRandomFilename('camera') };
    that._sendPendingTransfer();
  },

  startEditName: function () {
    this.setData({ isEditingName: true });
  },

  onFileNameInput: function (e) {
    this.setData({ customFileName: e.detail.value });
  },

  onFileNameBlur: function () {
    this.setData({ isEditingName: false });
  },

  _sendPendingTransfer: function () {
    var that = this;
    var pending = this._pendingTransfer;
    if (!pending) return;
    that.setData(transferView.beginning(pending.baseName));
    bleTransfer.sendFilm(pending.fileData, pending.baseName, {
      onStatus: function (event) { that.setData(transferView.fromEvent(event)); }
    }).catch(function (err) {
      console.error('Penaup camera transfer failed:', err);
    });
  },

  retryTransfer: function () {
    this._sendPendingTransfer();
  },

  closeTransfer: function () {
    this.setData(transferView.closed());
  },
});
