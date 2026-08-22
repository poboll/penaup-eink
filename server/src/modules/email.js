/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */

function validDeliveryUrl(value, production) {
  try {
    const url = new URL(value);
    if (production && url.protocol !== 'https:') return null;
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

export function createEmailDelivery({ config, logger = console }) {
  const provider = String(config.authEmailProvider || 'none').trim().toLowerCase();
  const production = config.nodeEnv === 'production';

  return {
    provider,
    async send({ email, code, expiresAt, challengeId }) {
      // Development can deliberately return the code in the API response. It
      // is disabled automatically for NODE_ENV=production.
      if (config.authExposeDevCode && !production) return { delivered: false, mode: 'dev_code' };
      if (provider !== 'webhook') throw new Error('email_delivery_not_configured');

      const endpoint = validDeliveryUrl(config.authEmailWebhookUrl, production);
      if (!endpoint) throw new Error('email_webhook_url_invalid');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const headers = { 'content-type': 'application/json' };
        if (config.authEmailWebhookToken) headers.authorization = `Bearer ${config.authEmailWebhookToken}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            to: email,
            from: config.authEmailFrom || undefined,
            subject: '花生片 Penaup 登录验证码',
            text: `你的花生片 Penaup 登录验证码是 ${code}，将在 10 分钟后失效。`,
            challenge_id: challengeId,
            expires_at: expiresAt
          }),
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`email_delivery_failed_${response.status}`);
        return { delivered: true, mode: 'webhook' };
      } catch (error) {
        logger?.warn?.({ err: error }, 'Penaup email delivery failed');
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
