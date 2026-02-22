'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { subscribeToWalletBalances } from '@/lib/realtime/subscriptions';
import { useWalletStore } from '@/store/walletStore';

export function useRealtimeBalances() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const { wallets, updateBalance } = useWalletStore();

  useEffect(() => {
    if (!session?.user?.id || wallets.length === 0) return;
    const walletIds = wallets.map((w) => w.id);

    const unsubscribe = subscribeToWalletBalances(walletIds, (payload) => {
      updateBalance(payload.new.wallet_id, payload.new);
      // Invalidate the balances query so components re-render
      queryClient.invalidateQueries({ queryKey: ['balances', session.user.id] });
    });

    return unsubscribe;
  }, [session?.user?.id, wallets, queryClient, updateBalance]);
}
