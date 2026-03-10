/**
 * Simple in-memory rate limiter.
 * Resets on server restart. Good enough for single-instance dev/prod.
 * For multi-instance deployments, swap the Map for Redis.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

function getStore(key: string): Map<string, RateLimitEntry> {
  if (!stores.has(key)) stores.set(key, new Map());
  return stores.get(key)!;
}

/**
 * Returns true if the request is allowed, false if rate limited.
 * @param storeKey  Identifies the limit bucket (e.g. 'agent-chat')
 * @param userId    Per-user identifier
 * @param max       Max requests allowed in the window
 * @param windowMs  Window duration in milliseconds
 */
export function checkRateLimit(
  storeKey: string,
  userId: string,
  max: number,
  windowMs: number
): boolean {
  const store = getStore(storeKey);
  const now = Date.now();
  const entry = store.get(userId);

  if (!entry || now - entry.windowStart > windowMs) {
    store.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}
