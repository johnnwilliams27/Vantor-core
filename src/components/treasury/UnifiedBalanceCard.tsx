'use client';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, Coins, Info, TrendingUp } from 'lucide-react';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import { useYieldPositions } from '@/hooks/useYield';
import { useFxRates } from '@/hooks/useFxRates';
import { useDisplayCurrency } from '@/hooks/useDisplayCurrency';
import { getCurrencySymbol } from '@/lib/fx/rates';
import { CardSpinner } from '@/components/ui/spinner';

const TOKEN_COLORS: Record<string, string> = {
  USDC: 'bg-blue-100 text-blue-800',
  USDT: 'bg-green-100 text-green-800',
};

const PROTOCOL_LABELS: Record<string, string> = {
  aave_v3: 'Aave V3', morpho: 'Morpho', morpho_steakhouse: 'Morpho Steakhouse',
  kamino: 'Kamino', kamino_multiply: 'Kamino Multiply', ondo: 'Ondo (USDY)',
  sky: 'Sky sUSDS', ethena: 'Ethena sUSDe', drift: 'Drift',
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
  fiatValue,
  stablecoinValue,
  deployedValue,
  displayCurrency,
  fxSource,
  fxFetchedAt,
  priceSource,
  isLoading,
}: {
  total: number;
  fiatValue: number;
  stablecoinValue: number;
  deployedValue: number;
  displayCurrency: string;
  fxSource: string | undefined;
  fxFetchedAt: string | null | undefined;
  priceSource: string | undefined;
  isLoading: boolean;
}) {
  const dc = displayCurrency;
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
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <CardSpinner />
          </div>
        ) : (
        <>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white/70 dark:text-muted-foreground">Total Treasury</p>
            <p className="text-3xl font-bold tabular-nums tracking-tight mt-0.5 dark:text-white">~{fmt(total, dc)} <span className="text-lg font-semibold text-white/60 dark:text-muted-foreground">{dc} equiv.</span></p>
          </div>
          {deployedValue > 0 && (
            <div className="text-right">
              <div className="flex items-center gap-1 text-green-300 dark:text-green-400">
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="text-sm font-semibold">{fmt(deployedValue, dc)} earning yield</span>
              </div>
            </div>
          )}
        </div>

        {total > 0 && (
          <div className="mt-4">
            <AllocationBar
              segments={[
                { label: 'Cash', value: fiatValue, color: 'bg-blue-400' },
                { label: 'Stablecoin', value: stablecoinValue, color: 'bg-violet-400' },
                { label: 'Deployed', value: deployedValue, color: 'bg-green-400' },
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
        </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Cash Holdings ────────────────────────────────────────────────

function CashHoldingsCard({
  fiatByCurrency,
  totalDisplay,
  displayCurrency,
  equivLabel,
  fmtD,
  isLoading,
}: {
  fiatByCurrency: Record<string, { usd: number; local: number }>;
  totalDisplay: number;
  displayCurrency: string;
  equivLabel: string;
  fmtD: (usd: number) => string;
  isLoading: boolean;
}) {
  const currencies = Object.entries(fiatByCurrency);
  const hasMultiple = currencies.length > 1 || (currencies.length === 1 && currencies[0][0] !== displayCurrency);

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-gray-500" />
          Cash Holdings
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col pt-2">
        {isLoading ? (
          <CardSpinner />
        ) : !currencies.length ? (
          <div className="text-sm text-muted-foreground py-4">No bank accounts connected.</div>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="flex-1">
              {/* Column headers */}
              <div className={`grid ${hasMultiple ? 'grid-cols-[auto_1fr_1fr]' : 'grid-cols-[auto_1fr]'} gap-x-3 items-center mb-1.5 px-1`}>
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Currency</span>
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider text-right">Balance</span>
                {hasMultiple && <span className="text-[11px] text-muted-foreground uppercase tracking-wider text-right">{displayCurrency} Equiv.</span>}
              </div>
              {/* Rows */}
              <div className="space-y-0.5">
                {currencies.map(([currency, { usd, local }]) => (
                  <div key={currency} className={`grid ${hasMultiple ? 'grid-cols-[auto_1fr_1fr]' : 'grid-cols-[auto_1fr]'} gap-x-3 items-center py-1.5 px-1 rounded hover:bg-muted/30 transition-colors`}>
                    <Badge variant={(currency.toLowerCase() as 'usd' | 'eur' | 'gbp' | 'brl' | 'mxn') ?? 'default'}>
                      {currency}
                    </Badge>
                    <span className="text-sm font-semibold tabular-nums text-right">{fmt(local, currency)}</span>
                    {hasMultiple && (
                      <span className="text-sm tabular-nums text-right text-muted-foreground">
                        {currency !== displayCurrency ? `~${fmtD(usd)}` : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t pt-3 mt-3 flex justify-between items-center">
              <span className="text-sm font-semibold text-muted-foreground">Total</span>
              <span className="text-base font-bold tabular-nums">{hasMultiple ? `~${fmt(totalDisplay, displayCurrency)} ${equivLabel}` : fmt(totalDisplay, displayCurrency)}</span>
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
  displayCurrency,
  equivLabel,
  fmtD,
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
  displayCurrency: string;
  equivLabel: string;
  fmtD: (usd: number) => string;
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
                <div className="flex items-center justify-between mb-1.5 px-1">
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Available</span>
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Amount</span>
                </div>
                <div className="space-y-0.5">
                  {Object.entries(cryptoByToken).map(([token, usdValue]) => (
                    <div key={token} className="flex items-center justify-between py-1.5 px-1 rounded hover:bg-muted/30 transition-colors">
                      <Badge className={TOKEN_COLORS[token] ?? 'bg-gray-100 text-gray-800'}>
                        {token}
                      </Badge>
                      <span className="text-sm font-semibold tabular-nums">{fmtD(usdValue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Deployed */}
            {hasPositions && (
              <div className={hasTokens ? 'mt-3 pt-3 border-t border-dashed' : ''}>
                <div className="flex items-center justify-between mb-1.5 px-1">
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Deployed</span>
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Amount</span>
                </div>
                <div className="space-y-0.5">
                  {activePositions.map((pos) => (
                    <div key={pos.id} className="flex items-center justify-between py-1.5 px-1 rounded hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm">{PROTOCOL_LABELS[pos.protocol] ?? pos.protocol}</span>
                        <Badge className={`${TOKEN_COLORS[pos.underlying_token] ?? 'bg-gray-100 text-gray-800'} !text-[10px] !px-1.5 !py-0`}>
                          {pos.underlying_token}
                        </Badge>
                      </div>
                      <span className="text-sm font-semibold tabular-nums shrink-0">{fmtD(parseFloat(pos.current_value_usd))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Total */}
            <div className="border-t pt-3 mt-3 flex justify-between items-center">
              <span className="text-sm font-semibold text-muted-foreground">Total</span>
              <span className="text-base font-bold tabular-nums">~{fmtD(totalStablecoin)} {equivLabel}</span>
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
  const { currency: displayCurrency } = useDisplayCurrency();

  const fxRates = fxData?.rates ?? {};
  const displayRate = fxRates[displayCurrency] ?? 1;
  const dc = displayCurrency; // shorthand

  // Convert USD → display currency
  const toDisplay = (usd: number) => usd * displayRate;
  const fmtD = (usd: number) => fmt(toDisplay(usd), dc);

  const activePositions = (yieldPositions ?? []).filter(p => p.is_active);
  const totalDeployedUsd = activePositions.reduce((s, p) => s + parseFloat(p.current_value_usd), 0);
  const fiatUsd = overview?.totalBankBalanceUsd ?? 0;
  const availableCryptoUsd = overview?.totalCryptoBalanceUsd ?? 0;
  const totalTreasury = fiatUsd + availableCryptoUsd + totalDeployedUsd;

  // Group fiat by currency
  const fiatByCurrency: Record<string, { usd: number; local: number }> = {};
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

  const equivLabel = `${dc} equiv.`;

  return (
    <div className="space-y-4">
      {/* Hero — Total Treasury */}
      <TotalTreasuryCard
        total={toDisplay(totalTreasury)}
        fiatValue={toDisplay(fiatUsd)}
        stablecoinValue={toDisplay(availableCryptoUsd)}
        deployedValue={toDisplay(totalDeployedUsd)}
        displayCurrency={dc}
        fxSource={fxData?.source}
        fxFetchedAt={fxData?.fetchedAt}
        priceSource={overview?.priceSource}
        isLoading={isLoading}
      />

      {/* Detail Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
        <CashHoldingsCard
          fiatByCurrency={fiatByCurrency}
          totalDisplay={toDisplay(fiatUsd)}
          displayCurrency={dc}
          equivLabel={equivLabel}
          fmtD={fmtD}
          isLoading={isLoading}
        />
        <StablecoinHoldingsCard
          cryptoByToken={cryptoByToken}
          activePositions={activePositions}
          availableUsd={availableCryptoUsd}
          deployedUsd={totalDeployedUsd}
          displayCurrency={dc}
          equivLabel={equivLabel}
          fmtD={fmtD}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
