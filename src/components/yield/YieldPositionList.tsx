'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, TrendingUp, ArrowDownRight } from 'lucide-react';
import { useYieldPositions, useRefreshPosition } from '@/hooks/useYield';
import { useToast } from '@/components/ui/toast';
import { YieldWithdrawForm } from './YieldWithdrawForm';
import { useState } from 'react';
import { CardSpinner } from '@/components/ui/spinner';

const PROTOCOL_LABELS: Record<string, string> = {
  aave_v3: 'Aave V3',
  morpho: 'Morpho',
  kamino: 'Kamino',
  ondo: 'Ondo (USDY)',
};

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

function formatAPY(value: string | number | null): string {
  if (value === null || value === undefined) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return `${(num * 100).toFixed(2)}%`;
}

export function YieldPositionList() {
  const { data: positions, isLoading } = useYieldPositions();
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
    return <CardSpinner />;
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
            <p className="text-xl font-bold mt-1">{formatUsd(totalValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Yield Earned</p>
            <p className="text-xl font-bold mt-1 text-green-600">{formatUsd(totalYield)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Active Positions</p>
            <p className="text-xl font-bold mt-1">{positions.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Position cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {positions.map((pos) => (
          <Card key={pos.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  {PROTOCOL_LABELS[pos.protocol] ?? pos.protocol}
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
                  <p className="font-medium">{formatUsd(pos.deposited_amount)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Current Value</p>
                  <p className="font-medium">{formatUsd(pos.current_value_usd)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Yield Earned</p>
                  <p className="font-medium text-green-600">{formatUsd(pos.accrued_yield_usd)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">APY</p>
                  <p className="font-medium">{formatAPY(pos.apy_snapshot)}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => handleRefresh(pos.id)}
                  disabled={refreshPosition.isPending}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => setWithdrawId(pos.id)}
                >
                  <ArrowDownRight className="h-3.5 w-3.5" />
                  Withdraw
                </Button>
              </div>

              {pos.last_refreshed_at && (
                <p className="text-[11px] text-muted-foreground/60">
                  Last refreshed: {new Date(pos.last_refreshed_at).toLocaleString()}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
