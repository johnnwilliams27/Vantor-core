'use client';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, Coins, Info, Landmark, TrendingUp } from 'lucide-react';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import { useYieldPositions } from '@/hooks/useYield';
import { useFxRates } from '@/hooks/useFxRates';
import { useDisplayCurrency } from '@/hooks/useDisplayCurrency';
import { getCurrencySymbol } from '@/lib/fx/rates';
import { CardSpinner, CardError, CardSkeleton, Skeleton } from '@/components/ui/spinner';
import { getVenue, getVenueDisplayName, MMF_YIELDS_AS_OF } from '@/lib/yield/venues';
import { getHoldingCardPlacement } from '@/lib/treasury/holdings-category';
import type { YieldProtocolId } from '@/lib/yield/interface';

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

// ─── Types ───────────────────────────────────────────────────────

type MmfRow = {
  id: string;
  protocol: YieldProtocolId;
  current_value_usd: string;
  apy_snapshot: string | null;
  asOfDate: string;
};

type DefiPositionRow = {
  id: string;
  protocol: string;
  current_value_usd: string;
  apy_snapshot: string | null;
  underlying_token: string;
  apyAsOf: string | null;
};

function formatApyAsOf(iso: string | null): string | null {
  if (!iso) return null;
  const ts = new Date(iso);
  if (Number.isNaN(ts.getTime())) return null;
  const diffMs = Date.now() - ts.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return ts.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── Allocation Bar ──────────────────────────────────────────────

function AllocationBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex h-3 rounded-full overflow-hidden bg-white/10">
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
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((seg) => {
          const pct = total > 0 ? ((seg.value / total) * 100).toFixed(0) : '0';
          if (seg.value === 0) return null;
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

// ─── Total Treasury (Hero) ───────────────────────────────────────

function TotalTreasuryCard({
  total,
  cashValue,
  yieldValue,
  displayCurrency,
  fxSource,
  fxFetchedAt,
  priceSource,
  isLoading,
  dataUpdatedAt,
}: {
  total: number;
  cashValue: number;
  yieldValue: number;
  displayCurrency: string;
  fxSource: string | undefined;
  fxFetchedAt: string | null | undefined;
  priceSource: string | undefined;
  isLoading: boolean;
  dataUpdatedAt: number;
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

  let freshness = '';
  if (dataUpdatedAt > 0) {
    const ageMs = Date.now() - dataUpdatedAt;
    const ageSec = Math.floor(ageMs / 1000);
    if (ageSec < 10) freshness = 'Updated just now';
    else if (ageSec < 60) freshness = `Updated ${ageSec}s ago`;
    else if (ageSec < 3600) freshness = `Updated ${Math.floor(ageSec / 60)}m ago`;
    else freshness = `Updated ${Math.floor(ageSec / 3600)}h ago`;
  }

  return (
    <Card className="text-white relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-teal-400/30 to-transparent pointer-events-none" />
      <CardContent className="py-5">
        {isLoading ? (
          <div className="py-2" role="status" aria-label="Loading">
            <Skeleton className="h-4 w-24 bg-white/10" />
            <Skeleton className="h-9 w-48 mt-2 bg-white/10" />
            <Skeleton className="h-3 w-full mt-5 rounded-full bg-white/10" />
            <div className="flex gap-4 mt-2">
              <Skeleton className="h-3 w-20 bg-white/10" />
              <Skeleton className="h-3 w-16 bg-white/10" />
            </div>
          </div>
        ) : (
        <>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white/70">Total Treasury</p>
            <p className="text-3xl font-bold tabular-nums tracking-tight mt-0.5 whitespace-nowrap">≈{fmt(total, dc)} <span className="text-lg font-semibold text-white/60">{dc} equiv.</span></p>
          </div>
          {yieldValue > 0 && (
            <div className="text-right">
              <div className="flex items-center gap-1 text-green-300">
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="text-sm font-semibold tabular-nums">{fmt(yieldValue, dc)} earning yield</span>
              </div>
            </div>
          )}
        </div>

        {total > 0 && (
          <div className="mt-4">
            <AllocationBar
              segments={[
                { label: 'Cash & Stablecoins', value: cashValue, color: 'bg-blue-400' },
                { label: 'Yield Positions',    value: yieldValue, color: 'bg-green-400' },
              ]}
            />
          </div>
        )}

        <div className="flex items-center gap-1 text-[11px] text-white/50 mt-2">
          <Info className="h-3 w-3 shrink-0" />
          <span>{[freshness, ...sources].filter(Boolean).join(' · ')}</span>
        </div>
        </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Cash & Stablecoins Card ─────────────────────────────────────

function CashHoldingsCard({
  fiatByCurrency,
  cryptoByToken,
  fiatTotalDisplay,
  stablecoinTotalDisplay,
  totalDisplay,
  displayCurrency,
  equivLabel,
  fmtD,
  isLoading,
}: {
  fiatByCurrency: Record<string, { usd: number; local: number }>;
  cryptoByToken: Record<string, number>;
  fiatTotalDisplay: number;
  stablecoinTotalDisplay: number;
  totalDisplay: number;
  displayCurrency: string;
  equivLabel: string;
  fmtD: (usd: number) => string;
  isLoading: boolean;
}) {
  const currencies = Object.entries(fiatByCurrency);
  const hasMultiple = currencies.length > 1 || (currencies.length === 1 && currencies[0][0] !== displayCurrency);
  const hasBank = currencies.length > 0;
  const hasStablecoins = Object.keys(cryptoByToken).length > 0;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-muted-foreground" />
          Cash & Stablecoins
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Bank and stablecoin wallet balances
        </p>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col pt-2">
        {isLoading ? (
          <CardSkeleton rows={4} />
        ) : !hasBank && !hasStablecoins ? (
          <div className="text-sm text-muted-foreground py-4">No bank accounts or wallets connected. <a href="/wallets" className="text-primary hover:underline">Connect a wallet →</a></div>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="flex-1">
              {/* Bank balances */}
              {hasBank && (
                <div role="table" aria-label="Bank balances">
                  <div role="row" className={`grid ${hasMultiple ? 'grid-cols-[auto_1fr_1fr]' : 'grid-cols-[auto_1fr]'} gap-x-3 items-center mb-1.5 px-1`}>
                    <span role="columnheader" className="text-[11px] text-muted-foreground uppercase tracking-wider">Currency</span>
                    {hasMultiple && <span role="columnheader" className="text-[11px] text-muted-foreground uppercase tracking-wider text-right">Local</span>}
                    <span role="columnheader" className="text-[11px] text-muted-foreground uppercase tracking-wider text-right">{displayCurrency} Value</span>
                  </div>
                  <div className="space-y-0.5">
                    {currencies.map(([currency, { usd, local }]) => (
                      <div role="row" key={currency} className={`grid ${hasMultiple ? 'grid-cols-[auto_1fr_1fr]' : 'grid-cols-[auto_1fr]'} gap-x-3 items-center py-1.5 px-1 rounded hover:bg-muted/30 transition-colors`}>
                        <span className="text-xs font-medium text-muted-foreground">{currency}</span>
                        {hasMultiple && (
                          <span className="text-sm tabular-nums text-right text-muted-foreground">
                            {currency !== displayCurrency ? fmt(local, currency) : ''}
                          </span>
                        )}
                        <span className="text-sm font-semibold tabular-nums text-right">{fmtD(usd)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Stablecoin wallet balances */}
              {hasStablecoins && (
                <div className={hasBank ? 'mt-3 pt-3 border-t border-dashed' : ''} role="table" aria-label="Stablecoin balances">
                  <div role="row" className="flex items-center justify-between mb-1.5 px-1">
                    <span role="columnheader" className="text-[11px] text-muted-foreground uppercase tracking-wider">Stablecoins</span>
                    <span role="columnheader" className="text-[11px] text-muted-foreground uppercase tracking-wider">USD Value</span>
                  </div>
                  <div className="space-y-0.5">
                    {Object.entries(cryptoByToken).map(([token, usdValue]) => (
                      <div role="row" key={token} className="flex items-center justify-between py-1.5 px-1 rounded hover:bg-muted/30 transition-colors">
                        <span className="text-xs font-medium text-muted-foreground">{token}</span>
                        <span className="text-sm font-semibold tabular-nums">{fmtD(usdValue)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="border-t pt-3 mt-3 flex justify-between items-center">
              <span className="text-sm font-semibold text-muted-foreground">Total</span>
              <span className="text-base font-bold tabular-nums">{hasMultiple ? `≈${fmt(totalDisplay, displayCurrency)} ${equivLabel}` : fmt(totalDisplay, displayCurrency)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Yield Positions Card (Tokenized MMFs + DeFi) ────────────────

function YieldPositionsCard({
  mmfPositions,
  defiPositions,
  mmfTotalUsd,
  defiTotalUsd,
  totalUsd,
  equivLabel,
  fmtD,
  isLoading,
}: {
  mmfPositions: MmfRow[];
  defiPositions: DefiPositionRow[];
  mmfTotalUsd: number;
  defiTotalUsd: number;
  totalUsd: number;
  equivLabel: string;
  fmtD: (usd: number) => string;
  isLoading: boolean;
}) {
  const hasMmf = mmfPositions.length > 0;
  const hasDefi = defiPositions.length > 0;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-muted-foreground" />
          Yield Positions
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Tokenized money market funds and DeFi protocol positions
        </p>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col pt-2">
        {isLoading ? (
          <CardSkeleton rows={4} />
        ) : !hasMmf && !hasDefi ? (
          <div className="text-sm text-muted-foreground py-4">No yield positions active. <a href="/yield" className="text-primary hover:underline">Explore yield opportunities →</a></div>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="flex-1">
              {/* Tokenized MMFs */}
              {hasMmf && (
                <div role="table" aria-label="Tokenized MMF positions">
                  <div role="row" className="flex items-center justify-between mb-1.5 px-1">
                    <span role="columnheader" className="text-[11px] text-muted-foreground uppercase tracking-wider">Tokenized MMFs</span>
                    <span role="columnheader" className="text-[11px] text-muted-foreground uppercase tracking-wider">Position</span>
                  </div>
                  <div className="space-y-0.5">
                    {mmfPositions.map((pos) => {
                      const label = getVenueDisplayName(pos.protocol);
                      const apy = pos.apy_snapshot ? parseFloat(pos.apy_snapshot).toFixed(2) : null;
                      return (
                        <div role="row" key={pos.id} className="flex items-center justify-between py-1.5 px-1 rounded hover:bg-muted/30 transition-colors">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm truncate">{label}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {apy ? `${apy}% as of ${pos.asOfDate}` : `as of ${pos.asOfDate}`}
                            </span>
                          </div>
                          <span className="text-sm font-semibold tabular-nums shrink-0">{fmtD(parseFloat(pos.current_value_usd))}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* DeFi Protocols */}
              {hasDefi && (
                <div className={hasMmf ? 'mt-3 pt-3 border-t border-dashed' : ''} role="table" aria-label="DeFi positions">
                  <div role="row" className="flex items-center justify-between mb-1.5 px-1">
                    <span role="columnheader" className="text-[11px] text-muted-foreground uppercase tracking-wider">DeFi Protocols</span>
                    <span role="columnheader" className="text-[11px] text-muted-foreground uppercase tracking-wider">Position</span>
                  </div>
                  <div className="space-y-0.5">
                    {defiPositions.map((pos) => {
                      const label = getVenueDisplayName(pos.protocol);
                      const apy = pos.apy_snapshot ? parseFloat(pos.apy_snapshot).toFixed(2) : null;
                      const apyAsOfLabel = formatApyAsOf(pos.apyAsOf);
                      return (
                        <div role="row" key={pos.id} className="flex items-center justify-between py-1.5 px-1 rounded hover:bg-muted/30 transition-colors">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm truncate">{label}</span>
                            <span className="text-xs text-muted-foreground">{pos.underlying_token}</span>
                            {apy && (
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {apy}%{apyAsOfLabel ? ` · ${apyAsOfLabel}` : ''}
                              </span>
                            )}
                          </div>
                          <span className="text-sm font-semibold tabular-nums shrink-0">{fmtD(parseFloat(pos.current_value_usd))}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="border-t pt-3 mt-3 flex justify-between items-center">
              <span className="text-sm font-semibold text-muted-foreground">Total</span>
              <span className="text-base font-bold tabular-nums">≈{fmtD(totalUsd)} {equivLabel}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export function UnifiedBalanceCard() {
  const { data: overview, isLoading, isError, refetch, dataUpdatedAt } = useTreasuryOverview();
  const { data: yieldPositions } = useYieldPositions();
  const { data: fxData } = useFxRates();
  const { currency: displayCurrency } = useDisplayCurrency();

  const fxRates = fxData?.rates ?? {};
  const displayRate = fxRates[displayCurrency] ?? 1;
  const dc = displayCurrency;

  const toDisplay = (usd: number) => usd * displayRate;
  const fmtD = (usd: number) => fmt(toDisplay(usd), dc);

  const activePositions = (yieldPositions ?? []).filter(p => p.is_active);

  const mmfPositions: MmfRow[] = [];
  const defiPositions: DefiPositionRow[] = [];
  let mmfTotalUsd = 0;
  let defiTotalUsd = 0;
  let otherYieldUsd = 0;

  for (const p of activePositions) {
    const placement = getHoldingCardPlacement({
      kind: 'yield_position',
      protocol: p.protocol as YieldProtocolId,
    });
    const usdValue = parseFloat(p.current_value_usd);
    if (placement === 'cash') {
      const venue = getVenue(p.protocol as YieldProtocolId);
      const asOf = venue && venue.category === 'tokenized_mmf'
        ? venue.yieldAsOf
        : MMF_YIELDS_AS_OF;
      mmfPositions.push({
        id: p.id,
        protocol: p.protocol as YieldProtocolId,
        current_value_usd: p.current_value_usd,
        apy_snapshot: p.apy_snapshot,
        asOfDate: asOf,
      });
      mmfTotalUsd += usdValue;
    } else if (placement === 'defi_positions') {
      defiPositions.push({
        id: p.id,
        protocol: p.protocol,
        current_value_usd: p.current_value_usd,
        apy_snapshot: p.apy_snapshot,
        underlying_token: p.underlying_token,
        apyAsOf: p.last_refreshed_at ?? null,
      });
      defiTotalUsd += usdValue;
    } else {
      otherYieldUsd += usdValue;
    }
  }

  const fiatUsd = overview?.totalBankBalanceUsd ?? 0;
  const availableCryptoUsd = overview?.totalCryptoBalanceUsd ?? 0;

  // Card subtotals: Cash & Stablecoins | Yield Positions (MMFs + DeFi)
  const cashSubtotalUsd = fiatUsd + availableCryptoUsd;
  const yieldSubtotalUsd = mmfTotalUsd + defiTotalUsd;
  const totalTreasury = cashSubtotalUsd + yieldSubtotalUsd + otherYieldUsd;

  const fiatByCurrency: Record<string, { usd: number; local: number }> = {};
  for (const acct of overview?.bankAccounts ?? []) {
    const cur = acct.currency ?? 'USD';
    if (!fiatByCurrency[cur]) fiatByCurrency[cur] = { usd: 0, local: 0 };
    fiatByCurrency[cur].usd += acct.currentBalanceUsd;
    const fxRate = fxRates[cur] ?? 1;
    fiatByCurrency[cur].local += acct.currentBalanceUsd * fxRate;
  }

  const cryptoByToken: Record<string, number> = {};
  for (const pos of overview?.cryptoPositions ?? []) {
    cryptoByToken[pos.token] = (cryptoByToken[pos.token] ?? 0) + pos.usdValue;
  }

  const equivLabel = `${dc} equiv.`;

  if (isError) {
    return (
      <Card>
        <CardContent className="py-5">
          <CardError message="Unable to load treasury data." onRetry={() => refetch()} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <TotalTreasuryCard
        total={toDisplay(totalTreasury)}
        cashValue={toDisplay(cashSubtotalUsd)}
        yieldValue={toDisplay(yieldSubtotalUsd)}
        displayCurrency={dc}
        fxSource={fxData?.source}
        fxFetchedAt={fxData?.fetchedAt}
        priceSource={overview?.priceSource}
        isLoading={isLoading}
        dataUpdatedAt={dataUpdatedAt}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <CashHoldingsCard
          fiatByCurrency={fiatByCurrency}
          cryptoByToken={cryptoByToken}
          fiatTotalDisplay={toDisplay(fiatUsd)}
          stablecoinTotalDisplay={toDisplay(availableCryptoUsd)}
          totalDisplay={toDisplay(cashSubtotalUsd)}
          displayCurrency={dc}
          equivLabel={equivLabel}
          fmtD={fmtD}
          isLoading={isLoading}
        />
        <YieldPositionsCard
          mmfPositions={mmfPositions}
          defiPositions={defiPositions}
          mmfTotalUsd={mmfTotalUsd}
          defiTotalUsd={defiTotalUsd}
          totalUsd={yieldSubtotalUsd}
          equivLabel={equivLabel}
          fmtD={fmtD}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
