/**
 * cache.js
 * Short-lived in-memory result cache. XposedOrNot allows only 25 requests
 * per hour per IP without a key, so during a demo where the same handful of
 * test emails get checked repeatedly this is what keeps the tool answering.
 *
 * PRIVACY: the plaintext email is never used as a key and never stored.
 * We key on a SHA-256 hash of it, so the cache can recognise a repeat
 * lookup without holding the address itself. This is what lets the UI
 * honestly say the email is not retained: an attacker with a heap dump
 * gets hashes, and the cached value is the breach report, not the identity.
 *
 * Entries are actively swept rather than only expiring when the same key is
 * read again - otherwise an email looked up once and never repeated would
 * sit in memory until the process restarted.
 */

import { createHash } from 'node:crypto';
import { CACHE_TTL_MS } from './config.js';

const cacheEntriesByHashedKey = new Map();

// A hard ceiling so a scripted flood cannot grow the map without bound even
// inside a single TTL window. Oldest entries are dropped first.
const MAX_CACHE_ENTRIES = 500;

// How often expired entries are proactively removed.
const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Hash the lookup key so the cache never holds a plaintext email address.
 */
function hashKey(plaintextKey) {
  return createHash('sha256').update(String(plaintextKey)).digest('hex');
}

function get(key) {
  const entry = cacheEntriesByHashedKey.get(hashKey(key));
  if (!entry) return undefined;

  if (Date.now() > entry.expiresAt) {
    cacheEntriesByHashedKey.delete(hashKey(key));
    return undefined;
  }

  return entry.value;
}

function set(key, value, ttlMs = CACHE_TTL_MS) {
  // Evict the oldest entry once the ceiling is reached. Map preserves
  // insertion order, so the first key is always the oldest.
  if (cacheEntriesByHashedKey.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cacheEntriesByHashedKey.keys().next().value;
    cacheEntriesByHashedKey.delete(oldestKey);
  }

  cacheEntriesByHashedKey.set(hashKey(key), {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Drop everything that has expired. Called on a timer so data leaves memory
 * on schedule rather than waiting for a coincidental repeat lookup.
 */
function sweepExpiredEntries(now = Date.now()) {
  let removedCount = 0;
  for (const [hashedKey, entry] of cacheEntriesByHashedKey) {
    if (now > entry.expiresAt) {
      cacheEntriesByHashedKey.delete(hashedKey);
      removedCount += 1;
    }
  }
  return removedCount;
}

function clear() {
  cacheEntriesByHashedKey.clear();
}

function size() {
  return cacheEntriesByHashedKey.size;
}

// unref() keeps this timer from holding the process open, so `npm test` and
// Ctrl-C both exit cleanly instead of hanging on a live interval.
const sweepTimer = setInterval(sweepExpiredEntries, SWEEP_INTERVAL_MS);
if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

export { get, set, clear, size, sweepExpiredEntries, MAX_CACHE_ENTRIES };
