'use client';
import { useQuery } from '@tanstack/react-query';

export interface FxRatesData {
  rates: Record<string, number>;
  fetchedAt: string | null;
  source: 'exchangeratesapi.io' | 'mock';
}

export function useFxRates() {
  return useQuery<FxRatesData>({
    queryKey: ['fx-rates'],
    queryFn: async () => {
      const res = await fetch('/api/fx/rates');
      if (!res.ok) throw new Error('Failed to fetch FX rates');
      return res.json();
    },
    staleTime: 30 * 60 * 1000, // 30 minutes
  });
}
