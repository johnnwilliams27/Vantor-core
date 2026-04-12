import { useQuery } from '@tanstack/react-query';
import type { ViewResult, TimeGranularity } from '@/lib/analytics/types';

interface ViewQueryOptions {
  viewSlug: string;
  from: string;
  to: string;
  filters?: Record<string, string | string[]>;
  granularity?: TimeGranularity;
  page?: number;
  pageSize?: number;
  enabled?: boolean;
}

async function fetchViewQuery(opts: Omit<ViewQueryOptions, 'enabled'>): Promise<ViewResult> {
  const res = await fetch('/api/analytics/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      viewSlug: opts.viewSlug,
      from: opts.from,
      to: opts.to,
      filters: opts.filters,
      granularity: opts.granularity,
      page: opts.page,
      pageSize: opts.pageSize,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Query failed' }));
    throw new Error(err.error ?? 'Analytics query failed');
  }
  const { data } = await res.json();
  return data;
}

export function useViewQuery(opts: ViewQueryOptions) {
  return useQuery<ViewResult>({
    queryKey: [
      'analytics-query',
      opts.viewSlug,
      opts.from,
      opts.to,
      opts.filters,
      opts.granularity,
      opts.page,
      opts.pageSize,
    ],
    queryFn: () => fetchViewQuery(opts),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  });
}
