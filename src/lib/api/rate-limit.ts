import { z } from 'zod';

/** Returns true if the string is a valid UUID v4. */
export function isValidUUID(id: string): boolean {
  return z.string().uuid().safeParse(id).success;
}

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
 * @param userId    Per-user identifier (or IP for unauthenticated routes)
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

/** Extract client IP from request headers (works behind proxies). */
export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    '127.0.0.1'
  );
}

/** Standard 429 JSON response. */
export function rateLimitResponse() {
  return new Response(
    JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
    { status: 429, headers: { 'Content-Type': 'application/json' } }
  );
}
