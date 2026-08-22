// Film 格式常量来自 packages/film-core；本地生成文件供微信运行时加载。
var FilmCore = require('./film-core');
const FILM_HEADER_SIZE = FilmCore.FILM_HEADER_SIZE;
var COLOR_RENDERING_MODE_DEFINITIONS = FilmCore.COLOR_RENDERING_MODE_DEFINITIONS || [
  { id: 'layer', label: '叠色层次', shortLabel: '叠色', description: '用自适应显影保留柔和的明暗过渡。', ditherType: 'adaptive', defaultStrength: 1 },
  { id: 'dots', label: '网点', shortLabel: '网点', description: '用有序色点铺开中间调，颗粒更清楚。', ditherType: 'bayer', defaultStrength: 1.1 },
  { id: 'dither', label: '抖动', shortLabel: '抖动', description: '把误差分散到邻近像素，尽量保留细节。', ditherType: 'floydSteinberg', defaultStrength: 1 }
];

function normalizeRenderingMode(mode) {
  var value = String(mode || '').toLowerCase();
  for (var index = 0; index < COLOR_RENDERING_MODE_DEFINITIONS.length; index += 1) {
    if (COLOR_RENDERING_MODE_DEFINITIONS[index].id === value) return value;
  }
  return 'layer';
}

function getRenderingModeDefinition(mode) {
  var normalized = normalizeRenderingMode(mode);
  for (var index = 0; index < COLOR_RENDERING_MODE_DEFINITIONS.length; index += 1) {
    if (COLOR_RENDERING_MODE_DEFINITIONS[index].id === normalized) return COLOR_RENDERING_MODE_DEFINITIONS[index];
  }
  return COLOR_RENDERING_MODE_DEFINITIONS[0];
}

function getRenderingModeOptions() {
  return COLOR_RENDERING_MODE_DEFINITIONS.map(function (mode) {
    return {
      id: mode.id,
      label: mode.label,
      shortLabel: mode.shortLabel,
      description: mode.description
    };
  });
}

// 设备配置表
function toWechatConfig(profile) {
  return {
    id: profile.id, key: profile.key, screenWidth: profile.screenWidth, screenHeight: profile.screenHeight,
    canvasWidth: profile.canvasWidth, canvasHeight: profile.canvasHeight, displayName: profile.displayName,
    isPortraitPanel: profile.id !== 'max', pixelLayout: profile.pixelLayout,
    bodySize: profile.bodySize, totalSize: profile.totalSize
  };
}
const DEVICE_CONFIGS = {
  FRAMEFILM: toWechatConfig(FilmCore.PROFILES.PENAUP_STD),
  FRAMEFILMPRO: toWechatConfig(FilmCore.PROFILES.PENAUP_PRO),
  FRAMEFILMMAX: toWechatConfig(FilmCore.PROFILES.PENAUP_MAX)
};

// 新品牌键名；FRAMEFILM* 作为旧设备/旧草稿兼容键保留。
DEVICE_CONFIGS.PENAUP = DEVICE_CONFIGS.FRAMEFILM;
DEVICE_CONFIGS.PENAUPPRO = DEVICE_CONFIGS.FRAMEFILMPRO;
DEVICE_CONFIGS.PENAUPMAX = DEVICE_CONFIGS.FRAMEFILMMAX;

var currentDeviceType = 'PENAUP';

function normalizeDeviceType(type) {
  var value = String(type || '').toUpperCase();
  if (value === 'PENAUPMAX' || value === 'FRAMEFILMMAX' || value.indexOf('MAX') !== -1) {
    return 'PENAUPMAX';
  }
  if (value === 'PENAUPPRO' || value === 'FRAMEFILMPRO' || value.indexOf('PRO') !== -1) {
    return 'PENAUPPRO';
  }
  return 'PENAUP';
}

function getDeviceTypeFromName(name) {
  return normalizeDeviceType(name);
}

function getDeviceConfigForType(type) {
  return DEVICE_CONFIGS[normalizeDeviceType(type)] || DEVICE_CONFIGS.PENAUP;
}

function getDeviceConfig() {
  return getDeviceConfigForType(currentDeviceType);
}

function setDeviceType(type) {
  currentDeviceType = normalizeDeviceType(type);
}

function getDeviceType() {
  return currentDeviceType;
}

// 动态尺寸 getter（向后兼容旧页面引用）
function getCanvasWidth() { return getDeviceConfig().canvasWidth; }
function getCanvasHeight() { return getDeviceConfig().canvasHeight; }
function getScreenWidth() { return getDeviceConfig().screenWidth; }
function getScreenHeight() { return getDeviceConfig().screenHeight; }
function getFilmPixelDataSize() { return (getScreenWidth() * getScreenHeight()) / 2; }
function getFilmFileTotalSize() { return FILM_HEADER_SIZE + getFilmPixelDataSize(); }

