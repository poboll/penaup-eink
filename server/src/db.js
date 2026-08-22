/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 *
 * SQLite persistence for the Penaup single-process runtime. The schema is
 * intentionally boring: WAL, parameterized statements, JSON at the edges,
 * and explicit ownership columns so the invite-only API can be audited.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';

function nowIso() { return new Date().toISOString(); }

function tokensMatch(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string' || !expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && crypto.timingSafeEqual(expectedBytes, receivedBytes);
}

function hashToken(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

function normalizeText(value, fallback = '', max = 512) {
  return typeof value === 'string' ? value.trim().slice(0, max) : fallback;
}

export function normalizeEmail(value) { return normalizeText(value).toLowerCase().slice(0, 254); }

function json(value, fallback = {}) { try { return JSON.stringify(value ?? fallback); } catch { return JSON.stringify(fallback); } }
function parseJson(value, fallback = {}) { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } }

function serializeUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email || row.username || '', role: row.role || 'user', status: row.status || 'active', createdAt: row.created_at };
}

function serializeDevice(row, includeToken = false) {
  if (!row) return null;
  const ageMs = Date.now() - Date.parse(row.last_seen_at || 0);
  const online = Number.isFinite(ageMs) && ageMs <= (row.heartbeat_interval || 60) * 3 * 1000;
  const device = {
    id: row.id, deviceId: row.device_id, name: row.name,
    model: row.model || row.device_type || 'unknown', deviceType: row.device_type || row.model || 'unknown',
    ownerId: row.user_id == null ? null : row.user_id, batteryPercent: row.battery_percent, voltageMv: row.voltage_mv,
    state: row.state, wifiConnected: Boolean(row.wifi_connected), lastSeenAt: row.last_seen_at, lastIp: row.last_ip,
    heartbeatInterval: row.heartbeat_interval, online, claimedAt: row.claimed_at || null, createdAt: row.created_at
  };
  // Keep the old admin surface readable during the migration window. New
  // clients use camelCase; legacy pages still receive their snake_case keys.
  Object.assign(device, {
    device_id: row.device_id,
    device_type: row.device_type || row.model || 'unknown',
    is_claimed: row.user_id != null || row.claimed_at != null,
    wifi_enable: Boolean(row.wifi_enable),
    play_mode: row.play_mode ?? 0,
    sleep_mode: Boolean(row.sleep_mode),
    sleep_auto: Boolean(row.sleep_auto),
    sleep_time: row.sleep_time ?? 0,
    ble_enable: Boolean(row.ble_enable),
    current_file_id: row.current_file_id ?? 0,
    play_stream_id: row.play_stream_id ?? null,
    battery_percent: row.battery_percent,
    voltage_mv: row.voltage_mv,
    heartbeat_interval: row.heartbeat_interval,
    last_heartbeat_at: row.last_seen_at,
    last_ip: row.last_ip,
    created_at: row.created_at
  });
  if (includeToken) device.token = row.token;
  return device;
}

function serializeMedia(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, storedPath: row.stored_path, stored_path: row.stored_path, mime: row.mime, size: row.size,
    sha256: row.sha256 || '', kind: row.kind || 'film', profile: row.profile || '', albumId: row.album_id == null ? null : row.album_id,
    originalPath: row.original_path || '', previewPath: row.preview_path || '', thumbPath: row.thumb_path || '', createdAt: row.created_at, created_at: row.created_at
  };
}

function serializePhoto(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id == null ? null : row.user_id,
    albumId: row.album_id,
    filename: row.filename,
    width: row.width,
    height: row.height,
    layout: parseJson(row.layout, {}),
    sort: row.sort,
    createdAt: row.created_at
  };
}

function serializeTransfer(row) {
  if (!row) return null;
  return {
    transfer_id: row.transfer_id, user_id: row.user_id, device_id: row.device_id, media_id: row.media_id,
    phase: row.phase, completed_bytes: row.completed_bytes, total_bytes: row.total_bytes, progress_hint: row.progress_hint,
    outcome: row.outcome, detail: row.detail, card_title: row.card_title, rendering_detail: row.rendering_detail,
    updated_at: row.updated_at, created_at: row.created_at
  };
}

