import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import type { SectionId } from '@/components/reporting/section-config';
import type { ViewResult } from '@/lib/analytics/types';

const SECTION_VIEW_MAP: Record<SectionId, string> = {
  'treasury-overview': 'treasury-summary',
  'obligation-coverage': 'obligation-coverage',
  'recommendations': 'ai-actions',
  'ramp-history': 'ramp-activity',
  'transfers': 'transfer-volume',
  'swaps': 'swap-activity',
  'invoices': 'invoice-aging',
  'compliance': 'compliance-summary',
  'yield': 'yield-performance',
};

async function queryAnalyticsView(
  viewSlug: string,
  from: string,
  to: string,
): Promise<ViewResult> {
  const res = await fetch('/api/analytics/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ viewSlug, from, to }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Query failed' }));
    throw new Error(err.error ?? `Analytics query failed (${res.status})`);
  }
  const { data } = await res.json();
  return data as ViewResult;
}

function useViewQuery(
  sectionId: SectionId,
  from: string | undefined,
  to: string | undefined,
  enabled: boolean,
) {
  const viewSlug = SECTION_VIEW_MAP[sectionId];
  return useQuery<ViewResult>({
    queryKey: ['analytics', viewSlug, from, to],
    queryFn: () => queryAnalyticsView(viewSlug, from!, to!),
    enabled,
    staleTime: 60_000,
  });
}

export function useReportData(from?: string, to?: string, sections?: Set<SectionId>) {
  const { data: session } = useSession();
  const hasSection = (id: SectionId) => !!from && !!to && !!session && !!sections?.has(id);

  const treasury = useViewQuery('treasury-overview', from, to, hasSection('treasury-overview'));
  const obligationCoverage = useViewQuery('obligation-coverage', from, to, hasSection('obligation-coverage'));
  const recommendations = useViewQuery('recommendations', from, to, hasSection('recommendations'));
  const rampHistory = useViewQuery('ramp-history', from, to, hasSection('ramp-history'));
  const transfers = useViewQuery('transfers', from, to, hasSection('transfers'));
  const swaps = useViewQuery('swaps', from, to, hasSection('swaps'));
  const invoices = useViewQuery('invoices', from, to, hasSection('invoices'));
  const compliance = useViewQuery('compliance', from, to, hasSection('compliance'));
  const yieldTxs = useViewQuery('yield', from, to, hasSection('yield'));

  const isLoading =
    (hasSection('treasury-overview') && treasury.isLoading) ||
    (hasSection('obligation-coverage') && obligationCoverage.isLoading) ||
    (hasSection('recommendations') && recommendations.isLoading) ||
    (hasSection('ramp-history') && rampHistory.isLoading) ||
    (hasSection('transfers') && transfers.isLoading) ||
    (hasSection('swaps') && swaps.isLoading) ||
    (hasSection('invoices') && invoices.isLoading) ||
    (hasSection('compliance') && compliance.isLoading) ||
    (hasSection('yield') && yieldTxs.isLoading);

  return {
    treasury,
    obligationCoverage,
    recommendations,
    rampHistory,
    transfers,
    swaps,
    invoices,
    compliance,
    yieldTxs,
    isLoading,
  };
}
