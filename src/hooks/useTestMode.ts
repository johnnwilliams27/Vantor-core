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

    // Clear ALL cached queries to prevent stale cross-mode data
    queryClient.clear();

    // Re-fetch test mode status
    queryClient.invalidateQueries({ queryKey: ['test-mode-status'] });
  };

  return { testMode, toggleTestMode };
}
