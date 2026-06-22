"use strict";

// Shared in-process user cache — referenced by both auth middleware (reads)
// and the User model post-hooks (writes + invalidations).
// TTL keeps stale data < 30 s; fine for subscription/ban propagation.

const _cache = new Map();
const TTL_MS = 30_000;

function get(id) {
  const entry = _cache.get(String(id));
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) { _cache.delete(String(id)); return null; }
  return entry.user;
}

function set(id, user) {
  _cache.set(String(id), { user, ts: Date.now() });
  // Evict stale entries once the cache grows large.
  if (_cache.size > 1000) {
    const cutoff = Date.now() - TTL_MS;
    for (const [k, v] of _cache) { if (v.ts < cutoff) _cache.delete(k); }
  }
}

function invalidate(id) {
  if (id) _cache.delete(String(id));
}

module.exports = { get, set, invalidate };
