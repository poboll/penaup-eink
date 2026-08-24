let frameOriginalImage = null;
let frameScale = 1.0;
let frameOffsetX = 0;
let frameOffsetY = 0;
let frameCanvasRotation = 0;
let frameCameraStream = null;
let frameActiveTab = 'frame-upload';
var frameRenderRevision = Object.create(null);
var frameRenderRaf = Object.create(null);

function frameMarkDeveloping() {
    document.body.dataset.flow = 'developing';
    var page = document.getElementById('frame-page');
    if (page) page.classList.add('is-developing');
}

function frameRenderStatus(canvasId, message, type) {
    var resultId = {
        'frame-canvas': 'frame-result',
        'frame-camera-canvas': 'frame-camera-result',
        'frame-quote-canvas': 'frame-quote-result'
    }[canvasId];
    var result = resultId && document.getElementById(resultId);
    if (!result) return;
    result.textContent = message;
    result.className = type || '';
}

function initFrameTabSwitch() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.frame-tab'));
    if (!tabs.length) return;

    function activateTab(tab, moveFocus) {
        if (!tab) return;
        var tabId = tab.getAttribute('data-frame-tab');
        tabs.forEach(function(t) {
            var active = t === tab;
            var panelId = t.getAttribute('aria-controls') || t.getAttribute('data-frame-tab');
            var panel = document.getElementById(panelId);
            t.classList.toggle('active', active);
            t.setAttribute('aria-selected', active ? 'true' : 'false');
            t.setAttribute('tabindex', active ? '0' : '-1');
            if (panel) {
                panel.classList.toggle('active', active);
                panel.setAttribute('aria-hidden', active ? 'false' : 'true');
            }
        });
        frameActiveTab = tabId;
        if (tabId !== 'frame-camera' && frameCameraStream) {
            frameStopCamera();
        }
        if (moveFocus) tab.focus();
        var pageContent = document.getElementById('page-content');
        if (pageContent) pageContent.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        setTimeout(function() {
            updateCanvasScale();
        }, 50);
    }

    tabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
            activateTab(this, false);
        });
        tab.addEventListener('keydown', function(event) {
            var index = tabs.indexOf(this);
            var nextIndex = index;
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = tabs.length - 1;
            if (nextIndex !== index) {
                event.preventDefault();
                activateTab(tabs[nextIndex], true);
            } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activateTab(this, false);
            }
        });
    });

    activateTab(tabs.find(function(tab) { return tab.classList.contains('active'); }) || tabs[0], false);
}

function initFrameUpload() {
    var fileInput = document.getElementById('frameFileInput');
    var selectBtn = document.getElementById('frameSelectBtn');

    selectBtn.addEventListener('click', function() {
        fileInput.click();
    });

    fileInput.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        frameMarkDeveloping();
        e.target.value = '';
        var objectUrl = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function() {
            URL.revokeObjectURL(objectUrl);
            frameOriginalImage = img;
            frameSetupImage('frame-canvas', false);
            frameUpdateImage('frame-canvas');
            document.getElementById('frameUploadBtn').disabled = false;
            document.getElementById('frame-reset-upload').disabled = false;
        };
        img.onerror = function() {
            URL.revokeObjectURL(objectUrl);
            showMessage('照片读取失败，请换一张图片重试', 'error');
        };
        img.src = objectUrl;
    });

    document.getElementById('frameUploadBtn').addEventListener('click', function() {
        frameUploadToDevice('frame-canvas', 'frame-transfer-');
    });
}

function initFrameCamera() {
    var captureBtn = document.getElementById('frameCaptureBtn');
    var confirmBtn = document.getElementById('frameCaptureConfirm');

    captureBtn.addEventListener('click', function() {
        frameStartCamera();
    });

    confirmBtn.addEventListener('click', function() {
        frameCapturePhoto();
    });

    document.getElementById('frameCameraUploadBtn').addEventListener('click', function() {
        frameUploadToDevice('frame-camera-canvas', 'frame-camera-transfer-');
    });
}

function frameStartCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showMessage('当前浏览器不支持相机功能', 'error');
        return;
    }

    navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }
    }).then(function(stream) {
        frameCameraStream = stream;
        var video = document.getElementById('frameVideo');
        video.srcObject = stream;
        document.getElementById('frame-video-container').style.display = 'block';
        document.getElementById('frameCaptureBtn').style.display = 'none';
    }).catch(function(err) {
        showMessage('无法访问相机: ' + err.message, 'error');
    });
}

function frameCapturePhoto() {
    var video = document.getElementById('frameVideo');
    var tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    var ctx = tempCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    var img = new Image();
    if (tempCanvas.toBlob) {
        tempCanvas.toBlob(function(blob) {
            if (!blob) {
                showMessage('照片生成失败，请重试', 'error');
                return;
            }
            var objectUrl = URL.createObjectURL(blob);
            img.onload = function() {
                URL.revokeObjectURL(objectUrl);
                frameOriginalImage = img;
                frameMarkDeveloping();
                frameSetupImage('frame-camera-canvas', true);
                frameUpdateImage('frame-camera-canvas');
                document.getElementById('frameCameraUploadBtn').disabled = false;
                document.getElementById('frame-reset-camera').disabled = false;
            };
            img.onerror = function() { URL.revokeObjectURL(objectUrl); };
            img.src = objectUrl;
        }, 'image/jpeg', 0.92);
    } else {
        img.onload = function() {
            frameOriginalImage = img;
            frameMarkDeveloping();
            frameSetupImage('frame-camera-canvas', true);
            frameUpdateImage('frame-camera-canvas');
            document.getElementById('frameCameraUploadBtn').disabled = false;
            document.getElementById('frame-reset-camera').disabled = false;
        };
        img.src = tempCanvas.toDataURL('image/jpeg', 0.92);
    }

    frameStopCamera();
}

function frameStopCamera() {
    if (frameCameraStream) {
        frameCameraStream.getTracks().forEach(function(track) {
            track.stop();
        });
        frameCameraStream = null;
    }
    var video = document.getElementById('frameVideo');
    video.srcObject = null;
    document.getElementById('frame-video-container').style.display = 'none';
    document.getElementById('frameCaptureBtn').style.display = '';
}

function frameSetupImage(canvasId, fill) {
    var canvas = document.getElementById(canvasId);
    var img = frameOriginalImage;

    // 相纸按用户的手持方向始终是竖版。照片保持原始方向，用户可以
    // 继续通过构图手势调整位置；旋转只留给转换器的显式操作。
    frameCanvasRotation = 0;

    var effectiveWidth = frameCanvasRotation === 1 ? getCanvasHeight() : getCanvasWidth();
    var effectiveHeight = frameCanvasRotation === 1 ? getCanvasWidth() : getCanvasHeight();
    var scaleX = effectiveWidth / img.width;
    var scaleY = effectiveHeight / img.height;
    frameScale = fill ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    frameOffsetX = 0;
    frameOffsetY = 0;
}