function ensureColumn(db, table, column, definition) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function createSettingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      user_id INTEGER,
      value TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_user_key ON settings(user_id, key) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_global_key ON settings(key) WHERE user_id IS NULL;
  `);
}

function migrateLegacySettingsTable(db) {
  const columns = db.prepare('PRAGMA table_info(settings)').all();
  const hasId = columns.some((row) => row.name === 'id');
  const keyIsPrimary = columns.some((row) => row.name === 'key' && row.pk === 1);
  if (hasId && !keyIsPrimary) {
    createSettingsTable(db);
    return;
  }

  // The first runtime schema used key as the only primary key. Preserve that
  // table as an import/rollback witness, then copy its rows into the scoped
  // schema. No setting is discarded during the shape change.
  const backupName = 'settings_legacy_v1';
  const backupExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(backupName);
  if (!backupExists) db.exec(`ALTER TABLE settings RENAME TO ${backupName}`);
  else db.exec('DROP TABLE settings');
  createSettingsTable(db);
  db.exec(`
    INSERT OR IGNORE INTO settings (key, user_id, value, updated_at)
    SELECT key, user_id, value, updated_at FROM ${backupName};
  `);
}

export class PenaupDatabase {
  constructor(filename) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, username TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'active', ver INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_challenges (
        id TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, used_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'access',
        expires_at TEXT NOT NULL, last_seen_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL UNIQUE, token TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT 'unknown', device_type TEXT NOT NULL DEFAULT 'unknown', user_id INTEGER, claimed_at TEXT,
        battery_percent INTEGER NOT NULL DEFAULT -1, voltage_mv INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'unknown',
        wifi_connected INTEGER NOT NULL DEFAULT 0, heartbeat_interval INTEGER NOT NULL DEFAULT 60, last_seen_at TEXT,
        last_ip TEXT NOT NULL DEFAULT '', wifi_enable INTEGER NOT NULL DEFAULT 0, play_mode INTEGER NOT NULL DEFAULT 0,
        sleep_mode INTEGER NOT NULL DEFAULT 0, sleep_auto INTEGER NOT NULL DEFAULT 0, sleep_time INTEGER NOT NULL DEFAULT 0,
        ble_enable INTEGER NOT NULL DEFAULT 0, current_file_id INTEGER NOT NULL DEFAULT 0, play_stream_id INTEGER,
        pending_config TEXT NOT NULL DEFAULT '{}', pending_commands TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, album_id INTEGER, name TEXT NOT NULL, stored_path TEXT NOT NULL UNIQUE,
        original_path TEXT NOT NULL DEFAULT '', preview_path TEXT NOT NULL DEFAULT '', thumb_path TEXT NOT NULL DEFAULT '',
        mime TEXT NOT NULL DEFAULT 'application/octet-stream', kind TEXT NOT NULL DEFAULT 'film', profile TEXT NOT NULL DEFAULT '',
        sha256 TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS albums (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', cover_photo_id INTEGER,
        dither_type TEXT NOT NULL DEFAULT 'adaptive', dither_strength INTEGER NOT NULL DEFAULT 80, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, album_id INTEGER NOT NULL, filename TEXT NOT NULL DEFAULT '',
        original_path TEXT NOT NULL DEFAULT '', film_path TEXT NOT NULL DEFAULT '', preview_path TEXT NOT NULL DEFAULT '',
        width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0, layout TEXT NOT NULL DEFAULT '{}', sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'custom', is_builtin INTEGER NOT NULL DEFAULT 0,
        definition TEXT NOT NULL DEFAULT '{}', render_config TEXT NOT NULL DEFAULT '{}', thumb_path TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS streams (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'device_pull',
        enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stream_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, stream_id INTEGER NOT NULL, template_id INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0,
        schedule_type TEXT NOT NULL DEFAULT 'relative', duration_sec INTEGER NOT NULL DEFAULT 30, start_at TEXT, enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS push_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, device_id TEXT NOT NULL, stream_item_id INTEGER, film_path TEXT NOT NULL DEFAULT '',
        method TEXT NOT NULL DEFAULT 'pull', pushed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transfers (
        transfer_id TEXT PRIMARY KEY, user_id INTEGER, device_id TEXT NOT NULL, media_id INTEGER, phase TEXT NOT NULL DEFAULT 'idle',
        completed_bytes INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER NOT NULL DEFAULT 0, progress_hint REAL NOT NULL DEFAULT 0,
        outcome TEXT NOT NULL DEFAULT 'pending', detail TEXT NOT NULL DEFAULT '', card_title TEXT NOT NULL DEFAULT '花生片正在显影',
        rendering_detail TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, command TEXT NOT NULL, params_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, delivered_at TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, device_id TEXT, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_auth_challenges_email_created ON auth_challenges(email, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_auth_challenges_ip_created ON auth_challenges(ip, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
      CREATE INDEX IF NOT EXISTS idx_media_user_created ON media(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_transfers_user_updated ON transfers(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_commands_device_status ON commands(device_id, status, id);
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
    `);

    // Existing FastAPI/Runtime databases predate the consolidated schema.
    // Add only missing columns; never drop or reinterpret legacy data here.
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get()) {
      createSettingsTable(this.db);
    }
    for (const [table, column, definition] of [
      ['users', 'email', 'TEXT'], ['users', 'role', "TEXT NOT NULL DEFAULT 'user'"], ['users', 'status', "TEXT NOT NULL DEFAULT 'active'"],
      ['devices', 'device_type', "TEXT NOT NULL DEFAULT 'unknown'"], ['devices', 'user_id', 'INTEGER'], ['devices', 'claimed_at', 'TEXT'],
      ['devices', 'wifi_enable', 'INTEGER NOT NULL DEFAULT 0'], ['devices', 'play_mode', 'INTEGER NOT NULL DEFAULT 0'],
      ['devices', 'sleep_mode', 'INTEGER NOT NULL DEFAULT 0'], ['devices', 'sleep_auto', 'INTEGER NOT NULL DEFAULT 0'],
      ['devices', 'sleep_time', 'INTEGER NOT NULL DEFAULT 0'], ['devices', 'ble_enable', 'INTEGER NOT NULL DEFAULT 0'],
      ['devices', 'current_file_id', 'INTEGER NOT NULL DEFAULT 0'], ['devices', 'play_stream_id', 'INTEGER'],
      ['devices', 'pending_config', "TEXT NOT NULL DEFAULT '{}'"], ['devices', 'pending_commands', "TEXT NOT NULL DEFAULT '[]'"],
      ['media', 'user_id', 'INTEGER'], ['media', 'album_id', 'INTEGER'], ['media', 'original_path', "TEXT NOT NULL DEFAULT ''"],
      ['media', 'preview_path', "TEXT NOT NULL DEFAULT ''"], ['media', 'thumb_path', "TEXT NOT NULL DEFAULT ''"], ['media', 'kind', "TEXT NOT NULL DEFAULT 'film'"],
      ['media', 'profile', "TEXT NOT NULL DEFAULT ''"], ['media', 'sha256', "TEXT NOT NULL DEFAULT ''"],
      ['albums', 'user_id', 'INTEGER'], ['photos', 'user_id', 'INTEGER'], ['templates', 'user_id', 'INTEGER'], ['streams', 'user_id', 'INTEGER'],
      ['push_records', 'user_id', 'INTEGER'], ['settings', 'user_id', 'INTEGER'], ['settings', 'updated_at', "TEXT NOT NULL DEFAULT ''"]
    ]) ensureColumn(this.db, table, column, definition);
    migrateLegacySettingsTable(this.db);
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL AND email <> ''");
    this.db.exec("INSERT INTO schema_meta (key, value) VALUES ('runtime_schema', '3') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  }

  close() { this.db.close(); }
  get raw() { return this.db; }
  count(table, where = '', params = []) { return Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}${where ? ` WHERE ${where}` : ''}`).get(...params).count); }

  findUserByEmail(email) { const value = normalizeEmail(email); return this.db.prepare('SELECT * FROM users WHERE lower(email) = ? OR lower(username) = ? LIMIT 1').get(value, value) || null; }
  findUserById(id) { return this.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id)) || null; }
  createUser(email, role = 'user') {
    const normalized = normalizeEmail(email); const existing = this.findUserByEmail(normalized); if (existing) return existing;
    const now = nowIso();
    const result = this.db.prepare('INSERT INTO users (email, username, password_hash, role, status, created_at) VALUES (?, ?, \'\', ?, \'active\', ?)').run(normalized, normalized, role, now);
    return this.findUserById(result.lastInsertRowid);
  }
  serializeUser(id) { return serializeUser(this.findUserById(id)); }

  createInvite(email, ttlSeconds = 86400) {
    const normalized = email ? normalizeEmail(email) : null; const rawToken = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    this.db.prepare('INSERT INTO invites (email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)').run(normalized, hashToken(rawToken), expiresAt, nowIso());
    return { token: rawToken, email: normalized, expiresAt };
  }
  findUsableInvite(email) { const value = normalizeEmail(email); return this.db.prepare('SELECT * FROM invites WHERE (email IS NULL OR lower(email) = ?) AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1').get(value, nowIso()) || null; }
  findInviteByToken(token, email = '') { const value = normalizeEmail(email); return this.db.prepare('SELECT * FROM invites WHERE token_hash = ? AND (email IS NULL OR lower(email) = ?) AND used_at IS NULL AND expires_at > ? LIMIT 1').get(hashToken(token), value, nowIso()) || null; }
  consumeInvite(id) { this.db.prepare('UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL').run(nowIso(), id); }
  countRecentChallengesByEmail(email, sinceIso) { return this.count('auth_challenges', 'created_at > ? AND email = ?', [sinceIso, normalizeEmail(email)]); }
  countRecentChallengesByIp(ip, sinceIso) { return this.count('auth_challenges', 'created_at > ? AND ip = ?', [sinceIso, normalizeText(ip, '', 96)]); }
  countRecentChallenges(email, ip, sinceIso) { return this.count('auth_challenges', 'created_at > ? AND (email = ? OR ip = ?)', [sinceIso, normalizeEmail(email), normalizeText(ip, '', 96)]); }
  createChallenge({ email, codeHash, ip, expiresAt }) { const id = crypto.randomUUID(); this.db.prepare('INSERT INTO auth_challenges (id, email, code_hash, ip, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, normalizeEmail(email), codeHash, normalizeText(ip, '', 96), expiresAt, nowIso()); return id; }
  getChallenge(id) { return this.db.prepare('SELECT * FROM auth_challenges WHERE id = ?').get(id) || null; }
  incrementChallengeAttempt(id) { this.db.prepare('UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?').run(id); }
  consumeChallenge(id) {
    return this.db.prepare('UPDATE auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL').run(nowIso(), id).changes > 0;
  }
  invalidateChallenge(id) { this.db.prepare('UPDATE auth_challenges SET used_at = COALESCE(used_at, ?) WHERE id = ?').run(nowIso(), id); }
  createSession(userId, token, kind, expiresAt) { const now = nowIso(); const result = this.db.prepare('INSERT INTO sessions (user_id, token_hash, kind, expires_at, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(userId, hashToken(token), kind, expiresAt, now, now); return Number(result.lastInsertRowid); }
  findSession(token, kind = 'access') { const row = this.db.prepare('SELECT s.*, u.email, u.role, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.kind = ? AND s.revoked_at IS NULL AND s.expires_at > ?').get(hashToken(token), kind, nowIso()); if (row) this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), row.id); return row || null; }
  revokeSession(token) { this.db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?').run(nowIso(), hashToken(token)); }

  heartbeat(input) {
    const deviceId = normalizeText(input.deviceId, '', 96); if (!deviceId) throw new Error('device_id is required');
    const existing = this.db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId);
    if (existing && !tokensMatch(existing.token, input.token)) return { authenticated: false, provisioned: false, device: null, commands: [] };
    const now = nowIso(); let provisioned = false;
    if (!existing) {
      const token = crypto.randomBytes(24).toString('hex'); const name = normalizeText(input.name, deviceId, 96); const model = normalizeText(input.model, 'unknown', 64);
      this.db.prepare('INSERT INTO devices (device_id, token, name, model, device_type, last_seen_at, last_ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(deviceId, token, name, model, model, now, normalizeText(input.ip, '', 96), now); provisioned = true;
    }
    const interval = Math.min(180, Math.max(5, Number(input.heartbeatInterval) || 60));
    this.db.prepare('UPDATE devices SET battery_percent = ?, voltage_mv = ?, state = ?, wifi_connected = ?, heartbeat_interval = ?, last_seen_at = ?, last_ip = ?, model = COALESCE(NULLIF(?, \'\'), model), device_type = COALESCE(NULLIF(?, \'\'), device_type) WHERE device_id = ?').run(
      Number.isFinite(input.battery) ? Math.min(100, Math.max(-1, input.battery)) : -1, Number.isFinite(input.voltageMv) ? input.voltageMv : 0,
      normalizeText(input.state, 'idle', 32), input.wifiConnected ? 1 : 0, interval, now, normalizeText(input.ip, '', 96), normalizeText(input.model, '', 64), normalizeText(input.model, '', 64), deviceId
    );
    const commands = this.db.transaction(() => {
      const pending = this.db.prepare("SELECT id, command, params_json FROM commands WHERE device_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 20").all(deviceId);
      const mark = this.db.prepare("UPDATE commands SET status = 'delivered', delivered_at = ? WHERE id = ?"); pending.forEach((command) => mark.run(now, command.id));
      return pending.map((command) => ({ id: command.id, cmd: command.command, params: parseJson(command.params_json) }));
    })();
    const fresh = this.db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId);
    return { authenticated: true, provisioned, device: serializeDevice(fresh, true), commands };
  }
  listDevices(userId = null, includeUnclaimed = false) { const rows = userId == null ? this.db.prepare('SELECT * FROM devices ORDER BY last_seen_at DESC, id DESC').all() : (includeUnclaimed ? this.db.prepare('SELECT * FROM devices WHERE user_id = ? OR user_id IS NULL ORDER BY last_seen_at DESC, id DESC').all(userId) : this.db.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC, id DESC').all(userId)); return rows.map((row) => serializeDevice(row)); }
  getDevice(deviceId, includeToken = false) { return serializeDevice(this.db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId), includeToken); }
  deviceMediaRows(deviceId) {
    return this.db.prepare(`
      SELECT m.*
      FROM media m
      JOIN devices d ON d.device_id = ?
      WHERE m.user_id IS NULL OR (d.user_id IS NOT NULL AND m.user_id = d.user_id)
      ORDER BY m.id DESC
    `).all(deviceId);
  }
  latestFilmForDevice(deviceId) {
    const row = this.deviceMediaRows(deviceId).find((media) => media.kind === 'film' || String(media.name || '').toLowerCase().endsWith('.film'));
    return serializeMedia(row);
  }
  filmForDeviceByFilename(deviceId, filename) {
    const wanted = path.basename(String(filename || ''));
    const row = this.deviceMediaRows(deviceId).find((media) => media.name === wanted || path.basename(media.stored_path || '') === wanted);
    return serializeMedia(row);
  }
  claimDevice(deviceId, userId) { const result = this.db.prepare('UPDATE devices SET user_id = ?, claimed_at = ? WHERE device_id = ? AND (user_id IS NULL OR user_id = ?)').run(userId, nowIso(), deviceId, userId); return result.changes > 0 ? this.getDevice(deviceId) : null; }
  issueCommand(deviceId, command, params = {}) { const cmd = normalizeText(command, 'noop', 128); const result = this.db.prepare('INSERT INTO commands (device_id, command, params_json, created_at) VALUES (?, ?, ?, ?)').run(deviceId, cmd, json(params), nowIso()); return { id: Number(result.lastInsertRowid), deviceId, cmd, params }; }

  getDeviceRecord(identifier) {
    const value = String(identifier ?? '').trim();
    if (!value) return null;
    return this.db.prepare('SELECT * FROM devices WHERE device_id = ? OR CAST(id AS TEXT) = ? LIMIT 1').get(value, value) || null;
  }

  updateDevice(identifier, input = {}) {
    const row = this.getDeviceRecord(identifier);
    if (!row) return null;
    const values = {
      name: input.name,
      device_type: input.device_type ?? input.deviceType,
      heartbeat_interval: input.heartbeat_interval ?? input.heartbeatInterval,
      wifi_enable: input.wifi_enable ?? input.wifiEnable,
      play_mode: input.play_mode ?? input.playMode,
      sleep_mode: input.sleep_mode ?? input.sleepMode,
      sleep_auto: input.sleep_auto ?? input.sleepAuto,
      sleep_time: input.sleep_time ?? input.sleepTime,
      ble_enable: input.ble_enable ?? input.bleEnable,
      current_file_id: input.current_file_id ?? input.currentFileId,
      play_stream_id: input.play_stream_id === 0 ? null : (input.play_stream_id ?? input.playStreamId)
    };
    const allowed = new Set(['name', 'device_type', 'heartbeat_interval', 'wifi_enable', 'play_mode', 'sleep_mode', 'sleep_auto', 'sleep_time', 'ble_enable', 'current_file_id', 'play_stream_id']);
    const assignments = [];
    const params = [];
    for (const [column, raw] of Object.entries(values)) {
      if (!allowed.has(column) || raw === undefined) continue;
      let value = raw;
      if (column === 'name' || column === 'device_type') value = normalizeText(raw, '', column === 'name' ? 96 : 64);
      else if (column === 'heartbeat_interval') value = Math.min(180, Math.max(5, Number(raw) || 60));
      else if (column === 'play_mode') value = Math.min(2, Math.max(0, Math.trunc(Number(raw) || 0)));
      else if (column === 'sleep_time') value = Math.min(2880, Math.max(0, Math.trunc(Number(raw) || 0)));
      else if (column === 'current_file_id') value = Math.max(0, Math.trunc(Number(raw) || 0));
      else if (column === 'play_stream_id') value = value == null ? null : (Number(value) || null);
      else value = Boolean(raw) ? 1 : 0;
      assignments.push(`${column} = ?`); params.push(value);
    }
    if (assignments.length) {
      params.push(row.id);
      this.db.prepare(`UPDATE devices SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    }
    return this.getDevice(row.device_id);
  }

  deleteDevice(identifier) {
    const row = this.getDeviceRecord(identifier);
    if (!row) return false;
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM commands WHERE device_id = ?').run(row.device_id);
      this.db.prepare('DELETE FROM transfers WHERE device_id = ?').run(row.device_id);
      this.db.prepare('DELETE FROM push_records WHERE device_id = ?').run(row.device_id);
      this.db.prepare('DELETE FROM devices WHERE id = ?').run(row.id);
    })();
    return true;
  }

  resetDeviceToken(identifier) {
    const row = this.getDeviceRecord(identifier);
    if (!row) return null;
    const token = crypto.randomBytes(24).toString('hex');
    this.db.prepare('UPDATE devices SET token = ?, user_id = NULL, claimed_at = NULL WHERE id = ?').run(token, row.id);
    return this.getDevice(row.device_id, true);
  }

  queueDeviceConfig(identifier, config = {}) {
    const row = this.getDeviceRecord(identifier);
    if (!row) return null;
    const current = parseJson(row.pending_config, {});
    const next = { ...current, ...config };
    this.db.prepare('UPDATE devices SET pending_config = ? WHERE id = ?').run(json(next), row.id);
    return this.issueCommand(row.device_id, 'set_config', next);
  }

  legacyStream(id, includeItems = false) {
    const row = this.db.prepare('SELECT * FROM streams WHERE id = ?').get(Number(id));
    if (!row) return null;
    const stream = { id: row.id, name: row.name, mode: row.mode, enabled: Boolean(row.enabled), created_at: row.created_at, createdAt: row.created_at };
    if (includeItems) stream.items = this.listStreamItems(row.id);
    return stream;
  }

  listStreamItems(streamId) {
    return this.db.prepare('SELECT * FROM stream_items WHERE stream_id = ? ORDER BY position ASC, id ASC').all(Number(streamId)).map((row) => ({
      id: row.id, stream_id: row.stream_id, template_id: row.template_id, position: row.position,
      schedule_type: row.schedule_type, duration_sec: row.duration_sec, start_at: row.start_at,
      enabled: Boolean(row.enabled)
    }));
  }

  createStreamItem(streamId, input = {}, ownerId = undefined) {
    const stream = ownerId === undefined ? this.legacyStream(streamId) : this.getStream(streamId, ownerId);
    if (!stream) return null;
    const templateId = Number(input.template_id ?? input.templateId);
    if (!templateId || !this.getTemplate(templateId, ownerId === undefined ? null : ownerId)) return null;
    const position = Number.isFinite(Number(input.position)) ? Math.max(0, Number(input.position)) : this.listStreamItems(streamId).length;
    const result = this.db.prepare('INSERT INTO stream_items (stream_id, template_id, position, schedule_type, duration_sec, start_at, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      Number(streamId), templateId, position, input.schedule_type === 'absolute' ? 'absolute' : 'relative', Math.max(1, Number(input.duration_sec ?? input.durationSec) || 30), input.start_at || input.startAt || null, input.enabled === false ? 0 : 1
    );
    return this.listStreamItems(streamId).find((item) => item.id === Number(result.lastInsertRowid));
  }

  updateStreamItem(streamId, itemId, input = {}, ownerId = undefined) {
    if (ownerId !== undefined && !this.getStream(streamId, ownerId)) return null;
    const current = this.db.prepare('SELECT * FROM stream_items WHERE id = ? AND stream_id = ?').get(Number(itemId), Number(streamId));
    if (!current) return null;
    const next = {
      template_id: input.template_id ?? input.templateId,
      position: input.position,
      schedule_type: input.schedule_type,
      duration_sec: input.duration_sec ?? input.durationSec,
      start_at: input.start_at ?? input.startAt,
      enabled: input.enabled
    };
    const assignments = [];
    const params = [];
    if (next.template_id !== undefined && this.getTemplate(Number(next.template_id), ownerId === undefined ? null : ownerId)) { assignments.push('template_id = ?'); params.push(Number(next.template_id)); }
    if (next.position !== undefined) { assignments.push('position = ?'); params.push(Math.max(0, Number(next.position) || 0)); }
    if (next.schedule_type !== undefined) { assignments.push('schedule_type = ?'); params.push(next.schedule_type === 'absolute' ? 'absolute' : 'relative'); }
    if (next.duration_sec !== undefined) { assignments.push('duration_sec = ?'); params.push(Math.max(1, Number(next.duration_sec) || 30)); }
    if (next.start_at !== undefined) { assignments.push('start_at = ?'); params.push(next.start_at || null); }
    if (next.enabled !== undefined) { assignments.push('enabled = ?'); params.push(next.enabled === false ? 0 : 1); }
    if (assignments.length) { params.push(Number(itemId), Number(streamId)); this.db.prepare(`UPDATE stream_items SET ${assignments.join(', ')} WHERE id = ? AND stream_id = ?`).run(...params); }
    return this.listStreamItems(streamId).find((item) => item.id === Number(itemId)) || null;
  }

  deleteStreamItem(streamId, itemId, ownerId = undefined) {
    if (ownerId !== undefined && !this.getStream(streamId, ownerId)) return false;
    return this.db.prepare('DELETE FROM stream_items WHERE id = ? AND stream_id = ?').run(Number(itemId), Number(streamId)).changes > 0;
  }

  sortStreamItems(streamId, itemIds = [], ownerId = undefined) {
    if (ownerId !== undefined && !this.getStream(streamId, ownerId)) return [];
    const validIds = new Set(this.db.prepare('SELECT id FROM stream_items WHERE stream_id = ?').all(Number(streamId)).map((row) => Number(row.id)));
    const update = this.db.prepare('UPDATE stream_items SET position = ? WHERE id = ? AND stream_id = ?');
    this.db.transaction(() => Array.from(new Set(itemIds.map((id) => Number(id)).filter((id) => validIds.has(id)))).forEach((id, index) => update.run(index, id, Number(streamId))))();
    return this.listStreamItems(streamId);
  }

  bindStreamDevices(streamId, deviceIds = [], ownerId = undefined) {
    if (ownerId !== undefined && !this.getStream(streamId, ownerId)) return [];
    const ids = new Set(deviceIds.map((value) => String(value)));
    const update = this.db.prepare('UPDATE devices SET play_stream_id = ? WHERE id = ?');
    const rows = ownerId === undefined
      ? this.db.prepare('SELECT id, device_id FROM devices').all()
      : this.db.prepare('SELECT id, device_id FROM devices WHERE user_id = ?').all(Number(ownerId));
    this.db.transaction(() => rows.forEach((row) => update.run(ids.has(String(row.device_id)) || ids.has(String(row.id)) ? Number(streamId) : null, row.id)))();
    return rows.filter((row) => ids.has(String(row.device_id)) || ids.has(String(row.id))).map((row) => row.device_id);
  }

  listMedia(userId = null) { const rows = userId == null ? this.db.prepare('SELECT * FROM media ORDER BY id DESC').all() : this.db.prepare('SELECT * FROM media WHERE user_id = ? ORDER BY id DESC').all(userId); return rows.map(serializeMedia); }
  latestFilm(userId = null) { const row = userId == null ? this.db.prepare("SELECT * FROM media WHERE lower(name) LIKE '%.film' OR kind = 'film' ORDER BY id DESC LIMIT 1").get() : this.db.prepare("SELECT * FROM media WHERE user_id = ? AND (lower(name) LIKE '%.film' OR kind = 'film') ORDER BY id DESC LIMIT 1").get(userId); return serializeMedia(row); }
  getUserMediaBytes(userId) { return Number(this.db.prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM media WHERE user_id = ?').get(userId).bytes); }
  insertMedia({ userId = null, albumId = null, name, storedPath, originalPath = '', previewPath = '', thumbPath = '', mime, kind = 'film', profile = '', sha256 = '', size }) {
    const result = this.db.prepare('INSERT INTO media (user_id, album_id, name, stored_path, original_path, preview_path, thumb_path, mime, kind, profile, sha256, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(userId, albumId, normalizeText(name, 'untitled.film', 128), storedPath, originalPath, previewPath, thumbPath, normalizeText(mime, 'application/octet-stream', 128), normalizeText(kind, 'film', 24), normalizeText(profile, '', 32), sha256, Number(size) || 0, nowIso());
    return serializeMedia(this.db.prepare('SELECT * FROM media WHERE id = ?').get(result.lastInsertRowid));
  }
  getMedia(id, userId = null) { const row = userId == null ? this.db.prepare('SELECT * FROM media WHERE id = ?').get(id) : this.db.prepare('SELECT * FROM media WHERE id = ? AND user_id = ?').get(id, userId); return serializeMedia(row); }
  setMediaAlbum(id, albumId, userId) {
    const result = this.db.prepare('UPDATE media SET album_id = ? WHERE id = ? AND user_id = ?').run(albumId == null ? null : Number(albumId), Number(id), Number(userId));
    return result.changes > 0 ? this.getMedia(id, userId) : null;
  }
  deleteMedia(id, userId) {
    const row = this.db.prepare('SELECT * FROM media WHERE id = ? AND user_id = ?').get(Number(id), Number(userId));
    if (!row) return null;
    this.db.prepare('DELETE FROM media WHERE id = ? AND user_id = ?').run(Number(id), Number(userId));
    return row;
  }

  listPhotos(albumId) {
    return this.db.prepare('SELECT * FROM photos WHERE album_id = ? ORDER BY sort ASC, id ASC').all(Number(albumId)).map((row) => ({ ...row, layout: row.layout || '{}' }));
  }

  listPhotosForUser(albumId, userId) {
    return this.db.prepare(`
      SELECT p.*
      FROM photos p
      JOIN albums a ON a.id = p.album_id
      WHERE p.album_id = ? AND a.user_id = ?
      ORDER BY p.sort ASC, p.id ASC
    `).all(Number(albumId), Number(userId)).map(serializePhoto);
  }

  insertPhoto({ userId = null, albumId, filename, originalPath, filmPath = '', previewPath = '', width = 0, height = 0, layout = '{}', sort = null }) {
    const nextSort = sort == null ? (this.db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS value FROM photos WHERE album_id = ?').get(Number(albumId)).value) : Number(sort);
    const result = this.db.prepare('INSERT INTO photos (user_id, album_id, filename, original_path, film_path, preview_path, width, height, layout, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      userId, Number(albumId), normalizeText(filename, 'photo', 255), normalizeText(originalPath, '', 512), normalizeText(filmPath, '', 512), normalizeText(previewPath, '', 512), Math.max(0, Number(width) || 0), Math.max(0, Number(height) || 0), normalizeText(layout, '{}', 4000), Math.max(0, nextSort), nowIso()
    );
    const photo = this.db.prepare('SELECT * FROM photos WHERE id = ?').get(result.lastInsertRowid);
    const album = this.db.prepare('SELECT * FROM albums WHERE id = ?').get(Number(albumId));
    if (album && album.cover_photo_id == null) this.db.prepare('UPDATE albums SET cover_photo_id = ? WHERE id = ?').run(photo.id, Number(albumId));
    return photo;
  }

  getPhoto(photoId, albumId = null) {
    return albumId == null ? this.db.prepare('SELECT * FROM photos WHERE id = ?').get(Number(photoId)) : this.db.prepare('SELECT * FROM photos WHERE id = ? AND album_id = ?').get(Number(photoId), Number(albumId));
  }

  getPhotoForUser(photoId, albumId, userId) {
    return this.db.prepare(`
      SELECT p.*
      FROM photos p
      JOIN albums a ON a.id = p.album_id
      WHERE p.id = ? AND p.album_id = ? AND a.user_id = ?
    `).get(Number(photoId), Number(albumId), Number(userId)) || null;
  }

  deletePhoto(photoId, ownerId = undefined) {
    const photo = ownerId === undefined
      ? this.getPhoto(photoId)
      : this.db.prepare(`
        SELECT p.*
        FROM photos p
        JOIN albums a ON a.id = p.album_id
        WHERE p.id = ? AND a.user_id = ?
      `).get(Number(photoId), Number(ownerId));
    if (!photo) return null;
    const paths = [photo.original_path, photo.film_path, photo.preview_path].filter(Boolean);
    const mediaRows = paths.length ? this.db.prepare(`
      SELECT m.*
      FROM media m
      WHERE m.stored_path IN (${paths.map(() => '?').join(', ')})
        AND NOT EXISTS (
          SELECT 1 FROM photos other
          WHERE other.id <> ?
            AND (other.original_path = m.stored_path OR other.film_path = m.stored_path OR other.preview_path = m.stored_path)
        )
    `).all(...paths, Number(photoId)) : [];
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM photos WHERE id = ?').run(Number(photoId));
      this.db.prepare('UPDATE albums SET cover_photo_id = NULL WHERE cover_photo_id = ?').run(Number(photoId));
      if (mediaRows.length) this.db.prepare(`DELETE FROM media WHERE id IN (${mediaRows.map(() => '?').join(', ')})`).run(...mediaRows.map((row) => row.id));
    })();
    return { photo, media: mediaRows };
  }

  updateAlbum(albumId, input = {}, ownerId = undefined) {
    const album = ownerId === undefined
      ? this.db.prepare('SELECT * FROM albums WHERE id = ?').get(Number(albumId))
      : this.db.prepare('SELECT * FROM albums WHERE id = ? AND user_id = ?').get(Number(albumId), Number(ownerId));
    if (!album) return null;
    const assignments = [];
    const params = [];
    if (input.name !== undefined) { assignments.push('name = ?'); params.push(normalizeText(input.name, album.name, 128)); }
    if (input.description !== undefined) { assignments.push('description = ?'); params.push(normalizeText(input.description, '', 1000)); }
    if (input.cover_photo_id !== undefined) {
      const cover = input.cover_photo_id == null ? null : this.getPhoto(input.cover_photo_id, albumId);
      if (input.cover_photo_id == null || cover) { assignments.push('cover_photo_id = ?'); params.push(cover ? cover.id : null); }
    }
    if (input.dither_type !== undefined || input.ditherType !== undefined) { assignments.push('dither_type = ?'); params.push(normalizeText(input.dither_type ?? input.ditherType, 'adaptive', 32)); }
    if (input.dither_strength !== undefined || input.ditherStrength !== undefined) { assignments.push('dither_strength = ?'); params.push(Math.min(100, Math.max(0, Number(input.dither_strength ?? input.ditherStrength) || 80))); }
    if (assignments.length) { params.push(Number(albumId)); this.db.prepare(`UPDATE albums SET ${assignments.join(', ')} WHERE id = ?`).run(...params); }
    return this.getAlbum(albumId, null);
  }

  deleteAlbum(albumId, ownerId = undefined) {
    const album = ownerId === undefined
      ? this.db.prepare('SELECT * FROM albums WHERE id = ?').get(Number(albumId))
      : this.db.prepare('SELECT * FROM albums WHERE id = ? AND user_id = ?').get(Number(albumId), Number(ownerId));
    if (!album) return null;
    const photos = this.listPhotos(albumId);
    const media = this.db.prepare('SELECT * FROM media WHERE album_id = ?').all(Number(albumId));
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM photos WHERE album_id = ?').run(Number(albumId));
      this.db.prepare('DELETE FROM media WHERE album_id = ?').run(Number(albumId));
      this.db.prepare('DELETE FROM albums WHERE id = ?').run(Number(albumId));
    })();
    return { album, photos, media };
  }

  sortPhotos(albumId, photoIds = []) {
    const update = this.db.prepare('UPDATE photos SET sort = ? WHERE id = ? AND album_id = ?');
    this.db.transaction(() => photoIds.forEach((id, index) => update.run(index, Number(id), Number(albumId))))();
    return this.listPhotos(albumId);
  }

  updatePhotoLayout(albumId, photoId, layout = {}) {
    const photo = this.getPhoto(photoId, albumId);
    if (!photo) return null;
    const safe = {
      scale: Math.min(4, Math.max(0.5, Number(layout.scale) || 1)),
      x: Math.trunc(Number(layout.x) || 0),
      y: Math.trunc(Number(layout.y) || 0),
      rotate: ((Math.trunc(Number(layout.rotate) || 0) % 360) + 360) % 360
    };
    this.db.prepare('UPDATE photos SET layout = ? WHERE id = ? AND album_id = ?').run(json(safe), Number(photoId), Number(albumId));
    return this.getPhoto(photoId, albumId);
  }

  createAlbum({ userId, name, description = '', ditherType = 'adaptive', ditherStrength = 80 }) { const result = this.db.prepare('INSERT INTO albums (user_id, name, description, dither_type, dither_strength, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(userId, normalizeText(name, '未命名片单', 128), normalizeText(description, '', 1000), normalizeText(ditherType, 'adaptive', 32), Math.min(100, Math.max(0, Number(ditherStrength) || 80)), nowIso()); return this.getAlbum(result.lastInsertRowid, userId); }
  listAlbums(userId) { const rows = userId == null ? this.db.prepare('SELECT * FROM albums ORDER BY id DESC').all() : this.db.prepare('SELECT * FROM albums WHERE user_id = ? ORDER BY id DESC').all(userId); return rows.map((row) => ({ ...row, ditherType: row.dither_type, ditherStrength: row.dither_strength, createdAt: row.created_at })); }
  getAlbum(id, userId) { const row = userId == null ? this.db.prepare('SELECT * FROM albums WHERE id = ?').get(id) : this.db.prepare('SELECT * FROM albums WHERE id = ? AND user_id = ?').get(id, userId); return row ? { ...row, ditherType: row.dither_type, ditherStrength: row.dither_strength, createdAt: row.created_at } : null; }
  createTemplate({ userId, name, kind = 'custom', definition = {}, renderConfig = {}, thumbPath = '', builtin = false }) { const result = this.db.prepare('INSERT INTO templates (user_id, name, kind, is_builtin, definition, render_config, thumb_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(userId, normalizeText(name, '未命名模板', 128), normalizeText(kind, 'custom', 32), builtin ? 1 : 0, json(definition), json(renderConfig), thumbPath, nowIso()); return this.getTemplate(result.lastInsertRowid, userId); }
  updateTemplate(id, input = {}, ownerId = undefined) {
    const row = ownerId === undefined
      ? this.db.prepare('SELECT * FROM templates WHERE id = ?').get(Number(id))
      : this.db.prepare('SELECT * FROM templates WHERE id = ? AND user_id = ?').get(Number(id), Number(ownerId));
    if (!row || row.is_builtin) return null;
    const assignments = [];
    const params = [];
    if (input.name !== undefined) { assignments.push('name = ?'); params.push(normalizeText(input.name, row.name, 128)); }
    if (input.kind !== undefined) { assignments.push('kind = ?'); params.push(normalizeText(input.kind, row.kind, 32)); }
    if (input.definition !== undefined) { assignments.push('definition = ?'); params.push(json(input.definition)); }
    if (input.render_config !== undefined || input.renderConfig !== undefined) { assignments.push('render_config = ?'); params.push(json(input.render_config ?? input.renderConfig)); }
    if (input.thumb_path !== undefined || input.thumbPath !== undefined) { assignments.push('thumb_path = ?'); params.push(normalizeText(input.thumb_path ?? input.thumbPath, '', 512)); }
    if (assignments.length) {
      params.push(Number(id));
      const ownerClause = ownerId === undefined ? '' : ' AND user_id = ?';
      if (ownerId !== undefined) params.push(Number(ownerId));
      this.db.prepare(`UPDATE templates SET ${assignments.join(', ')} WHERE id = ? AND is_builtin = 0${ownerClause}`).run(...params);
    }
    return this.getTemplate(id, ownerId === undefined ? null : ownerId);
  }
  deleteTemplate(id, ownerId = undefined) {
    const ownerClause = ownerId === undefined ? '' : ' AND user_id = ?';
    const params = ownerId === undefined ? [Number(id)] : [Number(id), Number(ownerId)];
    return this.db.prepare(`DELETE FROM templates WHERE id = ? AND is_builtin = 0${ownerClause}`).run(...params).changes > 0;
  }
  listTemplates(userId) { const rows = userId == null ? this.db.prepare('SELECT * FROM templates ORDER BY is_builtin DESC, id DESC').all() : this.db.prepare('SELECT * FROM templates WHERE user_id = ? OR is_builtin = 1 ORDER BY is_builtin DESC, id DESC').all(userId); return rows.map((row) => this.serializeTemplate(row)); }
  getTemplate(id, userId) { const row = userId == null ? this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id) : this.db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_builtin = 1)').get(id, userId); return row ? this.serializeTemplate(row) : null; }
  serializeTemplate(row) { return { id: row.id, userId: row.user_id, name: row.name, kind: row.kind, builtin: Boolean(row.is_builtin), definition: parseJson(row.definition), renderConfig: parseJson(row.render_config), thumbPath: row.thumb_path, createdAt: row.created_at }; }
  createStream({ userId, name, mode = 'device_pull', enabled = true }) { const result = this.db.prepare('INSERT INTO streams (user_id, name, mode, enabled, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, normalizeText(name, '我的片单', 128), normalizeText(mode, 'device_pull', 24), enabled ? 1 : 0, nowIso()); return this.getStream(result.lastInsertRowid, userId); }
  listStreams(userId) { const rows = userId == null ? this.db.prepare('SELECT * FROM streams ORDER BY id DESC').all() : this.db.prepare('SELECT * FROM streams WHERE user_id = ? ORDER BY id DESC').all(userId); return rows.map((row) => ({ id: row.id, name: row.name, mode: row.mode, enabled: Boolean(row.enabled), createdAt: row.created_at })); }
  getStream(id, userId) { const row = userId == null ? this.db.prepare('SELECT * FROM streams WHERE id = ?').get(id) : this.db.prepare('SELECT * FROM streams WHERE id = ? AND user_id = ?').get(id, userId); return row ? { id: row.id, name: row.name, mode: row.mode, enabled: Boolean(row.enabled), createdAt: row.created_at } : null; }
  updateStream(id, input = {}, ownerId = undefined) {
    const row = ownerId === undefined
      ? this.db.prepare('SELECT * FROM streams WHERE id = ?').get(Number(id))
      : this.db.prepare('SELECT * FROM streams WHERE id = ? AND user_id = ?').get(Number(id), Number(ownerId));
    if (!row) return null;
    const assignments = [];
    const params = [];
    if (input.name !== undefined) { assignments.push('name = ?'); params.push(normalizeText(input.name, row.name, 128)); }
    if (input.mode !== undefined) { assignments.push('mode = ?'); params.push(input.mode === 'server_push' ? 'server_push' : 'device_pull'); }
    if (input.enabled !== undefined) { assignments.push('enabled = ?'); params.push(input.enabled === false ? 0 : 1); }
    if (assignments.length) {
      params.push(Number(id));
      const ownerClause = ownerId === undefined ? '' : ' AND user_id = ?';
      if (ownerId !== undefined) params.push(Number(ownerId));
      this.db.prepare(`UPDATE streams SET ${assignments.join(', ')} WHERE id = ?${ownerClause}`).run(...params);
    }
    return this.getStream(id, ownerId === undefined ? null : ownerId);
  }
  deleteStream(id, ownerId = undefined) {
    const stream = ownerId === undefined
      ? this.db.prepare('SELECT * FROM streams WHERE id = ?').get(Number(id))
      : this.db.prepare('SELECT * FROM streams WHERE id = ? AND user_id = ?').get(Number(id), Number(ownerId));
    if (!stream) return null;
    this.db.transaction(() => {
      this.db.prepare('UPDATE devices SET play_stream_id = NULL WHERE play_stream_id = ?').run(Number(id));
      this.db.prepare('DELETE FROM stream_items WHERE stream_id = ?').run(Number(id));
      this.db.prepare('DELETE FROM streams WHERE id = ?').run(Number(id));
    })();
    return { id: stream.id, name: stream.name };
  }
  getSetting(key, userId = null) {
    const row = this.db.prepare('SELECT * FROM settings WHERE key = ? AND user_id IS ?').get(normalizeText(key, '', 64), userId);
    return row ? parseJson(row.value) : null;
  }
  setSetting(key, value, userId = null) {
    const normalizedKey = normalizeText(key, '', 64);
    const timestamp = nowIso();
    const update = this.db.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE key = ? AND user_id IS ?');
    const insert = this.db.prepare('INSERT INTO settings (key, user_id, value, updated_at) VALUES (?, ?, ?, ?)');
    this.db.transaction(() => {
      const result = update.run(json(value), timestamp, normalizedKey, userId);
      if (result.changes === 0) insert.run(normalizedKey, userId, json(value), timestamp);
    })();
    return value;
  }

  createTransfer({ transferId, userId, deviceId, mediaId = null, phase = 'preparing', totalBytes = 0, cardTitle = '花生片正在显影', renderingDetail = '' }) { const now = nowIso(); this.db.prepare('INSERT INTO transfers (transfer_id, user_id, device_id, media_id, phase, total_bytes, card_title, rendering_detail, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(transferId, userId, deviceId, mediaId, phase, Number(totalBytes) || 0, normalizeText(cardTitle, '花生片正在显影', 128), normalizeText(renderingDetail, '', 256), now, now); return this.getTransfer(transferId, userId); }
  getTransfer(transferId, userId = null) { const row = userId == null ? this.db.prepare('SELECT * FROM transfers WHERE transfer_id = ?').get(transferId) : this.db.prepare('SELECT * FROM transfers WHERE transfer_id = ? AND user_id = ?').get(transferId, userId); return serializeTransfer(row); }
  listTransfers(userId, limit = 50) {
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const rows = userId == null
      ? this.db.prepare(`SELECT * FROM transfers ORDER BY updated_at DESC LIMIT ${safeLimit}`).all()
      : this.db.prepare(`SELECT * FROM transfers WHERE user_id = ? ORDER BY updated_at DESC LIMIT ${safeLimit}`).all(Number(userId));
    return rows.map(serializeTransfer);
  }
  updateTransfer(transferId, patch, userId = null) { const current = this.getTransfer(transferId, userId); if (!current) return null; const next = { ...current, ...patch, updated_at: nowIso() }; this.db.prepare('UPDATE transfers SET phase = ?, completed_bytes = ?, total_bytes = ?, progress_hint = ?, outcome = ?, detail = ?, card_title = ?, rendering_detail = ?, updated_at = ? WHERE transfer_id = ?').run(next.phase, Number(next.completed_bytes) || 0, Number(next.total_bytes) || 0, Math.max(0, Math.min(1, Number(next.progress_hint) || 0)), normalizeText(next.outcome, 'pending', 32), normalizeText(next.detail, '', 512), normalizeText(next.card_title, '花生片正在显影', 128), normalizeText(next.rendering_detail, '', 256), next.updated_at, transferId); return this.getTransfer(transferId, userId); }

  listScheduledPushCandidates(at = nowIso(), limit = 50) {
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const rows = this.db.prepare(`
      SELECT s.id AS stream_id, s.user_id, s.name AS stream_name, si.id AS stream_item_id,
             si.template_id, si.position, si.schedule_type, si.duration_sec, si.start_at,
             d.device_id, d.user_id AS device_user_id, COALESCE(last_push.pushed_at, '') AS last_pushed_at,
             COALESCE(last_push.push_id, 0) AS last_push_id
      FROM streams s
      JOIN stream_items si ON si.stream_id = s.id AND si.enabled = 1
      JOIN devices d ON d.play_stream_id = s.id AND d.user_id = s.user_id
      LEFT JOIN (
        SELECT device_id, stream_item_id, MAX(pushed_at) AS pushed_at, MAX(id) AS push_id
        FROM push_records
        GROUP BY device_id, stream_item_id
      ) last_push ON last_push.device_id = d.device_id AND last_push.stream_item_id = si.id
      WHERE s.enabled = 1
        AND s.mode = 'server_push'
        AND (
          si.schedule_type = 'relative'
          OR
          (si.schedule_type = 'absolute' AND si.start_at IS NOT NULL AND si.start_at <= ? AND (last_push.pushed_at IS NULL OR last_push.pushed_at < si.start_at))
        )
      ORDER BY s.id ASC, d.device_id ASC, si.position ASC
    `).all(at);
    const nowMs = Date.parse(at);
    const candidates = [];
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.stream_id}:${row.device_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    for (const items of groups.values()) {
      const relative = items.filter((item) => item.schedule_type === 'relative').sort((a, b) => a.position - b.position || a.stream_item_id - b.stream_item_id);
      const absolute = items.filter((item) => item.schedule_type === 'absolute' && item.start_at && Date.parse(item.start_at) <= nowMs && (!item.last_pushed_at || item.last_pushed_at < item.start_at)).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || a.position - b.position);
      if (absolute.length) {
        candidates.push(absolute[0]);
        continue;
      }
      if (!relative.length) continue;
      const latest = relative.filter((item) => item.last_pushed_at).sort((a, b) =>
        Date.parse(b.last_pushed_at) - Date.parse(a.last_pushed_at) || b.last_push_id - a.last_push_id
      )[0];
      if (!latest) {
        candidates.push(relative[0]);
        continue;
      }
      const elapsed = (nowMs - Date.parse(latest.last_pushed_at)) / 1000;
      if (!Number.isFinite(elapsed) || elapsed < Math.max(1, Number(latest.duration_sec) || 30)) continue;
      const currentIndex = relative.findIndex((item) => item.stream_item_id === latest.stream_item_id);
      candidates.push(relative[(currentIndex + 1) % relative.length]);
    }
    return candidates.slice(0, safeLimit);
  }

  listStreamPushTargets(streamId, userId, itemId = null) {
    const where = ['s.id = ?', 's.user_id = ?', 'si.enabled = 1'];
    const params = [Number(streamId), Number(userId)];
    if (itemId != null) { where.push('si.id = ?'); params.push(Number(itemId)); }
    return this.db.prepare(`
      SELECT s.id AS stream_id, s.user_id, s.name AS stream_name, si.id AS stream_item_id,
             si.template_id, si.position, si.schedule_type, si.duration_sec, si.start_at,
             d.device_id, d.user_id AS device_user_id, COALESCE(last_push.pushed_at, '') AS last_pushed_at,
             COALESCE(last_push.push_id, 0) AS last_push_id
      FROM streams s
      JOIN stream_items si ON si.stream_id = s.id
      JOIN devices d ON d.play_stream_id = s.id AND d.user_id = s.user_id
      LEFT JOIN (
        SELECT device_id, stream_item_id, MAX(pushed_at) AS pushed_at, MAX(id) AS push_id
        FROM push_records
        GROUP BY device_id, stream_item_id
      ) last_push ON last_push.device_id = d.device_id AND last_push.stream_item_id = si.id
      WHERE ${where.join(' AND ')}
      ORDER BY si.position ASC, d.device_id ASC
    `).all(...params);
  }

  recordPush({ userId = null, deviceId, streamItemId = null, filmPath = '', method = 'scheduled' }) {
    const result = this.db.prepare('INSERT INTO push_records (user_id, device_id, stream_item_id, film_path, method, pushed_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      userId, normalizeText(deviceId, '', 96), streamItemId == null ? null : Number(streamItemId), normalizeText(filmPath, '', 512), normalizeText(method, 'scheduled', 32), nowIso()
    );
    return this.db.prepare('SELECT * FROM push_records WHERE id = ?').get(result.lastInsertRowid);
  }

  listPushRecords(userId, { deviceId = '', streamId = null, limit = 50 } = {}) {
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const where = ['p.user_id = ?'];
    const params = [Number(userId)];
    if (deviceId) { where.push('p.device_id = ?'); params.push(normalizeText(deviceId, '', 96)); }
    if (streamId != null && Number.isSafeInteger(Number(streamId))) { where.push('si.stream_id = ?'); params.push(Number(streamId)); }
    return this.db.prepare(`
      SELECT p.id, p.user_id, p.device_id, p.stream_item_id, p.film_path, p.method, p.pushed_at,
             si.stream_id, si.template_id, si.position, s.name AS stream_name
      FROM push_records p
      LEFT JOIN stream_items si ON si.id = p.stream_item_id
      LEFT JOIN streams s ON s.id = si.stream_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.id DESC
      LIMIT ${safeLimit}
    `).all(...params).map((row) => ({
      id: row.id, userId: row.user_id, deviceId: row.device_id, streamItemId: row.stream_item_id,
      streamId: row.stream_id, streamName: row.stream_name || '', templateId: row.template_id,
      position: row.position, filmPath: row.film_path, method: row.method, pushedAt: row.pushed_at
    }));
  }

  appendEvent(eventType, deviceId, payload = {}) { this.db.prepare('INSERT INTO events (event_type, device_id, payload_json, created_at) VALUES (?, ?, ?, ?)').run(eventType, deviceId || null, json(payload), nowIso()); }
  listEvents(limit = 50, userId = null) {
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const rows = userId == null
      ? this.db.prepare(`SELECT id, event_type, device_id, payload_json, created_at FROM events ORDER BY id DESC LIMIT ${safeLimit}`).all()
      : this.db.prepare(`
          SELECT e.id, e.event_type, e.device_id, e.payload_json, e.created_at
          FROM events e
          LEFT JOIN devices d ON d.device_id = e.device_id
          WHERE d.user_id = ?
             OR (json_valid(e.payload_json) AND (json_extract(e.payload_json, '$.userId') = ? OR json_extract(e.payload_json, '$.user_id') = ?))
          ORDER BY e.id DESC
          LIMIT ${safeLimit}
        `).all(Number(userId), Number(userId), Number(userId));
    return rows.map((row) => ({ id: row.id, type: row.event_type, deviceId: row.device_id, payload: parseJson(row.payload_json), at: row.created_at }));
  }
}

export { hashToken, nowIso, parseJson, serializeDevice, serializeMedia, serializePhoto, serializeUser, serializeTransfer, tokensMatch };
