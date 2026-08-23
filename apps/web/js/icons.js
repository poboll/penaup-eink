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
        auto_awesome: '✦',
        download: '↓',
        expand_more: '⌄',
        image: '▧',
        hourglass_top: '⌛',
        link: '↗',
        link_off: '×',
        menu_book: '▣',
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
        save_alt: '⇩',
        system_update: '⇩',
        touch_app: '☝',
        visibility: '◉',
        wifi: '⌁'
    };

    function decorate(root) {
        var scope = root || document;
        var nodes = [];
        if (scope.nodeType === 1 && scope.matches && scope.matches('.material-icons:not([data-icon])')) nodes.push(scope);
        scope.querySelectorAll('.material-icons:not([data-icon])').forEach(function (node) { nodes.push(node); });
        nodes.forEach(function (node) {
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
