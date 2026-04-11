import type { SupabaseClient } from '@supabase/supabase-js';
import type { TreasuryRule } from '@/types/database';
import type { StablecoinPrices } from '@/types/database';
import type {
  TreasurySnapshot,
  UpcomingObligation,
  RulesEngineResult,
} from './interface';
import { getStablecoinPrices } from './oracle';
import { TreasuryStateService } from './state/service';
import { createForecastService } from '@/lib/forecast/service';
import { getHoldingCardPlacement } from './holdings-category';
import type { YieldProtocolId } from '@/lib/yield/interface';

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
      bankAccounts: [],
      cryptoPositions: [],
    };
  }

  const stateSvc = new TreasuryStateService(supabase);
  const snap = await stateSvc.computeSnapshot(enterpriseId, 'pre_decision');

  // Fan yield positions into MMF / DeFi / other via the canonical
  // holdings-category logic. Every position must land in exactly one
  // bucket and the three bucket totals must sum to the legacy
  // totalDefiBaseUsd. This is the invariant the regression test locks in.
  let mmfTotal = 0;
  let defiTotal = 0;
  let otherTotal = 0;
  for (const p of snap.positions.defiPositions) {
    const placement = getHoldingCardPlacement({
      kind: 'yield_position',
      protocol: p.protocol as YieldProtocolId,
    });
    if (placement === 'cash') mmfTotal += p.currentValueBaseUsd;
    else if (placement === 'defi_positions') defiTotal += p.currentValueBaseUsd;
    else otherTotal += p.currentValueBaseUsd;
  }

  return {
    totalBankBalanceUsd: snap.totalFiatBaseUsd,
    // Wallet stablecoins ONLY — no yield conflation.
    totalCryptoBalanceUsd: snap.totalStablecoinBaseUsd,
    totalMmfPositionsUsd: mmfTotal,
    totalDefiPositionsUsd: defiTotal,
    totalOtherYieldUsd: otherTotal,
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
  userId: string,
  lookaheadDays: number,
  enterpriseId?: string | null,
): Promise<UpcomingObligation[]> {
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + lookaheadDays);
  const windowEndStr = windowEnd.toISOString().split('T')[0];

  // --- Invoices: still queried directly until a later phase syncs them
  //     into the obligations table via source='erp_sync'.
  let invoiceQuery = supabase
    .from('invoices')
    .select('id, invoice_number, description, amount, due_date')
    .eq('user_id', userId)
    .in('status', ['unpaid', 'overdue'])
    .not('due_date', 'is', null)
    .lte('due_date', windowEndStr);

  if (enterpriseId) {
    invoiceQuery = invoiceQuery.eq('enterprise_id', enterpriseId);
  }

  const invoiceRes = await invoiceQuery;
  if (invoiceRes.error) throw new Error(invoiceRes.error.message);

  const obligations: UpcomingObligation[] = [];

  for (const inv of invoiceRes.data ?? []) {
    obligations.push({
      id: inv.id as string,
      source: 'erp_invoice',
      label: (inv.description as string) || `Invoice ${inv.invoice_number}`,
      amountUsd: parseFloat(inv.amount as string),
      dueDate: inv.due_date as string,
    });
  }

  // --- Manual + recurring obligations: delegated to ForecastService so
  //     the rules engine sees the same expanded window as every other
  //     consumer (T15 adapter, forecast API, agent tools).
  if (enterpriseId) {
    const svc = createForecastService({
      enterpriseId,
      db: supabase,
      consumer: 'rules_engine',
    });
    const manual = await svc.getObligationsDueInWindow(lookaheadDays);
    for (const o of manual) {
      obligations.push({
        id: o.id,
        source: 'manual',
        label: o.label,
        // Currency conversion at projection time lives in the engine;
        // the rules engine's legacy shape is USD-native and does not
        // FX-convert, so we take the raw amount. Non-USD obligations
        // would need a caller-side FX pass if the rules engine ever
        // starts scoring them — out of scope for this rewire.
        amountUsd: o.amount,
        dueDate: o.dueDate,
      });
    }
  }

  return obligations;
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
