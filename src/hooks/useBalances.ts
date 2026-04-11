'use client';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

export interface BalanceSummaryItem {
  walletId: string;
  walletAddress: string;
  chain: string;
  token: string;
  balance: string;
  usdValue: string | null;
}

export function useBalances() {
  const { data: session } = useSession();

  return useQuery<BalanceSummaryItem[]>({
    queryKey: ['balances', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/balances');
      if (!res.ok) throw new Error('Failed to fetch balances');
      const { data } = await res.json();
      return data ?? [];
    },
    enabled: !!session?.user?.id,
    refetchInterval: 60_000, // fallback poll every 60s
    staleTime: 30_000,
  });
}

/** Look up the balance for a specific wallet + token pair. */
export function useWalletTokenBalance(walletId: string | undefined, token: string | undefined) {
  const { data: balances } = useBalances();

  return useMemo(() => {
    if (!walletId || !token || !balances) return null;
    const match = balances.find((b) => b.walletId === walletId && b.token === token);
    return match ? parseFloat(match.balance) : 0;
  }, [balances, walletId, token]);
}

/** Look up total balance across all tokens for a wallet. */
export function useWalletTotalBalance(walletId: string | undefined) {
  const { data: balances } = useBalances();

  return useMemo(() => {
    if (!walletId || !balances) return null;
    return balances
      .filter((b) => b.walletId === walletId)
      .reduce((sum, b) => sum + (b.usdValue ? parseFloat(b.usdValue) : 0), 0);
  }, [balances, walletId]);
}

/** Per-wallet total USD value across all tokens, keyed by walletId. */
export function useWalletBalanceMap() {
  const { data: balances } = useBalances();

  return useMemo(() => {
    const map = new Map<string, number>();
    if (!balances) return map;
    for (const b of balances) {
      if (!b.usdValue) continue;
      const prev = map.get(b.walletId) ?? 0;
      map.set(b.walletId, prev + parseFloat(b.usdValue));
    }
    return map;
  }, [balances]);
}

/** Format a USD amount compactly for dropdown labels (e.g. "$1,234.56"). */
export function formatWalletBalanceLabel(usd: number | undefined | null): string {
  if (usd == null) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(usd);
}
