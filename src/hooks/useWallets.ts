'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useWalletStore } from '@/store/walletStore';
import type { Wallet } from '@/types/database';

export function useWallets() {
  const { setWallets } = useWalletStore();
  const { data: session } = useSession();

  const query = useQuery<Wallet[]>({
    queryKey: ['wallets', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/wallets');
      if (!res.ok) throw new Error('Failed to fetch wallets');
      const { data } = await res.json();
      return data ?? [];
    },
    enabled: !!session?.user?.id,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (query.data) setWallets(query.data);
  }, [query.data, setWallets]);

  return query;
}

export function useUnlinkWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (walletId: string) => {
      const res = await fetch(`/api/wallets/${walletId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to unlink wallet');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallets'] });
      queryClient.invalidateQueries({ queryKey: ['balances'] });
    },
  });
}
