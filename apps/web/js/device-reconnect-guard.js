/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 *
 * Small, side-effect-free gate for maintenance confirmation. A command may
 * be confirmed only after the page expected a reconnect and observed the
 * corresponding GATT disconnect event.
 */
(function (global) {
    'use strict';

    function clear() { return { expected: false, observed: false }; }
    function begin() { return { expected: true, observed: false }; }
    function observe(expected) { return { expected: !!expected, observed: !!expected }; }
    function canConfirm(expected, observed) { return expected === true && observed === true; }

    global.PenaupReconnectGuard = Object.freeze({
        clear: clear,
        begin: begin,
        observe: observe,
        canConfirm: canConfirm
    });
}(window));
