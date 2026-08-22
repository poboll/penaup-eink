/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */

export const AI_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'none', name: '本地模板', enabled: true }),
  Object.freeze({ id: 'compatible', name: 'OpenAI-compatible provider', enabled: false })
]);

export const PENAUP_AI_SYSTEM_PROMPT = [
  '你是花生片 Penaup 的彩色电子纸拍立得创作助手。',
  '产品使用六种基础电子纸颜料：黑、白、黄、红、蓝、绿。通过叠色、网点和抖动，画面可以呈现 48 种丰富的色彩观感；这不是新增 42 种独立墨水，.film 文件仍只使用六色基础索引。',
  '电子纸主要在写入和刷新时耗电，画面停住后不需要像手机屏幕一样持续点亮。不要把产品描述成“颜色少”或“完全零能耗”。',
  '当用户请求模板、相纸或版式时，优先给出克制、留白充足、适合低分辨率电子纸阅读的结果，并只使用黑白灰和少量六色强调。',
  '如果请求 JSON 模板，必须只输出合法 JSON，不要包裹 Markdown；否则使用简洁、温和、可执行的中文。'
].join('\n');

export function sanitizeAiSettings(input = {}) {
  const provider = input.provider === 'compatible' ? 'compatible' : 'none';
  return {
    provider,
    model: String(input.model || '').slice(0, 128),
    configured: provider === 'none' ? false : Boolean(input.configured)
  };
}

function text(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }

export function createAiService({ config, database, fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = text(config?.aiBaseUrl || '', 512).replace(/\/+$/, '');
  const apiKey = text(config?.aiApiKey || '', 512);
  const timeoutMs = Math.min(60000, Math.max(3000, Number(config?.aiTimeoutMs) || 20000));

  function providerState() {
    return AI_PROVIDERS.map((provider) => ({
      ...provider,
      enabled: provider.id === 'none' || (provider.id === 'compatible' && Boolean(baseUrl && apiKey))
    }));
  }

  function settings(userId) {
    const stored = database?.getSetting('ai', userId) || { provider: 'none', model: '', configured: false };
    const safe = sanitizeAiSettings(stored);
    return { ...safe, configured: safe.provider === 'compatible' ? Boolean(baseUrl && apiKey) : false };
  }

  async function generate(userId, input = {}) {
    const prompt = text(input.prompt, 4000);
    if (!prompt) return { ok: false, status: 400, error: 'prompt_required' };
    const stored = settings(userId);
    const provider = input.provider === 'compatible' ? 'compatible' : stored.provider;
    if (provider !== 'compatible') return { ok: false, status: 503, error: 'ai_provider_not_configured', detail: '请先配置受信任的 AI provider。' };
    if (!baseUrl || !apiKey || typeof fetchImpl !== 'function') return { ok: false, status: 503, error: 'ai_provider_not_configured', detail: 'OpenAI-compatible provider 尚未配置。' };
    const model = text(input.model || stored.model, 128);
    if (!model) return { ok: false, status: 400, error: 'ai_model_required' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: PENAUP_AI_SYSTEM_PROMPT },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7
        }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, status: 502, error: 'ai_provider_request_failed', detail: text(payload.error?.message || payload.message || `provider_http_${response.status}`, 256) };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) return { ok: false, status: 502, error: 'ai_provider_empty_response' };
      return { ok: true, data: { provider, model, content: content.slice(0, 12000), usage: payload.usage || null } };
    } catch (error) {
      return { ok: false, status: 502, error: error?.name === 'AbortError' ? 'ai_provider_timeout' : 'ai_provider_unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }

  return { providerState, settings, generate };
}