function frameUpdateImage(canvasId) {
    if (!frameOriginalImage) return;

    var canvas = document.getElementById(canvasId);
    var canvasWidth = getCanvasWidth();
    var canvasHeight = getCanvasHeight();
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    var ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.save();

    var effectiveWidth = canvasWidth;
    var effectiveHeight = canvasHeight;

    if (frameCanvasRotation === 1) {
        ctx.translate(0, canvasHeight);
        ctx.rotate(-Math.PI / 2);
        effectiveWidth = canvasHeight;
        effectiveHeight = canvasWidth;
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, effectiveWidth, effectiveHeight);

    var imgWidth = frameOriginalImage.width * frameScale;
    var imgHeight = frameOriginalImage.height * frameScale;
    var drawX = (effectiveWidth - imgWidth) / 2 + frameOffsetX;
    var drawY = (effectiveHeight - imgHeight) / 2 + frameOffsetY;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, effectiveWidth, effectiveHeight);
    ctx.clip();

    ctx.drawImage(
        frameOriginalImage,
        0, 0,
        frameOriginalImage.width, frameOriginalImage.height,
        drawX, drawY,
        imgWidth, imgHeight
    );

    ctx.restore();
    ctx.restore();

    var imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    adjustContrast(imageData, 1.2);
    frameRenderStatus(canvasId, '显影中 · 六色基底正在计算', 'render-note');

    var revision = (frameRenderRevision[canvasId] || 0) + 1;
    frameRenderRevision[canvasId] = revision;
    var perceivedColorFeelCount = (window.PenaupFilmCore && window.PenaupFilmCore.PERCEIVED_COLOR_FEEL_COUNT) || 48;
    var renderPromise = window.PenaupImageWorker && window.PenaupImageWorker.supported
        ? window.PenaupImageWorker.process({
            data: imageData.data.slice().buffer,
            width: canvasWidth,
            height: canvasHeight,
            profile: getDeviceConfig().key,
            contrast: 1,
            dither: true,
            ditherType: 'adaptive',
            ditherStrength: 1
        })
        : Promise.reject(new Error('film_worker_unavailable'));

    renderPromise.then(function(workerResult) {
        if (frameRenderRevision[canvasId] !== revision) return;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(workerResult.preview), canvasWidth, canvasHeight), 0, 0);
        frameRenderStatus(canvasId, '六色显影完成 · 最多 ' + perceivedColorFeelCount + ' 种色彩观感可预览', 'success');
        updateCanvasScale();
    }).catch(function(error) {
        if (frameRenderRevision[canvasId] !== revision || error.name === 'AbortError') return;
        try {
            var processedImageData = adaptiveDither(imageData);
            var processedData = processImageData(processedImageData);
            var finalImageData = decodeProcessedData(processedData, canvasWidth, canvasHeight);
            ctx.putImageData(finalImageData, 0, 0);
            frameRenderStatus(canvasId, '六色显影完成 · 最多 ' + perceivedColorFeelCount + ' 种观感 · 本地降级模式', 'render-note');
            updateCanvasScale();
        } catch (fallbackError) {
            frameRenderStatus(canvasId, '显影失败 · 请换一张照片重试', 'error');
            showMessage('显影失败：' + fallbackError.message, 'error');
        }
    });
}

async function frameEncodeCanvas(canvas) {
    var canvasWidth = getCanvasWidth();
    var canvasHeight = getCanvasHeight();
    var ctx = canvas.getContext('2d');
    var imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    if (window.PenaupImageWorker && window.PenaupImageWorker.supported) {
        try {
            var workerResult = await window.PenaupImageWorker.process({
                data: imageData.data.slice().buffer,
                width: canvasWidth,
                height: canvasHeight,
                profile: getDeviceConfig().key,
                contrast: 1,
                dither: false,
                ditherType: 'adaptive',
                ditherStrength: 1
            });
            return new Uint8Array(workerResult.film);
        } catch (error) {
            if (error.name !== 'AbortError') console.warn('film worker encode fallback:', error);
        }
    }
    return processImageData(imageData);
}

async function frameUploadToDevice(canvasId, prefix) {
    if (typeof device === 'undefined' || !device || !server || !characteristic) {
        showMessage('请先连接设备', 'error');
        return;
    }

    if (!frameOriginalImage) {
        showMessage('请先选择照片', 'error');
        return;
    }

    try {
        var canvas = document.getElementById(canvasId);
        var processedData = await frameEncodeCanvas(canvas);
        var header = generateFilmHeader();
        var totalSize = getFilmFileTotalSize();
        var fileData = new Uint8Array(totalSize);
        fileData.set(header, 0);
        fileData.set(processedData, 32);

        frameUploadViaBle('frame.film', fileData, prefix);
    } catch (error) {
        showMessage('转换失败: ' + error.message, 'error');
    }
}

async function frameQuoteUploadToDevice() {
    if (typeof device === 'undefined' || !device || !server || !characteristic) {
        showMessage('请先连接设备', 'error');
        return;
    }

    try {
        var canvas = document.getElementById('frame-quote-canvas');
        var processedData = await frameEncodeCanvas(canvas);
        var header = generateFilmHeader();
        var totalSize = getFilmFileTotalSize();
        var fileData = new Uint8Array(totalSize);
        fileData.set(header, 0);
        fileData.set(processedData, 32);

        frameUploadViaBle('quote.film', fileData, 'frame-quote-transfer-');
    } catch (error) {
        showMessage('转换失败: ' + error.message, 'error');
    }
}

