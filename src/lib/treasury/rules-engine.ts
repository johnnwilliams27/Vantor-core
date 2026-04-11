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
import { getStablecoinPrices, priceToken } from './oracle';
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

export async function buildTreasurySnapshot(
  supabase: SupabaseClient,
  userId: string,
  prices?: StablecoinPrices,
  enterpriseId?: string | null
): Promise<TreasurySnapshot> {
  let bankQuery = supabase
    .from('bank_accounts')
    .select('id, institution_name, account_name, last4, currency, current_balance, balance_as_of')
    .eq('user_id', userId)
    .eq('is_active', true);

  let walletQuery = supabase
    .from('wallets')
    .select('id, chain, wallet_balances(token, balance, usd_value)')
    .eq('user_id', userId);

  let yieldQuery = supabase
    .from('yield_positions')
    .select(
      'id, protocol, chain, underlying_token, yield_token, deposited_amount, yield_token_balance, current_value_usd, accrued_yield_usd, apy_snapshot, last_refreshed_at',
    )
    .eq('user_id', userId)
    .eq('is_active', true);

  if (enterpriseId) {
    bankQuery = bankQuery.eq('enterprise_id', enterpriseId);
    walletQuery = walletQuery.eq('enterprise_id', enterpriseId);
    yieldQuery = yieldQuery.eq('enterprise_id', enterpriseId);
  }

  const [bankRes, walletRes, yieldRes] = await Promise.all([
    bankQuery,
    walletQuery,
    yieldQuery,
  ]);

  if (bankRes.error) throw new Error(bankRes.error.message);
  if (walletRes.error) throw new Error(walletRes.error.message);
  if (yieldRes.error) throw new Error(yieldRes.error.message);

  // Resolve prices: use provided prices or fetch from oracle
  const resolvedPrices: StablecoinPrices = prices ?? (await getStablecoinPrices()).prices;

  // Fetch cached FX rates for converting non-USD balances
  const { data: fxRows } = await supabase
    .from('fx_rate_cache')
    .select('target_currency, rate')
    .eq('base_currency', 'USD');
  const fxRates: Record<string, number> = { USD: 1 };
  for (const row of fxRows ?? []) {
    fxRates[row.target_currency] = parseFloat(row.rate as string);
  }

  const bankAccounts = (bankRes.data ?? []).map((acct) => {
    const currency = (acct.currency as string) ?? 'USD';
    const localBalance = acct.current_balance ? parseFloat(acct.current_balance as string) : 0;
    const fxRate = fxRates[currency] ?? 1;
    return {
      id: acct.id as string,
      institutionName: acct.institution_name as string,
      accountName: acct.account_name as string,
      last4: acct.last4 as string | null,
      currency,
      // Preserve the native-currency amount as reported by the bank. The
      // insights engine's currency exposure and liquidity detectors need
      // to reason about EUR/GBP/etc. without reverse-engineering via FX.
      currentBalanceNative: localBalance,
      currentBalanceUsd: localBalance / fxRate,
      balanceAsOf: acct.balance_as_of as string | null,
    };
  });

  const totalBankBalanceUsd = bankAccounts.reduce((sum, a) => sum + a.currentBalanceUsd, 0);

  const cryptoPositions: TreasurySnapshot['cryptoPositions'] = [];
  for (const wallet of walletRes.data ?? []) {
    const balances = (wallet as any).wallet_balances ?? [];
    for (const wb of balances) {
      const rawBalance = parseFloat(wb.balance ?? '0');
      // Apply oracle price; fall back to stored usd_value if price not available
      const usdValue = priceToken(wb.token as string, rawBalance, resolvedPrices) ||
        (wb.usd_value ? parseFloat(wb.usd_value) : rawBalance);
      cryptoPositions.push({
        walletId: wallet.id as string,
        chain: wallet.chain as string,
        token: wb.token as string,
        balance: rawBalance,
        usdValue,
      });
    }
  }

  const totalCryptoBalanceUsd = cryptoPositions.reduce((sum, p) => sum + p.usdValue, 0);

  // Build yield position snapshots. For each row, look up the venue
  // category from the canonical venues registry — detectors need this
  // to apply category-specific logic (MMF vs DeFi vault vs lending market).
  const yieldPositions: YieldPositionSnapshot[] = (yieldRes.data ?? []).map((row) => {
    const venue = getVenue(row.protocol as YieldProtocolId);
    return {
      id: row.id as string,
      protocol: row.protocol as string,
      chain: row.chain as ChainType,
      underlyingToken: row.underlying_token as string,
      yieldToken: (row.yield_token as string | null) ?? null,
      venueCategory: venue?.category ?? null,
      depositedAmount: row.deposited_amount ? parseFloat(row.deposited_amount as string) : 0,
      yieldTokenBalance: row.yield_token_balance
        ? parseFloat(row.yield_token_balance as string)
        : 0,
      currentValueUsd: row.current_value_usd ? parseFloat(row.current_value_usd as string) : 0,
      accruedYieldUsd: row.accrued_yield_usd ? parseFloat(row.accrued_yield_usd as string) : 0,
      apySnapshot: row.apy_snapshot != null ? parseFloat(row.apy_snapshot as string) : null,
      lastRefreshedAt: (row.last_refreshed_at as string | null) ?? null,
    };
  });

  const totalYieldBalanceUsd = yieldPositions.reduce((sum, p) => sum + p.currentValueUsd, 0);

  return {
    totalBankBalanceUsd,
    totalCryptoBalanceUsd,
    totalYieldBalanceUsd,
    bankAccounts,
    cryptoPositions,
    yieldPositions,
  };
}

export async function collectObligations(
  supabase: SupabaseClient,
  userId: string,
  lookaheadDays: number,
  enterpriseId?: string | null
): Promise<UpcomingObligation[]> {
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + lookaheadDays);
  const windowEndStr = windowEnd.toISOString().split('T')[0];

  let invoiceQuery = supabase
    .from('invoices')
    .select('id, invoice_number, description, amount, due_date')
    .eq('user_id', userId)
    .in('status', ['unpaid', 'overdue'])
    .not('due_date', 'is', null)
    .lte('due_date', windowEndStr);

  let manualQuery = supabase
    .from('manual_obligations')
    .select('id, label, amount_usd, due_date')
    .eq('user_id', userId)
    .eq('is_active', true)
    .lte('due_date', windowEndStr);

  if (enterpriseId) {
    invoiceQuery = invoiceQuery.eq('enterprise_id', enterpriseId);
    manualQuery = manualQuery.eq('enterprise_id', enterpriseId);
  }

  const [invoiceRes, manualRes] = await Promise.all([invoiceQuery, manualQuery]);

  if (invoiceRes.error) throw new Error(invoiceRes.error.message);
  if (manualRes.error) throw new Error(manualRes.error.message);

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

  for (const ob of manualRes.data ?? []) {
    obligations.push({
      id: ob.id as string,
      source: 'manual',
      label: ob.label as string,
      amountUsd: parseFloat(ob.amount_usd as string),
      dueDate: ob.due_date as string,
    });
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
    // Cap offramp at available crypto value
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
