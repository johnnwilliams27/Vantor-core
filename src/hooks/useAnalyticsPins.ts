import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const DEFAULT_PINS = ['balance-history', 'obligation-coverage'];

async function fetchPins(): Promise<string[]> {
  const res = await fetch('/api/analytics/pins');
  if (!res.ok) return DEFAULT_PINS;
  const { data } = await res.json();
  return data?.pinnedSlugs ?? DEFAULT_PINS;
}

async function updatePins(slugs: string[]): Promise<string[]> {
  const res = await fetch('/api/analytics/pins', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slugs }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Update failed' }));
    throw new Error(err.error ?? 'Failed to update pins');
  }
  const { data } = await res.json();
  return data.pinnedSlugs;
}

export function useAnalyticsPins() {
  const queryClient = useQueryClient();

  const query = useQuery<string[]>({
    queryKey: ['analytics-pins'],
    queryFn: fetchPins,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: updatePins,
    onSuccess: (newPins) => {
      queryClient.setQueryData(['analytics-pins'], newPins);
    },
  });

  const togglePin = (slug: string) => {
    const current = query.data ?? DEFAULT_PINS;
    const isPinned = current.includes(slug);
    if (isPinned) {
      mutation.mutate(current.filter((s) => s !== slug));
    } else if (current.length < 4) {
      mutation.mutate([...current, slug]);
    }
  };

  return {
    pins: query.data ?? DEFAULT_PINS,
    isLoading: query.isLoading,
    togglePin,
    isPinned: (slug: string) => (query.data ?? DEFAULT_PINS).includes(slug),
    isPinning: mutation.isPending,
  };
}
