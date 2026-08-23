/* Copyright (c) 2026 poboll · WeRead to Penaup Pro wallpaper */
(function () {
    'use strict';

    var STORAGE_KEY = 'penaup.weread.skill-key';
    var PROFILE = 'PENAUP_PRO';
    var WIDTH = 792;
    var HEIGHT = 528;
    var state = {
        mode: 'weekly',
        snapshot: null,
        film: null,
        renderRevision: 0
    };

    function byId(id) { return document.getElementById(id); }

    function setStatus(message, type) {
        var status = byId('weread-status');
        if (!status) return;
        status.textContent = message;
        status.className = 'weread-status' + (type ? ' is-' + type : '');
    }

    function setOutputButtons(options) {
        var png = byId('weread-download-png');
        var film = byId('weread-download-film');
        var send = byId('weread-send');
        var hasPreview = Boolean(options && options.preview);
        var hasFilm = Boolean(options && options.film);
        if (png) png.disabled = !hasPreview;
        if (film) film.disabled = !hasFilm;
        if (send) send.disabled = !hasFilm;
    }

    function safeText(value, fallback) {
        var text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
        return text || fallback || '';
    }

    function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

    function roundedRect(ctx, x, y, width, height, radius) {
        var r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    function wrapText(ctx, text, maxWidth, maxLines) {
        var source = Array.from(safeText(text));
        var lines = [];
        var current = '';
        source.forEach(function (character) {
            var candidate = current + character;
            if (current && ctx.measureText(candidate).width > maxWidth) {
                lines.push(current);
                current = character;
            } else {
                current = candidate;
            }
        });
        if (current) lines.push(current);
        if (lines.length > maxLines) {
            lines = lines.slice(0, maxLines);
            var last = lines[maxLines - 1];
            while (last.length && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
            lines[maxLines - 1] = last + '…';
        }
        return lines;
    }

    function drawTextLines(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
        var lines = wrapText(ctx, text, maxWidth, maxLines);
        lines.forEach(function (line, index) { ctx.fillText(line, x, y + index * lineHeight); });
        return lines.length;
    }

    function drawPaperGrain(ctx) {
        var colors = ['rgba(38,37,33,.045)', 'rgba(212,169,47,.045)', 'rgba(63,111,155,.03)'];
        for (var i = 0; i < 280; i += 1) {
            var x = (i * 67) % WIDTH;
            var y = (i * 43) % HEIGHT;
            ctx.fillStyle = colors[i % colors.length];
            ctx.fillRect(x, y, i % 3 === 0 ? 2 : 1, i % 5 === 0 ? 2 : 1);
        }
    }

    function drawPalette(ctx, x, y, width, height) {
        var colors = ['#262521', '#fffdf7', '#d4a92f', '#ad5145', '#3f6f9b', '#55765e'];
        var itemWidth = width / colors.length;
        colors.forEach(function (color, index) {
            ctx.fillStyle = color;
            ctx.fillRect(x + itemWidth * index, y, itemWidth + .5, height);
        });
        ctx.strokeStyle = 'rgba(38,37,33,.24)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);
    }

    function drawReadingBars(ctx, snapshot, x, y, width, height) {
        var readings = (snapshot.dailyReading || []).slice(-7);
        if (!readings.length) return;
        var max = Math.max.apply(null, readings.map(function (item) { return item.readingMinutes; }).concat([1]));
        var gap = 5;
        var itemWidth = Math.max(5, (width - gap * (readings.length - 1)) / readings.length);
        ctx.fillStyle = 'rgba(38,37,33,.12)';
        ctx.fillRect(x, y + height - 1, width, 1);
        readings.forEach(function (item, index) {
            var barHeight = Math.max(3, (item.readingMinutes / max) * (height - 12));
            ctx.fillStyle = index === readings.length - 1 ? '#d4a92f' : '#3f6f9b';
            roundedRect(ctx, x + index * (itemWidth + gap), y + height - barHeight, itemWidth, barHeight, 3);
            ctx.fill();
            ctx.fillStyle = '#67645c';
            ctx.font = '11px "SF Pro Text", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(String(item.day), x + index * (itemWidth + gap) + itemWidth / 2, y + height + 14);
        });
        ctx.textAlign = 'left';
    }

    function drawBook(ctx, book, x, y, width, index) {
        var title = safeText(book.title, '未命名书籍');
        var author = safeText(book.author, '作者未知');
        var minutes = Math.max(0, Number(book.readingMinutes) || 0);
        var progress = clamp(Number(book.progress) || 0, 0, 100);
        ctx.fillStyle = '#262521';
        ctx.font = '400 20px "Huiwen Mincho", "Songti SC", serif';
        ctx.textAlign = 'left';
        ctx.fillText(String(index + 1).padStart(2, '0'), x, y);
        ctx.fillStyle = '#262521';
        ctx.font = '400 18px "Huiwen Mincho", "Songti SC", serif';
        drawTextLines(ctx, title, x + 35, y, width - 150, 22, 1);
        ctx.fillStyle = '#67645c';
        ctx.font = '12px "SF Pro Text", sans-serif';
        ctx.fillText(author, x + 35, y + 19);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#3f6f9b';
        ctx.font = '12px ui-monospace, Menlo, monospace';
        ctx.fillText(minutes ? minutes + ' min' : (progress ? progress + '%' : '—'), x + width, y + 7);
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(38,37,33,.12)';
        ctx.fillRect(x + 35, y + 31, width - 35, 3);
        ctx.fillStyle = '#d4a92f';
        ctx.fillRect(x + 35, y + 31, (width - 35) * (minutes ? clamp(minutes / 360, .04, 1) : progress / 100), 3);
    }

    async function renderWallpaper(snapshot) {
        var canvas = byId('weread-canvas');
        if (!canvas) return;
        var revision = ++state.renderRevision;
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        ctx.fillStyle = '#f8f3e8';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        drawPaperGrain(ctx);

        ctx.fillStyle = '#3f6f9b';
        ctx.font = '600 12px ui-monospace, Menlo, monospace';
        ctx.letterSpacing = '1px';
        ctx.fillText('PENAUP / READING TRACE', 36, 36);
        ctx.letterSpacing = '0px';
        ctx.fillStyle = '#262521';
        ctx.font = '400 34px "Huiwen Mincho", "Songti SC", serif';
        ctx.fillText(snapshot.mode === 'weekly' ? '本周读书' : '本月读书', 36, 82);
        ctx.fillStyle = '#67645c';
        ctx.font = '13px "SF Pro Text", sans-serif';
        ctx.fillText(safeText(snapshot.periodLabel, '一页阅读记录'), 38, 105);
        drawPalette(ctx, WIDTH - 172, 30, 136, 9);

        ctx.strokeStyle = 'rgba(38,37,33,.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(36, 126);
        ctx.lineTo(WIDTH - 36, 126);
        ctx.stroke();

        var statX = WIDTH - 220;
        var statY = 154;
        ctx.fillStyle = '#262521';
        ctx.font = '400 34px "Huiwen Mincho", "Songti SC", serif';
        ctx.fillText(String(snapshot.readingMinutes || 0), statX, statY);
        ctx.fillStyle = '#67645c';
        ctx.font = '12px ui-monospace, Menlo, monospace';
        ctx.fillText('MINUTES', statX + 1, statY + 20);
        ctx.fillStyle = '#262521';
        ctx.font = '400 26px "Huiwen Mincho", "Songti SC", serif';
        ctx.fillText(String(snapshot.readingDays || 0), statX + 112, statY);
        ctx.fillStyle = '#67645c';
        ctx.font = '12px ui-monospace, Menlo, monospace';
        ctx.fillText('DAYS', statX + 113, statY + 20);

        ctx.fillStyle = '#67645c';
        ctx.font = '11px ui-monospace, Menlo, monospace';
        ctx.fillText('LAST SEVEN DAYS', statX, 201);
        drawReadingBars(ctx, snapshot, statX, 211, 184, 54);

        ctx.fillStyle = '#262521';
        ctx.font = '600 12px ui-monospace, Menlo, monospace';
        ctx.fillText('BOOKS IN THE MARGIN', 36, 155);
        var books = (snapshot.topBookDetails || []).slice(0, 5);
        if (!books.length) {
            ctx.fillStyle = '#67645c';
            ctx.font = '400 18px "Huiwen Mincho", "Songti SC", serif';
            ctx.fillText('这一页还在等你的阅读记录。', 36, 202);
        } else {
            books.forEach(function (book, index) { drawBook(ctx, book, 36, 188 + index * 48, 350, index); });
        }

        var excerpt = books.find(function (book) { return book.summary; });
        ctx.fillStyle = '#ad5145';
        ctx.fillRect(430, 303, 3, 72);
        ctx.fillStyle = '#262521';
        ctx.font = '400 24px "Huiwen Mincho", "Songti SC", serif';
        var excerptLines = drawTextLines(ctx, excerpt ? excerpt.summary : safeText(snapshot.quote, '读过的每一页，都会在某天回来。'), 450, 326, 288, 30, 2);
        ctx.fillStyle = '#67645c';
        ctx.font = '12px "SF Pro Text", sans-serif';
        ctx.fillText(excerpt ? '摘录 · ' + safeText(excerpt.title, '此刻') : '花生片 / Penaup', 450, 326 + excerptLines * 30 + 17);

        ctx.strokeStyle = 'rgba(38,37,33,.22)';
        ctx.beginPath();
        ctx.moveTo(36, 456);
        ctx.lineTo(WIDTH - 36, 456);
        ctx.stroke();
        ctx.fillStyle = '#67645c';
        ctx.font = '12px ui-monospace, Menlo, monospace';
        ctx.fillText('6 BASE INKS · UP TO 48 COLOR FEELS · E6 PRO', 36, 486);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#3f6f9b';
        ctx.fillText(String(snapshot.bookCount || books.length) + ' BOOKS  /  ' + String(snapshot.noteCount || 0) + ' NOTES', WIDTH - 36, 486);
        ctx.textAlign = 'left';

        var imageData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
        var worker = window.PenaupImageWorker;
        if (worker && worker.supported) {
            try {
                var result = await worker.process({
                    data: imageData.data.slice().buffer,
                    width: WIDTH,
                    height: HEIGHT,
                    profile: PROFILE,
                    contrast: 1,
                    dither: true,
                    ditherType: 'adaptive',
                    ditherStrength: 1
                });
                if (revision !== state.renderRevision) return;
                ctx.putImageData(new ImageData(new Uint8ClampedArray(result.preview), WIDTH, HEIGHT), 0, 0);
                state.film = new Uint8Array(result.film);
            } catch (error) {
                state.film = null;
            }
        } else {
            state.film = null;
        }
        var hasFilm = Boolean(state.film && window.PenaupFilmCore);
        var empty = byId('weread-empty');
        if (empty) empty.hidden = true;
        var meta = byId('weread-preview-meta');
        if (meta) meta.textContent = safeText(snapshot.periodLabel, '阅读记录') + ' · 3.68 英寸 E6 Pro · 6 色基底，最多 48 种色彩观感。' + (hasFilm ? '' : ' 当前仅完成预览，六色显影模块未就绪。');
        setOutputButtons({ preview: true, film: hasFilm });
        return hasFilm;
    }

    function saveKeyIfNeeded() {
        var input = byId('weread-skill-key');
        var remember = byId('weread-remember-key');
        if (!input || !remember) return;
        try {
            if (remember.checked && input.value.trim()) localStorage.setItem(STORAGE_KEY, input.value.trim());
            else localStorage.removeItem(STORAGE_KEY);
        } catch (error) { /* storage may be disabled; the request still works */ }
    }

    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    function downloadPng() {
        var canvas = byId('weread-canvas');
        if (!canvas || !state.snapshot) return;
        canvas.toBlob(function (blob) {
            if (blob) downloadBlob(blob, 'penaup-weread-' + state.snapshot.periodKey + '.png');
        }, 'image/png');
    }

    async function buildFilm() {
        if (state.film) return window.PenaupFilmCore.createFilmFile(PROFILE, state.film);
        throw new Error('film_render_unavailable');
    }

    async function downloadFilm() {
        try {
            var film = await buildFilm();
            downloadBlob(new Blob([film], { type: 'application/octet-stream' }), 'penaup-weread-' + state.snapshot.periodKey + '.film');
        } catch (error) {
            setStatus('六色 film 还没有准备好，请重新取回记录。', 'error');
        }
    }

    async function sendToDevice() {
        var deviceConfig = typeof getDeviceConfig === 'function' ? getDeviceConfig() : null;
        if (!deviceConfig || deviceConfig.key !== PROFILE) {
            setStatus('这张屏保固定为 Pro 版 792 × 528，请先连接花生片 Pro。', 'error');
            return;
        }
        if (typeof frameUploadViaBle !== 'function') {
            setStatus('设备传输模块还没有准备好，请刷新页面重试。', 'error');
            return;
        }
        try {
            var film = await buildFilm();
            var container = byId('weread-transfer-container');
            if (container) container.hidden = false;
            frameUploadViaBle('weread.film', film, 'weread-transfer-');
        } catch (error) {
            setStatus('生成 film 失败，请先重新取回阅读记录。', 'error');
        }
    }

    async function fetchSnapshot() {
        var input = byId('weread-skill-key');
        var button = byId('weread-fetch');
        var key = input && input.value.trim();
        if (!key) {
            setStatus('先填入微信读书 Skill Key，Key 不会被写入页面地址。', 'error');
            if (input) input.focus();
            return;
        }
        saveKeyIfNeeded();
        state.film = null;
        setOutputButtons({ preview: false, film: false });
        if (button) { button.disabled = true; button.classList.add('is-busy'); button.innerHTML = '<i class="material-icons">hourglass_top</i>正在取回阅读记录'; }
        setStatus('正在从微信读书取回一页记录，随后在本地显影。');
        try {
            var response = await fetch('/api/v1/integrations/weread/snapshot', {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json', 'X-Penaup-WeRead-Key': key },
                body: JSON.stringify({ mode: state.mode })
            });
            var payload = await response.json().catch(function () { return {}; });
            if (!response.ok || !payload.ok) throw new Error(payload.message || 'weread_unavailable');
            state.snapshot = payload.data;
            var rendered = await renderWallpaper(state.snapshot);
            var stats = byId('weread-stats');
            if (stats) {
                stats.hidden = false;
                stats.innerHTML = '<div class="weread-stat"><strong>' + Number(state.snapshot.readingMinutes || 0) + '</strong><span>阅读分钟</span></div>' +
                    '<div class="weread-stat"><strong>' + Number(state.snapshot.readingDays || 0) + '</strong><span>阅读天数</span></div>' +
                    '<div class="weread-stat"><strong>' + Number(state.snapshot.bookCount || 0) + '</strong><span>读过的书</span></div>';
            }
            setStatus(rendered ? '记录取回完成。先看看这一页，再决定要不要把它送到 Pro。' : '记录取回完成，但六色显影模块暂未就绪；可以先下载预览，稍后重试显影。', rendered ? 'success' : 'error');
        } catch (error) {
            state.snapshot = null;
            state.film = null;
            setOutputButtons({ preview: false, film: false });
            var message = error && error.message === 'weread_key_rejected' ? '这个 Key 似乎无效或已过期，请检查后重试。' : (error && error.message ? error.message : '微信读书暂时不可用，请稍后重试。');
            setStatus(message, 'error');
        } finally {
            if (button) { button.disabled = false; button.classList.remove('is-busy'); button.innerHTML = '<i class="material-icons">auto_awesome</i>取回阅读记录'; }
        }
    }

    function init() {
        if (!byId('frame-weread')) return;
        try {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                byId('weread-skill-key').value = saved;
                byId('weread-remember-key').checked = true;
            }
        } catch (error) {}
        document.querySelectorAll('[data-weread-mode]').forEach(function (button) {
            button.addEventListener('click', function () {
                state.mode = button.dataset.wereadMode === 'monthly' ? 'monthly' : 'weekly';
                document.querySelectorAll('[data-weread-mode]').forEach(function (item) {
                    var active = item === button;
                    item.classList.toggle('is-active', active);
                    item.setAttribute('aria-pressed', active ? 'true' : 'false');
                });
            });
        });
        byId('weread-fetch').addEventListener('click', fetchSnapshot);
        byId('weread-clear-key').addEventListener('click', function () {
            var input = byId('weread-skill-key');
            if (input) input.value = '';
            try { localStorage.removeItem(STORAGE_KEY); } catch (error) {}
            if (byId('weread-remember-key')) byId('weread-remember-key').checked = false;
            setStatus('已清除本机保存的 Key。');
        });
        byId('weread-remember-key').addEventListener('change', saveKeyIfNeeded);
        byId('weread-download-png').addEventListener('click', downloadPng);
        byId('weread-download-film').addEventListener('click', downloadFilm);
        byId('weread-send').addEventListener('click', sendToDevice);
    }

    window.addEventListener('DOMContentLoaded', init);
}());
