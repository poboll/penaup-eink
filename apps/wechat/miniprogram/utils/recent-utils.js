// 花生片本地片单与草稿：Storage 只保存元数据，film 二进制写入用户数据目录。
// 不再把 120KB~960KB 的 film 转成 base64 长期塞进 wx storage。
var RECENT_KEY = 'penaup_recent_list';
var DRAFT_KEY = 'penaup_drafts';
var BATCH_KEY = 'penaup_batch';
var LEGACY_RECENT_KEY = 'ff_recent_list';
var LEGACY_DRAFT_KEY = 'ff_drafts';
var LEGACY_BATCH_KEY = 'ff_batch';
var MAX_RECENT = 9;
var MAX_DRAFT = 4;
var MAX_BATCH = 30;
var DATA_ROOT = 'penaup-film-cache';

function nowText() {
  var d = new Date();
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function fs() {
  try { return wx.getFileSystemManager(); } catch (e) { return null; }
}

function rootPath() {
  try {
    var base = wx.env && wx.env.USER_DATA_PATH;
    return base ? base + '/' + DATA_ROOT : '';
  } catch (e) { return ''; }
}

function ensureRoot() {
  var manager = fs();
  var root = rootPath();
  if (!manager || !root) return false;
  try { manager.mkdirSync(root, true); } catch (e) {}
  return true;
}

function safePart(value) {
  return String(value || 'film').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'film';
}

function toArrayBuffer(fileData) {
  if (fileData instanceof ArrayBuffer) return fileData;
  if (fileData && fileData.buffer instanceof ArrayBuffer) {
    return fileData.buffer.slice(fileData.byteOffset || 0, (fileData.byteOffset || 0) + fileData.byteLength);
  }
  return null;
}

function writeFilmData(kind, name, fileData) {
  var manager = fs();
  var root = rootPath();
  var buffer = toArrayBuffer(fileData);
  if (!manager || !root || !buffer || !ensureRoot()) return '';
  var filePath = root + '/' + safePart(kind) + '-' + Date.now().toString(36) + '-' + safePart(name) + '.film';
  try {
    manager.writeFileSync(filePath, buffer);
    return filePath;
  } catch (e) {
    return '';
  }
}

function removeFilmData(filePath) {
  var manager = fs();
  var root = rootPath();
  if (!manager || !root || !filePath || String(filePath).indexOf(root + '/') !== 0) return;
  try { manager.unlinkSync(filePath); } catch (e) {}
}

function readFilmData(item) {
  if (!item) return null;
  var manager = fs();
  if (manager && item.dataPath) {
    try {
      var data = manager.readFileSync(item.dataPath);
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      if (data && data.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
    } catch (e) {}
  }
  // Only used while migrating an older release. The value is never written
  // back to storage; callers should not persist the returned base64 string.
  if (item.data) {
    try { return new Uint8Array(wx.base64ToArrayBuffer(item.data)); } catch (e2) {}
  }
  return null;
}

function getStorage(key, fallbackKey) {
  var value = null;
  try { value = wx.getStorageSync(key); } catch (e) {}
  if ((!value || !value.length) && fallbackKey) {
    try { value = wx.getStorageSync(fallbackKey); } catch (e2) {}
  }
  return Array.isArray(value) ? value : [];
}

function setStorage(key, list) {
  try { wx.setStorageSync(key, list); } catch (e) {}
}

function migrateList(list, kind) {
  var changed = false;
  var result = [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i] || {};
    if (!item.name) continue;
    var next = { name: item.name, time: item.time || nowText() };
    if (item.dataPath) {
      next.dataPath = item.dataPath;
    } else if (item.data) {
      var legacyData = readFilmData(item);
      var migratedPath = legacyData ? writeFilmData(kind, item.name, legacyData) : '';
      if (migratedPath) next.dataPath = migratedPath;
      changed = true;
    }
    if (item.thumb) next.thumb = item.thumb;
    if (item.status) next.status = item.status;
    result.push(next);
  }
  if (changed || result.length !== list.length) setStorage(kind === 'recent' ? RECENT_KEY : kind === 'draft' ? DRAFT_KEY : BATCH_KEY, result);
  return result;
}

// ---------- 最近使用 ----------
function getRecent() {
  return migrateList(getStorage(RECENT_KEY, LEGACY_RECENT_KEY), 'recent');
}

function addRecent(name, fileData, meta) {
  var list = getRecent();
  for (var i = list.length - 1; i >= 0; i--) {
    if (list[i].name === name) {
      removeFilmData(list[i].dataPath);
      list.splice(i, 1);
    }
  }
  var item = { name: name, time: nowText() };
  if (meta && meta.status) item.status = meta.status;
  var dataPath = writeFilmData('recent', name, fileData);
  if (dataPath) item.dataPath = dataPath;
  list.unshift(item);
  if (list.length > MAX_RECENT) {
    var removed = list.splice(MAX_RECENT);
    for (var j = 0; j < removed.length; j++) removeFilmData(removed[j].dataPath);
  }
  setStorage(RECENT_KEY, list);
  return list;
}

function clearRecent() {
  var list = getRecent();
  for (var i = 0; i < list.length; i++) removeFilmData(list[i].dataPath);
  setStorage(RECENT_KEY, []);
  try { wx.removeStorageSync(LEGACY_RECENT_KEY); } catch (e) {}
}

// ---------- 本地草稿 ----------
function getDrafts() {
  return migrateList(getStorage(DRAFT_KEY, LEGACY_DRAFT_KEY), 'draft');
}

function saveDraft(name, fileData) {
  var list = getDrafts();
  for (var i = list.length - 1; i >= 0; i--) {
    if (list[i].name === name) {
      removeFilmData(list[i].dataPath);
      list.splice(i, 1);
    }
  }
  var dataPath = writeFilmData('draft', name, fileData);
  if (!dataPath) return list;
  list.unshift({ name: name, time: nowText(), dataPath: dataPath });
  if (list.length > MAX_DRAFT) {
    var removed = list.splice(MAX_DRAFT);
    for (var j = 0; j < removed.length; j++) removeFilmData(removed[j].dataPath);
  }
  setStorage(DRAFT_KEY, list);
  return list;
}

function removeDraft(name) {
  var list = getDrafts();
  for (var i = list.length - 1; i >= 0; i--) {
    if (list[i].name === name) {
      removeFilmData(list[i].dataPath);
      list.splice(i, 1);
    }
  }
  setStorage(DRAFT_KEY, list);
  return list;
}

// ---------- 批量片单 ----------
function getBatch() {
  return migrateList(getStorage(BATCH_KEY, LEGACY_BATCH_KEY), 'batch');
}

function addBatchItem(item) {
  item = item || {};
  var list = getBatch();
  var data = item.fileData || (item.data ? readFilmData(item) : null);
  var dataPath = item.dataPath || writeFilmData('batch', item.name, data);
  if (!dataPath) return list;
  list.push({ name: item.name, time: item.time || nowText(), dataPath: dataPath });
  if (list.length > MAX_BATCH) {
    var removed = list.splice(0, list.length - MAX_BATCH);
    for (var i = 0; i < removed.length; i++) removeFilmData(removed[i].dataPath);
  }
  setStorage(BATCH_KEY, list);
  return getBatch();
}

function removeBatchItem(name) {
  var list = getBatch();
  for (var i = list.length - 1; i >= 0; i--) {
    if (list[i].name === name) {
      removeFilmData(list[i].dataPath);
      list.splice(i, 1);
    }
  }
  setStorage(BATCH_KEY, list);
  return getBatch();
}

function clearBatch() {
  var list = getBatch();
  for (var i = 0; i < list.length; i++) removeFilmData(list[i].dataPath);
  setStorage(BATCH_KEY, []);
  return [];
}

module.exports = {
  getRecent: getRecent,
  addRecent: addRecent,
  clearRecent: clearRecent,
  getDrafts: getDrafts,
  saveDraft: saveDraft,
  removeDraft: removeDraft,
  getBatch: getBatch,
  addBatchItem: addBatchItem,
  removeBatchItem: removeBatchItem,
  clearBatch: clearBatch,
  readFilmData: readFilmData
};
