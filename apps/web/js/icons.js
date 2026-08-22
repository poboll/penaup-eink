/* Copyright (c) 2026 poboll · local Penaup icon treatment */
(function () {
    'use strict';

    // Keep the recovered markup readable while avoiding a remote icon font.
    var glyphs = {
        bedtime: '☾',
        bluetooth: 'ᛒ',
        bug_report: '⊙',
        build: '⌘',
        camera_alt: '◉',
        camera: '◉',
        check: '✓',
        check_circle: '✓',
        cloud_download: '↓',
        delete: '×',
        delete_forever: '×',
        devices: '▤',
        edit: '↗',
        error_outline: '!',
        expand_less: '⌃',
        fit_screen: '↔',
        format_quote: '“',
        image: '▧',
        link: '↗',
        link_off: '×',
        movie: '▣',
        palette: '◌',
        photo_camera: '◉',
        photo_library: '▦',
        refresh: '↻',
        restart_alt: '↺',
        schedule: '◷',
        sd_card: '▧',
        send: '↗',
        settings: '⚙',
        system_update: '⇩',
        touch_app: '☝',
        wifi: '⌁'
    };

    function decorate(root) {
        var scope = root || document;
        scope.querySelectorAll('.material-icons:not([data-icon])').forEach(function (node) {
            var name = (node.textContent || '').trim();
            node.dataset.icon = name;
            node.dataset.symbol = glyphs[name] || '·';
            node.setAttribute('aria-hidden', 'true');
            node.textContent = '';
        });
    }

    decorate(document);
    if (window.MutationObserver && document.body) {
        new MutationObserver(function (records) {
            records.forEach(function (record) {
                record.addedNodes.forEach(function (node) {
                    if (node.nodeType === 1) decorate(node);
                });
            });
        }).observe(document.body, { childList: true, subtree: true });
    }
}());
