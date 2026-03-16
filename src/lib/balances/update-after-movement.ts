import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Updates wallet_balances and bank_accounts after a money movement.
 * This is a mock/fallback mechanism — in production, balances come from
 * on-chain reads (wallets) and Plaid/bank API syncs (bank accounts).
 * This ensures the UI reflects changes immediately rather than waiting
 * for the next external sync.
 */

interface WalletBalanceUpdate {
  walletId: string;
  token: string;
  delta: number; // positive = increase, negative = decrease
}

interface BankBalanceUpdate {
  bankAccountId: string;
  delta: number; // positive = increase, negative = decrease
}

export async function updateWalletBalance(update: WalletBalanceUpdate): Promise<void> {
  const supabase = createAdminClient();

  const { data: current } = await supabase
    .from('wallet_balances')
    .select('balance')
    .eq('wallet_id', update.walletId)
    .eq('token', update.token)
    .maybeSingle();

  if (current) {
    const oldBalance = parseFloat(current.balance);
    const newBalance = Math.max(0, oldBalance + update.delta);

    await supabase
      .from('wallet_balances')
      .update({
        balance: newBalance,
        usd_value: newBalance, // stablecoins ≈ 1:1 USD
        last_updated: new Date().toISOString(),
      })
      .eq('wallet_id', update.walletId)
      .eq('token', update.token);
  }
}

export async function updateBankBalance(update: BankBalanceUpdate): Promise<void> {
  const supabase = createAdminClient();

  const { data: account } = await supabase
    .from('bank_accounts')
    .select('current_balance')
    .eq('id', update.bankAccountId)
    .maybeSingle();

  if (account) {
    const oldBalance = parseFloat(account.current_balance ?? '0');
    const newBalance = Math.max(0, oldBalance + update.delta);

    await supabase
      .from('bank_accounts')
      .update({
        current_balance: newBalance,
        balance_as_of: new Date().toISOString(),
      })
      .eq('id', update.bankAccountId);
  }
}

/**
 * Convenience: update both sides of a ramp (on-ramp or off-ramp).
 * - Off-ramp: crypto decreases, fiat increases
 * - On-ramp: crypto increases, fiat decreases
 */
export async function updateBalancesAfterRamp(params: {
  direction: 'onramp' | 'offramp';
  walletId?: string | null;
  bankAccountId?: string | null;
  token: string;
  cryptoAmount: number;
  fiatAmount: number;
}): Promise<void> {
  const { direction, walletId, bankAccountId, token, cryptoAmount, fiatAmount } = params;
  const isOfframp = direction === 'offramp';

  if (walletId) {
    await updateWalletBalance({
      walletId,
      token,
      delta: isOfframp ? -cryptoAmount : cryptoAmount,
    });
  }

  if (bankAccountId) {
    await updateBankBalance({
      bankAccountId,
      delta: isOfframp ? fiatAmount : -fiatAmount,
    });
  }
}

/**
 * Update wallet balance after a payment (outgoing transfer).
 */
export async function updateBalancesAfterPayment(params: {
  walletId: string;
  token: string;
  amount: number;
}): Promise<void> {
  await updateWalletBalance({
    walletId: params.walletId,
    token: params.token,
    delta: -params.amount, // outgoing = decrease
  });
}

/**
 * Update wallet balances after a swap.
 * fromToken decreases, toToken increases (on same wallet).
 */
export async function updateBalancesAfterSwap(params: {
  walletId: string;
  fromToken: string;
  toToken: string;
  fromAmount: number;
  toAmount: number;
}): Promise<void> {
  await updateWalletBalance({
    walletId: params.walletId,
    token: params.fromToken,
    delta: -params.fromAmount,
  });

  await updateWalletBalance({
    walletId: params.walletId,
    token: params.toToken,
    delta: params.toAmount,
  });
}
