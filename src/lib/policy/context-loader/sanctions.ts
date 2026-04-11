// src/lib/policy/context-loader/sanctions.ts

import { SanctionsSnapshot } from '../types/context';
import { SanctionsStatus } from '../types/ir';

/**
 * Row returned by the latest-screening query. The adapter (Plan 2)
 * wraps the real sanctions_screenings table; tests supply a mock.
 */
export interface SanctionsScreeningRow {
  counterparty_id: string;
  result: SanctionsStatus;
  screened_at: Date;
}

export interface SanctionsDeps {
  fetchLatestScreening: (
    enterpriseId: string,
    counterpartyId: string,
  ) => Promise<SanctionsScreeningRow | null>;
}

/**
 * Load the latest sanctions screening for a proposed movement's
 * counterparty. Returns a SanctionsSnapshot that's always populated —
 * the evaluator's sanctions_status leaf reads this directly.
 *
 * Never throws. On fetch error, returns a snapshot with `status='unscreened'`
 * AND a `failure` field set. The sanctions_status leaf checks `failure`
 * first and treats this as cannot-fully-evaluate (fail-closed).
 *
 * When no counterparty is provided (movement has no counterparty
 * reference), returns `{status: 'unscreened'}` with no failure. A rule
 * like `sanctions_status in ['sanctioned']` correctly evaluates false
 * for the absent-counterparty case; a rule like
 * `sanctions_status not_in ['clear']` correctly fires (unscreened is
 * not clear).
 */
export async function loadSanctions(
  enterpriseId: string,
  counterpartyId: string | undefined,
  deps: SanctionsDeps,
): Promise<SanctionsSnapshot> {
  if (!counterpartyId) {
    return { status: 'unscreened' };
  }

  try {
    const row = await deps.fetchLatestScreening(enterpriseId, counterpartyId);
    if (!row) {
      // Counterparty exists but has no screening record yet
      return { counterparty_id: counterpartyId, status: 'unscreened' };
    }
    return {
      counterparty_id: counterpartyId,
      status: row.result,
      screened_at: row.screened_at,
    };
  } catch (err) {
    return {
      counterparty_id: counterpartyId,
      status: 'unscreened',
      failure: {
        reason_code: 'sanctions_status_unavailable',
        human_readable: `Failed to load sanctions screening: ${err instanceof Error ? err.message : String(err)}`,
        details: { counterparty_id: counterpartyId },
      },
    };
  }
}
