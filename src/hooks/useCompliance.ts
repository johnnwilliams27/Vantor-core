'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import type {
  SanctionsScreening,
  KytTransfer,
  KytAlert,
  TravelRuleTransfer,
  KytAlertStatus,
  KytAlertSeverity,
} from '@/types/database';

// ---- Overview ----

export interface ComplianceOverview {
  screenings24h: number;
  sanctionedHits24h: number;
  openAlerts: { low: number; medium: number; high: number; severe: number };
  totalOpenAlerts: number;
  pendingTravelRule: number;
  highRiskTransfers: Array<{
    id: string;
    external_id: string;
    chain: string;
    direction: string;
    amount: string | null;
    asset_amount_usd: string | null;
    risk_score: string | null;
    registered_at: string;
  }>;
}

export function useComplianceOverview() {
  const { data: session } = useSession();
  return useQuery<ComplianceOverview>({
    queryKey: ['compliance-overview', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/compliance/overview');
      if (!res.ok) throw new Error('Failed to fetch compliance overview');
      const { data } = await res.json();
      return data;
    },
    enabled: !!session?.user?.id,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ---- Sanctions Screenings ----

export function useSanctionsScreenings(result?: string) {
  const { data: session } = useSession();
  return useQuery<SanctionsScreening[]>({
    queryKey: ['sanctions-screenings', session?.user?.id, result],
    queryFn: async () => {
      const params = result ? `?result=${result}` : '';
      const res = await fetch(`/api/compliance/screening${params}`);
      if (!res.ok) throw new Error('Failed to fetch screenings');
      const { data } = await res.json();
      return data ?? [];
    },
    enabled: !!session?.user?.id,
    staleTime: 15_000,
  });
}

export function useScreenAddress() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (payload: { address: string; chain: 'ethereum' | 'solana' }) => {
      const res = await fetch('/api/compliance/screening', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Screening failed');
      }
      const { data } = await res.json();
      return data as SanctionsScreening;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sanctions-screenings', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['compliance-overview', session?.user?.id] });
    },
  });
}

// ---- KYT Transfers ----

export function useKytTransfers(minRisk?: number) {
  const { data: session } = useSession();
  return useQuery<KytTransfer[]>({
    queryKey: ['kyt-transfers', session?.user?.id, minRisk],
    queryFn: async () => {
      const params = minRisk ? `?min_risk=${minRisk}` : '';
      const res = await fetch(`/api/compliance/kyt/transfers${params}`);
      if (!res.ok) throw new Error('Failed to fetch KYT transfers');
      const { data } = await res.json();
      return data ?? [];
    },
    enabled: !!session?.user?.id,
    staleTime: 15_000,
  });
}

// ---- KYT Alerts ----

export function useKytAlerts(status?: KytAlertStatus, severity?: KytAlertSeverity) {
  const { data: session } = useSession();
  return useQuery<KytAlert[]>({
    queryKey: ['kyt-alerts', session?.user?.id, status, severity],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (severity) params.set('severity', severity);
      const qs = params.toString() ? `?${params}` : '';
      const res = await fetch(`/api/compliance/kyt/alerts${qs}`);
      if (!res.ok) throw new Error('Failed to fetch KYT alerts');
      const { data } = await res.json();
      return data ?? [];
    },
    enabled: !!session?.user?.id,
    staleTime: 15_000,
  });
}

export function useUpdateKytAlert() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({ id, status, review_notes }: {
      id: string;
      status: 'under_review' | 'dismissed' | 'escalated' | 'resolved';
      review_notes?: string;
    }) => {
      const res = await fetch(`/api/compliance/kyt/alerts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, review_notes }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to update alert');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kyt-alerts', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['compliance-overview', session?.user?.id] });
    },
  });
}

// ---- Travel Rule ----

export function useTravelRuleTransfers(status?: string) {
  const { data: session } = useSession();
  return useQuery<TravelRuleTransfer[]>({
    queryKey: ['travel-rule-transfers', session?.user?.id, status],
    queryFn: async () => {
      const params = status ? `?status=${status}` : '';
      const res = await fetch(`/api/compliance/travel-rule${params}`);
      if (!res.ok) throw new Error('Failed to fetch travel rule transfers');
      const { data } = await res.json();
      return data ?? [];
    },
    enabled: !!session?.user?.id,
    staleTime: 15_000,
  });
}

export function useCreateTravelRule() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (payload: {
      paymentId?: string;
      direction: 'outgoing' | 'incoming';
      amountUsd: number;
      originatorName: string;
      originatorAddress?: string;
      originatorWallet: string;
      originatorChain: 'ethereum' | 'solana';
      originatorVasp?: string;
      beneficiaryName: string;
      beneficiaryAddress?: string;
      beneficiaryWallet: string;
      beneficiaryChain: 'ethereum' | 'solana';
      beneficiaryVasp?: string;
    }) => {
      const res = await fetch('/api/compliance/travel-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to create travel rule transfer');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['travel-rule-transfers', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['compliance-overview', session?.user?.id] });
    },
  });
}
