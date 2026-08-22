/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 *
 * Main-thread bridge for the local film renderer. Jobs are coalesced so a
 * slider or pointer gesture cannot build an unbounded queue of old frames.
 */
(function () {
    'use strict';

    var worker = null;
    var nextId = 1;
    var active = null;
    var queued = null;

    function abortError() {
        var error = new Error('render_superseded');
        error.name = 'AbortError';
        return error;
    }

    function rejectQueued() {
        if (!queued) return;
        queued.reject(abortError());
        queued = null;
    }

    function startNext() {
        if (active || !queued || !worker) return;
        active = queued;
        queued = null;
        active.id = nextId++;
        worker.postMessage({ id: active.id, ...active.options }, [active.options.data]);
    }

    function ensureWorker() {
        if (worker || typeof window.Worker !== 'function') return worker;
        worker = new window.Worker('../js/image-worker.js');
        worker.addEventListener('message', function (event) {
            var message = event.data || {};
            if (!active || message.id !== active.id) return;
            var job = active;
            active = null;
            if (message.ok) {
                job.resolve(message);
            } else {
                var error = new Error(message.error || 'film_worker_failed');
                job.reject(error);
            }
            startNext();
        });
        worker.addEventListener('error', function (event) {
            var job = active;
            active = null;
            if (job) job.reject(new Error(event.message || 'film_worker_unavailable'));
            rejectQueued();
            if (worker) worker.terminate();
            worker = null;
        });
        return worker;
    }

    function process(options) {
        if (!ensureWorker()) return Promise.reject(new Error('film_worker_unavailable'));
        if (!options || !(options.data instanceof ArrayBuffer)) {
            return Promise.reject(new TypeError('film_worker_data_required'));
        }
        rejectQueued();
        return new Promise(function (resolve, reject) {
            queued = { options: options, resolve: resolve, reject: reject };
            startNext();
        });
    }

    window.PenaupImageWorker = Object.freeze({
        process: process,
        supported: typeof window.Worker === 'function'
    });
}());
