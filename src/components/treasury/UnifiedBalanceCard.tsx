'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Building2, Coins, RefreshCw, AlertTriangle } from 'lucide-react';
import { useTreasuryOverview, useRefreshBankBalance } from '@/hooks/useTreasury';
import { useToast } from '@/components/ui/toast';

const TOKEN_COLORS: Record<string, string> = {
  USDC: 'bg-blue-100 text-blue-800',
  USDT: 'bg-green-100 text-green-800',
  PYUSD: 'bg-purple-100 text-purple-800',
};

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function isStale(balanceAsOf: string | null): boolean {
  if (!balanceAsOf) return true;
  return Date.now() - new Date(balanceAsOf).getTime() > 4 * 60 * 60 * 1000; // 4h
}

export function UnifiedBalanceCard() {
  const { data: overview, isLoading } = useTreasuryOverview();
  const refreshBalance = useRefreshBankBalance();
  const { toast } = useToast();

  const handleRefresh = async (accountId: string) => {
    try {
      await refreshBalance.mutateAsync(accountId);
      toast({ title: 'Balance refreshed', variant: 'success' });
    } catch (err) {
      toast({ title: 'Refresh failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const totalTreasury = (overview?.totalBankBalanceUsd ?? 0) + (overview?.totalCryptoBalanceUsd ?? 0);

  // Group crypto by token
  const cryptoByToken: Record<string, number> = {};
  for (const pos of overview?.cryptoPositions ?? []) {
    cryptoByToken[pos.token] = (cryptoByToken[pos.token] ?? 0) + pos.usdValue;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Fiat Holdings */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-gray-500" />
              Fiat Holdings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground py-4">Loading…</div>
            ) : !overview?.bankAccounts.length ? (
              <div className="text-sm text-muted-foreground py-4">No bank accounts connected.</div>
            ) : (
              <div className="space-y-3">
                {overview.bankAccounts.map((acct) => {
                  const stale = isStale(acct.balanceAsOf);
                  return (
                    <div key={acct.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">
                            {acct.institutionName}
                            {acct.last4 && (
                              <span className="text-muted-foreground font-mono ml-1">****{acct.last4}</span>
                            )}
                          </span>
                          {stale && (
                            <Badge variant="warning" className="text-xs flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Stale
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{acct.accountName}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-semibold tabular-nums">
                          {formatUsd(acct.currentBalanceUsd)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleRefresh(acct.id)}
                          disabled={refreshBalance.isPending}
                          title="Refresh balance"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${refreshBalance.isPending ? 'animate-spin' : ''}`} />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                <div className="border-t pt-2 flex justify-between text-sm font-semibold">
                  <span>Total Fiat</span>
                  <span>{formatUsd(overview.totalBankBalanceUsd)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stablecoin Holdings */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-4 w-4 text-gray-500" />
              Stablecoin Holdings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground py-4">Loading…</div>
            ) : !Object.keys(cryptoByToken).length ? (
              <div className="text-sm text-muted-foreground py-4">No stablecoin positions found.</div>
            ) : (
              <div className="space-y-3">
                {Object.entries(cryptoByToken).map(([token, usdValue]) => (
                  <div key={token} className="flex items-center justify-between">
                    <Badge className={TOKEN_COLORS[token] ?? 'bg-gray-100 text-gray-800'}>
                      {token}
                    </Badge>
                    <span className="text-sm font-semibold tabular-nums">{formatUsd(usdValue)}</span>
                  </div>
                ))}
                <div className="border-t pt-2 flex justify-between text-sm font-semibold">
                  <span>Total Crypto</span>
                  <span>{formatUsd(overview?.totalCryptoBalanceUsd ?? 0)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Total Treasury */}
      <Card className="bg-[#207679] text-white">
        <CardContent className="py-4 flex items-center justify-between">
          <span className="text-sm font-medium opacity-90">Total Treasury</span>
          <span className="text-2xl font-bold tabular-nums">{formatUsd(totalTreasury)}</span>
        </CardContent>
      </Card>
    </div>
  );
}
