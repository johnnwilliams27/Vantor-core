'use client';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

export interface BalanceSummaryItem {
  walletId: string;
  walletAddress: string;
  chain: string;
  token: string;
  balance: string;
  usdValue: string | null;
}

export function useBalances() {
  const { data: session } = useSession();

  return useQuery<BalanceSummaryItem[]>({
    queryKey: ['balances', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/balances');
      if (!res.ok) throw new Error('Failed to fetch balances');
      const { data } = await res.json();
      return data ?? [];
    },
    enabled: !!session?.user?.id,
    refetchInterval: 60_000, // fallback poll every 60s
    staleTime: 30_000,
  });
}

/** Look up the balance for a specific wallet + token pair. */
export function useWalletTokenBalance(walletId: string | undefined, token: string | undefined) {
  const { data: balances } = useBalances();

  return useMemo(() => {
    if (!walletId || !token || !balances) return null;
    const match = balances.find((b) => b.walletId === walletId && b.token === token);
    return match ? parseFloat(match.balance) : 0;
  }, [balances, walletId, token]);
}

/** Look up total balance across all tokens for a wallet. */
export function useWalletTotalBalance(walletId: string | undefined) {
  const { data: balances } = useBalances();

  return useMemo(() => {
    if (!walletId || !balances) return null;
    return balances
      .filter((b) => b.walletId === walletId)
      .reduce((sum, b) => sum + (b.usdValue ? parseFloat(b.usdValue) : 0), 0);
  }, [balances, walletId]);
}

export interface WalletTokenHolding {
  token: string;
  balance: number;
  usdValue: number;
}

/**
 * Per-wallet token holdings (native amounts, not USD-collapsed),
 * sorted by USD value descending. Keyed by walletId.
 */
export function useWalletTokenHoldings() {
  const { data: balances } = useBalances();

  return useMemo(() => {
    const map = new Map<string, WalletTokenHolding[]>();
    if (!balances) return map;
    for (const b of balances) {
      const native = parseFloat(b.balance);
      if (!isFinite(native) || native <= 0) continue;
      const list = map.get(b.walletId) ?? [];
      list.push({
        token: b.token,
        balance: native,
        usdValue: b.usdValue ? parseFloat(b.usdValue) : 0,
      });
      map.set(b.walletId, list);
    }
    map.forEach((list) => {
      list.sort((a: WalletTokenHolding, b: WalletTokenHolding) => b.usdValue - a.usdValue);
    });
    return map;
  }, [balances]);
}

/** Format a single token amount, e.g. "50,000.00 USDC" or "0.0512 ETH". */
function formatTokenAmount(amount: number, token: string): string {
  if (!isFinite(amount)) return `0 ${token}`;
  let formatted: string;
  if (amount >= 1_000_000) {
    formatted = new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(amount);
  } else if (amount > 0 && amount < 1) {
    formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(amount);
  } else {
    formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }
  return `${formatted} ${token}`;
}

/**
 * Format a wallet's token holdings for dropdown labels.
 * Shows the top holdings in their native currency, e.g.:
 *   "50,000.00 USDC"            (single-token wallet)
 *   "50,000.00 USDC + 0.0512 ETH" (multi-token wallet, top 2)
 *   "50,000.00 USDC + 2 more"   (more than 2 tokens)
 */
export function formatWalletTokensLabel(holdings: WalletTokenHolding[] | undefined): string {
  if (!holdings || holdings.length === 0) return '';
  const first = formatTokenAmount(holdings[0].balance, holdings[0].token);
  if (holdings.length === 1) return first;
  if (holdings.length === 2) {
    return `${first} + ${formatTokenAmount(holdings[1].balance, holdings[1].token)}`;
  }
  return `${first} + ${holdings.length - 1} more`;
}
