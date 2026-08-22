// template-sender.js - 模板上墙 BLE 发送管线（模板共用）
// 从一言页 _sendViaBle 抽取：canvas -> film 数据 -> BLE 分包发送 -> 记录最近上墙
var filmUtils = require('./film-utils');
var bleTransfer = require('./ble-transfer');

// 把 canvas 当前内容转为完整 film 文件数据
// 与照片管线一致：任意彩色画布 -> 自适应抖动 -> 6 色编码，保证渐变/多色设计的上屏质感
function canvasToFilmData(canvas) {
  var imageData = filmUtils.extractLandscapeData(canvas);
  var dithered = filmUtils.applyDitherByType(imageData, 'adaptive', 1.0);
  var processedData = filmUtils.processImageData(dithered);
  var header = filmUtils.generateFilmHeader();
  var totalSize = filmUtils.getFilmFileTotalSize();
  var fileData = new Uint8Array(totalSize);
  fileData.set(header, 0);
  fileData.set(processedData, filmUtils.FILM_HEADER_SIZE);
  return fileData;
}

// 发送到设备。onStatus(event) 用于页面更新阶段弹层；返回 Promise。
// FILE_STOP 后返回 device_state_uncertain，不能把没有刷新回执的设备当作成功。
function sendToDevice(fileData, baseName, onStatus) {
  return bleTransfer.sendFilm(fileData, baseName, { onStatus: onStatus });
}

module.exports = {
  canvasToFilmData: canvasToFilmData,
  sendToDevice: sendToDevice
};
