'use client';
import { ThemeProvider } from 'next-themes';
import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, useMemo } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { WagmiConfig } from './wagmi-config';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter, LedgerWalletAdapter } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';

// Solana wallet adapter types are incompatible with React 18 — cast to suppress
const SolConnectionProvider = ConnectionProvider as any;
const SolWalletProvider = WalletProvider as any;
const SolWalletModalProvider = WalletModalProvider as any;

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

  const solanaWallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    new LedgerWalletAdapter(),
  ], []);
  const solanaEndpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem storageKey="vantor-theme">
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          <WagmiConfig>
            <SolConnectionProvider endpoint={solanaEndpoint}>
              <SolWalletProvider wallets={solanaWallets} autoConnect>
                <SolWalletModalProvider>
                  <ToastProvider>
                    {children}
                  </ToastProvider>
                </SolWalletModalProvider>
              </SolWalletProvider>
            </SolConnectionProvider>
          </WagmiConfig>
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
