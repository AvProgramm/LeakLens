/**
 * cache.js
 * Minimal in-memory TTL cache. XON allows only 2 req/sec, 25/hour,
 * 100/day per IP — during a hackathon demo where multiple teammates
 * hit the same test emails repeatedly, this alone can save the demo.
 * Not for production (no eviction beyond lazy-expiry, resets on
 * restart) — good enough for a hackathon build.
 */

const store = new Map();
const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export { get, set };