async function frameUploadViaBle(fileName, fileData, prefix) {
    var expectedSize = getFilmFileTotalSize();
    if (fileData.length !== expectedSize) {
        showMessage('文件大小不符合要求(应为' + expectedSize + '字节)', 'error');
        return { ok: false, code: 'film_size_mismatch' };
    }

    var container = document.getElementById(prefix + 'container');
    if (container) {
        container.style.display = 'block';
    }

    frameUpdateTransferStatus(prefix, '准备传输...', 0);

    try {
        filmTransState = BLE_FILM_TRANS_STATE_STARTED;
        filmTransFileName = fileName;
        filmTransFileSize = fileData.length;
        filmTransSentBytes = 0;

        await sendBleFileStart();
        await sendBleFileName(fileName);
        await sendBleFileLen(fileData.length);

        var chunkSize = BLE_CHUNK_SIZE;
        var sentBytes = 0;
        for (var i = 0; i < fileData.length; i += chunkSize) {
            var chunk = fileData.slice(i, i + chunkSize);
            await sendBleFileData(chunk);
            sentBytes += chunk.length;
            filmTransSentBytes = sentBytes;
            var progress = Math.round((sentBytes / fileData.length) * 100);
            frameUpdateTransferStatus(prefix, '传输中...', progress);
        }

        await sendBleFileStop();
        frameUpdateTransferStatus(prefix, '已写入，等待电子纸刷新确认', 100);
        showMessage('文件已发送，设备刷新结果待确认', 'info');
        return { ok: true, state: 'device_state_uncertain' };
    } catch (error) {
        frameUpdateTransferStatus(prefix, '传输失败，可重新发送: ' + error.message, 0);
        showMessage('传输失败: ' + error.message, 'error');
        return { ok: false, code: 'transfer_failed', error: error };
    }
}

function frameUpdateTransferStatus(prefix, message, progress) {
    var statusEl = document.getElementById(prefix + 'status');
    var progressBarEl = document.getElementById(prefix + 'progress-bar');
    var progressEl = document.getElementById(prefix + 'progress');

    if (statusEl) statusEl.textContent = message;
    if (progressBarEl) progressBarEl.style.width = progress + '%';
    if (progressEl) progressEl.textContent = progress + '%';
}

function frameApplyDragOffset(deltaX, deltaY) {
    // 视觉 canvas 已经是竖版，不再由 CSS 旋转，因此拖动坐标直接映射。
    var cssRotated = false;
    if (frameCanvasRotation === 1) {
        if (cssRotated) {
            frameOffsetX += deltaX;
            frameOffsetY += deltaY;
        } else {
            frameOffsetX -= deltaY;
            frameOffsetY += deltaX;
        }
    } else if (cssRotated) {
        frameOffsetX += deltaY;
        frameOffsetY -= deltaX;
    } else {
        frameOffsetX += deltaX;
        frameOffsetY += deltaY;
    }
}

function frameScheduleRender(canvasId) {
    if (frameRenderRaf[canvasId]) return;
    frameRenderRaf[canvasId] = window.requestAnimationFrame(function() {
        frameRenderRaf[canvasId] = 0;
        frameUpdateImage(canvasId);
    });
}

function frameResetComposition(canvasId) {
    if (!frameOriginalImage) return;
    frameSetupImage(canvasId, canvasId === 'frame-camera-canvas');
    frameScheduleRender(canvasId);
}

