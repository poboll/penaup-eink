#!/usr/bin/env node
/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 *
 * Import the historical FastAPI SQLite database without deleting or mutating
 * the source. Use --dry-run first; the report is deliberately evidence-rich
 * so a human can approve ownership and media provenance before publication.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PenaupDatabase } from '../src/db.js';
import { validateFilmBuffer } from '../../packages/film-core/src/index.js';

function args(argv) {
  const result = { dryRun: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--dry-run') result.dryRun = true;
    else if (value === '--json') result.json = true;
    else if (value.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      result[value.slice(2).replaceAll('-', '_')] = argv[++i];
    }
  }
  return result;
}

async function sha256(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function tables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
}

function rows(db, table, availableTables) {
  if (!availableTables.includes(table)) return [];
  return db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all();
}

function countRows(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count);
}

function legacyUserEmail(row) {
  const value = String(row.email || row.username || '').trim().toLowerCase();
  return value.includes('@') ? value : `legacy-${row.id || 'user'}@imported.penaup.local`;
}

function parseJsonValue(raw, fallback, label, warnings) {
  try {
    return { value: JSON.parse(raw || JSON.stringify(fallback)), valid: true };
  } catch {
    warnings.push(`${label} is not valid JSON; imported as an empty object`);
    return { value: fallback, valid: false };
  }
}

function objectKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
}

function templateStructure(definition, renderConfig) {
  const layers = definition && Array.isArray(definition.layers) ? definition.layers : [];
  return {
    top_level_keys: objectKeys(definition),
    layer_count: layers.length,
    layer_types: layers.map((layer) => String(layer?.type || 'unknown')).slice(0, 64),
    render_config_keys: objectKeys(renderConfig)
  };
}

function sourcePath(sourceData, value) {
  const file = String(value || '').trim();
  return file ? (path.isAbsolute(file) ? file : path.join(sourceData, file)) : null;
}

function isFilmFile(file) { return String(file || '').toLowerCase().endsWith('.film'); }

function mimeForFile(file) {
  const ext = path.extname(String(file || '')).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
        : 'application/octet-stream';
}

function safeImportedName(rowId, file, suffix = '') {
  const name = path.basename(file).replace(/[^a-zA-Z0-9._-]/g, '_');
  const tag = suffix ? `-${suffix.replace(/[^a-zA-Z0-9._-]/g, '_')}` : '';
  return `imported-${rowId}${tag}-${name}`;
}

