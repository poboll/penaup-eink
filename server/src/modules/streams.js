/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */

export function streamPayload(input = {}) {
  return {
    name: String(input.name || '').trim().slice(0, 128),
    mode: input.mode === 'server_push' ? 'server_push' : 'device_pull',
    enabled: input.enabled !== false
  };
}
