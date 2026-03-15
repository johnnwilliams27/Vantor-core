import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useTreasuryReport } from './useTreasury';
import type { SectionId } from '@/components/reporting/section-config';
import type { Payment, Swap, Invoice, YieldTransaction } from '@/types/database';

function filterByDate<T>(items: T[], dateAccessor: (item: T) => string, from?: string, to?: string): T[] {
  if (!from && !to) return items;
  return items.filter((item) => {
    const d = dateAccessor(item).slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

export function useReportData(from?: string, to?: string, sections?: Set<SectionId>) {
  const { data: session } = useSession();
  const hasSection = (id: SectionId) => !!from && !!to && !!sections?.has(id);

  // Existing treasury report (covers overview, coverage, recommendations, ramps)
  const needsTreasury = hasSection('treasury-overview') || hasSection('obligation-coverage') ||
    hasSection('recommendations') || hasSection('ramp-history');
  const treasury = useTreasuryReport(needsTreasury ? from : undefined, needsTreasury ? to : undefined);

  const payments = useQuery<Payment[]>({
    queryKey: ['report-payments', from, to],
    queryFn: async () => {
      const res = await fetch('/api/payments');
      if (!res.ok) return [];
      const { data } = await res.json();
      return filterByDate(data ?? [], (p) => p.created_at, from, to);
    },
    enabled: hasSection('payments'),
    staleTime: 60_000,
  });

  const swaps = useQuery<Swap[]>({
    queryKey: ['report-swaps', from, to],
    queryFn: async () => {
      const res = await fetch('/api/swaps');
      if (!res.ok) return [];
      const { data } = await res.json();
      return filterByDate(data ?? [], (s) => s.created_at, from, to);
    },
    enabled: hasSection('swaps'),
    staleTime: 60_000,
  });

  const invoices = useQuery<Invoice[]>({
    queryKey: ['report-invoices', from, to],
    queryFn: async () => {
      const res = await fetch('/api/invoices');
      if (!res.ok) return [];
      const { data } = await res.json();
      return filterByDate(data ?? [], (i) => i.created_at, from, to);
    },
    enabled: hasSection('invoices'),
    staleTime: 60_000,
  });

  const compliance = useQuery<Record<string, unknown>>({
    queryKey: ['report-compliance'],
    queryFn: async () => {
      const res = await fetch('/api/compliance/overview');
      if (!res.ok) return {};
      const { data } = await res.json();
      return data ?? {};
    },
    enabled: hasSection('compliance'),
    staleTime: 60_000,
  });

  const yieldTxs = useQuery<YieldTransaction[]>({
    queryKey: ['report-yield', from, to],
    queryFn: async () => {
      const res = await fetch('/api/yield/transactions');
      if (!res.ok) return [];
      const { data } = await res.json();
      return filterByDate(data ?? [], (y) => y.executed_at ?? y.created_at, from, to);
    },
    enabled: hasSection('yield'),
    staleTime: 60_000,
  });

  const isLoading = (needsTreasury && treasury.isLoading) ||
    (hasSection('payments') && payments.isLoading) ||
    (hasSection('swaps') && swaps.isLoading) ||
    (hasSection('invoices') && invoices.isLoading) ||
    (hasSection('compliance') && compliance.isLoading) ||
    (hasSection('yield') && yieldTxs.isLoading);

  return {
    treasury,
    payments,
    swaps,
    invoices,
    compliance,
    yieldTxs,
    isLoading,
  };
}
