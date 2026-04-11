'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import type { TreasuryInsightRow } from '@/lib/insights/types';

/**
 * TanStack Query hooks for the Treasury Insights feed.
 *
 * List fetch hits `GET /api/insights`, which already filters to the
 * authenticated user's active insights (`new` or `viewed`) newest first.
 * Mutations call `PATCH /api/insights/[id]` with one of the three
 * allowed actions (`view`, `dismiss`, `acted_on`) and invalidate the
 * list on success so the UI stays in sync.
 */

// Mirror of the query-key convention in useTreasury.ts.
function insightsQueryKey(userId: string | undefined) {
  return ['insights', userId] as const;
}

export function useInsights() {
  const { data: session } = useSession();

  return useQuery<TreasuryInsightRow[]>({
    queryKey: insightsQueryKey(session?.user?.id),
    queryFn: async () => {
      const res = await fetch('/api/insights');
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? 'Failed to fetch insights');
      }
      const { data } = await res.json();
      return (data ?? []) as TreasuryInsightRow[];
    },
    enabled: !!session?.user?.id,
    staleTime: 30_000,
    // Match the cron cadence: refresh the feed roughly every minute so
    // new insights land without a manual reload.
    refetchInterval: 60_000,
  });
}

type PatchAction = 'view' | 'dismiss' | 'acted_on';

async function patchInsight(id: string, action: PatchAction): Promise<TreasuryInsightRow> {
  const res = await fetch(`/api/insights/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `Failed to ${action} insight`);
  }
  const { data } = await res.json();
  return data as TreasuryInsightRow;
}

export function useMarkInsightViewed() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: (id: string) => patchInsight(id, 'view'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: insightsQueryKey(session?.user?.id) });
    },
  });
}

export function useDismissInsight() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: (id: string) => patchInsight(id, 'dismiss'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: insightsQueryKey(session?.user?.id) });
    },
  });
}

export function useMarkInsightActedOn() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: (id: string) => patchInsight(id, 'acted_on'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: insightsQueryKey(session?.user?.id) });
    },
  });
}
