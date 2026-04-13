import type { SupabaseClient } from '@supabase/supabase-js';
import type { TreasuryRule } from '@/types/database';
import type { StablecoinPrices, ChainType } from '@/types/database';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type {
  TreasurySnapshot,
  UpcomingObligation,
  RulesEngineResult,
  YieldPositionSnapshot,
} from './interface';
import { getStablecoinPrices } from './oracle';
import { TreasuryStateService } from './state/service';
import { createForecastService } from '@/lib/forecast/service';
import { getHoldingCardPlacement } from './holdings-category';
import { getVenue } from '@/lib/yield/venues';

export async function getActiveTreasuryRule(
  supabase: SupabaseClient,
  userId: string,
  enterpriseId?: string | null
): Promise<TreasuryRule | null> {
  let query = supabase
    .from('treasury_rules')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1);

  if (enterpriseId) {
    query = query.eq('enterprise_id', enterpriseId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Build a TreasurySnapshot for the rules engine.
 *
 * Thin adapter over `TreasuryStateService` (`src/lib/treasury/state/
 * service.ts`) which owns the canonical state aggregation. The signature
 * keeps `userId` and `prices` for backwards compatibility with the six
 * existing callers; `userId` is ignored (the new model is enterprise-
 * scoped, which is the correct multi-tenant boundary), and `prices` is
 * ignored because TreasuryStateService does its own price fetch with a
 * 5-minute Next.js cache.
 *
 * ## Bucketing invariant
 *
 * Yield positions from TreasuryStateSnapshot arrive all mixed together in
 * `snap.totalDefiBaseUsd`. This function fans them out into three distinct
 * buckets using the canonical `getHoldingCardPlacement` logic from
 * `holdings-category.ts`:
 *
 *   - tokenized MMFs       → totalMmfPositionsUsd
 *   - DeFi venues          → totalDefiPositionsUsd
 *   - unknown/other venues → totalOtherYieldUsd
 *
 * `totalCryptoBalanceUsd` is now strictly "idle stablecoin wallet
 * balances" — NO yield positions. This is a correction from the Phase A
 * T18 shape which conflated wallet stablecoins with all yield, causing
 * the Stablecoins dashboard card to double-count by ~$2.3M on dev.
 * The bug was masked because `getHoldingCardPlacement` is correct in
 * isolation; the leak happened one layer up in the adapter. See the
 * wiring-level regression test in tests/treasury-rollup.test.ts.
 */
export async function buildTreasurySnapshot(
  supabase: SupabaseClient,
  _userId: string,
  _prices?: StablecoinPrices,
  enterpriseId?: string | null,
): Promise<TreasurySnapshot> {
  if (!enterpriseId) {
    return {
      totalBankBalanceUsd: 0,
      totalCryptoBalanceUsd: 0,
      totalMmfPositionsUsd: 0,
      totalDefiPositionsUsd: 0,
      totalOtherYieldUsd: 0,
      totalYieldBalanceUsd: 0,
      bankAccounts: [],
      cryptoPositions: [],
      yieldPositions: [],
    };
  }

  const stateSvc = new TreasuryStateService(supabase);
  const snap = await stateSvc.computeSnapshot(enterpriseId, 'pre_decision');

  // Fan yield positions into MMF / DeFi / other via the canonical
  // holdings-category logic. Used for `yieldPositions[]` venue metadata
  // and the yield-only `totalYieldBalanceUsd`. Post-C-1.5b the MMF and
  // DeFi aggregates are equivalent to snap.totalMmfBaseUsd and
  // snap.totalDefiVaultBaseUsd+snap.totalDefiLendingBaseUsd respectively;
  // the invariant is locked in by segmentation.ts tests.
  let yieldMmfTotal = 0;
  let yieldDefiTotal = 0;
  let yieldOtherTotal = 0;
  for (const p of snap.positions.defiPositions) {
    const placement = getHoldingCardPlacement({
      kind: 'yield_position',
      protocol: p.protocol as YieldProtocolId,
    });
    if (placement === 'cash') yieldMmfTotal += p.currentValueBaseUsd;
    else if (placement === 'defi_positions') yieldDefiTotal += p.currentValueBaseUsd;
    else yieldOtherTotal += p.currentValueBaseUsd;
  }

  // Build YieldPositionSnapshot[] for the insights engine. DefiPosition
  // from TreasuryStateSnapshot doesn't carry the venue category, so we
  // look it up against the canonical venues registry here. Detectors
  // then apply category-specific logic (MMF vs DeFi vault vs lending
  // market) without re-querying.
  const yieldPositions: YieldPositionSnapshot[] = snap.positions.defiPositions.map((p) => {
    const venue = getVenue(p.protocol as YieldProtocolId);
    return {
      id: p.positionId,
      protocol: p.protocol,
      chain: p.chain as ChainType,
      underlyingToken: p.underlyingToken,
      // DefiPosition in the new state service doesn't expose the
      // yield-bearing token separately. Insights detectors size
      // positions via currentValueUsd, so leaving these two as
      // null/0 is safe for v1.
      yieldToken: null,
      venueCategory: venue?.category ?? null,
      depositedAmount: p.depositedAmount,
      yieldTokenBalance: 0,
      currentValueUsd: p.currentValueBaseUsd,
      accruedYieldUsd: p.accruedYieldBaseUsd,
      apySnapshot: p.apySnapshot,
      lastRefreshedAt: p.lastRefreshedAt,
    };
  });

  const totalYieldBalanceUsd = yieldMmfTotal + yieldDefiTotal + yieldOtherTotal;

  return {
    totalBankBalanceUsd: snap.totalBankBaseUsd,
    // Idle USDC/USDT wallet balances ONLY — never yield, never non-stables.
    totalCryptoBalanceUsd: snap.totalStablecoinIdleBaseUsd,
    totalMmfPositionsUsd: yieldMmfTotal,
    totalDefiPositionsUsd: yieldDefiTotal,
    // Catch-all so the five bucket sum reconciles to Total Treasury:
    // non-stable wallet tokens (ETH/SOL, from snap.totalOtherBaseUsd minus
    // the yield-other slice we just computed) PLUS unknown-venue yield.
    // Equivalent to snap.totalOtherBaseUsd — segmentation.ts ensures the
    // two slices there sum to that aggregate.
    totalOtherYieldUsd: snap.totalOtherBaseUsd,
    totalYieldBalanceUsd,
    bankAccounts: snap.positions.bankAccounts.map((b) => ({
      id: b.accountId,
      institutionName: b.institutionName,
      accountName: b.accountName,
      last4: b.last4,
      currency: b.currency,
      currentBalanceUsd: b.balanceBaseUsd,
      balanceAsOf: b.balanceAsOf,
    })),
    cryptoPositions: snap.positions.wallets.map((w) => ({
      walletId: w.walletId,
      chain: w.chain,
      token: w.token,
      balance: w.balanceNative,
      usdValue: w.balanceBaseUsd,
    })),
    yieldPositions,
  };
}

/**
 * Collect every obligation due within the lookahead window.
 *
 * Invoices still come straight from the `invoices` table — they have
 * not been synced into the `obligations` table on this branch, so the
 * rules engine would go blind to overdue invoices if it only asked
 * ForecastService. Sync lands in a later phase; for now, invoice
 * loading stays in this function as a direct query.
 *
 * Manual / recurring obligations are delegated to
 * `ForecastService.getObligationsDueInWindow`, which reads from the
 * `obligations` table (renamed from `manual_obligations` in 0036),
 * expands recurring rules via `expandRecurrence`, and applies the
 * rules-engine scenario filter. Prior to this rewire the rules engine
 * was silently broken on dev after 0036 renamed the table out from
 * under the direct query — nothing was reaching the rules engine
 * because every call failed. This is why no callers noticed.
 *
 * `userId` stays in the signature for caller compatibility but is only
 * used for the invoice query (which is still user-scoped). The manual
 * obligation path is now strictly enterprise-scoped, matching the
 * multi-tenant model introduced in 0010.
 */
export async function collectObligations(
  supabase: SupabaseClient,
  // Historically scoped by user_id; post-0053 obligations are scoped by
  // enterprise so the user parameter is vestigial. Kept to preserve the
  // public signature for existing callers.
  _userId: string,
  lookaheadDays: number,
  enterpriseId?: string | null,
): Promise<UpcomingObligation[]> {
  // Every obligation (manual, recurring_rule, erp_sync) now lives in the
  // `obligations` table — migration 0053 moved ERP invoices behind the
  // canonical table via dual-write in the ERP sync paths. So the rules
  // engine delegates entirely to ForecastService and drops the direct
  // invoices query that used to short-circuit this path.
  if (!enterpriseId) return [];

  const svc = createForecastService({
    enterpriseId,
    db: supabase,
    consumer: 'rules_engine',
  });
  const expanded = await svc.getObligationsDueInWindow(lookaheadDays);

  return expanded.map((o) => ({
    id: o.id,
    source: o.source === 'erp_sync' ? 'erp_invoice' : 'manual',
    label: o.label,
    // Rules engine legacy shape is USD-native. Stablecoin currencies
    // (USDC/USDT) are effectively $1 so pass through cleanly; multi-
    // currency fiat obligations would need a caller-side FX pass —
    // that's Item 2 in the Phase A leftovers roadmap.
    amountUsd: o.amount,
    dueDate: o.dueDate,
  }));
}

export async function computeRecommendation(
  supabase: SupabaseClient,
  userId: string,
  rule: TreasuryRule,
  enterpriseId?: string | null
): Promise<RulesEngineResult> {
  const lookaheadDays = rule.obligation_lookahead_days;
  const multiplier = parseFloat(rule.safety_buffer_multiplier);
  const approvalThreshold = parseFloat(rule.approval_threshold_usd);

  // Fetch prices once and pass to snapshot builder to avoid double fetch
  const { prices } = await getStablecoinPrices();

  const [snapshot, obligations] = await Promise.all([
    buildTreasurySnapshot(supabase, userId, prices, enterpriseId),
    collectObligations(supabase, userId, lookaheadDays, enterpriseId),
  ]);

  const totalObligationsUsd = obligations.reduce((sum, o) => sum + o.amountUsd, 0);
  const safetyBufferTargetUsd = totalObligationsUsd * multiplier;
  const surplusUsd = snapshot.totalBankBalanceUsd - safetyBufferTargetUsd;

  let action: RulesEngineResult['action'] = 'no_action';
  let recommendedAmountUsd: number | null = null;

  if (surplusUsd > 100) {
    // Excess fiat → deploy to stablecoin (fiat → crypto = onramp)
    action = 'onramp';
    recommendedAmountUsd = Math.round(surplusUsd * 100) / 100;
  } else if (surplusUsd < -100) {
    // Short on fiat → liquidate crypto (crypto → fiat = offramp)
    action = 'offramp';
    const needed = Math.abs(surplusUsd);
    // Cap offramp at the instantly-available crypto value. This is
    // intentionally restricted to idle stablecoin wallet balances —
    // yield positions (Aave, Kamino, even tokenized MMFs with T+1
    // redemption windows) require an unwinding step first, so they
    // can't cover a same-day shortfall. A future phase can extend
    // this to multi-tier liquidity using Projection.shortfalls
    // from the forecast engine.
    const availableCrypto = snapshot.totalCryptoBalanceUsd;
    recommendedAmountUsd = Math.round(Math.min(needed, availableCrypto) * 100) / 100;
  }

  const requiresApproval =
    recommendedAmountUsd !== null && recommendedAmountUsd >= approvalThreshold;

  // Use the first active bank account as target for ramps
  const targetBankAccountId =
    snapshot.bankAccounts.length > 0 ? snapshot.bankAccounts[0].id : null;

  return {
    snapshot,
    obligationsInWindow: obligations,
    totalObligationsUsd,
    safetyBufferTargetUsd,
    surplusUsd,
    action,
    recommendedAmountUsd,
    requiresApproval,
    targetBankAccountId,
    targetStablecoinToken: rule.target_stablecoin,
    targetChain: rule.target_chain,
    lookaheadDays,
  };
}
