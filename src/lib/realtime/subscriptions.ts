import { createClient } from '@/lib/supabase/client';
import type { WalletBalance } from '@/types/database';

type BalanceChangeCallback = (payload: {
  new: WalletBalance;
  old: Partial<WalletBalance>;
}) => void;

export function subscribeToWalletBalances(
  walletIds: string[],
  onUpdate: BalanceChangeCallback
) {
  const supabase = createClient();

  const channel = supabase
    .channel('wallet_balances_realtime')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'wallet_balances',
        filter: walletIds.length === 1
          ? `wallet_id=eq.${walletIds[0]}`
          : undefined,
      },
      (payload) => {
        if (walletIds.length > 1 && payload.new) {
          const newRow = payload.new as WalletBalance;
          if (!walletIds.includes(newRow.wallet_id)) return;
        }
        onUpdate(payload as unknown as { new: WalletBalance; old: Partial<WalletBalance> });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToPayments(
  userId: string,
  onUpdate: (payload: { new: Record<string, unknown> }) => void
) {
  const supabase = createClient();

  const channel = supabase
    .channel('payments_realtime')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'payments',
        filter: `user_id=eq.${userId}`,
      },
      onUpdate
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}
