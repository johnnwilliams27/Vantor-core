'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import type {
  TreasuryRule,
  ManualObligation,
  AiRecommendation,
  StablecoinPrices,
  TreasuryForecast,
  SimulationRun,
} from '@/types/database';

// ---- Overview ----

export interface TreasuryOverview {
  totalBankBalanceUsd: number;
  totalCryptoBalanceUsd: number;
  bankAccounts: Array<{
    id: string;
    institutionName: string;
    accountName: string;
    last4: string | null;
    currency: string;
    currentBalanceUsd: number;
    balanceAsOf: string | null;
  }>;
  cryptoPositions: Array<{
    walletId: string;
    chain: string;
    token: string;
    balance: number;
    usdValue: number;
  }>;
  pendingRecommendations: Array<{
    id: string;
    action: string;
    recommended_amount_usd: string | null;
    status: string;
    expires_at: string;
    created_at: string;
  }>;
}

export function useTreasuryOverview() {
  const { data: session } = useSession();
  return useQuery<TreasuryOverview>({
    queryKey: ['treasury-overview', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/treasury/overview');
      if (!res.ok) throw new Error('Failed to fetch treasury overview');
      const { data } = await res.json();
      return data;
    },
    enabled: !!session?.user?.id,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ---- Rules ----

export function useTreasuryRules() {
  const { data: session } = useSession();
  return useQuery<TreasuryRule | null>({
    queryKey: ['treasury-rules', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/treasury/rules');
      if (!res.ok) throw new Error('Failed to fetch treasury rules');
      const { data } = await res.json();
      return data ?? null;
    },
    enabled: !!session?.user?.id,
    staleTime: 60_000,
  });
}

export function useSaveTreasuryRule() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (payload: {
      id?: string;
      label: string;
      safety_buffer_multiplier: number;
      obligation_lookahead_days: number;
      target_stablecoin: string;
      target_chain: string;
      approval_threshold_usd: number;
    }) => {
      const { id, ...body } = payload;
      const url = id ? `/api/treasury/rules/${id}` : '/api/treasury/rules';
      const method = id ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to save rule');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treasury-rules', session?.user?.id] });
    },
  });
}

// ---- Manual Obligations ----

export function useManualObligations() {
  const { data: session } = useSession();
  return useQuery<ManualObligation[]>({
    queryKey: ['treasury-obligations', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/treasury/obligations');
      if (!res.ok) throw new Error('Failed to fetch obligations');
      const { data } = await res.json();
      return data ?? [];
    },
    enabled: !!session?.user?.id,
    staleTime: 30_000,
  });
}

export function useCreateObligation() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (payload: {
      label: string;
      description?: string;
      amount_usd: number;
      due_date: string;
      is_recurring?: boolean;
      recurrence_days?: number;
    }) => {
      const res = await fetch('/api/treasury/obligations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to create obligation');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treasury-obligations', session?.user?.id] });
    },
  });
}

export function useDeleteObligation() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/treasury/obligations/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to delete obligation');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treasury-obligations', session?.user?.id] });
    },
  });
}

// ---- Recommendations ----

export function useTreasuryRecommendations() {
  const { data: session } = useSession();
  return useQuery<AiRecommendation[]>({
    queryKey: ['treasury-recommendations', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/treasury/recommendations');
      if (!res.ok) throw new Error('Failed to fetch recommendations');
      const { data } = await res.json();
      return data ?? [];
    },
    enabled: !!session?.user?.id,
    staleTime: 15_000,
  });
}

export function useGenerateRecommendation() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/treasury/recommendations/generate', { method: 'POST' });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to generate recommendation');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treasury-recommendations', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['treasury-overview', session?.user?.id] });
    },
  });
}

export function useApproveRecommendation() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/treasury/recommendations/${id}/approve`, { method: 'POST' });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to approve recommendation');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treasury-recommendations', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['treasury-overview', session?.user?.id] });
    },
  });
}

export function useRejectRecommendation() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const res = await fetch(`/api/treasury/recommendations/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to reject recommendation');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treasury-recommendations', session?.user?.id] });
    },
  });
}

// ---- Stablecoin Prices ----

export interface StablecoinPricesResponse {
  USDC: number;
  USDT: number;
  fetchedAt: string;
  source: 'mock' | 'coingecko';
}

export function useStablecoinPrices() {
  const { data: session } = useSession();
  return useQuery<StablecoinPricesResponse>({
    queryKey: ['stablecoin-prices'],
    queryFn: async () => {
      const res = await fetch('/api/treasury/prices');
      if (!res.ok) throw new Error('Failed to fetch stablecoin prices');
      const { data } = await res.json();
      return data;
    },
    enabled: !!session?.user?.id,
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
}

// ---- Cash Flow Forecast ----

export function useTreasuryForecast(days = 30) {
  const { data: session } = useSession();
  return useQuery<TreasuryForecast | null>({
    queryKey: ['treasury-forecast', session?.user?.id, days],
    queryFn: async () => {
      const res = await fetch(`/api/treasury/forecast?days=${days}`);
      if (!res.ok) throw new Error('Failed to fetch forecast');
      const { data } = await res.json();
      return data ?? null;
    },
    enabled: !!session?.user?.id,
    staleTime: 5 * 60_000,
  });
}

export function useGenerateForecast() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (payload?: { lookahead_days?: number }) => {
      const res = await fetch('/api/treasury/forecast/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to generate forecast');
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      const days = variables?.lookahead_days ?? 30;
      queryClient.invalidateQueries({
        queryKey: ['treasury-forecast', session?.user?.id, days],
      });
    },
  });
}

// ---- Paper Trading Simulation ----

export function useRunSimulation() {
  return useMutation({
    mutationFn: async (payload?: {
      rule_overrides?: {
        safety_buffer_multiplier?: number;
        obligation_lookahead_days?: number;
        approval_threshold_usd?: number;
        label?: string;
      };
    }): Promise<SimulationRun> => {
      const res = await fetch('/api/treasury/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to run simulation');
      }
      const json = await res.json();
      return json.data as SimulationRun;
    },
  });
}

// ---- Treasury Reports ----

import type { ReportData } from '@/lib/treasury/report';

export function useTreasuryReport(from?: string, to?: string) {
  const { data: session } = useSession();
  return useQuery<ReportData | null>({
    queryKey: ['treasury-report', session?.user?.id, from, to],
    queryFn: async () => {
      if (!from || !to) return null;
      const params = new URLSearchParams({ format: 'json', from, to });
      const res = await fetch(`/api/treasury/report?${params}`);
      if (!res.ok) throw new Error('Failed to fetch report');
      const { data } = await res.json();
      return data ?? null;
    },
    enabled: !!session?.user?.id && !!from && !!to,
    staleTime: 60_000,
  });
}

// ---- Bank Balance Refresh ----

export function useRefreshBankBalance() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (bankAccountId: string) => {
      const res = await fetch(`/api/bank-accounts/${bankAccountId}/refresh-balance`, {
        method: 'POST',
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to refresh balance');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treasury-overview', session?.user?.id] });
    },
  });
}
