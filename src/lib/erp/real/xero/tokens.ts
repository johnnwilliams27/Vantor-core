import type { TokenResponse } from './schemas';

/**
 * A token is "expiring soon" if it will expire within 60 seconds of now.
 * This is the threshold at which we trigger a proactive refresh before
 * making an API call.
 */
export function isExpiringSoon(expiresAt: Date): boolean {
  const cutoff = new Date(Date.now() + 60_000);
  return expiresAt.getTime() < cutoff.getTime();
}

export function computeExpiresAt(expiresInSeconds: number): Date {
  return new Date(Date.now() + expiresInSeconds * 1000);
}

/**
 * In-process per-connection refresh mutex. When a refresh is already in
 * flight for a given connection, concurrent callers await the same promise
 * instead of issuing a second refresh request.
 */
const inFlightRefreshes = new Map<string, Promise<TokenResponse>>();

export function tryAcquireRefreshLock(
  connectionId: string,
  doRefresh: () => Promise<TokenResponse>,
): Promise<TokenResponse> {
  const existing = inFlightRefreshes.get(connectionId);
  if (existing) return existing;
  const promise = (async () => {
    try {
      return await doRefresh();
    } finally {
      inFlightRefreshes.delete(connectionId);
    }
  })();
  inFlightRefreshes.set(connectionId, promise);
  return promise;
}

/** Test-only: reset the in-process mutex map between tests. */
export function __resetMutexForTests(): void {
  inFlightRefreshes.clear();
}
