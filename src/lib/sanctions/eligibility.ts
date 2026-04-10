import { createAdminClient } from '@/lib/supabase/admin';
import { getSanctionsConfig, type Counterparty } from './types';
import { screenCounterpartyOnboarding } from './onboarding';

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  stale_rescreen?: boolean;
}

/**
 * Pre-transfer eligibility check. Reads local state only.
 * If the last screening is older than the staleness threshold,
 * triggers an inline re-screen before returning.
 */
export async function checkTransferEligibility(
  counterpartyId: string,
  enterpriseId: string,
  userId: string,
): Promise<EligibilityResult> {
  const supabase = createAdminClient();
  const config = getSanctionsConfig();

  const { data: counterparty, error } = await supabase
    .from('counterparties')
    .select('*')
    .eq('id', counterpartyId)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (error || !counterparty) {
    return { eligible: false, reason: 'counterparty_not_found' };
  }

  const cp = counterparty as Counterparty;

  // Blocked counterparties are never eligible
  if (cp.screening_status === 'blocked') {
    return { eligible: false, reason: 'blocked' };
  }

  // Pending counterparties (never screened) are not eligible
  if (cp.screening_status === 'pending') {
    return { eligible: false, reason: 'pending_screening' };
  }

  // If flagged with transfer_eligible=false, block
  if (!cp.transfer_eligible) {
    return { eligible: false, reason: cp.screening_status };
  }

  // Check staleness — if last screen is too old, re-screen inline
  if (cp.last_screened_at) {
    const lastScreened = new Date(cp.last_screened_at);
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - config.stalenessThresholdDays);

    if (lastScreened < staleCutoff) {
      // Stale — trigger inline re-screen
      const result = await screenCounterpartyOnboarding(
        enterpriseId,
        counterpartyId,
        userId,
      );

      if (result.result_status === 'flagged' || result.result_status === 'blocked') {
        return {
          eligible: false,
          reason: result.result_status,
          stale_rescreen: true,
        };
      }

      return { eligible: true, stale_rescreen: true };
    }
  }

  return { eligible: true };
}
