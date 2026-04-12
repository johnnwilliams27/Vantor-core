'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ---- Types ----

export interface SystemHealth {
  total_enterprises: number;
  total_users: number;
  total_transactions: number;
  frozen_enterprises: number;
}

export interface EnterpriseRow {
  id: string;
  name: string;
  status: string;
  kyc_status: string;
  created_at: string;
  user_count: number;
}

export interface EnterpriseDetail {
  id: string;
  name: string;
  status: string;
  kyc_status: string;
  kyc_submitted_at: string | null;
  kyc_verified_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  user_count: number;
  transaction_count: number;
  recent_audit_logs: Array<{
    id: string;
    user_id: string | null;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    details: Record<string, unknown> | null;
    created_at: string;
    user_email?: string;
  }>;
}

// ---- Hooks ----

export function useSystemHealth() {
  return useQuery<SystemHealth>({
    queryKey: ['admin', 'system-health'],
    queryFn: async () => {
      const res = await fetch('/api/admin/system/health');
      if (!res.ok) throw new Error('Failed to fetch system health');
      const { data } = await res.json();
      return data;
    },
    refetchInterval: 30_000,
  });
}

export function useEnterprises() {
  return useQuery<EnterpriseRow[]>({
    queryKey: ['admin', 'enterprises'],
    queryFn: async () => {
      const res = await fetch('/api/admin/enterprises');
      if (!res.ok) throw new Error('Failed to fetch enterprises');
      const { data } = await res.json();
      return data;
    },
  });
}

export function useEnterprise(id: string | undefined) {
  return useQuery<EnterpriseDetail>({
    queryKey: ['admin', 'enterprise', id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/enterprises/${id}`);
      if (!res.ok) throw new Error('Failed to fetch enterprise');
      const { data } = await res.json();
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateEnterprise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string }) => {
      const res = await fetch('/api/admin/enterprises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create enterprise');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'enterprises'] });
      qc.invalidateQueries({ queryKey: ['admin', 'system-health'] });
    },
  });
}

export function useFreezeEnterprise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/enterprises/${id}/freeze`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to freeze enterprise');
      }
      return res.json();
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['admin', 'enterprise', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'enterprises'] });
      qc.invalidateQueries({ queryKey: ['admin', 'system-health'] });
    },
  });
}

export function useUnfreezeEnterprise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/enterprises/${id}/unfreeze`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to unfreeze enterprise');
      }
      return res.json();
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['admin', 'enterprise', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'enterprises'] });
      qc.invalidateQueries({ queryKey: ['admin', 'system-health'] });
    },
  });
}
