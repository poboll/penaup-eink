// 模板中心
var core = require('../../utils/template-core');

Page({
  data: {
    templates: core.TEMPLATE_LIST
  },

  onShareAppMessage: function () {
    return {
      title: '花生片 Penaup · 模板中心',
      path: '/pages/template/index'
    };
  },

  goTemplate: function (e) {
    var id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/template/' + id + '/index' });
  }
});
