import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ScheduledOperation, ScheduledOperationType } from '@/types/scheduled-operations';

async function safeJsonParse(res: Response): Promise<ScheduledOperation[]> {
  try {
    if (!res.ok) return [];
    const text = await res.text();
    if (!text || text.startsWith('<!')) return []; // HTML error page
    const { data } = JSON.parse(text);
    return data ?? [];
  } catch {
    return [];
  }
}

export function useScheduledOperations(filters?: { type?: ScheduledOperationType; status?: string }) {
  return useQuery<ScheduledOperation[]>({
    queryKey: ['scheduled-operations', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.type) params.set('type', filters.type);
      if (filters?.status) params.set('status', filters.status);
      const res = await fetch(`/api/scheduled-operations?${params}`);
      return safeJsonParse(res);
    },
    staleTime: 15_000,
  });
}

export function usePendingApprovals() {
  return useQuery<ScheduledOperation[]>({
    queryKey: ['scheduled-operations', { status: 'awaiting_authorization' }],
    queryFn: async () => {
      const res = await fetch('/api/scheduled-operations?status=awaiting_authorization');
      return safeJsonParse(res);
    },
    staleTime: 15_000,
  });
}

export function useScheduledOperationQuote(id: string) {
  return useQuery<{ data: ScheduledOperation }>({
    queryKey: ['scheduled-operation', id],
    queryFn: async () => {
      const res = await fetch(`/api/scheduled-operations/${id}`);
      if (!res.ok) throw new Error('Failed to fetch operation');
      return res.json();
    },
    enabled: !!id,
  });
}

export function useApproveScheduledOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/scheduled-operations/${id}/approve`, { method: 'POST' });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? 'Approval failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-operations'] });
    },
  });
}

export function useCancelScheduledOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/scheduled-operations/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? 'Cancellation failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-operations'] });
    },
  });
}

export function useCreateScheduledOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      type: ScheduledOperationType;
      scheduledFor: string;
      memo?: string;
      params: Record<string, unknown>;
    }) => {
      const res = await fetch('/api/scheduled-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? 'Failed to schedule');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-operations'] });
    },
  });
}