function initFrameCanvasInteraction(canvasId, btnId) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var pointers = Object.create(null);
    var dragging = false;
    var startPoint = null;
    var startScale = 1;
    var pinchDistance = 0;

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', function(event) {
        if (!frameOriginalImage) return;
        canvas.setPointerCapture(event.pointerId);
        pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
        var points = Object.keys(pointers);
        if (points.length === 1) {
            dragging = true;
            startPoint = { x: event.clientX, y: event.clientY };
        } else if (points.length === 2) {
            var first = pointers[points[0]];
            var second = pointers[points[1]];
            pinchDistance = Math.hypot(second.x - first.x, second.y - first.y);
            startScale = frameScale;
            dragging = false;
        }
        event.preventDefault();
    });

    canvas.addEventListener('pointermove', function(event) {
        if (!pointers[event.pointerId]) return;
        pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
        var points = Object.keys(pointers);
        if (points.length === 1 && dragging && startPoint) {
            frameApplyDragOffset(event.clientX - startPoint.x, event.clientY - startPoint.y);
            startPoint = { x: event.clientX, y: event.clientY };
            frameScheduleRender(canvasId);
        } else if (points.length >= 2 && pinchDistance > 0) {
            var first = pointers[points[0]];
            var second = pointers[points[1]];
            var distance = Math.hypot(second.x - first.x, second.y - first.y);
            frameScale = Math.max(0.05, Math.min(10, startScale * distance / pinchDistance));
            frameScheduleRender(canvasId);
        }
        event.preventDefault();
    });

    function releasePointer(event) {
        delete pointers[event.pointerId];
        if (Object.keys(pointers).length === 0) {
            dragging = false;
            startPoint = null;
            pinchDistance = 0;
        }
    }
    canvas.addEventListener('pointerup', releasePointer);
    canvas.addEventListener('pointercancel', releasePointer);
    canvas.addEventListener('wheel', function(event) {
        if (!frameOriginalImage) return;
        event.preventDefault();
        var factor = event.deltaY > 0 ? 0.92 : 1.08;
        var nextScale = Math.max(0.05, Math.min(10, frameScale * factor));
        var relativeX = (event.clientX - canvas.getBoundingClientRect().left) / getCanvasWidth();
        var relativeY = (event.clientY - canvas.getBoundingClientRect().top) / getCanvasHeight();
        frameOffsetX += relativeX * (frameOriginalImage.width * nextScale - frameOriginalImage.width * frameScale);
        frameOffsetY += relativeY * (frameOriginalImage.height * nextScale - frameOriginalImage.height * frameScale);
        frameScale = nextScale;
        frameScheduleRender(canvasId);
    }, { passive: false });

    var resetButton = document.getElementById(btnId);
    if (resetButton) resetButton.addEventListener('click', function() { frameResetComposition(canvasId); });
}

// ===== 每日一句 =====

var frameCurrentQuote = { text: '', author: '' };

var frameQuoteFontKey = 'system';
var frameQuoteFonts = {
    huiwen: '"Huiwen Mincho", "Songti SC", "STSong", Georgia, serif',
    system: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
};

function frameQuoteFontFamily() {
    return frameQuoteFonts[frameQuoteFontKey] || frameQuoteFonts.system;
}

