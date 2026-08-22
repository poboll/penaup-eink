/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { validateFilmBuffer } from '../../../packages/film-core/src/index.js';
import { isImageMagic, isImageMime, safeFilename, stripImageMetadata } from './media.js';

function fail(part, status, error) {
  if (part?.file && !part.file.destroyed) part.file.resume();
  return { ok: false, status, error };
}

export async function storeUploadedMedia({ part, config, database, userId, albumId = null }) {
  if (!part || part.type !== 'file' || !part.file) return fail(part, 400, 'file_required');
  const fileName = safeFilename(part.filename || 'upload.bin');
  const isFilm = fileName.toLowerCase().endsWith('.film');
  if (!isFilm && !isImageMime(part.mimetype)) return fail(part, 415, 'supported_image_or_film_required');
  if (database.getUserMediaBytes(userId) >= config.userQuotaBytes) return fail(part, 413, 'user_quota_exceeded');

  const storedName = `${crypto.randomUUID()}-${fileName}`;
  const absolutePath = path.join(config.mediaDir, storedName);
  try {
    await pipeline(part.file, fs.createWriteStream(absolutePath, { flags: 'wx' }));
    if (part.file.truncated) {
      await fs.promises.rm(absolutePath, { force: true });
      return { ok: false, status: 413, error: 'file_too_large' };
    }

    let content = await fs.promises.readFile(absolutePath);
    let profile = '';
    let kind = isFilm ? 'film' : 'original';
    if (isFilm) {
      const checked = validateFilmBuffer(content);
      if (!checked.valid) {
        await fs.promises.rm(absolutePath, { force: true });
        return { ok: false, status: 422, error: checked.error };
      }
      profile = checked.profile.key;
    } else {
      if (!isImageMagic(content, part.mimetype)) {
        await fs.promises.rm(absolutePath, { force: true });
        return { ok: false, status: 415, error: 'file_magic_mismatch' };
      }
      content = stripImageMetadata(content, part.mimetype);
      if (content.byteLength === 0) {
        await fs.promises.rm(absolutePath, { force: true });
        return { ok: false, status: 422, error: 'image_metadata_invalid' };
      }
      await fs.promises.writeFile(absolutePath, content);
    }

    const stat = await fs.promises.stat(absolutePath);
    if (database.getUserMediaBytes(userId) + stat.size > config.userQuotaBytes) {
      await fs.promises.rm(absolutePath, { force: true });
      return { ok: false, status: 413, error: 'user_quota_exceeded' };
    }
    const storedPath = path.relative(config.dataDir, absolutePath);
    const media = database.insertMedia({
      userId, albumId, name: fileName, storedPath, originalPath: kind === 'original' ? storedPath : '',
      mime: part.mimetype, kind, profile, sha256: crypto.createHash('sha256').update(content).digest('hex'), size: stat.size
    });
    return { ok: true, media, storedPath, isFilm, kind };
  } catch (error) {
    await fs.promises.rm(absolutePath, { force: true });
    throw error;
  }
}
