'use client';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, Coins, Info, TrendingUp } from 'lucide-react';
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

function fmt(value: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtPrecise(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

// ─── Allocation Bar ───────────────────────────────────────────────

function AllocationBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex h-2 rounded-full overflow-hidden bg-white/10">
        {segments.map((seg) => {
          const pct = (seg.value / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={seg.label}
              className={`${seg.color} transition-all duration-500`}
              style={{ width: `${pct}%` }}
            />
          );
        })}
      </div>
      <div className="flex gap-3">
        {segments.map((seg) => {
          const pct = total > 0 ? ((seg.value / total) * 100).toFixed(0) : '0';
          return (
            <div key={seg.label} className="flex items-center gap-1.5 text-xs text-white/50">
              <div className={`h-1.5 w-1.5 rounded-full ${seg.color}`} />
              <span>{seg.label} {pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Total Treasury (Hero) ────────────────────────────────────────

function TotalTreasuryCard({
  total,
  fiatUsd,
  availableCryptoUsd,
  deployedUsd,
  fxSource,
  fxFetchedAt,
  priceSource,
  isLoading,
}: {
  total: number;
  fiatUsd: number;
  availableCryptoUsd: number;
  deployedUsd: number;
  fxSource: string | undefined;
  fxFetchedAt: string | null | undefined;
  priceSource: string | undefined;
  isLoading: boolean;
}) {
  const sources: string[] = [];
  if (fxSource && fxSource !== 'mock') {
    const time = fxFetchedAt
      ? ` (${new Date(fxFetchedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })})`
      : '';
    sources.push(`FX via ${fxSource}${time}`);
  }
  if (priceSource === 'coingecko') sources.push('Stablecoin prices via CoinGecko');

  return (
    <Card className="bg-[#19595b] text-white dark:bg-slate-800 dark:text-foreground dark:border-slate-700">
      <CardContent className="py-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white/70 dark:text-muted-foreground">Total Treasury</p>
            {isLoading ? (
              <div className="h-9 w-48 animate-pulse rounded bg-white/10 mt-1" />
            ) : (
              <p className="text-3xl font-bold tabular-nums tracking-tight mt-0.5 dark:text-white">{fmt(total)}</p>
            )}
          </div>
          {!isLoading && deployedUsd > 0 && (
            <div className="text-right">
              <div className="flex items-center gap-1 text-green-300 dark:text-green-400">
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="text-sm font-semibold">{fmt(deployedUsd)} earning yield</span>
              </div>
            </div>
          )}
        </div>

        {!isLoading && total > 0 && (
          <div className="mt-4">
            <AllocationBar
              segments={[
                { label: 'Cash', value: fiatUsd, color: 'bg-blue-400' },
                { label: 'Stablecoin', value: availableCryptoUsd, color: 'bg-violet-400' },
                { label: 'Deployed', value: deployedUsd, color: 'bg-green-400' },
              ]}
            />
          </div>
        )}

        {sources.length > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-white/50 dark:text-muted-foreground mt-2">
            <Info className="h-3 w-3 shrink-0" />
            <span>{sources.join(' · ')}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Cash Holdings ────────────────────────────────────────────────

function CashHoldingsCard({
  fiatByCurrency,
  totalUsd,
  accountCount,
  isLoading,
}: {
  fiatByCurrency: Record<string, { usd: number; local: number }>;
  totalUsd: number;
  accountCount: number;
  isLoading: boolean;
}) {
  const currencies = Object.entries(fiatByCurrency);
  const hasNonUsd = currencies.some(([c]) => c !== 'USD');

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-gray-500" />
            Cash Holdings
          </CardTitle>
          {!isLoading && accountCount > 0 && (
            <span className="text-xs text-muted-foreground">{accountCount} account{accountCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col pt-2">
        {isLoading ? (
          <CardSpinner />
        ) : !currencies.length ? (
          <div className="text-sm text-muted-foreground py-4">No bank accounts connected.</div>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="space-y-2.5 flex-1">
              {currencies.map(([currency, { usd, local }]) => (
                <div key={currency} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Badge variant={(currency.toLowerCase() as 'usd' | 'eur' | 'gbp' | 'brl' | 'mxn') ?? 'default'}>
                      {currency}
                    </Badge>
                    <span className="text-sm font-semibold tabular-nums">{fmt(local, currency)}</span>
                  </div>
                  {currency !== 'USD' && (
                    <span className="text-xs text-muted-foreground tabular-nums">{fmt(usd)} USD</span>
                  )}
                </div>
              ))}
            </div>
            <div className="border-t pt-3 mt-3 flex justify-between items-center">
              <span className="text-sm font-semibold text-muted-foreground">Total</span>
              <span className="text-base font-bold tabular-nums">{fmt(totalUsd)}{hasNonUsd ? ' USD' : ''}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Stablecoin Holdings ──────────────────────────────────────────

function StablecoinHoldingsCard({
  cryptoByToken,
  activePositions,
  availableUsd,
  deployedUsd,
  isLoading,
}: {
  cryptoByToken: Record<string, number>;
  activePositions: Array<{
    id: string;
    protocol: string;
    current_value_usd: string;
    apy_snapshot: string | null;
    underlying_token: string;
  }>;
  availableUsd: number;
  deployedUsd: number;
  isLoading: boolean;
}) {
  const totalStablecoin = availableUsd + deployedUsd;
  const hasTokens = Object.keys(cryptoByToken).length > 0;
  const hasPositions = activePositions.length > 0;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-5 w-5 text-gray-500" />
          Stablecoin Holdings
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col pt-2">
        {isLoading ? (
          <CardSpinner />
        ) : !hasTokens && !hasPositions ? (
          <div className="text-sm text-muted-foreground py-4">No stablecoin positions found.</div>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Available */}
            {hasTokens && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Available</p>
                <div className="space-y-2">
                  {Object.entries(cryptoByToken).map(([token, usdValue]) => (
                    <div key={token} className="flex items-center justify-between">
                      <Badge className={TOKEN_COLORS[token] ?? 'bg-gray-100 text-gray-800'}>
                        {token}
                      </Badge>
                      <span className="text-sm font-semibold tabular-nums">{fmt(usdValue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Deployed */}
            {hasPositions && (
              <div className={hasTokens ? 'mt-3 pt-3 border-t border-dashed' : ''}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Deployed</p>
                <div className="space-y-2">
                  {activePositions.map((pos) => (
                    <div key={pos.id} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {PROTOCOL_LOGOS[pos.protocol] && (
                          <Image src={PROTOCOL_LOGOS[pos.protocol]} alt={pos.protocol} width={20} height={20} className="h-5 w-5 object-contain shrink-0" unoptimized />
                        )}
                        <span className="text-sm truncate">{PROTOCOL_LABELS[pos.protocol] ?? pos.protocol}</span>
                        <Badge className={`${TOKEN_COLORS[pos.underlying_token] ?? 'bg-gray-100 text-gray-800'} !text-[10px] !px-1.5 !py-0`}>
                          {pos.underlying_token}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-semibold tabular-nums">{fmt(parseFloat(pos.current_value_usd))}</span>
                        {pos.apy_snapshot && (
                          <span className="text-xs text-green-600 font-medium tabular-nums w-12 text-right">{parseFloat(pos.apy_snapshot).toFixed(1)}%</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Total */}
            <div className="border-t pt-3 mt-3 flex justify-between items-center">
              <span className="text-sm font-semibold text-muted-foreground">Total</span>
              <span className="text-base font-bold tabular-nums">{fmt(totalStablecoin)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────

export function UnifiedBalanceCard() {
  const { data: overview, isLoading } = useTreasuryOverview();
  const { data: yieldPositions } = useYieldPositions();
  const { data: fxData } = useFxRates();

  const activePositions = (yieldPositions ?? []).filter(p => p.is_active);
  const totalDeployedUsd = activePositions.reduce((s, p) => s + parseFloat(p.current_value_usd), 0);
  const fiatUsd = overview?.totalBankBalanceUsd ?? 0;
  const availableCryptoUsd = overview?.totalCryptoBalanceUsd ?? 0;
  const totalTreasury = fiatUsd + availableCryptoUsd + totalDeployedUsd;

  // Group fiat by currency
  const fiatByCurrency: Record<string, { usd: number; local: number }> = {};
  const fxRates = fxData?.rates ?? {};
  for (const acct of overview?.bankAccounts ?? []) {
    const cur = acct.currency ?? 'USD';
    if (!fiatByCurrency[cur]) fiatByCurrency[cur] = { usd: 0, local: 0 };
    fiatByCurrency[cur].usd += acct.currentBalanceUsd;
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
      {/* Hero — Total Treasury */}
      <TotalTreasuryCard
        total={totalTreasury}
        fiatUsd={fiatUsd}
        availableCryptoUsd={availableCryptoUsd}
        deployedUsd={totalDeployedUsd}
        fxSource={fxData?.source}
        fxFetchedAt={fxData?.fetchedAt}
        priceSource={overview?.priceSource}
        isLoading={isLoading}
      />

      {/* Detail Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
        <CashHoldingsCard
          fiatByCurrency={fiatByCurrency}
          totalUsd={fiatUsd}
          accountCount={overview?.bankAccounts?.length ?? 0}
          isLoading={isLoading}
        />
        <StablecoinHoldingsCard
          cryptoByToken={cryptoByToken}
          activePositions={activePositions}
          availableUsd={availableCryptoUsd}
          deployedUsd={totalDeployedUsd}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
