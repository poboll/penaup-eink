/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */

// A bounded fixed-window limiter is enough for the single-process runtime.
// It protects public API bursts without adding Redis or making device heartbeats
// depend on a network service.
export function createRateLimiter({ windowMs = 60_000, max = 120, maxKeys = 4096, now = () => Date.now() } = {}) {
  const buckets = new Map();
  let lastPruneAt = 0;

  function prune(currentTime) {
    if (currentTime - lastPruneAt < windowMs) return;
    lastPruneAt = currentTime;
    for (const [key, bucket] of buckets) {
      if (currentTime >= bucket.resetAt) buckets.delete(key);
    }
    while (buckets.size > maxKeys) {
      const first = buckets.keys().next().value;
      if (first === undefined) break;
      buckets.delete(first);
    }
  }

  function consume(key) {
    const currentTime = now();
    const normalizedKey = String(key || 'anonymous').slice(0, 160);
    prune(currentTime);

    let bucket = buckets.get(normalizedKey);
    if (!bucket || currentTime >= bucket.resetAt) {
      bucket = { count: 0, resetAt: currentTime + windowMs };
      buckets.set(normalizedKey, bucket);
    }
    bucket.count += 1;

    while (buckets.size > maxKeys) {
      const first = buckets.keys().next().value;
      if (first === undefined) break;
      buckets.delete(first);
    }

    const allowed = bucket.count <= max;
    return {
      allowed,
      limit: max,
      remaining: Math.max(0, max - bucket.count),
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000))
    };
  }

  return {
    consume,
    size: () => buckets.size,
    reset: () => buckets.clear()
  };
}
