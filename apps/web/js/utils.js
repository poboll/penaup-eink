// 工具函数

// ===== 设备配置 =====
var FilmCore = window.PenaupFilmCore;
var DEVICE_CONFIGS = {
    FRAMEFILM: FilmCore.PROFILES.PENAUP_STD,
    FRAMEFILMPRO: FilmCore.PROFILES.PENAUP_PRO,
    FRAMEFILMMAX: FilmCore.PROFILES.PENAUP_MAX
};
DEVICE_CONFIGS.PENAUP = DEVICE_CONFIGS.FRAMEFILM;
DEVICE_CONFIGS.PENAUPPRO = DEVICE_CONFIGS.FRAMEFILMPRO;
DEVICE_CONFIGS.PENAUPMAX = DEVICE_CONFIGS.FRAMEFILMMAX;

// 花生片当前主产品是 E6 Pro 3.68 英寸；STD/Max 仍可在连接后显式切换。
var DEFAULT_DEVICE_TYPE = 'PENAUPPRO';
var currentDeviceType = DEFAULT_DEVICE_TYPE;

function getDeviceConfig() {
    return DEVICE_CONFIGS[currentDeviceType] || DEVICE_CONFIGS['PENAUP'];
}

function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[character];
    });
}

// 物理协议屏幕是否竖向；STD/Pro 的视觉相纸会在预览中另行旋转。
function isPortraitDevice() {
    var cfg = getDeviceConfig();
    return cfg.screenHeight > cfg.screenWidth;
}

function setDeviceType(type) {
    var profileKey = FilmCore.normalizeProfileKey(type);
    var typeMap = { PENAUP_STD: 'PENAUP', PENAUP_PRO: 'PENAUPPRO', PENAUP_MAX: 'PENAUPMAX' };
    var normalizedType = typeMap[profileKey] || type;
    if (DEVICE_CONFIGS[normalizedType]) {
        currentDeviceType = normalizedType;
        onDeviceTypeChanged();
    }
}

function onDeviceTypeChanged() {
    // 更新所有 canvas 尺寸
    var cfg = getDeviceConfig();
    var canvases = document.querySelectorAll('canvas[id]');
    for (var i = 0; i < canvases.length; i++) {
        if (canvases[i].closest && canvases[i].closest('.weread-polaroid-inner')) continue;
        canvases[i].width = cfg.screenWidth;
        canvases[i].height = cfg.screenHeight;
    }
    // 更新设备类型信息显示
    var badge = document.getElementById('device-type-badge');
    var resolution = document.getElementById('device-resolution');
    var typeInfo = document.getElementById('device-type-info');
    if (badge) {
        badge.textContent = cfg.displayName;
    }
    if (resolution) {
        resolution.textContent = cfg.screenWidth + ' x ' + cfg.screenHeight;
    }
    if (typeInfo) {
        typeInfo.style.display = 'flex';
    }
}

function getCanvasWidth() {
    var w = getDeviceConfig().screenWidth;
    console.log('[DEBUG] getCanvasWidth() = ' + w + ' | deviceType=' + currentDeviceType);
    return w;
}

function getCanvasHeight() {
    var h = getDeviceConfig().screenHeight;
    console.log('[DEBUG] getCanvasHeight() = ' + h + ' | deviceType=' + currentDeviceType);
    return h;
}

// Keep the logical film bitmap centered inside the physical preview frame.
// STD/Pro are rotated for the portrait preview; Max is already portrait.
function fitPolaroidCanvas(container, canvas) {
    if (!container || !canvas) return;

    var profile = getDeviceConfig();
    var logicalWidth = profile.screenWidth;
    var logicalHeight = profile.screenHeight;
    var visualWidth = profile.canvasWidth || logicalWidth;
    var visualHeight = profile.canvasHeight || logicalHeight;
    var needsRotation = logicalWidth !== visualWidth || logicalHeight !== visualHeight;

    container.style.aspectRatio = visualWidth + ' / ' + visualHeight;
    container.style.minHeight = '0';

    var containerWidth = container.clientWidth;
    var containerHeight = container.clientHeight;
    if (!containerWidth || !containerHeight) return;

    var scale = Math.min(containerWidth / visualWidth, containerHeight / visualHeight);
    canvas.style.position = 'absolute';
    canvas.style.left = '50%';
    canvas.style.top = '50%';
    canvas.style.width = logicalWidth + 'px';
    canvas.style.height = logicalHeight + 'px';
    canvas.style.maxWidth = 'none';
    canvas.style.maxHeight = 'none';
    canvas.style.transform = 'translate(-50%, -50%)' + (needsRotation ? ' rotate(90deg)' : '') + ' scale(' + scale + ')';
    canvas.dataset.displayScale = String(scale);
}

function getFilmPixelDataSize() {
    var size = FilmCore.getProfile(getDeviceConfig()).bodySize;
    console.log('[DEBUG] getFilmPixelDataSize() = ' + size + ' | deviceType=' + currentDeviceType);
    return size;
}

function getFilmFileTotalSize() {
    var total = FilmCore.getProfile(getDeviceConfig()).totalSize;
    console.log('[DEBUG] getFilmFileTotalSize() = ' + total + ' | deviceType=' + currentDeviceType);
    return total;
}

// 根据设备类型返回正确的像素索引
function getPixelIndex(x, y, width, height) {
    var profile = getDeviceConfig();
    if (FilmCore.canvasPixelIndex) return FilmCore.canvasPixelIndex(x, y, profile, width, height);
    return FilmCore.pixelIndex(x, y, profile);
}

// 显示消息提示
function showMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.setAttribute('role', type === 'error' ? 'alert' : 'status');
    messageDiv.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    messageDiv.textContent = message;
    document.body.appendChild(messageDiv);
    requestAnimationFrame(() => messageDiv.classList.add('is-visible'));

    setTimeout(() => {
        messageDiv.classList.remove('is-visible');
        messageDiv.addEventListener('transitionend', () => messageDiv.remove(), { once: true });
        setTimeout(() => messageDiv.remove(), 380);
    }, 3000);
}

function showHint(element) {
    const tooltip = element.querySelector('.hint-tooltip');
    if (tooltip) {
        tooltip.style.display = tooltip.style.display === 'block' ? 'none' : 'block';
        setTimeout(() => {
            tooltip.style.display = 'none';
        }, 3000);
    }
}

// 检查浏览器是否支持蓝牙
function checkBluetoothSupport() {
    return navigator.bluetooth !== undefined;
}

// 检查是否在移动设备上
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 节流函数
function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 生成随机ID
function generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// 深拷贝对象
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    if (typeof obj === 'object') {
        const clonedObj = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                clonedObj[key] = deepClone(obj[key]);
            }
        }
        return clonedObj;
    }
}

// 检查是否为有效的JSON
function isValidJSON(str) {
    try {
        JSON.parse(str);
        return true;
    } catch (e) {
        return false;
    }
}

// 延迟函数
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 计算两点之间的距离
function distance(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

// 限制数字在指定范围内
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

// 线性插值
function lerp(start, end, t) {
    return start + (end - start) * t;
}

// 映射值到新范围
function map(value, inMin, inMax, outMin, outMax) {
    return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}
