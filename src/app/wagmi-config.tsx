'use client';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';

const config = getDefaultConfig({
  appName: 'Vantor',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'demo',
  chains: [mainnet],
  ssr: true,
  // wagmi default is 4s which triggers eth_blockNumber 900x/hr/tab and was
  // tripping Infura's per-second burst limit (429s). 30s is plenty for a
  // treasury dashboard.
  pollingInterval: 30_000,
  transports: {
    [mainnet.id]: http(
      process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL || undefined,
    ),
  },
});

export function WagmiConfig({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <RainbowKitProvider>{children}</RainbowKitProvider>
    </WagmiProvider>
  );
}
