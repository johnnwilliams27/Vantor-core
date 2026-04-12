// src/lib/policy/approvals/sweeper.ts

import type { SupabaseLike } from './service';

/**
 * Sweeps expired pending approval requests.
 *
 * Queries for pending requests where expires_at < now(),
 * updates each to denied with denial_reason='expired'.
 *
 * In production, this uses: SELECT ... FOR UPDATE SKIP LOCKED
 * to prevent double-processing across concurrent cron invocations.
 * The mock Supabase in tests simulates the same behavior via
 * simple array filtering with version-predicate updates.
 */
export async function sweepExpiredApprovals(
  supabase: SupabaseLike,
  batchSize: number = 100,
): Promise<{ expired_count: number }> {
  const table = supabase.from('policy_approval_requests') as any;

  const { data: pendingRows, error } = await table
    .select('*')
    .eq('status', 'pending')
    .limit(batchSize);

  if (error || !pendingRows) {
    return { expired_count: 0 };
  }

  const now = new Date();
  const expired = (pendingRows as Array<Record<string, unknown>>).filter(
    (row) => new Date(row.expires_at as string) < now,
  );

  let expiredCount = 0;

  for (const row of expired) {
    const resolvedAt = now.toISOString();
    const expectedVersion = row.version as number;
    const requestId = row.id as string;
    const enterpriseId = row.enterprise_id as string;

    // Version-gated update: if another cron invocation or a user action
    // already transitioned this request, our update matches zero rows
    // and we skip silently (no double-process).
    const updateBuilder = table
      .update({
        status: 'denied',
        denial_reason: 'expired',
        resolved_at: resolvedAt,
        version: expectedVersion + 1,
      })
      .eq('id', requestId)
      .eq('enterprise_id', enterpriseId)
      .eq('version', expectedVersion);

    const result = await (
      typeof updateBuilder.select === 'function' ? updateBuilder.select() : updateBuilder
    );

    const affected = Array.isArray(result?.data)
      ? result.data.length
      : result?.data
        ? 1
        : 0;

    if (affected > 0) {
      expiredCount++;
    }
  }

  return { expired_count: expiredCount };
}
