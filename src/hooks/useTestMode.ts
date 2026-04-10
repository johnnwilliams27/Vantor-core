'use client';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/store/appStore';

/**
 * Syncs test mode state from server cookie to Zustand store on mount.
 * Provides toggle function that sets cookie via API + clears all query cache.
 */
export function useTestMode() {
  const { testMode, setTestMode } = useAppStore();
  const queryClient = useQueryClient();

  // Fetch initial test mode status from server
  const { data } = useQuery({
    queryKey: ['test-mode-status'],
    queryFn: async () => {
      const res = await fetch('/api/test-mode/status');
      if (!res.ok) return { testMode: false };
      return res.json() as Promise<{ testMode: boolean }>;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // Sync server state to Zustand on load
  useEffect(() => {
    if (data) {
      setTestMode(data.testMode);
    }
  }, [data, setTestMode]);

  const toggleTestMode = async (enabled: boolean) => {
    const res = await fetch('/api/test-mode/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });

    if (!res.ok) {
      throw new Error('Failed to toggle test mode');
    }

    setTestMode(enabled);

    // Clear ALL cached queries and refetch active ones to prevent stale cross-mode data
    queryClient.clear();
    await queryClient.invalidateQueries();
    await queryClient.refetchQueries();
    // NOTE: The Solana ConnectionProvider's RPC endpoint is set at mount time
    // based on the test-mode-status query. A full page reload is required for
    // the wallet adapter to pick up the new RPC URL (devnet vs mainnet-beta)
    // when test mode is toggled. If seamless switching is needed in future,
    // refactor ConnectionProvider to be rendered below QueryClientProvider and
    // re-key it when cluster changes.
    // window.location.reload(); // Uncomment to force RPC reconnect on toggle.
  };

  return { testMode, toggleTestMode };
}
