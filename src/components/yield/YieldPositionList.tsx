'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, TrendingUp, ArrowDownRight } from 'lucide-react';
import { useYieldPositions, useRefreshPosition } from '@/hooks/useYield';
import { useToast } from '@/components/ui/toast';
import { YieldWithdrawForm } from './YieldWithdrawForm';
import { useState } from 'react';
import { CardSkeleton, CardError } from '@/components/ui/spinner';
import { UpgradeGate } from '@/components/ui/upgrade-gate';
import { getVenueDisplayName } from '@/lib/yield/venues';

const CHAIN_LABELS: Record<string, string> = {
  ethereum: 'Ethereum',
  solana: 'Solana',
};

function formatUsd(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(num);
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function formatAPY(value: string | number | null): string {
  if (value === null || value === undefined) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  // apy_snapshot is stored as a percentage (e.g. 6.1 = 6.1%), not a decimal
  return `${num.toFixed(2)}%`;
}

export function YieldPositionList() {
  const { data: positions, isLoading, isError, refetch } = useYieldPositions();
  const refreshPosition = useRefreshPosition();
  const { toast } = useToast();
  const [withdrawId, setWithdrawId] = useState<string | null>(null);

  const handleRefresh = async (id: string) => {
    try {
      await refreshPosition.mutateAsync(id);
      toast({ title: 'Position refreshed', variant: 'success' });
    } catch (err) {
      toast({ title: 'Refresh failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  if (isLoading) {
    return <Card><CardContent className="py-5"><CardSkeleton rows={4} /></CardContent></Card>;
  }

  if (isError) {
    return <Card><CardContent className="py-5"><CardError message="Failed to load positions." onRetry={() => refetch()} /></CardContent></Card>;
  }

  if (!positions?.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <TrendingUp className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">No active yield positions</p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            Go to "Explore Protocols" to deposit into a yield protocol.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (withdrawId) {
    const pos = positions.find((p) => p.id === withdrawId);
    if (pos) {
      return (
        <YieldWithdrawForm
          position={pos}
          onBack={() => setWithdrawId(null)}
        />
      );
    }
  }

  const totalValue = positions.reduce((s, p) => s + parseFloat(p.current_value_usd), 0);
  const totalYield = positions.reduce((s, p) => s + parseFloat(p.accrued_yield_usd), 0);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Deposited</p>
            <p className="text-xl font-bold mt-1 tabular-nums">{formatUsd(totalValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Yield Earned</p>
            <p className="text-xl font-bold mt-1 tabular-nums text-green-400">{formatUsd(totalYield)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Active Positions</p>
            <p className="text-xl font-bold mt-1 tabular-nums">{positions.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Position cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {positions.map((pos) => (
          <Card key={pos.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  {getVenueDisplayName(pos.protocol)}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={pos.chain === 'ethereum' ? 'ethereum' : 'solana'}>{CHAIN_LABELS[pos.chain] ?? pos.chain}</Badge>
                  <Badge variant="secondary">{pos.underlying_token}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Deposited</p>
                  <p className="font-medium tabular-nums">{formatUsd(pos.deposited_amount)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Current Value</p>
                  <p className="font-medium tabular-nums">{formatUsd(pos.current_value_usd)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Yield Earned</p>
                  <p className="font-medium tabular-nums text-green-400">{formatUsd(pos.accrued_yield_usd)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">APY</p>
                  <p className="font-medium tabular-nums">{formatAPY(pos.apy_snapshot)}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 pt-2 text-xs font-medium">
                <button
                  onClick={() => handleRefresh(pos.id)}
                  disabled={refreshPosition.isPending}
                  className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 rounded-sm"
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh
                </button>
                <UpgradeGate feature="Withdraw from Yield">
                  <button
                    onClick={() => setWithdrawId(pos.id)}
                    className="text-teal-500 hover:text-teal-400 transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 rounded-sm"
                  >
                    Withdraw →
                  </button>
                </UpgradeGate>
              </div>

              {pos.last_refreshed_at && (
                <p className="text-2xs text-muted-foreground/60">
                  Refreshed {formatRelativeTime(pos.last_refreshed_at)}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
