'use client';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, Coins, Info } from 'lucide-react';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import { useYieldPositions } from '@/hooks/useYield';
import { useFxRates } from '@/hooks/useFxRates';
import { CardSpinner } from '@/components/ui/spinner';

const TOKEN_COLORS: Record<string, string> = {
  USDC: 'bg-blue-100 text-blue-800',
  USDT: 'bg-green-100 text-green-800',
};

const PROTOCOL_LABELS: Record<string, string> = {
  aave_v3: 'Aave V3', morpho: 'Morpho', morpho_steakhouse: 'Morpho Steakhouse',
  kamino: 'Kamino', kamino_multiply: 'Kamino Multiply', ondo: 'Ondo (USDY)',
  sky: 'Sky sUSDS', ethena: 'Ethena sUSDe', maple: 'Maple', drift: 'Drift',
  compound_v3: 'Compound V3',
};

const PROTOCOL_LOGOS: Record<string, string> = {
  aave_v3: '/partners/Aave_idWRQ7YLO7_0.svg',
  morpho: '/partners/morpho-white.svg',
  morpho_steakhouse: '/partners/morpho-white.svg',
  kamino: '/partners/kamino-logo.svg',
  kamino_multiply: '/partners/kamino-logo.svg',
  ondo: '/partners/Ondo_Logo_0.svg',
  sky: '/partners/sky_logo.png',
  ethena: '/partners/ethena_logo.png',
  maple: '/partners/maple_logo.svg',
  drift: '/partners/drift_logo.svg',
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

function FxAttribution({ source, fetchedAt }: { source: string; fetchedAt: string | null }) {
  const label = source === 'mock'
    ? 'FX rates: estimated'
    : `FX rates via ${source}`;
  const time = fetchedAt
    ? `, updated ${new Date(fetchedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : '';

  return (
    <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
      <Info className="h-3 w-3 shrink-0" />
      <span>{label}{time}</span>
    </div>
  );
}

export function UnifiedBalanceCard() {
  const { data: overview, isLoading } = useTreasuryOverview();
  const { data: yieldPositions } = useYieldPositions();
  const { data: fxData } = useFxRates();

  const activePositions = (yieldPositions ?? []).filter(p => p.is_active);
  const totalDeployedUsd = activePositions.reduce((s, p) => s + parseFloat(p.current_value_usd), 0);
  const totalTreasury = (overview?.totalBankBalanceUsd ?? 0) + (overview?.totalCryptoBalanceUsd ?? 0) + totalDeployedUsd;

  // Group fiat by currency — track both USD-converted and local amounts
  const fiatByCurrency: Record<string, { usd: number; local: number }> = {};
  const fxRates = fxData?.rates ?? {};
  for (const acct of overview?.bankAccounts ?? []) {
    const cur = acct.currency ?? 'USD';
    if (!fiatByCurrency[cur]) fiatByCurrency[cur] = { usd: 0, local: 0 };
    fiatByCurrency[cur].usd += acct.currentBalanceUsd;
    // Reconstruct local amount from USD value × FX rate
    const fxRate = fxRates[cur] ?? 1;
    fiatByCurrency[cur].local += acct.currentBalanceUsd * fxRate;
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
                  {Object.entries(fiatByCurrency).map(([currency, { usd, local }]) => (
                    <div key={currency} className="flex items-center justify-between">
                      <Badge variant={(currency.toLowerCase() as 'usd' | 'eur' | 'gbp' | 'brl' | 'mxn') ?? 'default'}>
                        {currency}
                      </Badge>
                      <div className="text-right">
                        <span className="text-sm font-semibold tabular-nums">{formatCurrency(local, currency)}</span>
                        {currency !== 'USD' && (
                          <div className="text-[11px] text-muted-foreground tabular-nums">{formatUsdEquiv(usd)}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-3 mt-4">
                  <div className="flex justify-between items-center text-lg font-semibold">
                    <span>Total Fiat</span>
                    <span className="tabular-nums">{formatUsdEquiv(overview?.totalBankBalanceUsd ?? 0)}</span>
                  </div>
                  {fxData && Object.keys(fiatByCurrency).some(c => c !== 'USD') && (
                    <FxAttribution source={fxData.source} fetchedAt={fxData.fetchedAt} />
                  )}
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
            ) : !Object.keys(cryptoByToken).length && !activePositions.length ? (
              <div className="text-sm text-muted-foreground py-4">No stablecoin positions found.</div>
            ) : (
              <div className="flex-1 flex flex-col">
                {/* Available */}
                {Object.keys(cryptoByToken).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Available</p>
                    <div className="space-y-3">
                      {Object.entries(cryptoByToken).map(([token, usdValue]) => (
                        <div key={token} className="flex items-center justify-between">
                          <Badge className={TOKEN_COLORS[token] ?? 'bg-gray-100 text-gray-800'}>
                            {token}
                          </Badge>
                          <span className="text-sm font-semibold tabular-nums">{formatCurrency(usdValue)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Deployed */}
                {activePositions.length > 0 && (
                  <div className={Object.keys(cryptoByToken).length > 0 ? 'mt-4' : ''}>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Deployed in Yield</p>
                    <div className="space-y-3">
                      {activePositions.map((pos) => (
                        <div key={pos.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {PROTOCOL_LOGOS[pos.protocol] && (
                              <Image src={PROTOCOL_LOGOS[pos.protocol]} alt={pos.protocol} width={16} height={16} className="h-4 w-4 object-contain" unoptimized />
                            )}
                            <span className="text-sm text-muted-foreground">
                              {PROTOCOL_LABELS[pos.protocol] ?? pos.protocol}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-semibold tabular-nums">{formatCurrency(parseFloat(pos.current_value_usd))}</span>
                            {pos.apy_snapshot && (
                              <div className="text-[11px] text-green-600 tabular-nums">{parseFloat(pos.apy_snapshot).toFixed(2)}% APY</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="border-t pt-3 mt-4">
                  <div className="flex justify-between items-center text-lg font-semibold">
                    <span>Total Crypto</span>
                    <span className="tabular-nums">{formatUsdEquiv((overview?.totalCryptoBalanceUsd ?? 0) + totalDeployedUsd)}</span>
                  </div>
                  {overview?.priceSource === 'coingecko' && (
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
                      <Info className="h-3 w-3 shrink-0" />
                      <span>Prices via CoinGecko</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Total Treasury */}
      <Card className="bg-[#19595b] text-white dark:bg-slate-800 dark:text-foreground dark:border-slate-700">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <span className="text-2xl font-semibold opacity-90 dark:opacity-100 dark:text-foreground">Total Treasury</span>
            <span className="text-2xl font-bold tabular-nums dark:text-white">{formatUsdEquiv(totalTreasury)}</span>
          </div>
          {fxData && fxData.source !== 'mock' && (
            <div className="flex items-center gap-1 text-[11px] text-white/60 mt-1">
              <Info className="h-3 w-3 shrink-0" />
              <span>USD equivalents via {fxData.source}, updated {fxData.fetchedAt ? new Date(fxData.fetchedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
