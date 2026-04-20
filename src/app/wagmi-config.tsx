'use client';
import { WagmiProvider } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { fallback, http } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';

// Mainnet fallback transport: user-configured RPC (Infura today) first, then free
// public endpoints. viem auto-rotates on 429/5xx so a single overloaded provider
// no longer breaks deposits. retryCount=2 with ~600ms delay keeps UX snappy.
const mainnetTransport = fallback(
  [
    process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL
      ? http(process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL, { retryCount: 2, retryDelay: 600 })
      : null,
    http('https://cloudflare-eth.com', { retryCount: 2, retryDelay: 600 }),
    http('https://ethereum-rpc.publicnode.com', { retryCount: 2, retryDelay: 600 }),
    http('https://rpc.ankr.com/eth', { retryCount: 2, retryDelay: 600 }),
  ].filter((t): t is NonNullable<typeof t> => t !== null),
  { rank: false },
);

const config = getDefaultConfig({
  appName: 'Vantor',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'demo',
  chains: [mainnet],
  ssr: true,
  // wagmi default is 4s which triggers eth_blockNumber 900x/hr/tab and was
  // tripping Infura's per-second burst limit (429s). 30s is plenty for a
  // treasury dashboard. viem's waitForTransactionReceipt inherits this too,
  // so we don't need to pass it explicitly there.
  pollingInterval: 30_000,
  transports: {
    [mainnet.id]: mainnetTransport,
  },
});

export function WagmiConfig({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <RainbowKitProvider>{children}</RainbowKitProvider>
    </WagmiProvider>
  );
}
