'use strict';
// Small in-memory sliding-window limiter. Fine for a single-process home server.
function createLimiter({ windowMs, max }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, arr] of hits) {
      const fresh = arr.filter((t) => t > cutoff);
      if (fresh.length) hits.set(k, fresh); else hits.delete(k);
    }
  }, Math.max(windowMs, 10000));
  timer.unref();
  return {
    take(key) {
      const now = Date.now();
      const arr = (hits.get(key) || []).filter((t) => t > now - windowMs);
      if (arr.length >= max) {
        hits.set(key, arr);
        return { ok: false, retryAfter: Math.ceil((arr[0] + windowMs - now) / 1000) };
      }
      arr.push(now);
      hits.set(key, arr);
      return { ok: true };
    },
    reset(key) { hits.delete(key); },
  };
}
function middleware(limiter, keyFn, message) {
  return (req, res, next) => {
    const r = limiter.take(keyFn(req));
    if (r.ok) return next();
    res.set('Retry-After', String(r.retryAfter));
    res.status(429).json({ error: { code: 'rate_limited', message: message || 'Too many requests. Please slow down.' } });
  };
}
module.exports = { createLimiter, middleware };