// 保留旧常量作为默认值（标准版），供已有页面顶部 var 引用
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 600;
const FILM_SCREEN_WIDTH = 600;
const FILM_SCREEN_HEIGHT = 400;
const FILM_PIXEL_DATA_SIZE = FilmCore.PROFILES.PENAUP_STD.bodySize;
const FILM_FILE_TOTAL_SIZE = FilmCore.PROFILES.PENAUP_STD.totalSize;

// 颜色编码索引
const COLOR_CODE_BLACK = 0x00;
const COLOR_CODE_WHITE = 0x01;
const COLOR_CODE_YELLOW = 0x02;
const COLOR_CODE_RED = 0x03;
const COLOR_CODE_BLUE = 0x04;
const COLOR_CODE_GREEN = 0x05;

// 六色调色板
const rgbPalette = FilmCore.PALETTE.map(function (color) {
  return { name: color.name, r: color.r, g: color.g, b: color.b, value: color.value, code: color.index };
});

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s, l: l };
}

function rgbToLab(r, g, b) {
  r = r / 255; g = g / 255; b = b / 255;
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
  r *= 100; g *= 100; b *= 100;
  let x = r * 0.4124 + g * 0.3576 + b * 0.1805;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = r * 0.0193 + g * 0.1192 + b * 0.9505;
  x /= 95.047; y /= 100.0; z /= 108.883;
  x = x > 0.008856 ? Math.pow(x, 1 / 3) : (7.787 * x) + (16 / 116);
  y = y > 0.008856 ? Math.pow(y, 1 / 3) : (7.787 * y) + (16 / 116);
  z = z > 0.008856 ? Math.pow(z, 1 / 3) : (7.787 * z) + (16 / 116);
  return { l: (116 * y) - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

function labDistance(lab1, lab2) {
  const dl = lab1.l - lab2.l, da = lab1.a - lab2.a, db = lab1.b - lab2.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

const paletteHsl = rgbPalette.map(function (c) {
  return { color: c, hsl: rgbToHsl(c.r, c.g, c.b) };
});

function findClosestColor(r, g, b) {
  const input = rgbToHsl(r, g, b);
  if (input.s < 0.12) {
    return input.l > 0.5 ? rgbPalette[1] : rgbPalette[0];
  }
  let minDist = Infinity;
  let closestColor = rgbPalette[0];
  for (let i = 2; i < paletteHsl.length; i++) {
    const p = paletteHsl[i];
    let hueDiff = Math.abs(input.h - p.hsl.h);
    if (hueDiff > 180) hueDiff = 360 - hueDiff;
    const satDiff = Math.abs(input.s - p.hsl.s);
    const lumDiff = Math.abs(input.l - p.hsl.l);
    const dist = hueDiff + satDiff * 120 + lumDiff * 80;
    if (dist < minDist) {
      minDist = dist;
      closestColor = p.color;
    }
  }
  const labInput = rgbToLab(r, g, b);
  const labBlack = rgbToLab(0, 0, 0);
  const labWhite = rgbToLab(255, 255, 255);
  const distBlack = labDistance(labInput, labBlack);
  const distWhite = labDistance(labInput, labWhite);
  const distNeutral = Math.min(distBlack, distWhite);
  const neutralColor = distBlack < distWhite ? rgbPalette[0] : rgbPalette[1];
  const labChosen = rgbToLab(closestColor.r, closestColor.g, closestColor.b);
  const distChosen = labDistance(labInput, labChosen);
  if (distNeutral < distChosen * 0.45) {
    return neutralColor;
  }
  return closestColor;
}

function adjustContrast(imageData, factor) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.max(0, (data[i] - 128) * factor + 128));
    data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - 128) * factor + 128));
    data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - 128) * factor + 128));
  }
  return imageData;
}

