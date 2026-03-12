'use client';
import { useBalances } from '@/hooks/useBalances';
import { useRealtimeBalances } from '@/hooks/useRealtimeBalances';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, truncateAddress } from '@/lib/utils';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

const TOKEN_COLORS: Record<string, string> = {
  USDC: 'bg-[#207679]/5 border-[#207679]/20',
  USDT: 'bg-green-50 border-green-200',
  PYUSD: 'bg-purple-50 border-purple-200',
};

export function BalanceSummary() {
  const { data: balances, isLoading, refetch, isFetching } = useBalances();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  useRealtimeBalances();

  const handleRefresh = async () => {
    await fetch('/api/balances/refresh', { method: 'POST' }).catch(() => {});
    refetch();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // Group by token
  const totals: Record<string, number> = {};
  for (const b of balances ?? []) {
    totals[b.token] = (totals[b.token] ?? 0) + parseFloat(b.balance);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Token Balances</h2>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-4">
        {Object.entries(totals).map(([token, total]) => (
          <Card key={token} className={`border-2 ${TOKEN_COLORS[token] ?? ''}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">{token}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(total)}</div>
              <div className="text-xs text-gray-500 mt-1">≈ ${formatCurrency(total)} USD</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-wallet breakdown */}
      {balances && balances.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-600">By Wallet</h3>
          {balances.map((b) => (
            <div
              key={`${b.walletId}-${b.token}`}
              className="flex items-center justify-between p-3 rounded-lg border bg-white"
            >
              <div className="flex items-center gap-3">
                <Badge variant={b.chain === 'ethereum' ? 'ethereum' : 'solana'}>
                  {b.chain === 'ethereum' ? 'ETH' : 'SOL'}
                </Badge>
                <span className="text-sm text-gray-500 font-mono">
                  {truncateAddress(b.walletAddress ?? '', 6)}
                </span>
                <Badge variant="outline">{b.token}</Badge>
              </div>
              <span className="font-semibold">{formatCurrency(b.balance)}</span>
            </div>
          ))}
        </div>
      )}

      {(!balances || balances.length === 0) && (
        <div className="text-center py-8 text-gray-400">
          No balances yet. Connect a wallet to get started.
        </div>
      )}
    </div>
  );
}
