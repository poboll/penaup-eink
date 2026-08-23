// 首页 - 设备状态 + 一键发送
var app = getApp();
var recentUtils = require('../../utils/recent-utils');
var filmUtils = require('../../utils/film-utils');
var bleUtils = require('../../utils/ble-utils');
var bleTransfer = require('../../utils/ble-transfer');
var transferView = require('../../utils/transfer-view');

// 缩略图缓存（key: name|time），避免每次 onShow 重复渲染
var thumbCache = {};

Page({
  data: {
    showIntro: false,
    isConnected: false,
    deviceName: '',
    deviceTypeText: '',
    batteryLevel: 0,
    currentFile: '',
    devThumb: '',
    monthName: '',
    recentList: [],
    showTransfer: false,
    transferStatus: '',
    transferProgress: 0,
    transferTitle: '',
    transferPhaseLabel: '',
    transferOutcome: 'pending',
    transferCanRetry: false,
    transferCanClose: false,
    transferRenderingDetail: '',
    transferBusy: false
  },

  // 最近上墙原始记录（含 film 数据），仅供点击时使用，不进入 setData
  _recentRaw: [],
  _disconnectTimer: null,

  _bleListener: null,

  onLoad: function () {
    var seen = false;
    try { seen = wx.getStorageSync('penaup.introSeen') === '1'; } catch (e) {}
    if (!seen) {
      this.setData({ showIntro: true });
      this._introTimer = setTimeout(this.dismissIntro.bind(this), 1600);
    }
  },

  dismissIntro: function () {
    if (this._introTimer) {
      clearTimeout(this._introTimer);
      this._introTimer = null;
    }
    this.setData({ showIntro: false });
    try { wx.setStorageSync('penaup.introSeen', '1'); } catch (e) {}
  },

  noop: function () {},

  onShow: function () {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    var that = this;
    this._syncFromGlobal();
    // 已连接时主动刷新当前显示与文件列表，保证设备框「显示中」同步
    // （设备自动加载新文件后不会主动推送，需客户端查询）
    if (app.globalData.isConnected) {
      app.sendBleCmd(bleUtils.BLE_FILM_TRANS_CH_FILE_LIST, null).catch(function () {});
      app.sendBleCmd(bleUtils.BLE_FILM_TRANS_CH_FILE_DISPLAY_GET, null).catch(function () {});
    }
    // 注册 BLE 监听，实时刷新电量/当前显示文件
    this._bleListener = function () {
      that._syncFromGlobal();
    };
    app.registerBleDataListener(this._bleListener);
  },

  onHide: function () {
    this._removeBleListener();
    this._stopDisconnectWatch();
  },

  onUnload: function () {
    if (this._introTimer) clearTimeout(this._introTimer);
    this._removeBleListener();
    this._stopDisconnectWatch();
  },

  _removeBleListener: function () {
    if (this._bleListener) {
      app.unregisterBleDataListener(this._bleListener);
      this._bleListener = null;
    }
  },

  _syncFromGlobal: function () {
    var g = app.globalData;
    filmUtils.setDeviceType(g.deviceType || filmUtils.DEFAULT_DEVICE_TYPE);
    var deviceConfig = filmUtils.getDeviceConfig();
    var currentFile = '';
    var list = g.fileList || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].fileId === g.currentDisplayFileId) {
        currentFile = list[i].name;
        break;
      }
    }
    var devThumb = currentFile ? (thumbCache['dev:' + currentFile] || '') : '';
    if (g.isConnected && currentFile && !devThumb) {
      this._renderDevThumb(currentFile);
    }
    var recentRaw = recentUtils.getRecent().slice(0, 9);
    this._recentRaw = recentRaw;
    var recentList = [];
    for (var j = 0; j < recentRaw.length; j++) {
      var item = recentRaw[j];
      recentList.push({
        name: item.name,
        time: item.time,
        thumb: thumbCache[item.name + '|' + item.time] || ''
      });
    }
    this.setData({
      isConnected: g.isConnected,
      deviceName: g.deviceName || deviceConfig.displayName,
      deviceTypeText: deviceConfig.displayName,
      batteryLevel: g.batteryLevel,
      currentFile: currentFile,
      devThumb: devThumb,
      monthName: (new Date().getMonth() + 1) + '月日历',
      recentList: recentList
    });
    this._renderRecentThumbs(recentRaw);
  },

  // 渲染设备框当前显示文件的预览（从草稿/最近记录中匹配同名 film 数据）
  _renderDevThumb: function (name) {
    var that = this;
    var found = null;
    var drafts = recentUtils.getDrafts();
    for (var i = 0; i < drafts.length; i++) {
      if (drafts[i].name === name && drafts[i].dataPath) {
        found = drafts[i];
        break;
      }
    }
    if (!found) {
      var recents = recentUtils.getRecent();
      for (var j = 0; j < recents.length; j++) {
        if (recents[j].name === name && recents[j].dataPath) {
          found = recents[j];
          break;
        }
      }
    }
    if (!found) return;
    var fileData;
    try {
      fileData = recentUtils.readFilmData(found);
    } catch (e) {
      return;
    }
    filmUtils.renderFilmThumbnail(fileData, function (path) {
      if (!path) return;
      thumbCache['dev:' + name] = path;
      that.setData({ devThumb: path });
    });
  },

  // 异步为最近上墙渲染 film 缩略图（带缓存）
  _renderRecentThumbs: function (rawList) {
    var that = this;
    for (var i = 0; i < rawList.length; i++) {
      (function (item) {
        if (!item || !item.dataPath) return;
        var key = item.name + '|' + item.time;
        if (thumbCache[key]) return;
        var fileData;
        try {
          fileData = recentUtils.readFilmData(item);
        } catch (e) {
          return;
        }
        filmUtils.renderFilmThumbnail(fileData, function (path) {
          if (!path) return;
          thumbCache[key] = path;
          var cur = that.data.recentList;
          for (var k = 0; k < cur.length; k++) {
            if (cur[k].name === item.name && cur[k].time === item.time) {
              cur[k].thumb = path;
              that.setData({ recentList: cur.slice() });
              break;
            }
          }
        });
      })(rawList[i]);
    }
  },

  // 点击设备卡 → 蓝牙连接页
  goBluetooth: function () {
    wx.navigateTo({ url: '/pages/bluetooth/index' });
  },

  // 发送照片 CTA → 相册上传
  sendPhoto: function () {
    if (!app.globalData.isConnected) {
      wx.showToast({ title: '请先连接设备', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/frame/upload/index' });
  },

  // 拍一张 CTA → 相机页
  goCamera: function () {
    wx.navigateTo({ url: '/pages/frame/camera/index' });
  },

  // 模板卡 → 模板中心
  goToTemplate: function () {
    wx.navigateTo({ url: '/pages/template/index' });
  },

  // 微信读书阅读轨迹 → Pro 版屏保
  goWeread: function () {
    wx.navigateTo({ url: '/pages/weread/index' });
  },

  // 最近上墙点击：设备有同名文件直接切换显示，否则上传这一张
  tapRecent: function (e) {
    var that = this;
    var index = e.currentTarget.dataset.index;
    var item = (this._recentRaw && this._recentRaw[index]) || null;
    if (!item) return;
    if (!app.globalData.isConnected) {
      wx.showToast({ title: '请先连接设备', icon: 'none' });
      return;
    }
    if (!item.dataPath) {
      wx.showToast({ title: '本地数据已失效，请重新制作', icon: 'none' });
      return;
    }
    var fileList = app.globalData.fileList || [];
    if (fileList.length === 0) {
      // 设备文件列表还没拉取过，先刷新再检索
      this._loadFileListThen(function (list) {
        that._switchOrUpload(item, list);
      });
    } else {
      this._switchOrUpload(item, fileList);
    }
  },

  // 拉取设备文件列表并等待收集完成
  _loadFileListThen: function (callback) {
    var g = app.globalData;
    g.fileList = [];
    app.sendBleCmd(bleUtils.BLE_FILM_TRANS_CH_FILE_LIST, null).then(function () {
      var startTime = Date.now();
      var lastCount = -1;
      function check() {
        var count = (g.fileList || []).length;
        if (count > 0 && count === lastCount) {
          callback((g.fileList || []).slice());
          return;
        }
        if (Date.now() - startTime > 10000) {
          callback((g.fileList || []).slice());
          return;
        }
        lastCount = count;
        setTimeout(check, 800);
      }
      check();
    }).catch(function () {
      callback((g.fileList || []).slice());
    });
  },

  // 检索设备文件列表，有则切换显示，无则上传
  _switchOrUpload: function (item, fileList) {
    var that = this;
    var found = null;
    for (var i = 0; i < fileList.length; i++) {
      if (fileList[i].name === item.name) {
        found = fileList[i];
        break;
      }
    }
    if (found) {
      app.sendBleCmd(bleUtils.BLE_FILM_TRANS_CH_FILE_DISPLAY, found.fileId).then(function () {
        wx.showToast({ title: '已切换显示', icon: 'success' });
        setTimeout(function () {
          app.sendBleCmd(bleUtils.BLE_FILM_TRANS_CH_FILE_DISPLAY_GET, null);
        }, 500);
      }).catch(function () {
        wx.showToast({ title: '切换失败', icon: 'none' });
      });
      return;
    }
    // 设备上没有 → 重新上传
    var fileData;
    try {
      fileData = recentUtils.readFilmData(item);
    } catch (err) {
      wx.showToast({ title: '数据解析失败', icon: 'none' });
      return;
    }
    that._pendingTransfer = { fileData: fileData, baseName: item.name };
    that._watchDisconnect();
    that._sendPendingTransfer();
  },

  // 上传期间轮询设备连接状态，断联时自动关闭弹窗
  _watchDisconnect: function () {
    var that = this;
    if (this._disconnectTimer) clearInterval(this._disconnectTimer);
    this._disconnectTimer = setInterval(function () {
      if (!that.data.showTransfer || !that.data.transferBusy) {
        that._stopDisconnectWatch();
        return;
      }
      if (!app.globalData.isConnected) {
        that._stopDisconnectWatch();
        that.setData(transferView.fromEvent({
          phase: 'failed',
          outcome: 'failure',
          progress: that.data.transferProgress,
          detail: '设备已断开。草稿还在，重新连接后可以重试。'
        }));
      }
    }, 500);
  },

  _stopDisconnectWatch: function () {
    if (this._disconnectTimer) {
      clearInterval(this._disconnectTimer);
      this._disconnectTimer = null;
    }
  },

  _sendPendingTransfer: function () {
    var that = this;
    var pending = this._pendingTransfer;
    if (!pending) return;
    that.setData(transferView.beginning(pending.baseName));
    bleTransfer.sendFilm(pending.fileData, pending.baseName, {
      onStatus: function (event) {
        that.setData(transferView.fromEvent(event));
        if (event.phase === 'device_state_uncertain') {
          that._stopDisconnectWatch();
          app.globalData.fileList = [];
        }
      }
    }).catch(function (err) {
      console.error('Penaup recent transfer failed:', err);
    });
  },

  retryTransfer: function () {
    if (!this._pendingTransfer) return;
    this._watchDisconnect();
    this._sendPendingTransfer();
  },

  closeTransfer: function () {
    this._stopDisconnectWatch();
    this.setData(transferView.closed());
  },

  // 清除最近上墙记录（带确认）
  clearRecent: function () {
    var that = this;
    wx.showModal({
      title: '清除记录',
      content: '确定清除全部「最近上墙」记录吗？',
      confirmText: '清除',
      confirmColor: '#FF6B6B',
      cancelText: '取消',
      success: function (res) {
        if (!res.confirm) return;
        recentUtils.clearRecent();
        that._recentRaw = [];
        // 清理缩略图缓存（保留设备预览缓存）
        var keys = Object.keys(thumbCache);
        for (var i = 0; i < keys.length; i++) {
          if (keys[i].indexOf('dev:') !== 0) {
            delete thumbCache[keys[i]];
          }
        }
        that.setData({ recentList: [] });
        wx.showToast({ title: '已清除', icon: 'none' });
      }
    });
  },

  // 分享给朋友
  onShareAppMessage: function () {
    return {
      title: '花生片 Penaup · 把喜欢的画面留在眼前',
      path: '/pages/home/index'
    };
  }
});