function frameQuoteSyncFontUi() {
    document.querySelectorAll('[data-frame-font]').forEach(function(button) {
        var active = button.dataset.frameFont === frameQuoteFontKey;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

var frameLocalQuotes = [
    { text: '把今天留给明天看。', author: '花生片' },
    { text: '慢一点，画面会自己找到位置。', author: 'Penaup' },
    { text: '日常值得被好好保存。', author: '花生片' },
    { text: '光落在纸上，也落在心里。', author: 'Penaup' },
    { text: '留下一张，想起一整天。', author: '花生片' }
];

// 六色方案
var frameColorSchemes = [
    { bg: '#ffffff', text: '#000000', accent: '#ff0000', author: '#000000' },
    { bg: '#ffffff', text: '#000000', accent: '#0000ff', author: '#000000' },
    { bg: '#ffffff', text: '#000000', accent: '#29cc14', author: '#000000' },
];

function initFrameQuote() {
    var quoteBtn = document.getElementById('frameQuoteBtn');
    var sendBtn = document.getElementById('frameQuoteUploadBtn');
    var customToggle = document.getElementById('frameCustomQuoteToggle');
    var customPanel = document.getElementById('frame-custom-quote-panel');
    var customBtn = document.getElementById('frameCustomQuoteBtn');
    var customText = document.getElementById('frameCustomText');
    var customAuthor = document.getElementById('frameCustomAuthor');

    frameQuoteSyncFontUi();
    document.querySelectorAll('[data-frame-font]').forEach(function(button) {
        button.addEventListener('click', function() {
            var nextFont = button.dataset.frameFont;
            if (!frameQuoteFonts[nextFont]) return;
            frameQuoteFontKey = nextFont;
            frameQuoteSyncFontUi();
            if (frameCurrentQuote.text) {
                var redraw = function() { frameRenderQuote(frameCurrentQuote.text, frameCurrentQuote.author); };
                if (nextFont === 'huiwen' && document.fonts && typeof document.fonts.load === 'function') {
                    document.fonts.load('400 30px "Huiwen Mincho"').then(redraw).catch(redraw);
                } else {
                    redraw();
                }
            }
        });
    });

    quoteBtn.addEventListener('click', function() {
        frameFetchQuote();
    });

    sendBtn.addEventListener('click', function() {
        frameQuoteUploadToDevice();
    });

    // 自定义名言面板切换
    customToggle.addEventListener('click', function() {
        var isHidden = customPanel.style.display === 'none';
        customPanel.style.display = isHidden ? 'flex' : 'none';
    });

    // 生成自定义名言
    customBtn.addEventListener('click', function() {
        var text = customText.value.trim();
        if (!text) {
            customText.focus();
            return;
        }
        var author = customAuthor.value.trim();
        frameCurrentQuote.text = text;
        frameCurrentQuote.author = author;
        frameRenderQuote(text, author);
    });

    // 支持 Ctrl+Enter 键生成
    customText.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && e.ctrlKey) {
            customBtn.click();
        }
    });

    frameFetchQuote();
}

function frameFetchQuote() {
    var quote = frameLocalQuotes[Math.floor(Math.random() * frameLocalQuotes.length)];
    frameCurrentQuote.text = quote.text;
    frameCurrentQuote.author = quote.author;
    frameRenderQuote(frameCurrentQuote.text, frameCurrentQuote.author);
}

