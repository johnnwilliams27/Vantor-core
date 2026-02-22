'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Invoice, InvoiceStatus } from '@/types/database';

export function useInvoices(status?: InvoiceStatus) {
  return useQuery<Invoice[]>({
    queryKey: ['invoices', status],
    queryFn: async () => {
      const url = status ? `/api/invoices?status=${status}` : '/api/invoices';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch invoices');
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });
}

export function useSyncInvoices(erpConfigId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/invoices/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ erpConfigId }),
      });
      if (!res.ok) throw new Error('Sync failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}
