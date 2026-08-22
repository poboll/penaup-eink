/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 */
import crypto from 'node:crypto';
import { hashToken, normalizeEmail } from '../db.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function constantMatch(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  return header.split(';').reduce((result, part) => {
    const index = part.indexOf('=');
    if (index < 0) return result;
    const key = part.slice(0, index).trim();
    try { result[key] = decodeURIComponent(part.slice(index + 1).trim()); } catch { result[key] = ''; }
    return result;
  }, {});
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value || '')}`, `Path=${options.path || '/'}`, `SameSite=${options.sameSite || 'Lax'}`];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function body(request) { return request.body && typeof request.body === 'object' ? request.body : {}; }

function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function createAuthService({ database, config, emailDelivery, logger }) {
  const inviteEmails = new Set(String(config.inviteEmails || '').split(',').map((value) => normalizeEmail(value)).filter(Boolean));

  function accessToken(request) {
    const authorization = request.headers.authorization || '';
    if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim();
    return parseCookies(request.headers.cookie || {}).penaup_session || '';
  }

  function refreshToken(request) {
    const input = body(request);
    return String(input.refresh_token || input.refreshToken || parseCookies(request.headers.cookie || {}).penaup_refresh || '').trim();
  }

  function cookieWriteIsProtected(request) {
    const authorization = String(request.headers.authorization || '');
    if (/^Bearer\s+\S+$/i.test(authorization)) return true;
    const cookies = parseCookies(request.headers.cookie || '');
    return constantMatch(cookies.penaup_csrf, request.headers['x-csrf-token']);
  }

  function userForRequest(request) {
    const token = accessToken(request);
    if (!token) return null;
    const session = database.findSession(token, 'access');
    if (!session || session.status === 'disabled') return null;
    return { id: session.user_id, email: session.email, role: session.role || 'user', status: session.status || 'active' };
  }

  function adminTokenMatches(request) {
    // A development runtime bound only to loopback intentionally has no
    // token requirement. Keep this decision in one place so legacy admin
    // routes and SSE cannot disagree with the primary admin API.
    if (!config.adminToken) return config.nodeEnv !== 'production' && isLoopbackHost(config.host);
    const authorization = request.headers.authorization || '';
    const received = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    return constantMatch(config.adminToken, received);
  }

  async function requireAdmin(request, reply) {
    if (!config.adminToken && (config.nodeEnv === 'production' || !isLoopbackHost(config.host))) {
      return reply.code(503).send({ ok: false, error: 'admin_token_required_for_network_listener' });
    }
    if (!adminTokenMatches(request)) {
      return reply.code(401).send({ ok: false, error: 'admin_auth_required' });
    }
  }

  async function requireUser(request, reply) {
    const user = userForRequest(request);
    if (!user) return reply.code(401).send({ ok: false, error: 'authentication_required' });
    const authorization = String(request.headers.authorization || '');
    const bearerRequest = /^Bearer\s+\S+$/i.test(authorization);
    if (request.method !== 'GET' && request.method !== 'HEAD' && !bearerRequest) {
      const cookies = parseCookies(request.headers.cookie || {});
      if (!constantMatch(cookies.penaup_csrf, request.headers['x-csrf-token'])) return reply.code(403).send({ ok: false, error: 'csrf_required' });
    }
    request.penaupUser = user;
  }

  async function requireUserOrAdmin(request, reply) {
    if (adminTokenMatches(request)) { request.penaupAdmin = true; return; }
    return requireUser(request, reply);
  }

  function createTokens(userId) {
    const access = crypto.randomBytes(32).toString('base64url');
    const refresh = crypto.randomBytes(48).toString('base64url');
    const csrf = crypto.randomBytes(24).toString('base64url');
    const accessExpiresAt = new Date(Date.now() + config.accessTtlSeconds * 1000).toISOString();
    const refreshExpiresAt = new Date(Date.now() + config.refreshTtlSeconds * 1000).toISOString();
    database.createSession(userId, access, 'access', accessExpiresAt);
    database.createSession(userId, refresh, 'refresh', refreshExpiresAt);
    return { access, refresh, csrf, accessExpiresAt, refreshExpiresAt };
  }

  function setAuthCookies(reply, tokens) {
    reply.header('Set-Cookie', [
      cookie('penaup_session', tokens.access, { httpOnly: true, secure: config.cookieSecure, maxAge: config.accessTtlSeconds }),
      cookie('penaup_refresh', tokens.refresh, { httpOnly: true, secure: config.cookieSecure, maxAge: config.refreshTtlSeconds }),
      cookie('penaup_csrf', tokens.csrf, { secure: config.cookieSecure, maxAge: config.refreshTtlSeconds })
    ]);
  }

  function clearAuthCookies(reply) {
    reply.header('Set-Cookie', [cookie('penaup_session', '', { httpOnly: true, secure: config.cookieSecure, maxAge: 0 }), cookie('penaup_refresh', '', { httpOnly: true, secure: config.cookieSecure, maxAge: 0 }), cookie('penaup_csrf', '', { secure: config.cookieSecure, maxAge: 0 })]);
  }

  function inviteAllowed(email, inviteToken = '') {
    if (inviteEmails.has(normalizeEmail(email))) return true;
    if (inviteToken) return Boolean(database.findInviteByToken(inviteToken, email));
    return Boolean(database.findUsableInvite(email));
  }

  async function register(app) {
    app.post('/api/v1/auth/challenges', async (request, reply) => {
      const input = body(request);
      const email = normalizeEmail(input.email);
      if (!EMAIL_RE.test(email)) return reply.code(400).send({ ok: false, error: 'valid_email_required' });
      if (!database.findUserByEmail(email) && !inviteAllowed(email, input.invite_token || input.inviteToken)) return reply.code(403).send({ ok: false, error: 'invite_required' });
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      if (database.countRecentChallengesByEmail(email, since) >= 5 || database.countRecentChallengesByIp(request.ip, since) >= 5) {
        return reply.code(429).send({ ok: false, error: 'challenge_rate_limited' });
      }
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const expiresAt = new Date(Date.now() + config.challengeTtlSeconds * 1000).toISOString();
      const challengeId = database.createChallenge({ email, codeHash: hashToken(code), ip: request.ip, expiresAt });
      try {
        await emailDelivery.send({ email, code, expiresAt, challengeId });
      } catch (error) {
        database.invalidateChallenge(challengeId);
        if (logger?.warn) logger.warn({ err: error }, 'Penaup auth challenge delivery unavailable');
        return reply.code(503).send({ ok: false, error: 'email_delivery_unavailable' });
      }
      const response = { ok: true, data: { challenge_id: challengeId, expires_at: expiresAt, delivery: 'email' } };
      if (config.authExposeDevCode) response.data.dev_code = code;
      return reply.code(202).send(response);
    });

    app.post('/api/v1/auth/verify', async (request, reply) => {
      const input = body(request);
      const challenge = database.getChallenge(input.challenge_id || input.challengeId);
      const code = String(input.code || '').trim();
      if (!challenge || challenge.used_at || Date.parse(challenge.expires_at) <= Date.now() || challenge.attempts >= 5) return reply.code(400).send({ ok: false, error: 'challenge_expired_or_invalid' });
      database.incrementChallengeAttempt(challenge.id);
      if (!/^\d{6}$/.test(code) || !constantMatch(challenge.code_hash, hashToken(code))) return reply.code(401).send({ ok: false, error: 'verification_code_invalid' });
      if (!database.consumeChallenge(challenge.id)) return reply.code(401).send({ ok: false, error: 'challenge_already_used' });
      const invite = database.findUsableInvite(challenge.email);
      const user = database.findUserByEmail(challenge.email) || database.createUser(challenge.email);
      if (invite) database.consumeInvite(invite.id);
      const tokens = createTokens(user.id);
      setAuthCookies(reply, tokens);
      return { ok: true, data: { user: database.serializeUser(user.id), access_token: tokens.access, refresh_token: tokens.refresh, token_type: 'Bearer', expires_at: tokens.accessExpiresAt, refresh_expires_at: tokens.refreshExpiresAt } };
    });

    app.post('/api/v1/auth/refresh', async (request, reply) => {
      if (!cookieWriteIsProtected(request)) return reply.code(403).send({ ok: false, error: 'csrf_required' });
      const oldRefresh = refreshToken(request);
      const session = oldRefresh ? database.findSession(oldRefresh, 'refresh') : null;
      if (!session) return reply.code(401).send({ ok: false, error: 'refresh_token_invalid' });
      database.revokeSession(oldRefresh);
      const tokens = createTokens(session.user_id);
      setAuthCookies(reply, tokens);
      return { ok: true, data: { access_token: tokens.access, refresh_token: tokens.refresh, token_type: 'Bearer', expires_at: tokens.accessExpiresAt, refresh_expires_at: tokens.refreshExpiresAt } };
    });

    app.post('/api/v1/auth/logout', async (request, reply) => {
      if (!cookieWriteIsProtected(request)) return reply.code(403).send({ ok: false, error: 'csrf_required' });
      const access = accessToken(request); const refresh = refreshToken(request);
      if (access) database.revokeSession(access); if (refresh) database.revokeSession(refresh);
      clearAuthCookies(reply); return { ok: true };
    });
    app.get('/api/v1/me', { preHandler: requireUser }, async (request) => ({ ok: true, data: database.serializeUser(request.penaupUser.id) }));

    app.post('/api/v1/admin/invites', { preHandler: requireAdmin }, async (request, reply) => {
      const input = body(request); const email = input.email ? normalizeEmail(input.email) : null;
      if (input.email && !EMAIL_RE.test(email)) return reply.code(400).send({ ok: false, error: 'valid_email_required' });
      return { ok: true, data: database.createInvite(email, Math.min(30 * 86400, Math.max(300, Number(input.ttl_seconds) || 86400))) };
    });
  }

  return { register, accessToken, refreshToken, userForRequest, adminTokenMatches, requireAdmin, requireUser, requireUserOrAdmin, setAuthCookies, clearAuthCookies };
}