function frameRenderQuote(text, author) {
    var canvas = document.getElementById('frame-quote-canvas');
    var cw = getCanvasWidth();
    var ch = getCanvasHeight();
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext('2d');

    var portrait = getCanvasHeight() > getCanvasWidth();
    ctx.save();
    var w, h;
    if (portrait) {
        // 竖屏设备（Max）：画布本身竖屏，直接绘制
        w = cw;
        h = ch;
    } else {
        // 横向设备：反向旋转抵消CSS的rotate(90deg)，有效绘制区域为 height x width
        ctx.translate(0, ch);
        ctx.rotate(-Math.PI / 2);
        w = ch;
        h = cw;
    }

    // 布局缩放系数：以 Pro 有效宽（528）为基准，仅放大竖屏大屏设备（Max），不改变基础版/Pro 现有布局
    var s = Math.max(1, w / 528);

    // 随机配色方案
    var scheme = frameColorSchemes[Math.floor(Math.random() * frameColorSchemes.length)];

    // 纯色背景
    ctx.fillStyle = scheme.bg;
    ctx.fillRect(0, 0, w, h);

    // 装饰引号
    ctx.font = 'italic ' + Math.round(80 * s) + 'px Georgia, serif';
    ctx.fillStyle = scheme.accent;
    ctx.fillText('\u201C', 20 * s, 90 * s);

    // 装饰线
    ctx.strokeStyle = scheme.accent;
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.moveTo(35 * s, 105 * s);
    ctx.lineTo(90 * s, 105 * s);
    ctx.stroke();

    // 文字
    ctx.font = '600 ' + Math.round(30 * s) + 'px ' + frameQuoteFontFamily();
    ctx.fillStyle = scheme.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    var zhLines = frameWrapText(ctx, text, 30 * s, w - 80 * s);
    var zhLineHeight = 44 * s;
    var zhTotalHeight = zhLines.length * zhLineHeight;
    // 整体居中：考虑作者和装饰线的空间
    var bottomSpace = author ? 130 * s : 60 * s;  // 作者+装饰线+日期的空间
    var availableHeight = h - 100 * s - bottomSpace;  // 减去顶部和底部空间
    var zhStartY = 100 * s + (availableHeight - zhTotalHeight) / 2;

    for (var i = 0; i < zhLines.length; i++) {
        ctx.fillText(zhLines[i], w / 2, zhStartY + i * zhLineHeight);
    }

    // 作者
    if (author) {
        ctx.font = '600 ' + Math.round(18 * s) + 'px ' + frameQuoteFontFamily();
        ctx.fillStyle = scheme.author;
        ctx.fillText('\u2014\u2014 ' + author, w / 2, h - 130 * s);
    }

    // 底部装饰线
    ctx.strokeStyle = scheme.accent;
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 30 * s, h - 65 * s);
    ctx.lineTo(w / 2 + 30 * s, h - 65 * s);
    ctx.stroke();

    // 电量图标（右上角）
    var batteryX = w - 55 * s;
    var batteryY = 20 * s;
    var batteryWidth = 35 * s;
    var batteryHeight = 18 * s;
    var batteryLevel = (typeof deviceBatteryLevel !== 'undefined') ? deviceBatteryLevel / 100 : 0;
    var batteryRadius = 4 * s;

    // 绘制圆角矩形函数
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

    // 电池外框
    drawRoundedRect(batteryX, batteryY, batteryWidth, batteryHeight, batteryRadius);
    ctx.strokeStyle = scheme.accent;
    ctx.lineWidth = 1.5 * s;
    ctx.stroke();

    // 电池正极
    ctx.fillStyle = scheme.accent;
    ctx.fillRect(batteryX + batteryWidth + 1 * s, batteryY + 5 * s, 3 * s, batteryHeight - 10 * s);

    // 电池电量
    drawRoundedRect(batteryX + 2 * s, batteryY + 2 * s, (batteryWidth - 4 * s) * batteryLevel, batteryHeight - 4 * s, 2 * s);
    ctx.fillStyle = scheme.accent;
    ctx.fill();

    // 日期显示（底部居中）
    var now = new Date();
    var dateStr = now.getFullYear() + ' 年 ' + (now.getMonth() + 1).toString().padStart(2, '0') + ' 月 ' + now.getDate().toString().padStart(2, '0') + ' 日';
    ctx.font = '600 ' + Math.round(16 * s) + 'px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = scheme.accent;
    ctx.textAlign = 'center';
    ctx.fillText(dateStr, w / 2, h - 30 * s);

    ctx.restore();

    // 转换为六色显示效果（根据开关决定是否使用抖动）
    var imageData = ctx.getImageData(0, 0, cw, ch);
    var useDither = document.getElementById('frameQuoteDither').checked;
    var processedData = useDither 
        ? processImageData(floydSteinbergDither(imageData, 0.8))
        : processImageData(imageData);
    var finalData = decodeProcessedData(processedData, cw, ch);
    ctx.putImageData(finalData, 0, 0);

    updateCanvasScale();
}

function frameWrapText(ctx, text, fontSize, maxWidth) {
    var lines = [];
    // 先按手动换行符分割
    var paragraphs = text.split('\n');
    for (var p = 0; p < paragraphs.length; p++) {
        var currentLine = '';
        // 使用Array.from正确处理emoji等多码点字符
        var chars = Array.from(paragraphs[p]);
        if (chars.length === 0) {
            lines.push('');  // 保留空行
            continue;
        }
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
        if (currentLine.length > 0) {
            lines.push(currentLine);
        }
    }
    return lines;
}

// ===== 初始化 =====

function initFramePage() {
    initFrameTabSwitch();
    initFrameUpload();
    initFrameCamera();
    initFrameQuote();
    initFrameCanvasInteraction('frame-canvas', 'frameUploadBtn');
    initFrameCanvasInteraction('frame-camera-canvas', 'frameCameraUploadBtn');

    document.querySelectorAll('.nav-item').forEach(function(item) {
        if (item.getAttribute('data-page') !== 'frame-page') {
            item.addEventListener('click', function() {
                if (frameCameraStream) {
                    frameStopCamera();
                }
            });
        }
    });
}

window.addEventListener('DOMContentLoaded', initFramePage);
