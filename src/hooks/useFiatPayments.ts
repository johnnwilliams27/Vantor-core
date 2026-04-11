import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { FiatPayment } from '@/types/fiat-payments';

export function useFiatPayments(status?: string) {
  return useQuery<FiatPayment[]>({
    queryKey: ['fiat-payments', status],
    queryFn: async () => {
      const url = status ? `/api/payments?status=${status}` : '/api/payments';
      const res = await fetch(url);
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 15_000,
  });
}

export function useCreateFiatPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      fromBankAccountId: string;
      toBankName: string;
      toAccountNumber: string;
      toRoutingNumber: string;
      toAccountHolder: string;
      amount: string;
      currency: string;
      paymentRail: 'ach_push' | 'ach_same_day' | 'wire' | 'swift' | 'sepa' | 'spei' | 'pix';
      scheduledFor?: string;
      invoiceId?: string;
      memo?: string;
    }) => {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? 'Failed to create payment');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fiat-payments'] });
    },
  });
}
