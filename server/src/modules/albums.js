/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */

export function albumPayload(input = {}) {
  return {
    name: String(input.name || '').trim().slice(0, 128),
    description: String(input.description || '').trim().slice(0, 1000),
    ditherType: String(input.ditherType || input.dither_type || 'adaptive').slice(0, 32),
    ditherStrength: Math.min(100, Math.max(0, Number(input.ditherStrength ?? input.dither_strength ?? 80) || 80))
  };
}
