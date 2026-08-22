/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 *
 * The worker reuses the browser film implementation with a small DOM-free
 * adapter. The same palette, profile geometry and dither kernels therefore
 * produce the same .film bytes on the main thread and off it.
 */
var NativeImageData = self.ImageData;
if (!NativeImageData) {
    self.ImageData = function ImageData(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
    };
}

self.window = self;
importScripts('./film-core.js', './utils.js', './convert.js');

function imageData(data, width, height) {
    if (NativeImageData) return new NativeImageData(data, width, height);
    return { data: data, width: width, height: height };
}

function resizeImageData(source, targetWidth, targetHeight) {
    if (typeof self.OffscreenCanvas === 'function') {
        var sourceCanvas = new self.OffscreenCanvas(source.width, source.height);
        var sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
        sourceContext.putImageData(source, 0, 0);
        var targetCanvas = new self.OffscreenCanvas(targetWidth, targetHeight);
        var targetContext = targetCanvas.getContext('2d', { willReadFrequently: true });
        targetContext.imageSmoothingEnabled = true;
        targetContext.imageSmoothingQuality = 'medium';
        targetContext.drawImage(sourceCanvas, 0, 0, source.width, source.height, 0, 0, targetWidth, targetHeight);
        return targetContext.getImageData(0, 0, targetWidth, targetHeight);
    }

    var resized = new Uint8ClampedArray(targetWidth * targetHeight * 4);
    for (var y = 0; y < targetHeight; y += 1) {
        var sourceY = Math.min(source.height - 1, Math.floor(y * source.height / targetHeight));
        for (var x = 0; x < targetWidth; x += 1) {
            var sourceX = Math.min(source.width - 1, Math.floor(x * source.width / targetWidth));
            var sourceIndex = (sourceY * source.width + sourceX) * 4;
            var targetIndex = (y * targetWidth + x) * 4;
            resized[targetIndex] = source.data[sourceIndex];
            resized[targetIndex + 1] = source.data[sourceIndex + 1];
            resized[targetIndex + 2] = source.data[sourceIndex + 2];
            resized[targetIndex + 3] = source.data[sourceIndex + 3];
        }
    }
    return imageData(resized, targetWidth, targetHeight);
}

// The adaptive evaluator in convert.js calls this function by name. Replace
// its DOM canvas dependency with OffscreenCanvas (or a deterministic fallback).
downsampleImageData = resizeImageData;

function profileName(profile) {
    var normalized = FilmCore.normalizeProfileKey(profile);
    if (normalized === 'PENAUP_PRO') return 'PENAUPPRO';
    if (normalized === 'PENAUP_MAX') return 'PENAUPMAX';
    return 'PENAUP';
}

function render(message) {
    currentDeviceType = profileName(message.profile);
    var width = Number(message.width);
    var height = Number(message.height);
    var input = new Uint8ClampedArray(message.data);
    var frame = imageData(input, width, height);
    adjustContrast(frame, Number(message.contrast) || 1);

    if (message.dither) {
        if (message.ditherType === 'adaptive') {
            frame = adaptiveDither(frame);
        } else {
            frame = applyDitherByType(frame, message.ditherType || 'floydSteinberg', Number(message.ditherStrength) || 1);
        }
    }

    var pixels = processImageData(frame);
    return {
        preview: frame.data.buffer,
        film: pixels.buffer,
        adaptiveConfig: self._adaptiveConfig || null,
        width: width,
        height: height
    };
}

self.addEventListener('message', function (event) {
    var message = event.data || {};
    try {
        var result = render(message);
        self.postMessage({ id: message.id, ok: true, ...result }, [result.preview, result.film]);
    } catch (error) {
        self.postMessage({ id: message.id, ok: false, error: error && error.message ? error.message : 'film_worker_failed' });
    }
});
