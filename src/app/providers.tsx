'use client';
import { ThemeProvider } from 'next-themes';
import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, useMemo } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { WagmiConfig } from './wagmi-config';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter, LedgerWalletAdapter } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';
import { getSolanaRpcUrl } from '@/lib/yield/contracts/solana/cluster';

// Solana wallet adapter types are incompatible with React 18 — cast to suppress
const SolConnectionProvider = ConnectionProvider as any;
const SolWalletProvider = WalletProvider as any;
const SolWalletModalProvider = WalletModalProvider as any;

/**
 * Inner component that reads test mode from the query cache and passes the
 * appropriate Solana RPC endpoint to the ConnectionProvider.
 * Rendered inside QueryClientProvider so it can call useQuery.
 */
function SolanaProviders({ children }: { children: React.ReactNode }) {
  const { data: testModeData } = useQuery<{ testMode: boolean }>({
    queryKey: ['test-mode-status'],
    queryFn: async () => {
      const res = await fetch('/api/test-mode/status');
      if (!res.ok) return { testMode: false };
      return res.json();
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const testMode = testModeData?.testMode ?? false;
  const solanaEndpoint = getSolanaRpcUrl(testMode);

  const solanaWallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    new LedgerWalletAdapter(),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  return (
    <SolConnectionProvider endpoint={solanaEndpoint}>
      <SolWalletProvider wallets={solanaWallets} autoConnect>
        <SolWalletModalProvider>
          {children}
        </SolWalletModalProvider>
      </SolWalletProvider>
    </SolConnectionProvider>
  );
}

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
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem storageKey="vantor-theme">
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          <WagmiConfig>
            <SolanaProviders>
              <ToastProvider>
                {children}
              </ToastProvider>
            </SolanaProviders>
          </WagmiConfig>
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
