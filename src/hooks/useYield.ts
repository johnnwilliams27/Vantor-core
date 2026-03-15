'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import type { YieldPosition, YieldTransaction } from '@/types/database';
import type { YieldProtocolInfo, YieldRate } from '@/lib/yield/interface';
import type { SlippageEstimate } from '@/lib/yield/slippage';

// ---- Protocols with rates ----

export interface YieldProtocolWithRates extends YieldProtocolInfo {
  rates: YieldRate[];
}

export function useYieldProtocols() {
  const { data: session } = useSession();
  return useQuery<YieldProtocolWithRates[]>({
    queryKey: ['yield-protocols'],
    queryFn: async () => {
      const res = await fetch('/api/yield/protocols');
      if (!res.ok) throw new Error('Failed to fetch yield protocols');
      const { data } = await res.json();
      return data ?? [];
    },
    enabled: !!session?.user?.id,
    staleTime: 60_000,
  });
}

// ---- Rates only ----

export function useYieldRates() {
  const { data: session } = useSession();
  return useQuery<YieldRate[]>({
    queryKey: ['yield-rates'],
    queryFn: async () => {
      const res = await fetch('/api/yield/rates');
      if (!res.ok) throw new Error('Failed to fetch yield rates');
      const { data } = await res.json();
      return data ?? [];
    },
    enabled: !!session?.user?.id,
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
}

// ---- Positions ----

export function useYieldPositions() {
  const { data: session } = useSession();
  return useQuery<YieldPosition[]>({
    queryKey: ['yield-positions', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/yield/positions');
      if (!res.ok) throw new Error('Failed to fetch yield positions');
      const { data } = await res.json();
      return data ?? [];
    },
    enabled: !!session?.user?.id,
    staleTime: 30_000,
  });
}

// ---- Transactions ----

export function useYieldTransactions() {
  const { data: session } = useSession();
  return useQuery<YieldTransaction[]>({
    queryKey: ['yield-transactions', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/yield/transactions');
      if (!res.ok) throw new Error('Failed to fetch yield transactions');
      const { data } = await res.json();
      return data ?? [];
    },
    enabled: !!session?.user?.id,
    staleTime: 30_000,
  });
}

// ---- Deposit ----

export function useYieldDeposit() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (payload: {
      protocol: string;
      token: string;
      amount: string;
      walletAddress: string;
      chain: string;
      vaultAddress?: string;
    }) => {
      const res = await fetch('/api/yield/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to deposit');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yield-positions', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['yield-transactions', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['treasury-overview', session?.user?.id] });
    },
  });
}

// ---- Withdraw ----

export function useYieldWithdraw() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (payload: {
      positionId: string;
      amount: string;
      walletAddress: string;
    }) => {
      const res = await fetch('/api/yield/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to withdraw');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yield-positions', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['yield-transactions', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['treasury-overview', session?.user?.id] });
    },
  });
}

// ---- Slippage check ----

export function useSlippageCheck() {
  return useMutation<SlippageEstimate, Error, {
    protocol: string;
    token: string;
    chain: string;
    amountUsd: number;
  }>({
    mutationFn: async (payload) => {
      const res = await fetch('/api/yield/slippage-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to check slippage');
      }
      const { data } = await res.json();
      return data;
    },
  });
}

// ---- Refresh position ----

export function useRefreshPosition() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (positionId: string) => {
      const res = await fetch(`/api/yield/positions/${positionId}/refresh`, {
        method: 'POST',
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to refresh position');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yield-positions', session?.user?.id] });
    },
  });
}
