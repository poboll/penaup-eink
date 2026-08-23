/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 *
 * 微信读书壁纸实验室：服务端只转发最小数据，排版和六色显影留在浏览器。
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'penaup.weread.skill-key';
    var PROFILE = 'PENAUP_PRO';
    var WIDTH = 792;
    var HEIGHT = 528;
    var COLORS = {
        ink: '#262521',
        quiet: '#6d6a62',
        faint: '#aaa397',
        paper: '#f8f3e8',
        paperBright: '#fffdf7',
        line: 'rgba(38,37,33,.22)',
        red: '#ad5145',
        yellow: '#d4a92f',
        blue: '#3f6f9b',
        green: '#55765e'
    };
    var state = {
        mode: 'weekly',
        scene: 'weekly_receipt',
        renderMode: 'layer',
        snapshot: null,
        shelf: null,
        card: null,
        film: null,
        renderRevision: 0,
        source: 'live',
        phaseIndex: 0
    };
    var wallpaperFontPromise = null;

    function byId(id) { return document.getElementById(id); }

    function ensureWallpaperFonts() {
        if (wallpaperFontPromise) return wallpaperFontPromise;
        if (!document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve();
        wallpaperFontPromise = Promise.all([
            document.fonts.load('400 34px "Huiwen Mincho"'),
            document.fonts.load('400 22px "Huiwen Mincho"'),
            document.fonts.load('400 18px "Huiwen Mincho"')
        ]).then(function () {}).catch(function () {});
        return wallpaperFontPromise;
    }

    function safeText(value, fallback) {
        var text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
        return text || fallback || '';
    }

    function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

    function pad2(value) { return String(value).padStart(2, '0'); }

    // 示例数据完全在浏览器内生成，方便第一次打开实验室时先理解流程。
    // 它不模拟真实上游响应，也不应被当作微信读书数据。
    function createDemoSnapshot() {
        var now = new Date();
        var year = now.getFullYear();
        var month = now.getMonth() + 1;
        var day = now.getDate();
        var minutes = [42, 18, 66, 31, 87, 24, 53];
        var books = [
            { bookId: 'demo-book-01', title: '山茶文具店', author: '小川糸', readingMinutes: 186, progress: 72, summary: '有些话不必急着说出口，写下来，便有了再次抵达的时间。' },
            { bookId: 'demo-book-02', title: '云边有个小卖部', author: '张嘉佳', readingMinutes: 124, progress: 48, summary: '每个人都有自己的路要走，慢一点也没有关系。' },
            { bookId: 'demo-book-03', title: '设计中的设计', author: '原研哉', readingMinutes: 93, progress: 36, summary: '留白不是空缺，而是让事物重新呼吸的地方。' }
        ];
        return {
            source: 'demo',
            periodKey: year + '-' + pad2(month),
            periodLabel: year + ' 年 ' + pad2(month) + ' 月 · 示例阅读',
            readingMinutes: minutes.reduce(function (total, value) { return total + value; }, 0),
            readingDays: 6,
            bookCount: books.length,
            noteCount: 12,
            dailyReading: minutes.map(function (value, index) {
                return { day: Math.max(1, day - 6 + index), readingMinutes: value };
            }),
            topBooks: books.map(function (book) { return book.title; }),
            topBookDetails: books,
            quote: '把读过的书留给今天，明天再慢慢想起。',
            enrichment: 'demo'
        };
    }

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

    function drawPaperBase(ctx) {
        ctx.fillStyle = COLORS.paper;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        var grain = ['rgba(38,37,33,.045)', 'rgba(212,169,47,.045)', 'rgba(63,111,155,.03)'];
        for (var index = 0; index < 330; index += 1) {
            var x = (index * 67) % WIDTH;
            var y = (index * 43) % HEIGHT;
            ctx.fillStyle = grain[index % grain.length];
            ctx.fillRect(x, y, index % 3 === 0 ? 2 : 1, index % 5 === 0 ? 2 : 1);
        }
    }

    function drawPalette(ctx, x, y, width, height) {
        ['#262521', '#fffdf7', '#d4a92f', '#ad5145', '#3f6f9b', '#55765e'].forEach(function (color, index) {
            ctx.fillStyle = color;
            ctx.fillRect(x + width / 6 * index, y, width / 6 + .5, height);
        });
        ctx.strokeStyle = 'rgba(38,37,33,.26)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);
    }

    function drawHeading(ctx, title, subtitle, label) {
        ctx.fillStyle = COLORS.blue;
        ctx.font = '600 11px ui-monospace, Menlo, monospace';
        ctx.fillText(label || 'PENAUP / READING TRACE', 36, 33);
        ctx.fillStyle = COLORS.ink;
        ctx.font = '400 34px "Huiwen Mincho", "Songti SC", serif';
        ctx.fillText(safeText(title, '一页阅读记录'), 36, 78);
        ctx.fillStyle = COLORS.quiet;
        ctx.font = '13px "SF Pro Text", sans-serif';
        ctx.fillText(safeText(subtitle, '把读过的书留给今天。'), 38, 101);
        drawPalette(ctx, WIDTH - 172, 27, 136, 9);
        ctx.strokeStyle = COLORS.line;
        ctx.beginPath();
        ctx.moveTo(36, 122);
        ctx.lineTo(WIDTH - 36, 122);
        ctx.stroke();
    }

    function drawFooter(ctx, snapshot, label) {
        ctx.strokeStyle = COLORS.line;
        ctx.beginPath();
        ctx.moveTo(36, 475);
        ctx.lineTo(WIDTH - 36, 475);
        ctx.stroke();
        ctx.fillStyle = COLORS.quiet;
        ctx.font = '11px ui-monospace, Menlo, monospace';
        ctx.fillText(label || '6 BASE INKS · UP TO 48 COLOR FEELS · E6 PRO', 36, 500);
        ctx.textAlign = 'right';
        ctx.fillStyle = COLORS.blue;
        ctx.fillText(String(snapshot.bookCount || 0) + ' BOOKS  /  ' + String(snapshot.noteCount || 0) + ' NOTES', WIDTH - 36, 500);
        ctx.textAlign = 'left';
    }

    function drawReadingBars(ctx, snapshot, x, y, width, height, count) {
        var readings = (snapshot.dailyReading || []).slice(-(count || 7));
        if (!readings.length) return;
        var max = Math.max.apply(null, readings.map(function (item) { return item.readingMinutes; }).concat([1]));
        var gap = 5;
        var itemWidth = Math.max(5, (width - gap * (readings.length - 1)) / readings.length);
        ctx.fillStyle = 'rgba(38,37,33,.12)';
        ctx.fillRect(x, y + height - 1, width, 1);
        readings.forEach(function (item, index) {
            var barHeight = Math.max(3, (item.readingMinutes / max) * (height - 14));
            ctx.fillStyle = index === readings.length - 1 ? COLORS.yellow : COLORS.blue;
            roundedRect(ctx, x + index * (itemWidth + gap), y + height - barHeight, itemWidth, barHeight, 3);
            ctx.fill();
            ctx.fillStyle = COLORS.quiet;
            ctx.font = '11px ui-monospace, Menlo, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(String(item.day), x + index * (itemWidth + gap) + itemWidth / 2, y + height + 14);
        });
        ctx.textAlign = 'left';
    }

    function drawWeekly(ctx, snapshot) {
        drawHeading(ctx, '本周读书', snapshot.periodLabel, 'PENAUP / WEEKLY RECEIPT');
        var statX = WIDTH - 220;
        ctx.fillStyle = COLORS.ink;
        ctx.font = '400 34px "Huiwen Mincho", "Songti SC", serif';
        ctx.fillText(String(snapshot.readingMinutes || 0), statX, 155);
        ctx.fillStyle = COLORS.quiet;
        ctx.font = '11px ui-monospace, Menlo, monospace';
        ctx.fillText('MINUTES', statX + 1, 174);
        ctx.fillStyle = COLORS.ink;
        ctx.font = '400 26px "Huiwen Mincho", "Songti SC", serif';
        ctx.fillText(String(snapshot.readingDays || 0), statX + 112, 155);
        ctx.fillStyle = COLORS.quiet;
        ctx.font = '11px ui-monospace, Menlo, monospace';
        ctx.fillText('DAYS', statX + 113, 174);
        ctx.fillText('LAST SEVEN DAYS', statX, 201);
        drawReadingBars(ctx, snapshot, statX, 210, 184, 55, 7);

        ctx.fillStyle = COLORS.ink;
        ctx.font = '600 12px ui-monospace, Menlo, monospace';
        ctx.fillText('BOOKS IN THE MARGIN', 36, 151);
        var books = (snapshot.topBookDetails || []).slice(0, 5);
        if (!books.length) {
            ctx.fillStyle = COLORS.quiet;
            ctx.font = '400 18px "Huiwen Mincho", "Songti SC", serif';
            ctx.fillText('这一页还在等你的阅读记录。', 36, 200);
        } else {
            books.forEach(function (book, index) {
                var y = 184 + index * 50;
                ctx.fillStyle = COLORS.ink;
                ctx.font = '400 18px "Huiwen Mincho", "Songti SC", serif';
                ctx.fillText(String(index + 1).padStart(2, '0'), 36, y);
                ctx.fillText(safeText(book.title, '未命名书籍').slice(0, 17), 72, y);
                ctx.fillStyle = COLORS.quiet;
                ctx.font = '12px "SF Pro Text", sans-serif';
                ctx.fillText(safeText(book.author, '作者未知'), 72, y + 19);
                ctx.textAlign = 'right';
                ctx.fillStyle = COLORS.blue;
                ctx.font = '11px ui-monospace, Menlo, monospace';
                ctx.fillText(book.readingMinutes ? book.readingMinutes + ' MIN' : (book.progress ? book.progress + '%' : '—'), 382, y + 6);
                ctx.textAlign = 'left';
                ctx.fillStyle = 'rgba(38,37,33,.12)';
                ctx.fillRect(72, y + 29, 310, 3);
                ctx.fillStyle = COLORS.yellow;
                ctx.fillRect(72, y + 29, 310 * (book.readingMinutes ? clamp(book.readingMinutes / 360, .04, 1) : clamp(book.progress / 100, .04, 1)), 3);
            });
        }
        var excerpt = books.find(function (book) { return book.summary; });
        ctx.fillStyle = COLORS.red;
        ctx.fillRect(430, 304, 3, 72);
        ctx.fillStyle = COLORS.ink;
        ctx.font = '400 23px "Huiwen Mincho", "Songti SC", serif';
        var excerptLines = drawTextLines(ctx, excerpt ? excerpt.summary : safeText(snapshot.quote, '读过的每一页，都会在某天回来。'), 450, 326, 288, 29, 2);
        ctx.fillStyle = COLORS.quiet;
        ctx.font = '12px "SF Pro Text", sans-serif';
        ctx.fillText(excerpt ? '摘录 · ' + safeText(excerpt.title, '此刻') : '花生片 / Penaup', 450, 326 + excerptLines * 29 + 17);
        drawFooter(ctx, snapshot);
    }

    function daysInMonth(month) {
        var parts = String(month || '').split('-').map(Number);
        return parts.length === 2 && parts[0] && parts[1] ? new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate() : 31;
    }

    function drawMonthly(ctx, snapshot) {
        var month = snapshot.periodKey.slice(0, 7);
        var parts = month.split('-').map(Number);
        var title = parts[0] + ' / ' + String(parts[1] || 1).padStart(2, '0');
        drawHeading(ctx, title, '每天读的书，在日历上连成线。', 'PENAUP / MONTHLY CALENDAR');
        var left = 36;
        var top = 145;
        var width = WIDTH - 72;
        var cellWidth = width / 7;
        var rows = Math.ceil(daysInMonth(month) / 7);
        var cellHeight = Math.min(43, 250 / rows);
        var dayMap = Object.create(null);
        (snapshot.dailyReading || []).forEach(function (item) { dayMap[item.day] = item.readingMinutes; });
        ctx.font = '11px ui-monospace, Menlo, monospace';
        ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].forEach(function (label, index) {
            ctx.fillStyle = index === 6 ? COLORS.red : COLORS.quiet;
            ctx.fillText(label, left + index * cellWidth + 4, top - 10);
        });
        ctx.strokeStyle = COLORS.line;
        ctx.strokeRect(left, top, width, rows * cellHeight);
        var firstDay = new Date(Date.UTC(parts[0], (parts[1] || 1) - 1, 1)).getUTCDay();
        firstDay = firstDay === 0 ? 6 : firstDay - 1;
        for (var day = 1; day <= daysInMonth(month); day += 1) {
            var offset = firstDay + day - 1;
            var col = offset % 7;
            var row = Math.floor(offset / 7);
            var x = left + col * cellWidth;
            var y = top + row * cellHeight;
            ctx.strokeStyle = 'rgba(38,37,33,.12)';
            ctx.strokeRect(x, y, cellWidth, cellHeight);
            ctx.fillStyle = COLORS.ink;
            ctx.font = '400 14px "Huiwen Mincho", "Songti SC", serif';
            ctx.fillText(String(day), x + 5, y + 17);
            if (dayMap[day]) {
                var barWidth = clamp(cellWidth * (dayMap[day] / 90), 7, cellWidth - 16);
                ctx.fillStyle = day % 3 === 0 ? COLORS.green : day % 2 === 0 ? COLORS.blue : COLORS.yellow;
                roundedRect(ctx, x + 5, y + cellHeight - 12, barWidth, 5, 2);
                ctx.fill();
                ctx.fillStyle = COLORS.quiet;
                ctx.font = '10px ui-monospace, Menlo, monospace';
                ctx.fillText(dayMap[day] + 'm', x + 5, y + cellHeight - 17);
            }
        }
        var books = (snapshot.topBooks || []).slice(0, 4);
        ctx.fillStyle = COLORS.quiet;
        ctx.font = '11px ui-monospace, Menlo, monospace';
        ctx.fillText('READING THREADS', left, 408);
        ctx.fillStyle = COLORS.ink;
        ctx.font = '400 17px "Huiwen Mincho", "Songti SC", serif';
        drawTextLines(ctx, books.length ? books.join('  ·  ') : '等待书名落在日历边缘。', left, 430, 540, 22, 2);
        drawFooter(ctx, snapshot, '6 BASE INKS · MONTHLY TRACE · E6 PRO');
    }

    function drawBookshelf(ctx, snapshot) {
        drawHeading(ctx, '书架标本', snapshot.periodLabel || '读过的书，排成一面安静的墙。', 'PENAUP / BOOKSHELF SPECIMEN');
        ctx.fillStyle = COLORS.quiet;
        ctx.font = '11px ui-monospace, Menlo, monospace';
        ctx.fillText(String(snapshot.bookCount || 0) + ' BOOKS / A SMALL WALL OF READING', 36, 148);
        var books = (snapshot.topBookDetails || []).slice(0, 11);
        var palette = [COLORS.ink, COLORS.blue, COLORS.red, COLORS.green, COLORS.yellow, '#8f8061'];
        var shelves = [188, 306, 424];
        shelves.forEach(function (shelfY, shelfIndex) {
            ctx.fillStyle = 'rgba(38,37,33,.18)';
            ctx.fillRect(36, shelfY, WIDTH - 72, 5);
            ctx.fillStyle = 'rgba(38,37,33,.08)';
            ctx.fillRect(36, shelfY + 5, WIDTH - 72, 3);
            var start = shelfIndex * 4;
            var rowBooks = books.slice(start, start + 4);
            var x = 58;
            rowBooks.forEach(function (book, index) {
                var bookWidth = 36 + ((safeText(book.title, '').length * 7 + index * 13) % 36);
                var height = 72 + ((index * 19 + shelfIndex * 13) % 27);
                var y = shelfY - height;
                ctx.fillStyle = palette[(index + shelfIndex) % palette.length];
                roundedRect(ctx, x, y, bookWidth, height, 3);
                ctx.fill();
                ctx.strokeStyle = 'rgba(38,37,33,.32)';
                ctx.stroke();
                ctx.save();
                ctx.beginPath();
                ctx.rect(x + 5, y + 7, bookWidth - 10, height - 14);
                ctx.clip();
                ctx.translate(x + bookWidth / 2, shelfY - 10);
                ctx.rotate(-Math.PI / 2);
                ctx.fillStyle = COLORS.paperBright;
                ctx.font = '400 14px "Huiwen Mincho", "Songti SC", serif';
                ctx.textAlign = 'center';
                ctx.fillText(safeText(book.title, '无题'), 0, 4);
                ctx.restore();
                x += bookWidth + 9;
            });
            if (shelfIndex === 0) {
                ctx.fillStyle = COLORS.green;
                ctx.beginPath();
                ctx.arc(WIDTH - 92, shelfY - 38, 27, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = COLORS.ink;
                ctx.fillRect(WIDTH - 97, shelfY - 11, 10, 11);
            }
        });
        drawFooter(ctx, snapshot, '6 BASE INKS · BOOKSHELF STUDY · E6 PRO');
    }

    function drawReadingCard(ctx, snapshot, card) {
        var book = (snapshot.topBookDetails || [])[0] || {};
        var title = safeText(card && card.title || book.title, '正在读的一本书');
        var author = safeText(card && card.author || book.author, '作者未知');
        drawHeading(ctx, '我的读书卡', '为一本正在读的书留一页。', 'PENAUP / READING CARD');
        ctx.fillStyle = COLORS.red;
        roundedRect(ctx, 42, 150, 190, 250, 4);
        ctx.fill();
        ctx.fillStyle = COLORS.paperBright;
        ctx.font = '400 26px "Huiwen Mincho", "Songti SC", serif';
        drawTextLines(ctx, title, 60, 220, 154, 34, 4);
        ctx.fillStyle = 'rgba(255,253,247,.72)';
        ctx.font = '12px "SF Pro Text", sans-serif';
        ctx.fillText(author, 60, 365);
        ctx.fillStyle = COLORS.ink;
        ctx.font = '11px ui-monospace, Menlo, monospace';
        ctx.fillText('ONE BOOK / ONE PAGE', 270, 158);
        ctx.fillStyle = COLORS.ink;
        ctx.font = '400 31px "Huiwen Mincho", "Songti SC", serif';
        drawTextLines(ctx, title, 270, 205, 448, 38, 2);
        ctx.fillStyle = COLORS.quiet;
        ctx.font = '14px "SF Pro Text", sans-serif';
        ctx.fillText(author + (card && card.category ? '  ·  ' + card.category : ''), 272, 284);
        var progress = clamp(Number(card && card.progress || book.progress || 0), 0, 100);
        ctx.fillStyle = 'rgba(38,37,33,.12)';
        ctx.fillRect(272, 312, 420, 7);
        ctx.fillStyle = COLORS.yellow;
        ctx.fillRect(272, 312, 420 * progress / 100, 7);
        ctx.fillStyle = COLORS.quiet;
        ctx.font = '11px ui-monospace, Menlo, monospace';
        ctx.fillText('READING PROGRESS', 272, 339);
        ctx.textAlign = 'right';
        ctx.fillStyle = COLORS.blue;
        ctx.fillText(progress + '%', 692, 339);
        ctx.textAlign = 'left';
        var quote = safeText(card && (card.excerpt || card.summary) || book.summary || snapshot.quote, '读过的每一页，都会在某天回来。');
        ctx.fillStyle = COLORS.ink;
        ctx.font = '400 19px "Huiwen Mincho", "Songti SC", serif';
        drawTextLines(ctx, '“' + quote + '”', 270, 382, 420, 27, 2);
        drawFooter(ctx, snapshot, '6 BASE INKS · READING CARD · E6 PRO');
    }

    function updateStage(stage) {
        var stages = ['connect', 'choose', 'develop', 'keep'];
        var currentIndex = stages.indexOf(stage);
        if (currentIndex < 0) currentIndex = 0;
        document.querySelectorAll('[data-weread-stage]').forEach(function (item) {
            var index = stages.indexOf(item.dataset.wereadStage);
            item.classList.toggle('is-current', index === currentIndex);
            item.classList.toggle('is-complete', index < currentIndex);
        });
    }

    function setStatus(message, type) {
        var status = byId('weread-status');
        if (!status) return;
        status.textContent = message;
        status.className = 'weread-status' + (type ? ' is-' + type : '');
        status.dataset.state = type || 'idle';
    }

    function setDevelopmentPhase(phase, label) {
        var indicator = byId('weread-phase-indicator');
        var phaseLabel = byId('weread-phase-label');
        var panel = byId('weread-preview-panel');
        var phaseIndexes = { fetching: 0, typesetting: 1, developing: 2, preview: 2, downloading: 3, transferring: 3, pending: 3, done: 3 };
        if (Object.prototype.hasOwnProperty.call(phaseIndexes, phase)) state.phaseIndex = phaseIndexes[phase];
        document.querySelectorAll('[data-weread-phase-step]').forEach(function (item) {
            var index = Object.prototype.hasOwnProperty.call(phaseIndexes, item.dataset.wereadPhaseStep) ? phaseIndexes[item.dataset.wereadPhaseStep] : 0;
            var isCurrent = index === state.phaseIndex;
            item.classList.toggle('is-current', isCurrent);
            item.classList.toggle('is-complete', index < state.phaseIndex || (phase === 'done' && index === state.phaseIndex));
            if (isCurrent) item.setAttribute('aria-current', 'step');
            else item.removeAttribute('aria-current');
        });
        if (indicator) indicator.dataset.phase = phase || 'idle';
        if (phaseLabel) phaseLabel.textContent = label || '纸面待命';
        if (panel) panel.setAttribute('aria-busy', ['fetching', 'typesetting', 'developing', 'downloading', 'transferring'].indexOf(phase) >= 0 ? 'true' : 'false');
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

    function sceneTitle() {
        return {
            weekly_receipt: '本周读书',
            monthly_calendar: '本月阅读',
            bookshelf: '书架标本',
            reading_card: '我的读书卡'
        }[state.scene] || '阅读屏保';
    }

    function setRenderNote() {
        var note = byId('weread-render-note');
        var definitions = window.PenaupFilmCore && window.PenaupFilmCore.COLOR_RENDERING_MODE_DEFINITIONS;
        var definition = definitions && definitions.find(function (item) { return item.id === state.renderMode; });
        if (note) note.textContent = definition ? definition.description : '六种基础墨水通过相邻像素组织更多层次。';
    }

    function renderingSettings() {
        var definitions = window.PenaupFilmCore && window.PenaupFilmCore.COLOR_RENDERING_MODE_DEFINITIONS;
        var definition = definitions && definitions.find(function (item) { return item.id === state.renderMode; });
        return {
            type: definition ? definition.ditherType : state.renderMode === 'dots' ? 'bayer' : state.renderMode === 'dither' ? 'floydSteinberg' : 'adaptive',
            strength: definition ? definition.defaultStrength : 1
        };
    }

    async function renderWallpaper(snapshot) {
        var canvas = byId('weread-canvas');
        if (!canvas || !snapshot) return false;
        var revision = ++state.renderRevision;
        setDevelopmentPhase('typesetting', '汇文明朝体正在落版');
        await ensureWallpaperFonts();
        if (revision !== state.renderRevision) return false;
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        drawPaperBase(ctx);
        if (state.scene === 'monthly_calendar') drawMonthly(ctx, snapshot);
        else if (state.scene === 'bookshelf') drawBookshelf(ctx, snapshot);
        else if (state.scene === 'reading_card') drawReadingCard(ctx, snapshot, state.card);
        else drawWeekly(ctx, snapshot);
        state.film = null;
        setOutputButtons({ preview: true, film: false });
        var empty = byId('weread-empty');
        if (empty) empty.hidden = true;
        var title = byId('weread-preview-title');
        if (title) title.textContent = sceneTitle();
        canvas.setAttribute('aria-label', '微信读书 ' + sceneTitle() + ' · 花生片 Pro 3.68 英寸电子纸屏保预览');
        var imageData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
        var worker = window.PenaupImageWorker;
        var settings = renderingSettings();
        if (!worker || !worker.supported) {
            var unsupportedMeta = byId('weread-preview-meta');
            if (unsupportedMeta) unsupportedMeta.textContent = snapshot.periodLabel + ' · 预览已完成，但本机显影 Worker 未就绪，暂不能生成 .film。';
            setDevelopmentPhase('preview', '普通预览已完成');
            return false;
        }
        setDevelopmentPhase('developing', '六色显影正在扫描纸面');
        try {
            var result = await worker.process({
                data: imageData.data.slice().buffer,
                width: WIDTH,
                height: HEIGHT,
                profile: PROFILE,
                contrast: 1,
                dither: true,
                ditherType: settings.type,
                ditherStrength: settings.strength
            });
            if (revision !== state.renderRevision) return false;
            ctx.putImageData(new ImageData(new Uint8ClampedArray(result.preview), WIDTH, HEIGHT), 0, 0);
            state.film = new Uint8Array(result.film);
            var meta = byId('weread-preview-meta');
            if (meta) meta.textContent = snapshot.periodLabel + ' · ' + sceneTitle() + ' · ' + (state.renderMode === 'layer' ? '叠色层次' : state.renderMode === 'dots' ? '有序网点' : '误差抖动') + ' · 汇文明朝体本地显影。';
            setOutputButtons({ preview: true, film: true });
            updateStage('keep');
            setDevelopmentPhase('done', '六色显影已完成');
            return true;
        } catch (error) {
            if (error && error.name === 'AbortError') return false;
            state.film = null;
            setOutputButtons({ preview: true, film: false });
            var failedMeta = byId('weread-preview-meta');
            if (failedMeta) failedMeta.textContent = snapshot.periodLabel + ' · 普通预览完成，但六色显影失败，请重新尝试。';
            setDevelopmentPhase('failed', '显影失败，可保留预览后重试');
            return false;
        }
    }

    function saveKeyIfNeeded() {
        var input = byId('weread-skill-key');
        var remember = byId('weread-remember-key');
        if (!input || !remember) return;
        try {
            if (remember.checked && input.value.trim()) localStorage.setItem(STORAGE_KEY, input.value.trim());
            else localStorage.removeItem(STORAGE_KEY);
        } catch (error) {}
    }

    function validKey(key) { return /^wrk-[A-Za-z0-9_-]{8,160}$/.test(key); }

    function friendlyError(error, fallback) {
        var code = error && error.code;
        return {
            weread_key_invalid: '请先填入有效的微信读书 Skill Key。',
            weread_key_rejected: '这个 Key 似乎无效或已过期，请检查后重试。',
            weread_month_invalid: '月份格式无效，请选择一个月份。',
            weread_week_invalid: '周起始日无效，请换一个周一。',
            weread_book_id_invalid: '这本书暂时没有可用的编号。',
            weread_timeout: '微信读书请求超时；已保留当前草稿，可以稍后重试。',
            weread_rate_limited: '请求有点频繁，请稍等一分钟再试。',
            origin_not_allowed: '当前来源没有被服务端允许。',
            weread_bad_response: '微信读书返回格式异常，请稍后重试。',
            weread_unavailable: '微信读书暂时不可用，请稍后重试。'
        }[code] || safeText(error && error.message, fallback || '微信读书暂时不可用，请稍后重试。');
    }

    async function requestWeread(path, body, key) {
        var response = await fetch(path, {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'X-Penaup-WeRead-Key': key },
            body: JSON.stringify(body || {})
        });
        var payload = await response.json().catch(function () { return {}; });
        if (!response.ok || !payload.ok) {
            var error = new Error(payload.message || payload.error || 'weread_unavailable');
            error.code = payload.error || 'weread_unavailable';
            throw error;
        }
        return payload.data;
    }

    function updateStats(snapshot) {
        var stats = byId('weread-stats');
        if (!stats) return;
        stats.textContent = '';
        [['' + Number(snapshot.readingMinutes || 0), '阅读分钟'], ['' + Number(snapshot.readingDays || 0), '阅读天数'], ['' + Number(snapshot.bookCount || 0), '读过的书']].forEach(function (item) {
            var card = document.createElement('div');
            card.className = 'weread-stat';
            var strong = document.createElement('strong');
            strong.textContent = item[0];
            var label = document.createElement('span');
            label.textContent = item[1];
            card.appendChild(strong);
            card.appendChild(label);
            stats.appendChild(card);
        });
        stats.hidden = false;
    }

    function updateBookSelect(snapshot) {
        var select = byId('weread-book-select');
        if (!select) return;
        select.textContent = '';
        var books = snapshot && snapshot.topBookDetails || [];
        if (!books.length) {
            var empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '没有带编号的书，可先生成其他场景';
            select.appendChild(empty);
            return;
        }
        books.forEach(function (book, index) {
            var option = document.createElement('option');
            option.value = safeText(book.bookId, '');
            option.textContent = safeText(book.title, '未命名书籍') + (book.author ? ' · ' + book.author : '');
            if (index === 0) option.selected = true;
            select.appendChild(option);
        });
    }

    function syncSceneUi() {
        document.querySelectorAll('[data-weread-scene]').forEach(function (button) {
            var active = button.dataset.wereadScene === state.scene;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        var bookField = byId('weread-book-field');
        if (bookField) bookField.hidden = state.scene !== 'reading_card';
    }

    async function loadReadingCard() {
        if (state.scene !== 'reading_card' || !state.snapshot) return;
        var select = byId('weread-book-select');
        var bookId = select && select.value;
        var keyInput = byId('weread-skill-key');
        var requestedScene = state.scene;
        if (!bookId || !keyInput || !validKey(keyInput.value.trim())) {
            state.card = null;
            await renderWallpaper(state.snapshot);
            return;
        }
        setStatus('正在为这本书取回简介和最近的划线。');
        try {
            var card = await requestWeread('/api/v1/integrations/weread/reading-card', { book_id: bookId }, keyInput.value.trim());
            if (state.scene !== requestedScene || !select || select.value !== bookId) return;
            state.card = card;
            await renderWallpaper(state.snapshot);
            setStatus('读书卡已经准备好；你可以换一本书，或把这一页送到 Pro。', 'success');
        } catch (error) {
            if (state.scene !== requestedScene || !select || select.value !== bookId) return;
            state.card = null;
            await renderWallpaper(state.snapshot);
            setStatus(friendlyError(error, '读书卡补充信息暂时不可用；已用阅读记录生成。'), 'error');
        }
    }

    async function connectSource() {
        var input = byId('weread-skill-key');
        var button = byId('weread-connect');
        var key = input && input.value.trim();
        if (!validKey(key)) {
            setStatus('先填入有效的微信读书 Skill Key；它不会进入页面地址。', 'error');
            if (input) input.focus();
            return;
        }
        saveKeyIfNeeded();
        state.source = 'live';
        if (button) { button.disabled = true; button.classList.add('is-busy'); button.textContent = '正在连接书架'; }
        setDevelopmentPhase('fetching', '正在确认微信读书书架');
        setStatus('正在确认 Skill，并只读取书架数量。');
        try {
            var summary = await requestWeread('/api/v1/integrations/weread/connect', {}, key);
            var source = byId('weread-source-summary');
            if (source) { source.hidden = false; source.textContent = summary.ebooks + ' 本电子书 · ' + summary.audiobooks + ' 个有声内容'; }
            updateStage('choose');
            setDevelopmentPhase('idle', '书架已连接，选择一张纸');
            setStatus('书架已连接。现在挑一张纸，再取回对应的阅读记录。', 'success');
        } catch (error) {
            setDevelopmentPhase('failed', '书架连接失败，可检查 Key 后重试');
            setStatus(friendlyError(error, '书架连接失败，请检查 Key 后重试。'), 'error');
        } finally {
            if (button) { button.disabled = false; button.classList.remove('is-busy'); button.innerHTML = '<i class="material-icons">menu_book</i>连接书架'; }
        }
    }

    async function fetchSnapshot() {
        var input = byId('weread-skill-key');
        var button = byId('weread-fetch');
        var key = input && input.value.trim();
        if (!validKey(key)) {
            setStatus('先填入有效的微信读书 Skill Key；它不会进入页面地址。', 'error');
            if (input) input.focus();
            return;
        }
        saveKeyIfNeeded();
        state.source = 'live';
        state.film = null;
        state.card = null;
        setOutputButtons({ preview: false, film: false });
        if (button) { button.disabled = true; button.classList.add('is-busy'); button.innerHTML = '<i class="material-icons">hourglass_top</i>正在取回并显影'; }
        updateStage('develop');
        setDevelopmentPhase('fetching', '正在取回阅读轨迹');
        setStatus('正在取回阅读记录；下一步会在本地纸面上显影。');
        try {
            var body = { mode: state.mode, enrich: true };
            if (state.mode === 'monthly') {
                var month = byId('weread-month');
                if (month && month.value) body.month = month.value;
            }
            state.snapshot = await requestWeread('/api/v1/integrations/weread/snapshot', body, key);
            updateStats(state.snapshot);
            updateBookSelect(state.snapshot);
            var enrichment = byId('weread-enrichment-note');
            if (enrichment) {
                enrichment.hidden = false;
                enrichment.textContent = state.snapshot.enrichment === 'complete' ? '书架补充完成 · 书名、进度和最近划线已准备好。' : '统计已取回 · 部分书架资料未能补充，不影响这张纸生成。';
            }
            await renderWallpaper(state.snapshot);
            if (state.scene === 'reading_card') await loadReadingCard();
            if (state.film) setStatus('阅读记录已经显影。先看一眼，再决定下载或送到 Pro。', 'success');
            else setStatus('阅读记录已取回，但六色显影模块暂未就绪；普通预览仍会保留。', 'error');
        } catch (error) {
            setDevelopmentPhase('failed', '阅读数据未取回，原有草稿仍保留');
            setStatus(friendlyError(error), 'error');
        } finally {
            if (button) { button.disabled = false; button.classList.remove('is-busy'); button.innerHTML = '<i class="material-icons">auto_awesome</i>取回并显影'; }
        }
    }

    async function loadDemoSnapshot() {
        var button = byId('weread-demo');
        state.source = 'demo';
        state.snapshot = createDemoSnapshot();
        state.card = state.snapshot.topBookDetails[0];
        state.film = null;
        setOutputButtons({ preview: false, film: false });
        if (button) { button.disabled = true; button.classList.add('is-busy'); button.textContent = '正在铺开示例相纸'; }
        var source = byId('weread-source-summary');
        if (source) {
            source.hidden = false;
            source.textContent = '示例数据 · ' + state.snapshot.bookCount + ' 本书 · 不连接微信读书';
        }
        updateStats(state.snapshot);
        updateBookSelect(state.snapshot);
        syncSceneUi();
        updateStage('choose');
        setDevelopmentPhase('fetching', '示例阅读轨迹已就位');
        setStatus('示例数据已准备好；接下来会在浏览器本地排版和显影。', 'success');
        try {
            var ready = await renderWallpaper(state.snapshot);
            if (ready) setStatus('示例相纸已经显影。无需 Key，也可以下载或查看完整流程。', 'success');
            else setStatus('示例预览已完成，但本机六色 Worker 未就绪；可先查看排版结果。', 'error');
        } finally {
            if (button) { button.disabled = false; button.classList.remove('is-busy'); button.innerHTML = '<i class="material-icons">visibility</i>用示例数据预览'; }
        }
    }

    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.rel = 'noopener';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
    }

    function downloadPng() {
        var canvas = byId('weread-canvas');
        if (!canvas || !state.snapshot) return;
        setDevelopmentPhase('downloading', '正在准备 PNG 下载');
        canvas.toBlob(function (blob) {
            if (blob) {
                downloadBlob(blob, 'penaup-weread-' + state.scene + '-' + state.snapshot.periodKey + '.png');
                setDevelopmentPhase('done', 'PNG 已准备好，可以继续发送');
                setStatus('PNG 已下载；本地显影结果仍保留在这张纸上。', 'success');
            } else {
                setDevelopmentPhase('failed', 'PNG 下载失败，可重新尝试');
                setStatus('PNG 暂时没有生成成功，请重新尝试。', 'error');
            }
        }, 'image/png');
    }

    async function buildFilm() {
        if (state.film && window.PenaupFilmCore) return window.PenaupFilmCore.createFilmFile(PROFILE, state.film);
        throw new Error('film_render_unavailable');
    }

    async function downloadFilm() {
        setDevelopmentPhase('downloading', '正在准备 .film 下载');
        try {
            var film = await buildFilm();
            downloadBlob(new Blob([film], { type: 'application/octet-stream' }), 'penaup-weread-' + state.scene + '-' + state.snapshot.periodKey + '.film');
            setDevelopmentPhase('done', '.film 已准备好，可以写入 Pro');
            setStatus('.film 已下载；你也可以直接发送到已连接的 Pro。', 'success');
        } catch (error) {
            setDevelopmentPhase('failed', 'film 下载失败，可保留预览后重试');
            setStatus('六色 film 还没有准备好；请先完成本地显影。', 'error');
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
            setDevelopmentPhase('transferring', '正在通过 BLE 写入 Pro');
            setStatus('film 已准备好，正在写入花生片 Pro；刷新结果还需要设备回读确认。');
            var result = await frameUploadViaBle('weread-' + state.scene + '.film', film, 'weread-transfer-');
            if (result && result.ok) {
                setDevelopmentPhase('pending', '已写入，等待电子纸刷新确认');
                setStatus('已写入花生片 Pro；设备刷新结果待确认，不把写入进度当作完成。', 'pending');
            } else {
                setDevelopmentPhase('failed', '写入失败，可从当前显影结果重试');
                setStatus('写入没有完成；当前显影结果仍保留，可以重新发送。', 'error');
            }
        } catch (error) {
            setDevelopmentPhase('failed', 'film 生成失败，可保留当前预览');
            setStatus('生成 film 失败，请先完成本地显影。', 'error');
        }
    }

    function init() {
        if (!byId('frame-weread')) return;
        var monthInput = byId('weread-month');
        if (monthInput) monthInput.value = new Date().toISOString().slice(0, 7);
        try {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved && validKey(saved)) {
                byId('weread-skill-key').value = saved;
                byId('weread-remember-key').checked = true;
            }
        } catch (error) {}
        setRenderNote();
        setDevelopmentPhase('idle', '纸面在等一段阅读');
        syncSceneUi();
        document.querySelectorAll('[data-weread-scene]').forEach(function (button) {
            button.addEventListener('click', function () {
                state.scene = button.dataset.wereadScene || 'weekly_receipt';
                state.card = null;
                syncSceneUi();
                updateStage(state.snapshot ? 'choose' : 'connect');
                if (state.snapshot) {
                    if (state.scene === 'reading_card') loadReadingCard();
                    else renderWallpaper(state.snapshot);
                }
            });
        });
        document.querySelectorAll('[data-weread-mode]').forEach(function (button) {
            button.addEventListener('click', function () {
                state.mode = button.dataset.wereadMode === 'monthly' ? 'monthly' : 'weekly';
                document.querySelectorAll('[data-weread-mode]').forEach(function (item) {
                    var active = item === button;
                    item.classList.toggle('is-active', active);
                    item.setAttribute('aria-pressed', active ? 'true' : 'false');
                });
                if (state.snapshot) setStatus('时间范围已改变；点击“取回并显影”生成新的一页。');
            });
        });
        document.querySelectorAll('[data-weread-render]').forEach(function (button) {
            button.addEventListener('click', function () {
                state.renderMode = button.dataset.wereadRender || 'layer';
                document.querySelectorAll('[data-weread-render]').forEach(function (item) {
                    var active = item === button;
                    item.classList.toggle('is-active', active);
                    item.setAttribute('aria-pressed', active ? 'true' : 'false');
                });
                setRenderNote();
                if (state.snapshot) {
                    setStatus('显影方式已改变，正在重新扫描纸面。');
                    renderWallpaper(state.snapshot).then(function (ready) { if (ready) setStatus('新的显影方式已经准备好。', 'success'); });
                }
            });
        });
        byId('weread-connect').addEventListener('click', connectSource);
        byId('weread-fetch').addEventListener('click', fetchSnapshot);
        var demoButton = byId('weread-demo');
        if (demoButton) demoButton.addEventListener('click', loadDemoSnapshot);
        byId('weread-clear-key').addEventListener('click', function () {
            var input = byId('weread-skill-key');
            if (input) input.value = '';
            try { localStorage.removeItem(STORAGE_KEY); } catch (error) {}
            if (byId('weread-remember-key')) byId('weread-remember-key').checked = false;
            if (byId('weread-source-summary')) byId('weread-source-summary').hidden = true;
            setStatus('已清除本机保存的 Key。');
        });
        byId('weread-remember-key').addEventListener('change', saveKeyIfNeeded);
        byId('weread-toggle-key').addEventListener('click', function () {
            var input = byId('weread-skill-key');
            if (!input) return;
            input.type = input.type === 'password' ? 'text' : 'password';
            this.setAttribute('aria-pressed', input.type === 'text' ? 'true' : 'false');
        });
        byId('weread-book-select').addEventListener('change', loadReadingCard);
        byId('weread-download-png').addEventListener('click', downloadPng);
        byId('weread-download-film').addEventListener('click', downloadFilm);
        byId('weread-send').addEventListener('click', sendToDevice);
    }

    window.addEventListener('DOMContentLoaded', init);
}());
