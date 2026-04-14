import type { SupabaseClient } from '@supabase/supabase-js';
import { createForecastService } from '@/lib/forecast/service';
import type { ProposedTransfer } from '@/lib/forecast/types';
import type { RulesEngineResult } from '@/lib/treasury/interface';

interface PersistAgentPlannerForecastInput {
  supabase: SupabaseClient;
  enterpriseId: string;
  recommendationId: string;
  result: RulesEngineResult;
  actorId: string | null;
  /** Defaults to `result.lookaheadDays` if omitted. */
  windowDays?: number;
}

interface PersistAgentPlannerForecastResult {
  persisted: boolean;
  reason?: 'no_action' | 'no_amount' | 'no_wallet' | 'error';
  error?: string;
}

/**
 * Persist a hypothetical forecast snapshot representing the state that would
 * result from acting on an AI recommendation. Tied to the recommendation via
 * `correlation_id` so every AI rec has a reproducible forecast audit trail.
 *
 * The proposal is modeled as a two-leg reallocation: fiat leaves/arrives at
 * the target bank, stablecoin arrives/leaves the target wallet. Net treasury
 * USD is unchanged (both legs balance), which is the correct result for a
 * ramp — coverage doesn't change, only composition does.
 *
 * If no wallet on `targetChain` exists for the enterprise, skip persistence
 * rather than fabricate a venue — the JSONB audit record would be misleading.
 * Returns { persisted: false, reason } in that case; callers should log and
 * proceed (rec generation must not fail on snapshot issues).
 */
export async function persistAgentPlannerForecast({
  supabase,
  enterpriseId,
  recommendationId,
  result,
  actorId,
  windowDays,
}: PersistAgentPlannerForecastInput): Promise<PersistAgentPlannerForecastResult> {
  if (result.action === 'no_action') {
    return { persisted: false, reason: 'no_action' };
  }
  const amount = result.recommendedAmountUsd;
  if (amount === null || amount <= 0) {
    return { persisted: false, reason: 'no_amount' };
  }
  if (!result.targetBankAccountId || !result.targetChain) {
    return { persisted: false, reason: 'no_wallet' };
  }

  const { data: wallet } = await supabase
    .from('wallets')
    .select('id')
    .eq('enterprise_id', enterpriseId)
    .eq('chain', result.targetChain)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!wallet?.id) {
    return { persisted: false, reason: 'no_wallet' };
  }

  const stablecoin = result.targetStablecoinToken ?? 'USDC';
  const bankId = result.targetBankAccountId;
  const walletId = wallet.id as string;

  const transfers: ProposedTransfer[] = result.action === 'onramp'
    ? [
        { amount, asset: 'USD', fromVenue: bankId, toVenue: null },
        { amount, asset: stablecoin, fromVenue: null, toVenue: walletId },
      ]
    : [
        { amount, asset: stablecoin, fromVenue: walletId, toVenue: null },
        { amount, asset: 'USD', fromVenue: null, toVenue: bankId },
      ];

  try {
    const svc = createForecastService({
      enterpriseId,
      db: supabase,
      consumer: 'agent_planner',
      correlationId: recommendationId,
      persist: true,
      hypotheticalTransfers: transfers,
      takenBy: actorId,
    });
    await svc.getProjection(windowDays ?? result.lookaheadDays);
    return { persisted: true };
  } catch (err) {
    return {
      persisted: false,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
