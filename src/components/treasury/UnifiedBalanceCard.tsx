'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, Coins } from 'lucide-react';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import { CardSpinner } from '@/components/ui/spinner';

const TOKEN_COLORS: Record<string, string> = {
  USDC: 'bg-blue-100 text-blue-800',
  USDT: 'bg-green-100 text-green-800',
};

function formatCurrency(value: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatUsdEquiv(value: number): string {
  return `~${formatCurrency(value, 'USD')} USD equiv.`;
}

export function UnifiedBalanceCard() {
  const { data: overview, isLoading } = useTreasuryOverview();

  const totalTreasury = (overview?.totalBankBalanceUsd ?? 0) + (overview?.totalCryptoBalanceUsd ?? 0);

  // Group fiat by currency
  const fiatByCurrency: Record<string, number> = {};
  for (const acct of overview?.bankAccounts ?? []) {
    const cur = acct.currency ?? 'USD';
    fiatByCurrency[cur] = (fiatByCurrency[cur] ?? 0) + acct.currentBalanceUsd;
  }

  // Group crypto by token
  const cryptoByToken: Record<string, number> = {};
  for (const pos of overview?.cryptoPositions ?? []) {
    cryptoByToken[pos.token] = (cryptoByToken[pos.token] ?? 0) + pos.usdValue;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
        {/* Fiat Holdings */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-gray-500" />
              Fiat Holdings
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            {isLoading ? (
              <CardSpinner />
            ) : !Object.keys(fiatByCurrency).length ? (
              <div className="text-sm text-muted-foreground py-4">No bank accounts connected.</div>
            ) : (
              <div className="flex-1 flex flex-col">
                <div className="space-y-4 flex-1">
                  {Object.entries(fiatByCurrency).map(([currency, total]) => (
                    <div key={currency} className="flex items-center justify-between">
                      <Badge variant={(currency.toLowerCase() as 'usd' | 'eur' | 'gbp') ?? 'default'}>
                        {currency}
                      </Badge>
                      <span className="text-sm font-semibold tabular-nums">{formatCurrency(total, currency)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-3 mt-4 flex justify-between items-center text-lg font-semibold">
                  <span>Total Fiat</span>
                  <span className="tabular-nums">{formatUsdEquiv(overview?.totalBankBalanceUsd ?? 0)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stablecoin Holdings */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-gray-500" />
              Stablecoin Holdings
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            {isLoading ? (
              <CardSpinner />
            ) : !Object.keys(cryptoByToken).length ? (
              <div className="text-sm text-muted-foreground py-4">No stablecoin positions found.</div>
            ) : (
              <div className="flex-1 flex flex-col">
                <div className="space-y-4 flex-1">
                  {Object.entries(cryptoByToken).map(([token, usdValue]) => (
                    <div key={token} className="flex items-center justify-between">
                      <Badge className={TOKEN_COLORS[token] ?? 'bg-gray-100 text-gray-800'}>
                        {token}
                      </Badge>
                      <span className="text-sm font-semibold tabular-nums">{formatCurrency(usdValue)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-3 mt-4 flex justify-between items-center text-lg font-semibold">
                  <span>Total Crypto</span>
                  <span className="tabular-nums">{formatUsdEquiv(overview?.totalCryptoBalanceUsd ?? 0)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Total Treasury */}
      <Card className="bg-[#19595b] text-white dark:bg-slate-800 dark:text-foreground dark:border-slate-700">
        <CardContent className="py-4 flex items-center justify-between">
          <span className="text-2xl font-semibold opacity-90 dark:opacity-100 dark:text-foreground">Total Treasury</span>
          <span className="text-2xl font-bold tabular-nums dark:text-white">{formatUsdEquiv(totalTreasury)}</span>
        </CardContent>
      </Card>
    </div>
  );
}
