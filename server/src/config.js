import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(runtimeDir, '../..');

function integerFromEnv(name, fallback, minimum, maximum) {
  const value = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

export function createConfig(overrides = {}) {
  const dataDir = path.resolve(
    overrides.dataDir || process.env.PENAUP_DATA_DIR || path.join(projectRoot, 'server', 'data')
  );

  return {
    nodeEnv: overrides.nodeEnv || process.env.NODE_ENV || 'development',
    host: overrides.host || process.env.PENAUP_HOST || '127.0.0.1',
    port: overrides.port || integerFromEnv('PENAUP_PORT', 8787, 1, 65535),
    dataDir,
    databasePath: overrides.databasePath || path.join(dataDir, 'penaup.db'),
    mediaDir: overrides.mediaDir || path.join(dataDir, 'media'),
    webRoot: overrides.webRoot || path.join(projectRoot, 'apps', 'web'),
    assetsRoot: overrides.assetsRoot || path.join(projectRoot, 'assets'),
    adminWebRoot: overrides.adminWebRoot || path.join(projectRoot, 'server', 'admin', 'dist'),
    adminToken: overrides.adminToken ?? process.env.PENAUP_ADMIN_TOKEN ?? '',
    authExposeDevCode: (overrides.authExposeDevCode ?? process.env.PENAUP_AUTH_EXPOSE_DEV_CODE === '1') && (overrides.nodeEnv || process.env.NODE_ENV || 'development') !== 'production',
    authEmailProvider: overrides.authEmailProvider ?? process.env.PENAUP_EMAIL_PROVIDER ?? 'none',
    authEmailFrom: overrides.authEmailFrom ?? process.env.PENAUP_EMAIL_FROM ?? '',
    authEmailWebhookUrl: overrides.authEmailWebhookUrl ?? process.env.PENAUP_EMAIL_WEBHOOK_URL ?? '',
    authEmailWebhookToken: overrides.authEmailWebhookToken ?? process.env.PENAUP_EMAIL_WEBHOOK_TOKEN ?? '',
    cookieSecure: overrides.cookieSecure ?? ((overrides.nodeEnv || process.env.NODE_ENV || 'development') === 'production' || process.env.PENAUP_COOKIE_SECURE === '1'),
    allowedOrigins: overrides.allowedOrigins ?? process.env.PENAUP_ALLOWED_ORIGINS ?? '',
    inviteEmails: overrides.inviteEmails ?? process.env.PENAUP_INVITE_EMAILS ?? '',
    userQuotaBytes: overrides.userQuotaBytes || integerFromEnv('PENAUP_USER_QUOTA_BYTES', 512 * 1024 * 1024, 1 * 1024 * 1024, 10 * 1024 * 1024 * 1024),
    originalUploadLimit: overrides.originalUploadLimit || integerFromEnv('PENAUP_ORIGINAL_UPLOAD_LIMIT', 16 * 1024 * 1024, 1024 * 1024, 64 * 1024 * 1024),
    challengeTtlSeconds: overrides.challengeTtlSeconds || integerFromEnv('PENAUP_CHALLENGE_TTL', 600, 60, 3600),
    accessTtlSeconds: overrides.accessTtlSeconds || integerFromEnv('PENAUP_ACCESS_TTL', 900, 300, 3600),
    refreshTtlSeconds: overrides.refreshTtlSeconds || integerFromEnv('PENAUP_REFRESH_TTL', 30 * 24 * 3600, 3600, 180 * 24 * 3600),
    heartbeatInterval: overrides.heartbeatInterval || integerFromEnv('PENAUP_HEARTBEAT_INTERVAL', 60, 5, 180),
    mqttUrl: overrides.mqttUrl ?? process.env.PENAUP_MQTT_URL ?? '',
    mqttUsername: overrides.mqttUsername ?? process.env.PENAUP_MQTT_USERNAME ?? '',
    mqttPassword: overrides.mqttPassword ?? process.env.PENAUP_MQTT_PASSWORD ?? '',
    mqttTopicPrefix: overrides.mqttTopicPrefix || process.env.PENAUP_MQTT_TOPIC_PREFIX || 'penaup/device',
    schedulerIntervalMs: overrides.schedulerIntervalMs ?? integerFromEnv('PENAUP_SCHEDULER_INTERVAL_MS', 15000, 1000, 300000),
    aiBaseUrl: overrides.aiBaseUrl ?? process.env.PENAUP_AI_BASE_URL ?? '',
    aiApiKey: overrides.aiApiKey ?? process.env.PENAUP_AI_API_KEY ?? '',
    aiTimeoutMs: overrides.aiTimeoutMs || integerFromEnv('PENAUP_AI_TIMEOUT_MS', 20000, 3000, 60000),
    logLevel: overrides.logLevel || process.env.PENAUP_LOG_LEVEL || 'info'
  };
}

export async function ensureRuntimeDirectories(config) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(config.dataDir, { recursive: true });
  await mkdir(config.mediaDir, { recursive: true });
}
