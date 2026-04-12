import { useQuery } from '@tanstack/react-query';

export interface AnalyticsViewListItem {
  id: string;
  slug: string;
  label: string;
  description: string;
  kind: 'standard' | 'custom';
  chartType: string;
  config: Record<string, unknown>;
  sortOrder: number;
  forkedFrom?: string;
  createdAt?: string;
  updatedAt?: string;
}

async function fetchViews(): Promise<AnalyticsViewListItem[]> {
  const res = await fetch('/api/analytics/views');
  if (!res.ok) return [];
  const { data } = await res.json();
  return data ?? [];
}

export function useAnalyticsViews() {
  return useQuery<AnalyticsViewListItem[]>({
    queryKey: ['analytics-views'],
    queryFn: fetchViews,
    staleTime: 60_000,
  });
}
