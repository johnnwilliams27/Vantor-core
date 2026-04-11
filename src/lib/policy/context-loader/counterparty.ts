// src/lib/policy/context-loader/counterparty.ts

import { CounterpartyHistoryRecord } from '../types/context';

/**
 * Row returned by the counterparty history query. The adapter (Plan 2)
 * wraps the real DB client; tests supply a mock.
 */
export interface CounterpartyHistoryRow {
  id: string;
  first_seen_at?: Date;
  last_transfer_at?: Date;
  total_volume_usd?: string;
  transfer_count?: number;
}

export interface CounterpartyDeps {
  fetchCounterpartyHistory: (
    enterpriseId: string,
    counterpartyId: string,
  ) => Promise<CounterpartyHistoryRow | null>;
}

/**
 * Load counterparty history for a proposed movement. Returns undefined
 * when no counterparty id is provided (the movement has no counterparty
 * reference — e.g., some internal transfers).
 *
 * Never throws. On fetch error, returns a minimal record with a
 * populated `failure` field so the caller can surface the degradation
 * without blocking evaluation.
 */
export async function loadCounterparty(
  enterpriseId: string,
  counterpartyId: string | undefined,
  deps: CounterpartyDeps,
): Promise<CounterpartyHistoryRecord | undefined> {
  if (!counterpartyId) return undefined;

  try {
    const row = await deps.fetchCounterpartyHistory(enterpriseId, counterpartyId);
    if (!row) {
      // New/unknown counterparty — return the minimal record so the
      // evaluator can still reference counterparty.id in rules, but
      // any time-based attributes (first_seen_at, last_transfer_at)
      // remain undefined.
      return { id: counterpartyId };
    }
    return {
      id: row.id,
      first_seen_at: row.first_seen_at,
      last_transfer_at: row.last_transfer_at,
      total_volume_usd: row.total_volume_usd,
      transfer_count: row.transfer_count,
    };
  } catch (err) {
    return {
      id: counterpartyId,
      failure: {
        reason_code: 'counterparty_lookup_failed',
        human_readable: `Failed to load counterparty history: ${err instanceof Error ? err.message : String(err)}`,
        details: { counterparty_id: counterpartyId },
      },
    };
  }
}