function floydSteinbergDither(imageData, strength) {
  const width = imageData.width, height = imageData.height;
  const data = imageData.data;
  const tempData = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const closest = findClosestColor(tempData[idx], tempData[idx + 1], tempData[idx + 2]);
      const errR = (tempData[idx] - closest.r) * strength;
      const errG = (tempData[idx + 1] - closest.g) * strength;
      const errB = (tempData[idx + 2] - closest.b) * strength;
      if (x + 1 < width) {
        const ri = idx + 4;
        tempData[ri] = Math.min(255, Math.max(0, tempData[ri] + errR * 7 / 16));
        tempData[ri + 1] = Math.min(255, Math.max(0, tempData[ri + 1] + errG * 7 / 16));
        tempData[ri + 2] = Math.min(255, Math.max(0, tempData[ri + 2] + errB * 7 / 16));
      }
      if (y + 1 < height) {
        if (x > 0) {
          const di = idx + width * 4 - 4;
          tempData[di] = Math.min(255, Math.max(0, tempData[di] + errR * 3 / 16));
          tempData[di + 1] = Math.min(255, Math.max(0, tempData[di + 1] + errG * 3 / 16));
          tempData[di + 2] = Math.min(255, Math.max(0, tempData[di + 2] + errB * 3 / 16));
        }
        const di = idx + width * 4;
        tempData[di] = Math.min(255, Math.max(0, tempData[di] + errR * 5 / 16));
        tempData[di + 1] = Math.min(255, Math.max(0, tempData[di + 1] + errG * 5 / 16));
        tempData[di + 2] = Math.min(255, Math.max(0, tempData[di + 2] + errB * 5 / 16));
        if (x + 1 < width) {
          const di2 = idx + width * 4 + 4;
          tempData[di2] = Math.min(255, Math.max(0, tempData[di2] + errR * 1 / 16));
          tempData[di2 + 1] = Math.min(255, Math.max(0, tempData[di2 + 1] + errG * 1 / 16));
          tempData[di2 + 2] = Math.min(255, Math.max(0, tempData[di2 + 2] + errB * 1 / 16));
        }
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const closest = findClosestColor(tempData[idx], tempData[idx + 1], tempData[idx + 2]);
      data[idx] = closest.r; data[idx + 1] = closest.g; data[idx + 2] = closest.b;
    }
  }
  return imageData;
}

function atkinsonDither(imageData, strength) {
  const width = imageData.width, height = imageData.height;
  const data = imageData.data;
  const tempData = new Uint8ClampedArray(data);
  const fraction = 1 / 8;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const closest = findClosestColor(tempData[idx], tempData[idx + 1], tempData[idx + 2]);
      data[idx] = closest.r; data[idx + 1] = closest.g; data[idx + 2] = closest.b;
      const errR = (tempData[idx] - closest.r) * strength;
      const errG = (tempData[idx + 1] - closest.g) * strength;
      const errB = (tempData[idx + 2] - closest.b) * strength;
      const offsets = [
        [1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]
      ];
      for (const [dx, dy] of offsets) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) {
          const ni = (ny * width + nx) * 4;
          tempData[ni] = Math.min(255, Math.max(0, tempData[ni] + errR * fraction));
          tempData[ni + 1] = Math.min(255, Math.max(0, tempData[ni + 1] + errG * fraction));
          tempData[ni + 2] = Math.min(255, Math.max(0, tempData[ni + 2] + errB * fraction));
        }
      }
    }
  }
  return imageData;
}

function stuckiDither(imageData, strength) {
  const width = imageData.width, height = imageData.height;
  const data = imageData.data;
  const tempData = new Uint8ClampedArray(data);
  const divisor = 42;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const closest = findClosestColor(tempData[idx], tempData[idx + 1], tempData[idx + 2]);
      const errR = (tempData[idx] - closest.r) * strength;
      const errG = (tempData[idx + 1] - closest.g) * strength;
      const errB = (tempData[idx + 2] - closest.b) * strength;
      const offsets = [
        [1, 0, 8], [2, 0, 4],
        [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
        [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]
      ];
      for (const [dx, dy, w] of offsets) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) {
          const ni = (ny * width + nx) * 4;
          tempData[ni] = Math.min(255, Math.max(0, tempData[ni] + errR * w / divisor));
          tempData[ni + 1] = Math.min(255, Math.max(0, tempData[ni + 1] + errG * w / divisor));
          tempData[ni + 2] = Math.min(255, Math.max(0, tempData[ni + 2] + errB * w / divisor));
        }
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const closest = findClosestColor(tempData[idx], tempData[idx + 1], tempData[idx + 2]);
      data[idx] = closest.r; data[idx + 1] = closest.g; data[idx + 2] = closest.b;
    }
  }
  return imageData;
}

