/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */

export function templatePayload(input = {}) {
  return {
    name: String(input.name || '').trim().slice(0, 128),
    kind: String(input.kind || 'custom').trim().slice(0, 32),
    definition: input.definition && typeof input.definition === 'object' ? input.definition : {},
    renderConfig: input.renderConfig || input.render_config || {},
    thumbPath: String(input.thumbPath || input.thumb_path || '').slice(0, 512)
  };
}
