import type { SupabaseClient } from '@supabase/supabase-js';
import type { TreasuryRule } from '@/types/database';
import type { StablecoinPrices } from '@/types/database';
import type {
  TreasurySnapshot,
  UpcomingObligation,
  RulesEngineResult,
} from './interface';
import { getStablecoinPrices, priceToken } from './oracle';

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

  if (enterpriseId) {
    bankQuery = bankQuery.eq('enterprise_id', enterpriseId);
    walletQuery = walletQuery.eq('enterprise_id', enterpriseId);
  }

  const [bankRes, walletRes] = await Promise.all([bankQuery, walletQuery]);

  if (bankRes.error) throw new Error(bankRes.error.message);
  if (walletRes.error) throw new Error(walletRes.error.message);

  // Resolve prices: use provided prices or fetch from oracle
  const resolvedPrices: StablecoinPrices = prices ?? (await getStablecoinPrices()).prices;

  const bankAccounts = (bankRes.data ?? []).map((acct) => ({
    id: acct.id as string,
    institutionName: acct.institution_name as string,
    accountName: acct.account_name as string,
    last4: acct.last4 as string | null,
    currency: (acct.currency as string) ?? 'USD',
    currentBalanceUsd: acct.current_balance ? parseFloat(acct.current_balance as string) : 0,
    balanceAsOf: acct.balance_as_of as string | null,
  }));

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

  return {
    totalBankBalanceUsd,
    totalCryptoBalanceUsd,
    bankAccounts,
    cryptoPositions,
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
    action = 'offramp';
    recommendedAmountUsd = Math.round(surplusUsd * 100) / 100;
  } else if (surplusUsd < -100) {
    action = 'onramp';
    const needed = Math.abs(surplusUsd);
    // Cap onramp at available crypto value
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
