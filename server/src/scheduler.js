/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 */
import { nowIso } from './db.js';

function numericId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function templateMediaId(template) {
  const definition = template?.definition || {};
  const renderConfig = template?.renderConfig || {};
  return numericId(definition.film_media_id ?? definition.filmMediaId ?? definition.media_id ?? definition.mediaId ?? renderConfig.film_media_id ?? renderConfig.filmMediaId ?? renderConfig.media_id ?? renderConfig.mediaId);
}

export function createStreamScheduler({ config, database, queue, mqtt, emit }) {
  let timer = null;
  let running = false;

  async function dispatchCandidate(candidate) {
    const template = database.getTemplate(candidate.template_id, candidate.user_id);
    const mediaId = templateMediaId(template);
    const media = mediaId ? database.getMedia(mediaId, candidate.user_id) : null;
    if (!media || media.kind !== 'film') {
      const record = database.recordPush({ userId: candidate.user_id, deviceId: candidate.device_id, streamItemId: candidate.stream_item_id, method: 'skipped' });
      emit('stream.push.skipped', candidate.device_id, {
        userId: candidate.user_id, streamId: candidate.stream_id, streamItemId: candidate.stream_item_id,
        reason: 'template_film_not_ready', record
      });
      return { ok: false, reason: 'template_film_not_ready', deviceId: candidate.device_id };
    }

    const command = database.issueCommand(candidate.device_id, 'download_film', {
      filename: media.name, media_id: media.id, stream_id: candidate.stream_id, stream_item_id: candidate.stream_item_id
    });
    const published = await mqtt.publishCommand(candidate.device_id, command);
    const record = database.recordPush({ userId: candidate.user_id, deviceId: candidate.device_id, streamItemId: candidate.stream_item_id, filmPath: media.storedPath, method: 'scheduled' });
    emit('stream.push', candidate.device_id, {
      userId: candidate.user_id, streamId: candidate.stream_id, streamItemId: candidate.stream_item_id,
      mediaId: media.id, command, published, record
    });
    return { ok: true, deviceId: candidate.device_id, command, published, record };
  }

  async function tick(at = nowIso()) {
    if (running) return { ok: true, skipped: true, results: [] };
    running = true;
    try {
      const candidates = database.listScheduledPushCandidates(at, 50);
      const results = [];
      for (const candidate of candidates) results.push(await dispatchCandidate(candidate));
      return { ok: true, skipped: false, results };
    } finally {
      running = false;
    }
  }

  async function dispatchStream(streamId, userId, itemId = null) {
    const targets = database.listStreamPushTargets(streamId, userId, itemId);
    const results = [];
    for (const target of targets) results.push(await dispatchCandidate(target));
    return { ok: true, results };
  }

  function start() {
    const interval = Number(config?.schedulerIntervalMs) || 0;
    if (interval <= 0 || timer) return;
    timer = setInterval(() => {
      queue.add(() => tick(), 'stream-scheduler').catch((error) => {
        emit('stream.scheduler.error', null, { error: error?.message || 'scheduler_error' });
      });
    }, interval);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick, dispatchStream, dispatchCandidate };
}
