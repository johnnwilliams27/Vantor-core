'use client';
import { ThemeProvider } from 'next-themes';
import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { WagmiConfig } from './wagmi-config';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 2 * 60 * 1000,      // 2 min — cached data shows instantly on re-visit
            gcTime: 10 * 60 * 1000,         // keep unused data in memory 10 min
            refetchOnWindowFocus: false,     // don't re-fetch just because user switched tabs
            refetchOnReconnect: false,       // don't re-fetch on network reconnect
          },
        },
      })
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="vantor-theme">
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          <WagmiConfig>
            <ToastProvider>
              {children}
            </ToastProvider>
          </WagmiConfig>
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
