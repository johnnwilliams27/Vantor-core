/**
 * Solana cluster configuration for mainnet-beta and devnet.
 * Devnet is used when test mode is enabled.
 */

export type SolanaCluster = 'mainnet-beta' | 'devnet';

export const SOLANA_RPC_URLS: Record<SolanaCluster, string> = {
  'mainnet-beta': process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
  'devnet': process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com',
};

export function getSolanaCluster(testMode: boolean): SolanaCluster {
  return testMode ? 'devnet' : 'mainnet-beta';
}

export function getSolanaRpcUrl(testMode: boolean): string {
  return SOLANA_RPC_URLS[getSolanaCluster(testMode)];
}

// ─── Kamino addresses ─────────────────────────────────────────────────────────

/**
 * Kamino main market addresses.
 * NOTE: KAMINO_DEVNET_MARKET is a placeholder — Kamino's devnet deployment
 * uses a different market address that needs verification against their devnet
 * docs or SDK constants before going live.
 */
export const KAMINO_MAINNET_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
export const KAMINO_DEVNET_MARKET = '6WVSwDQXrBZeQVnu6hpnsRsmQQ2xnp1nN3MvqWzL3UJU'; // TODO: verify against Kamino devnet

export function getKaminoMarket(cluster: SolanaCluster): string {
  return cluster === 'devnet' ? KAMINO_DEVNET_MARKET : KAMINO_MAINNET_MARKET;
}

// ─── Token mints ──────────────────────────────────────────────────────────────

/** USDC mint differs between mainnet and devnet. */
export const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDC_DEVNET_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

/** USDT on devnet — same address as Circle's devnet USDT faucet (verify before use). */
export const USDT_MAINNET_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
export const USDT_DEVNET_MINT = 'EJwZgeZrdC8TXTQbQBoL6bfuAnFUUy1PVCMB4DYPzVaS'; // TODO: verify

export function getUsdcMint(cluster: SolanaCluster): string {
  return cluster === 'devnet' ? USDC_DEVNET_MINT : USDC_MAINNET_MINT;
}

export function getUsdtMint(cluster: SolanaCluster): string {
  return cluster === 'devnet' ? USDT_DEVNET_MINT : USDT_MAINNET_MINT;
}

/**
 * Returns the cluster-aware token mint map for USDC and USDT.
 */
export function getTokenMints(cluster: SolanaCluster): Record<string, string> {
  return {
    USDC: getUsdcMint(cluster),
    USDT: getUsdtMint(cluster),
  };
}