async function main() {
  const options = args(process.argv.slice(2));
  const sourceDb = path.resolve(options.source_db || path.join(process.cwd(), '..', 'server', 'data', 'filmhub.db'));
  const sourceData = path.resolve(options.source_data || path.dirname(sourceDb));
  const targetData = path.resolve(options.target_data || path.join(process.cwd(), 'data'));
  const explicitTargetDb = path.resolve(options.target_db || path.join(targetData, 'penaup.db'));
  if (!(await exists(sourceDb))) throw new Error(`source database not found: ${sourceDb}`);
  if (sourceDb === explicitTargetDb) throw new Error('source and target database must be different; source was not modified');

  const source = new Database(sourceDb, { readonly: true });
  const sourceTables = tables(source);
  const readRows = (table) => rows(source, table, sourceTables);
  const report = {
    sourceDb,
    sourceData,
    targetDb: explicitTargetDb,
    dryRun: options.dryRun,
    tables: Object.fromEntries(sourceTables.map((table) => [table, countRows(source, table)])),
    users: 0,
    devices: 0,
    albums: 0,
    photos: 0,
    photos_imported: 0,
    media_imported: 0,
    templates: 0,
    template_structures: [],
    streams: 0,
    stream_items: 0,
    push_records: 0,
    settings: 0,
    media: [],
    warnings: []
  };

  const tempDir = options.dryRun ? await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-import-dry-')) : targetData;
  await fs.mkdir(tempDir, { recursive: true });
  const target = new PenaupDatabase(options.dryRun ? path.join(tempDir, 'dry-run.db') : explicitTargetDb);
  const userMap = new Map();
  const deviceMap = new Map();
  const albumMap = new Map();
  const templateMap = new Map();
  const streamMap = new Map();
  const streamItemMap = new Map();

  for (const row of readRows('users')) {
    const email = legacyUserEmail(row);
    const user = options.dryRun ? null : target.createUser(email, 'user');
    if (user) userMap.set(row.id, user.id);
    report.users += 1;
    if (email.endsWith('@imported.penaup.local')) report.warnings.push(`legacy user ${row.id} has no verified email: ${email}`);
  }

  for (const row of readRows('devices')) {
    let targetDevice = target.getDevice(row.device_id);
    if (!targetDevice && !options.dryRun) {
      const model = row.model || row.device_type || 'unknown';
      const claimedAt = row.claimed_at || (row.is_claimed ? new Date().toISOString() : null);
      target.raw.prepare(`
        INSERT INTO devices (
          device_id, token, name, model, device_type, user_id, claimed_at,
          battery_percent, voltage_mv, state, wifi_connected, heartbeat_interval,
          last_seen_at, last_ip, wifi_enable, play_mode, sleep_mode, sleep_auto,
          sleep_time, ble_enable, current_file_id, play_stream_id, pending_config,
          pending_commands, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.device_id,
        row.token || crypto.randomBytes(24).toString('hex'),
        row.name || row.device_id,
        model,
        row.device_type || model,
        userMap.get(row.user_id) || null,
        claimedAt,
        row.battery_percent ?? -1,
        row.voltage_mv ?? 0,
        row.state || 'unknown',
        row.wifi_connected ? 1 : 0,
        row.heartbeat_interval || 60,
        row.last_seen_at || row.last_heartbeat_at || null,
        row.last_ip || '',
        row.wifi_enable ? 1 : 0,
        row.play_mode ?? 0,
        row.sleep_mode ? 1 : 0,
        row.sleep_auto ? 1 : 0,
        row.sleep_time ?? 0,
        row.ble_enable ? 1 : 0,
        row.current_file_id ?? 0,
        null,
        row.pending_config || '{}',
        row.pending_commands || '[]',
        row.created_at || new Date().toISOString()
      );
      targetDevice = target.getDevice(row.device_id);
    }
    if (targetDevice) deviceMap.set(row.id, { id: targetDevice.id, deviceId: targetDevice.deviceId });
    report.devices += 1;
  }

  const albumRows = readRows('albums');
  for (const row of albumRows) {
    const album = options.dryRun ? null : target.createAlbum({
      userId: userMap.get(row.user_id) || null,
      name: row.name,
      description: row.description,
      ditherType: row.dither_type,
      ditherStrength: row.dither_strength
    });
    if (album) albumMap.set(row.id, album.id);
    report.albums += 1;
  }

  for (const row of readRows('templates')) {
    const definitionResult = parseJsonValue(row.definition, {}, `template ${row.id} definition`, report.warnings);
    const renderResult = parseJsonValue(row.render_config, {}, `template ${row.id} render_config`, report.warnings);
    report.template_structures.push({
      id: row.id,
      name: row.name || '',
      kind: row.kind || 'custom',
      is_builtin: Boolean(row.is_builtin),
      definition_valid: definitionResult.valid,
      render_config_valid: renderResult.valid,
      ...templateStructure(definitionResult.value, renderResult.value)
    });
    const template = options.dryRun ? null : target.createTemplate({
      userId: userMap.get(row.user_id) || null,
      name: row.name,
      kind: row.kind,
      builtin: Boolean(row.is_builtin),
      definition: definitionResult.value,
      renderConfig: renderResult.value,
      thumbPath: row.thumb_path || ''
    });
    if (template) templateMap.set(row.id, template.id);
    report.templates += 1;
  }

  for (const row of readRows('streams')) {
    const stream = options.dryRun ? null : target.createStream({
      userId: userMap.get(row.user_id) || null,
      name: row.name,
      mode: row.mode,
      enabled: Boolean(row.enabled)
    });
    if (stream) streamMap.set(row.id, stream.id);
    report.streams += 1;
  }

  for (const row of readRows('stream_items')) {
    const targetStreamId = streamMap.get(row.stream_id);
    const targetTemplateId = templateMap.get(row.template_id);
    if (!options.dryRun && (!targetStreamId || !targetTemplateId)) {
      report.warnings.push(`stream item ${row.id} references a missing stream or template`);
      continue;
    }
    const item = options.dryRun ? null : target.createStreamItem(targetStreamId, {
      template_id: targetTemplateId,
      position: row.position,
      schedule_type: row.schedule_type,
      duration_sec: row.duration_sec,
      start_at: row.start_at,
      enabled: Boolean(row.enabled)
    });
    if (item) streamItemMap.set(row.id, item.id);
    report.stream_items += 1;
  }

  if (!options.dryRun) {
    for (const row of readRows('devices')) {
      const targetDevice = deviceMap.get(row.id);
      const targetStream = streamMap.get(row.play_stream_id);
      if (targetDevice && targetStream) target.raw.prepare('UPDATE devices SET play_stream_id = ? WHERE id = ?').run(targetStream, targetDevice.id);
    }
  }

  for (const row of readRows('settings')) {
    const value = parseJsonValue(row.value, {}, `setting ${row.key}`, report.warnings).value;
    if (!options.dryRun) target.setSetting(row.key, value, null);
    report.settings += 1;
  }

  const photoRows = readRows('photos');
  for (const row of photoRows) {
    const candidates = [row.original_path, row.preview_path, row.film_path]
      .map((value) => sourcePath(sourceData, value))
      .filter(Boolean);
    const existing = [];
    for (const candidate of candidates) if (await exists(candidate)) existing.push(candidate);
    const imageSource = existing.find((file) => !isFilmFile(file)) || null;
    const filmSource = existing.find((file) => isFilmFile(file)) || null;
    const sourceFile = imageSource || filmSource;
    const entry = {
      id: row.id,
      filename: row.filename || '',
      source: sourceFile,
      exists: Boolean(sourceFile),
      sha256: sourceFile ? await sha256(sourceFile) : '',
      film_sha256: filmSource ? await sha256(filmSource) : '',
      film: null,
      imported: false,
      photo_imported: false
    };
    if (filmSource) {
      const filmBuffer = await fs.readFile(filmSource);
      const checked = validateFilmBuffer(filmBuffer);
      entry.film = checked.valid
        ? { valid: true, profile: checked.profile.key, size: filmBuffer.length }
        : { valid: false, error: checked.error, size: filmBuffer.length };
    }
    const filmIsImportable = Boolean(filmSource && entry.film?.valid);
    if (filmSource && !filmIsImportable) report.warnings.push(`photo ${row.id} has an invalid .film file; it was not imported`);
    const importSources = [
      imageSource ? { file: imageSource, kind: 'original', suffix: 'image' } : null,
      filmIsImportable ? { file: filmSource, kind: 'film', suffix: 'film' } : null
    ].filter(Boolean);
    if (!sourceFile) {
      report.warnings.push(`photo ${row.id} media file not found`);
      report.media.push(entry);
      report.photos += 1;
      continue;
    }
    if (!importSources.length) {
      report.media.push(entry);
      report.photos += 1;
      continue;
    }

    if (!options.dryRun) {
      const userId = userMap.get(row.user_id) || null;
      const albumId = albumMap.get(row.album_id) || null;
      const importedPaths = {};
      for (const source of importSources) {
        const destination = path.join(targetData, 'media', safeImportedName(row.id, source.file, source.suffix));
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(source.file, destination);
        const sourceStat = await fs.stat(source.file);
        const media = target.insertMedia({
          userId,
          albumId,
          name: path.basename(source.file),
          storedPath: path.relative(targetData, destination),
          mime: mimeForFile(source.file),
          kind: source.kind,
          profile: source.kind === 'film' && entry.film?.valid ? entry.film.profile : '',
          sha256: await sha256(source.file),
          size: sourceStat.size
        });
        if (media) {
          entry.imported = true;
          report.media_imported += 1;
          importedPaths[source.kind] = destination;
        }
      }
      if (imageSource && albumId && importedPaths.original) {
        const photo = target.insertPhoto({
          userId,
          albumId,
          filename: row.filename || path.basename(imageSource),
          originalPath: importedPaths.original,
          filmPath: importedPaths.film || '',
          width: row.width,
          height: row.height,
          layout: row.layout || '{}',
          sort: row.sort
        });
        entry.photo_imported = Boolean(photo);
        if (photo && row.id === albumRows.find((album) => album.id === row.album_id)?.cover_photo_id) {
          const targetAlbumId = albumMap.get(row.album_id);
          if (targetAlbumId) target.updateAlbum(targetAlbumId, { cover_photo_id: photo.id });
        }
        if (photo) report.photos_imported += 1;
      } else if (!albumId) {
        report.warnings.push(`photo ${row.id} has no importable target album`);
      }
    }
    report.media.push(entry);
    report.photos += 1;
  }

  for (const row of readRows('push_records')) {
    const targetDevice = deviceMap.get(row.device_id);
    const targetItem = streamItemMap.get(row.stream_item_id) || null;
    if (!options.dryRun && targetDevice) {
      target.raw.prepare('INSERT INTO push_records (user_id, device_id, stream_item_id, film_path, method, pushed_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        userMap.get(row.user_id) || null,
        targetDevice.deviceId,
        targetItem,
        row.film_path || '',
        row.method || 'pull',
        row.pushed_at || new Date().toISOString()
      );
    }
    report.push_records += 1;
  }

  target.close();
  source.close();
  if (options.dryRun) await fs.rm(tempDir, { recursive: true, force: true });
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`FastAPI import ${options.dryRun ? 'dry-run' : 'completed'}`);
    console.log(`source: ${sourceDb}`);
    console.log(`tables: ${Object.entries(report.tables).map(([key, value]) => `${key}=${value}`).join(', ')}`);
    console.log(`users=${report.users} devices=${report.devices} albums=${report.albums} photos=${report.photos} templates=${report.templates} streams=${report.streams} stream_items=${report.stream_items} media_imported=${report.media_imported}`);
    console.log(`warnings=${report.warnings.length}`);
    report.warnings.slice(0, 20).forEach((warning) => console.log(`- ${warning}`));
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