function jarvisDither(imageData, strength) {
  const width = imageData.width, height = imageData.height;
  const data = imageData.data;
  const tempData = new Uint8ClampedArray(data);
  const divisor = 48;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const closest = findClosestColor(tempData[idx], tempData[idx + 1], tempData[idx + 2]);
      data[idx] = closest.r; data[idx + 1] = closest.g; data[idx + 2] = closest.b;
      const errR = (tempData[idx] - closest.r) * strength;
      const errG = (tempData[idx + 1] - closest.g) * strength;
      const errB = (tempData[idx + 2] - closest.b) * strength;
      const offsets = [
        [1, 0, 7], [2, 0, 5],
        [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
        [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]
      ];
      for (const [dx, dy, w] of offsets) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) {
          const ni = (ny * width + nx) * 4;
          tempData[ni] = Math.min(255, Math.max(0, tempData[ni] + errR * w / divisor));
          tempData[ni + 1] = Math.min(255, Math.max(0, tempData[ni + 1] + errG * w / divisor));
          tempData[ni + 2] = Math.min(255, Math.max(0, tempData[ni + 2] + errB * w / divisor));
        }
      }
    }
  }
  return imageData;
}

function computeEdgeMap(data, width, height) {
  var edges = new Float32Array(width * height);
  for (var y = 1; y < height - 1; y++) {
    for (var x = 1; x < width - 1; x++) {
      var tl = data[((y-1)*width+x-1)*4]*0.299 + data[((y-1)*width+x-1)*4+1]*0.587 + data[((y-1)*width+x-1)*4+2]*0.114;
      var tc = data[((y-1)*width+x)*4]*0.299 + data[((y-1)*width+x)*4+1]*0.587 + data[((y-1)*width+x)*4+2]*0.114;
      var tr = data[((y-1)*width+x+1)*4]*0.299 + data[((y-1)*width+x+1)*4+1]*0.587 + data[((y-1)*width+x+1)*4+2]*0.114;
      var ml = data[(y*width+x-1)*4]*0.299 + data[(y*width+x-1)*4+1]*0.587 + data[(y*width+x-1)*4+2]*0.114;
      var mr = data[(y*width+x+1)*4]*0.299 + data[(y*width+x+1)*4+1]*0.587 + data[(y*width+x+1)*4+2]*0.114;
      var bl = data[((y+1)*width+x-1)*4]*0.299 + data[((y+1)*width+x-1)*4+1]*0.587 + data[((y+1)*width+x-1)*4+2]*0.114;
      var bc = data[((y+1)*width+x)*4]*0.299 + data[((y+1)*width+x)*4+1]*0.587 + data[((y+1)*width+x)*4+2]*0.114;
      var br = data[((y+1)*width+x+1)*4]*0.299 + data[((y+1)*width+x+1)*4+1]*0.587 + data[((y+1)*width+x+1)*4+2]*0.114;
      var gx = -tl - 2*ml - bl + tr + 2*mr + br;
      var gy = -tl - 2*tc - tr + bl + 2*bc + br;
      edges[y * width + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return edges;
}

function analyzeImageAdvanced(imageData) {
  var data = imageData.data;
  var width = imageData.width, height = imageData.height;
  var pixelCount = width * height;
  var brightnessSum = 0, rSum = 0, gSum = 0, bSum = 0, saturationSum = 0;
  for (var i = 0; i < data.length; i += 4) {
    var r = data[i], g = data[i+1], b = data[i+2];
    rSum += r; gSum += g; bSum += b;
    brightnessSum += r * 0.299 + g * 0.587 + b * 0.114;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    saturationSum += max > 0 ? (max - min) / max : 0;
  }
  var edges = computeEdgeMap(data, width, height);
  var edgeSum = 0, edgeCount = 0;
  for (var i = 0; i < edges.length; i++) {
    edgeSum += edges[i];
    if (edges[i] > 20) edgeCount++;
  }
  var innerPixels = (width - 2) * (height - 2);
  return {
    brightness: brightnessSum / pixelCount / 255,
    edgeDensity: innerPixels > 0 ? edgeCount / innerPixels : 0,
    avgGradient: innerPixels > 0 ? edgeSum / innerPixels / 255 : 0,
    saturation: saturationSum / pixelCount
  };
}

function downsampleImageData(imageData, tw, th) {
  var srcCanvas = wx.createOffscreenCanvas({ type: '2d', width: imageData.width, height: imageData.height });
  var srcCtx = srcCanvas.getContext('2d');
  var srcImgData = srcCtx.createImageData(imageData.width, imageData.height);
  srcImgData.data.set(imageData.data);
  srcCtx.putImageData(srcImgData, 0, 0);
  var dstCanvas = wx.createOffscreenCanvas({ type: '2d', width: tw, height: th });
  var dstCtx = dstCanvas.getContext('2d');
  dstCtx.drawImage(srcCanvas, 0, 0, tw, th);
  return dstCtx.getImageData(0, 0, tw, th);
}

function generateAdaptiveCandidates(analysis) {
  var candidates = [];
  var algos = ['floydSteinberg', 'atkinson', 'stucki', 'jarvis'];
  var strengths;
  if (analysis.edgeDensity > 0.2) {
    strengths = [0.6, 0.8, 1.0, 1.2, 1.4, 1.6];
  } else if (analysis.saturation > 0.3) {
    strengths = [0.7, 0.9, 1.0, 1.2, 1.4, 1.6, 1.8];
  } else {
    strengths = [0.6, 0.8, 1.0, 1.2, 1.5, 1.8, 2.0];
  }
  for (var ai = 0; ai < algos.length; ai++) {
    for (var si = 0; si < strengths.length; si++) {
      candidates.push({ type: algos[ai], strength: strengths[si] });
    }
  }
  return candidates;
}

function evaluateDitherResult(original, dithered) {
  var d1 = original.data, d2 = dithered.data;
  var width = original.width, height = original.height;
  var n = d1.length / 4;
  var totalLabError = 0, maxError = 0;
  for (var i = 0; i < d1.length; i += 4) {
    var lab1 = rgbToLab(d1[i], d1[i+1], d1[i+2]);
    var lab2 = rgbToLab(d2[i], d2[i+1], d2[i+2]);
    var dist = labDistance(lab1, lab2);
    totalLabError += dist;
    if (dist > maxError) maxError = dist;
  }
  var avgLabError = totalLabError / n;
  var origEdges = computeEdgeMap(d1, width, height);
  var dithEdges = computeEdgeMap(d2, width, height);
  var edgeCorrelation = 0, origEdgeEnergy = 0, dithEdgeEnergy = 0;
  for (var i = 0; i < origEdges.length; i++) {
    edgeCorrelation += origEdges[i] * dithEdges[i];
    origEdgeEnergy += origEdges[i] * origEdges[i];
    dithEdgeEnergy += dithEdges[i] * dithEdges[i];
  }
  var edgePreservation = origEdgeEnergy > 0 && dithEdgeEnergy > 0 ?
    edgeCorrelation / Math.sqrt(origEdgeEnergy * dithEdgeEnergy) : 0;
  var colorMap = {};
  for (var i = 0; i < d2.length; i += 4) {
    var key = (d2[i] << 16) | (d2[i+1] << 8) | d2[i+2];
    colorMap[key] = (colorMap[key] || 0) + 1;
  }
  var colorCounts = Object.values(colorMap).sort(function(a,b){ return b-a; });
  var colorEntropy = 0;
  for (var i = 0; i < colorCounts.length; i++) {
    var p = colorCounts[i] / n;
    if (p > 0) colorEntropy -= p * Math.log2(p);
  }
  var maxEntropy = Math.log2(Math.min(6, colorCounts.length));
  var colorBalance = maxEntropy > 0 ? colorEntropy / maxEntropy : 0;
  var score = avgLabError * 0.4 + (1 - edgePreservation) * 80 * 0.35 + (1 - colorBalance) * 30 * 0.25;
  return { score: score, avgLabError: avgLabError, edgePreservation: edgePreservation, colorBalance: colorBalance, maxError: maxError };
}

function adaptiveDither(imageData) {
  var width = imageData.width, height = imageData.height;
  var evalScale = 3;
  var evalW = Math.max(30, Math.floor(width / evalScale));
  var evalH = Math.max(30, Math.floor(height / evalScale));
  var evalData = downsampleImageData(imageData, evalW, evalH);
  var analysis = analyzeImageAdvanced(evalData);
  var candidates = generateAdaptiveCandidates(analysis);
  var bestScore = Infinity;
  var bestConfig = candidates[0];
  for (var ci = 0; ci < candidates.length; ci++) {
    var config = candidates[ci];
    var copy = { data: new Uint8ClampedArray(evalData.data), width: evalW, height: evalH };
    applyDitherByType(copy, config.type, config.strength);
    var result = evaluateDitherResult(evalData, copy);
    if (result.score < bestScore) {
      bestScore = result.score;
      bestConfig = config;
    }
  }
  return applyDitherByType(imageData, bestConfig.type, bestConfig.strength);
}

// 4x4 Bayer 有序网点：用稳定的空间阈值表达中间调，不改变六色 film 索引。
var BAYER_MATRIX = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

function bayerDither(imageData, strength) {
  var width = imageData.width;
  var height = imageData.height;
  var data = imageData.data;
  var amount = Number(strength);
  if (!isFinite(amount)) amount = 1.1;
  for (var y = 0; y < height; y += 1) {
    var row = BAYER_MATRIX[y & 3];
    for (var x = 0; x < width; x += 1) {
      var bias = (row[x & 3] - 8) * amount;
      var index = (y * width + x) * 4;
      var closest = findClosestColor(
        Math.min(255, Math.max(0, data[index] + bias)),
        Math.min(255, Math.max(0, data[index + 1] + bias)),
        Math.min(255, Math.max(0, data[index + 2] + bias))
      );
      data[index] = closest.r;
      data[index + 1] = closest.g;
      data[index + 2] = closest.b;
    }
  }
  return imageData;
}

function applyDitherByType(imageData, type, strength) {
  switch (type) {
    case 'adaptive': return adaptiveDither(imageData);
    case 'bayer': return bayerDither(imageData, strength);
    case 'floydSteinberg': return floydSteinbergDither(imageData, strength);
    case 'atkinson': return atkinsonDither(imageData, strength);
    case 'stucki': return stuckiDither(imageData, strength);
    case 'jarvis': return jarvisDither(imageData, strength);
    default: return imageData;
  }
}

// 从竖屏画布提取横屏数据（标准版90°旋转）或直接提取（Pro版无需旋转）
function extractLandscapeData(portraitCanvas) {
  var cfg = getDeviceConfig();
  var sw = cfg.screenWidth;
  var sh = cfg.screenHeight;
  if (cfg.isPortraitPanel) {
    // 标准版：竖屏面板，需要旋转90°得到横屏数据
    var landscapeCanvas = wx.createOffscreenCanvas({ type: '2d', width: sw, height: sh });
    var ctx = landscapeCanvas.getContext('2d');
    ctx.save();
    ctx.translate(0, sh);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(portraitCanvas, 0, 0, cfg.canvasWidth, cfg.canvasHeight, 0, 0, cfg.canvasWidth, cfg.canvasHeight);
    ctx.restore();
    return ctx.getImageData(0, 0, sw, sh);
  } else {
    // Pro版：横屏面板，画布已是横屏方向，直接提取
    return portraitCanvas.getContext('2d').getImageData(0, 0, sw, sh);
  }
}

// 处理图像数据为 Film 格式并回显到画布
function processAndDisplay(portraitCanvas, portraitCtx, ditherType, ditherStrength, contrast) {
  var cfg = getDeviceConfig();
  var sw = cfg.screenWidth;
  var sh = cfg.screenHeight;
  var cw = cfg.canvasWidth;
  var ch = cfg.canvasHeight;

  var modeDefinition = null;
  for (var modeIndex = 0; modeIndex < COLOR_RENDERING_MODE_DEFINITIONS.length; modeIndex += 1) {
    if (COLOR_RENDERING_MODE_DEFINITIONS[modeIndex].id === ditherType) {
      modeDefinition = COLOR_RENDERING_MODE_DEFINITIONS[modeIndex];
      break;
    }
  }
  var processingType = modeDefinition ? modeDefinition.ditherType : ditherType;
  var processingStrength = modeDefinition ? modeDefinition.defaultStrength : ditherStrength;
  var landscapeData = extractLandscapeData(portraitCanvas);
  // 与原版 ForFrame 一致：先应用外部对比度，再抖动
  if (contrast && contrast !== 1.0) {
    adjustContrast(landscapeData, contrast);
  }
  if (processingType === 'adaptive') {
    landscapeData = adaptiveDither(landscapeData);
  } else if (processingType) {
    landscapeData = applyDitherByType(landscapeData, processingType, processingStrength || 1.0);
  }
  var processedData = processImageData(landscapeData);
  var decoded = decodeProcessedData(processedData, sw, sh);

  if (cfg.isPortraitPanel) {
    // 标准版：将横屏结果旋转回竖屏用于显示
    var tempCanvas = wx.createOffscreenCanvas({ type: '2d', width: sw, height: sh });
    var tempCtx = tempCanvas.getContext('2d');
    var imgData = tempCtx.createImageData(sw, sh);
    imgData.data.set(decoded.data);
    tempCtx.putImageData(imgData, 0, 0);
    portraitCtx.clearRect(0, 0, cw, ch);
    portraitCtx.save();
    portraitCtx.translate(cw, 0);
    portraitCtx.rotate(Math.PI / 2);
    portraitCtx.drawImage(tempCanvas, 0, 0, sw, sh, 0, 0, sw, sh);
    portraitCtx.restore();
  } else {
    // Pro版：画布已是横屏，直接回显
    var imgData = portraitCtx.createImageData(sw, sh);
    imgData.data.set(decoded.data);
    portraitCtx.clearRect(0, 0, cw, ch);
    portraitCtx.putImageData(imgData, 0, 0);
  }
  return processedData;
}

function processImageData(imageData) {
  const width = imageData.width, height = imageData.height;
  const data = imageData.data;
  var cfg = getDeviceConfig();
  const processedData = new Uint8Array(getFilmPixelDataSize());
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const closest = findClosestColor(data[index], data[index + 1], data[index + 2]);
      const code = closest.code;
      var newIndex;
      newIndex = FilmCore.pixelIndex(x, y, cfg);
      const byteIndex = Math.floor(newIndex / 2);
      if (newIndex % 2 === 0) {
        processedData[byteIndex] = (code << 4) | (processedData[byteIndex] & 0x0F);
      } else {
        processedData[byteIndex] = (processedData[byteIndex] & 0xF0) | code;
      }
    }
  }
  return processedData;
}

function decodeProcessedData(processedData, width, height) {
  var cfg = getDeviceConfig();
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      var newIndex;
      newIndex = FilmCore.pixelIndex(x, y, cfg);
      const byteIndex = Math.floor(newIndex / 2);
      const byte = processedData[byteIndex];
      const code = (newIndex % 2 === 0) ? (byte >> 4) & 0x0F : byte & 0x0F;
      const color = rgbPalette.find(c => c.code === code) || rgbPalette[1];
      const index = (y * width + x) * 4;
      pixels[index] = color.r;
      pixels[index + 1] = color.g;
      pixels[index + 2] = color.b;
      pixels[index + 3] = 255;
    }
  }
  return { data: pixels, width, height };
}

