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

    // Full page reload. The test-mode boundary changes enterprise_id in
    // the session JWT, Zustand state, every React Query cache entry, and
    // the Solana ConnectionProvider's RPC endpoint (devnet ↔ mainnet-beta,
    // set at mount time). A reload is the only way to get all four in
    // sync atomically — partial cache invalidation leaves stale data
    // visible for the frame before the new mode's queries resolve, and
    // the Solana wallet stays on the wrong cluster entirely.
    //
    // Zustand + queryClient.clear() are kept as belt-and-suspenders for
    // any code path that reads state before the browser fires reload.
    setTestMode(enabled);
    queryClient.clear();
    window.location.reload();
  };

  return { testMode, toggleTestMode };
}
