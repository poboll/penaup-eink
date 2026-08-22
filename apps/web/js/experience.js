// Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial
// 花生片体验层：只负责叙事状态和动效，不参与 BLE、film 转换或传输判断。
(function () {
    'use strict';

    var storyCopy = {
        connect: {
            title: '先让花生片靠近你',
            detail: '连接设备后，照片才会开始走向纸面。'
        },
        compose: {
            title: '把想留下的画面放进来',
            detail: '选一张照片、拍一张，或写下一句今天的话。'
        },
        develop: {
            title: '六色正在慢慢显影',
            detail: '叠色、网点与抖动在本地完成，原图不会离开这台设备。'
        },
        keep: {
            title: '画面已经留在纸上',
            detail: '电子纸刷新完成后不需要持续点亮；若设备未回报确认，会明确保持待确认。'
        },
        uncertain: {
            title: '相纸已写入，刷新结果待确认',
            detail: '请观察设备画面，确认后再开始下一张。'
        }
    };

    var storyOrder = ['connect', 'compose', 'develop', 'keep'];

    function visibleTransferContainer() {
        var nodes = document.querySelectorAll('.transfer-container');
        for (var index = 0; index < nodes.length; index += 1) {
            if (window.getComputedStyle(nodes[index]).display !== 'none') return nodes[index];
        }
        return null;
    }

    function activePageId() {
        var page = document.querySelector('.page.active');
        return page ? page.id : 'bluetooth-page';
    }

    function getStoryStage() {
        var transfer = visibleTransferContainer();
        if (transfer) {
            var progress = Number.parseInt((transfer.querySelector('.transfer-progress') || {}).textContent, 10) || 0;
            var statusText = (transfer.querySelector('.transfer-status') || {}).textContent || '';
            return { stage: progress >= 100 ? 'keep' : 'develop', uncertain: /待确认/.test(statusText) };
        }

        var pageId = activePageId();
        if (pageId === 'convert-page') return { stage: 'develop', uncertain: false };
        if (pageId === 'frame-page') return { stage: 'compose', uncertain: false };

        var connection = document.getElementById('connection-status');
        var connected = connection && (connection.classList.contains('connected') || /已连接/.test(connection.textContent || ''));
        return { stage: connected ? 'compose' : 'connect', uncertain: false };
    }

    function syncStoryProgress() {
        var root = document.querySelector('[data-story-progress]');
        if (!root) return;
        var current = getStoryStage();
        var currentIndex = storyOrder.indexOf(current.stage);
        if (currentIndex < 0) currentIndex = 0;

        root.dataset.stage = current.uncertain ? 'uncertain' : current.stage;
        root.querySelectorAll('[data-story-step]').forEach(function (step) {
            var stepIndex = storyOrder.indexOf(step.dataset.storyStep);
            var isCurrent = stepIndex === currentIndex;
            step.classList.toggle('is-current', isCurrent);
            step.classList.toggle('is-complete', stepIndex < currentIndex);
            if (isCurrent) step.setAttribute('aria-current', 'step');
            else step.removeAttribute('aria-current');
        });

        var fill = root.querySelector('[data-story-progress-fill]');
        if (fill) fill.style.width = (currentIndex === 0 ? 8 : currentIndex === 1 ? 36 : currentIndex === 2 ? 68 : 100) + '%';

        var copy = storyCopy[current.uncertain ? 'uncertain' : current.stage];
        var title = root.querySelector('[data-story-status-title]');
        var detail = root.querySelector('[data-story-status-detail]');
        if (title) title.textContent = copy.title;
        if (detail) detail.textContent = copy.detail;
    }

    function syncPaperArrival(file) {
        var note = document.querySelector('[data-paper-arrival-note]');
        if (!note) return;
        var hasFile = Boolean(file);
        note.classList.toggle('is-arrived', hasFile);
        note.classList.remove('is-rendered');
        note.querySelector('span:last-child').textContent = hasFile
            ? '相纸已落入画布 · 正在准备本地显影'
            : '相纸还在等一张照片';
    }

    function ready() {
        var splash = document.getElementById('penaup-splash');
        var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var splashSeen = false;
        try {
            splashSeen = sessionStorage.getItem('penaup.splashSeen') === '1';
        } catch (error) {}

        function closeSplash() {
            if (!splash) return;
            if (splash.classList.contains('is-leaving')) return;
            splash.classList.add('is-leaving');
            window.setTimeout(function () {
                splash.hidden = true;
                document.body.classList.add('experience-ready');
            }, reduceMotion ? 0 : 520);
            try { sessionStorage.setItem('penaup.splashSeen', '1'); } catch (error) {}
        }

        if (!splashSeen && splash) {
            window.setTimeout(closeSplash, reduceMotion ? 80 : 1200);
            splash.addEventListener('click', closeSplash, { once: true });
            splash.addEventListener('keydown', function (event) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeSplash();
                }
            });
        } else if (splash) {
            splash.hidden = true;
            document.body.classList.add('experience-ready');
        }

        var fileInputs = document.querySelectorAll('input[type="file"]');
        fileInputs.forEach(function (input) {
            input.addEventListener('change', function () {
                if (!input.files || !input.files.length) return;
                document.body.dataset.flow = 'developing';
                var page = input.closest('.page');
                if (page) page.classList.add('is-developing');
                if (input.id === 'imageFile') syncPaperArrival(input.files[0]);
                syncStoryProgress();
            });
        });

        var transferContainers = document.querySelectorAll('.transfer-container');
        function syncTransferState(node) {
            var visible = window.getComputedStyle(node).display !== 'none';
            node.classList.toggle('is-active', visible);
            var progress = node.querySelector('.transfer-progress');
            var status = node.querySelector('.transfer-status');
            var value = progress ? Number.parseInt(progress.textContent, 10) || 0 : 0;
            var uncertain = Boolean(status && /待确认/.test(status.textContent || ''));
            node.classList.toggle('is-complete', visible && value >= 100 && !uncertain);
            node.classList.toggle('is-uncertain', visible && uncertain);
            if (visible) document.body.dataset.flow = uncertain ? 'uncertain' : value >= 100 ? 'saved' : 'writing';
            if (visible && value >= 100 && !uncertain) {
                var paperNote = document.querySelector('[data-paper-arrival-note]');
                if (paperNote) {
                    paperNote.classList.remove('is-arrived');
                    paperNote.classList.add('is-rendered');
                    paperNote.querySelector('span:last-child').textContent = '相纸已经留下 · 可以回看这一张';
                }
            }
            syncStoryProgress();
        }
        transferContainers.forEach(function (node) {
            syncTransferState(node);
            new MutationObserver(function () { syncTransferState(node); }).observe(node, {
                attributes: true,
                childList: true,
                subtree: true,
                characterData: true
            });
        });

        var resultNodes = document.querySelectorAll('.result[id], [id$="-result"]');
        resultNodes.forEach(function (node) {
            new MutationObserver(syncStoryProgress).observe(node, { childList: true, characterData: true, subtree: true });
        });

        var status = document.getElementById('connection-status');
        var metaDot = document.querySelector('.meta-dot');
        var metaText = document.querySelector('.app-meta span:last-child');
        function syncConnectionState() {
            if (!status) return;
            var connected = status.classList.contains('connected') || /已连接/.test(status.textContent || '');
            if (metaDot) metaDot.classList.toggle('is-connected', connected);
            if (metaText) metaText.textContent = connected ? '花生片已连接' : '本地工作台';
            syncStoryProgress();
        }
        if (status) {
            syncConnectionState();
            new MutationObserver(syncConnectionState).observe(status, { attributes: true, childList: true, characterData: true, subtree: true });
        }

        document.querySelectorAll('.nav-item').forEach(function (item) {
            item.addEventListener('click', function () {
                document.body.dataset.flow = 'idle';
                document.querySelectorAll('.page').forEach(function (page) { page.classList.remove('is-developing'); });
                window.setTimeout(syncStoryProgress, 0);
            });
        });

        var imageInput = document.getElementById('imageFile');
        syncPaperArrival(imageInput && imageInput.files ? imageInput.files[0] : null);
        syncStoryProgress();
    }

    window.addEventListener('DOMContentLoaded', ready);
}());