function generateFilmHeader() {
  return FilmCore.createFilmHeader(getDeviceConfig());
}

function wrapText(ctx, text, fontSize, maxWidth) {
  var lines = [];
  var paragraphs = text.split('\n');
  for (var p = 0; p < paragraphs.length; p++) {
    var currentLine = '';
    var chars = Array.from(paragraphs[p]);
    if (chars.length === 0) { lines.push(''); continue; }
    for (var i = 0; i < chars.length; i++) {
      var char = chars[i];
      var testLine = currentLine + char;
      var metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine.length > 0) lines.push(currentLine);
  }
  return lines;
}

// 生成随机 Film 文件名：固定前缀 + 随机后缀
function generateRandomFilename(prefix) {
  prefix = prefix || 'frame';
  var chars = '0123456789abcdef';
  var suffix = '';
  for (var i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return prefix + '_' + suffix + '.film';
}

// 从 film 文件数据解析像素（自包含，不依赖当前设备配置）
// fileData: Uint8Array，返回 { data: RGBA, width, height, portrait }；失败返回 null
function decodeFilmFile(fileData) {
  if (!fileData || fileData.length <= FILM_HEADER_SIZE) return null;
  var sw = fileData[4] | (fileData[5] << 8);
  var sh = fileData[6] | (fileData[7] << 8);
  if (!sw || !sh) return null;
  // 标准版(600x400)为列优先翻转布局，Pro(792x528)为行优先
  var portrait = (sw === 600 && sh === 400);
  var pixelData = fileData.subarray(FILM_HEADER_SIZE);
  var pixels = new Uint8ClampedArray(sw * sh * 4);
  for (var y = 0; y < sh; y++) {
    for (var x = 0; x < sw; x++) {
      var newIndex = portrait ? (x * sh) + (sh - 1 - y) : (y * sw) + x;
      var byteIndex = newIndex >> 1;
      var byte = byteIndex < pixelData.length ? pixelData[byteIndex] : 0;
      var code = (newIndex % 2 === 0) ? (byte >> 4) & 0x0F : byte & 0x0F;
      var color = rgbPalette.find(function (c) { return c.code === code; }) || rgbPalette[1];
      var idx = (y * sw + x) * 4;
      pixels[idx] = color.r;
      pixels[idx + 1] = color.g;
      pixels[idx + 2] = color.b;
      pixels[idx + 3] = 255;
    }
  }
  return { data: pixels, width: sw, height: sh, portrait: portrait };
}

// 渲染 film 文件缩略图并导出临时图片路径
// callback(path)：path 为临时图片路径，失败时传空字符串；maxSize 控制最长边（默认 150）
function renderFilmThumbnail(fileData, callback, maxSize) {
  var decoded = decodeFilmFile(fileData);
  if (!decoded) { callback(''); return; }
  try {
    var sw = decoded.width;
    var sh = decoded.height;
    // 按展示方向渲染完整画面（标准版竖屏旋转 90°，Pro 横屏直出）
    var dispW = decoded.portrait ? sh : sw;
    var dispH = decoded.portrait ? sw : sh;
    var srcCanvas = wx.createOffscreenCanvas({ type: '2d', width: sw, height: sh });
    var srcCtx = srcCanvas.getContext('2d');
    var imgData = srcCtx.createImageData(sw, sh);
    imgData.data.set(decoded.data);
    srcCtx.putImageData(imgData, 0, 0);
    var dispCanvas = wx.createOffscreenCanvas({ type: '2d', width: dispW, height: dispH });
    var dispCtx = dispCanvas.getContext('2d');
    if (decoded.portrait) {
      dispCtx.translate(dispW, 0);
      dispCtx.rotate(Math.PI / 2);
      dispCtx.drawImage(srcCanvas, 0, 0, sw, sh, 0, 0, sw, sh);
    } else {
      dispCtx.drawImage(srcCanvas, 0, 0, sw, sh, 0, 0, dispW, dispH);
    }
    // 缩略图缩放（最长边上限 maxSize，防止比例过大）
    var maxSide = maxSize || 150;
    var thumbW = maxSide;
    var thumbH = Math.round(thumbW * dispH / dispW);
    if (thumbH > maxSide) {
      thumbH = maxSide;
      thumbW = Math.round(thumbH * dispW / dispH);
    }
    var thumbCanvas = wx.createOffscreenCanvas({ type: '2d', width: thumbW, height: thumbH });
    var ctx = thumbCanvas.getContext('2d');
    ctx.drawImage(dispCanvas, 0, 0, dispW, dispH, 0, 0, thumbW, thumbH);
    wx.canvasToTempFilePath({
      canvas: thumbCanvas,
      success: function (res) { callback(res.tempFilePath || ''); },
      fail: function () { callback(''); }
    });
  } catch (e) {
    callback('');
  }
}

// 本地图片 → film 文件数据（按当前设备类型转换，自适应抖动）
// src: 本地图片路径; callback(fileData)：成功返回 Uint8Array，失败传 null
function imageToFilmData(src, callback) {
  wx.getImageInfo({
    src: src,
    success: function (info) {
      try {
        var cfg = getDeviceConfig();
        var cw = cfg.canvasWidth;
        var ch = cfg.canvasHeight;
        var sw = cfg.screenWidth;
        var sh = cfg.screenHeight;
        var canvas = wx.createOffscreenCanvas({ type: '2d', width: cw, height: ch });
        var ctx = canvas.getContext('2d');
        var img = canvas.createImage();
        img.onload = function () {
          try {
            // cover 等比缩放居中填充
            var scale = Math.max(cw / img.width, ch / img.height);
            var dw = img.width * scale;
            var dh = img.height * scale;
            ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
            var landscapeData = extractLandscapeData(canvas);
            var dithered = adaptiveDither(landscapeData);
            var processedData = processImageData(dithered);
            var fileData = new Uint8Array(getFilmFileTotalSize());
            fileData.set(generateFilmHeader(), 0);
            fileData.set(processedData, FILM_HEADER_SIZE);
            callback(fileData);
          } catch (e) {
            callback(null);
          }
        };
        img.onerror = function () { callback(null); };
        img.src = src;
      } catch (e) {
        callback(null);
      }
    },
    fail: function () { callback(null); }
  });
}

module.exports = {
  CANVAS_WIDTH, CANVAS_HEIGHT,
  FILM_SCREEN_WIDTH, FILM_SCREEN_HEIGHT,
  FILM_HEADER_SIZE, FILM_PIXEL_DATA_SIZE, FILM_FILE_TOTAL_SIZE,
  DEVICE_CONFIGS,
  normalizeDeviceType, getDeviceTypeFromName,
  setDeviceType, getDeviceType, getDeviceConfig, getDeviceConfigForType,
  getCanvasWidth, getCanvasHeight, getScreenWidth, getScreenHeight,
  getFilmPixelDataSize, getFilmFileTotalSize,
  COLOR_RENDERING_MODE_DEFINITIONS,
  normalizeRenderingMode, getRenderingModeDefinition, getRenderingModeOptions,
  rgbPalette,
  findClosestColor,
  adjustContrast,
  floydSteinbergDither, atkinsonDither, stuckiDither, jarvisDither,
  applyDitherByType, bayerDither,
  processImageData, decodeProcessedData,
  extractLandscapeData,
  processAndDisplay,
  generateFilmHeader,
  wrapText,
  generateRandomFilename,
  decodeFilmFile,
  renderFilmThumbnail,
  imageToFilmData
};
