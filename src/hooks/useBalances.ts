'use client';
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
