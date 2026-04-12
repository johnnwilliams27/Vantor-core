'use client';
import { Card, CardContent } from '@/components/ui/card';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import { useYieldPositions } from '@/hooks/useYield';
import { CardSkeleton, CardError } from '@/components/ui/spinner';
import {
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Landmark,
  Wallet,
  Target,
  Receipt,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getHoldingCardPlacement } from '@/lib/treasury/holdings-category';
import type { YieldProtocolId } from '@/lib/yield/interface';
import { useDisplayCurrency } from '@/hooks/useDisplayCurrency';
import { useFxRates } from '@/hooks/useFxRates';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function TreasuryHealthCard() {
  const { data: overview, isLoading, isError, refetch } = useTreasuryOverview();
  const { data: yieldPositions } = useYieldPositions();
  const { currency: dc } = useDisplayCurrency();
  const { data: fxData } = useFxRates();
  const fxRate = fxData?.rates?.[dc] ?? 1;
  const fmt = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: dc, maximumFractionDigits: 0 }).format(v * fxRate);

  if (isLoading) return <Card><CardContent className="pt-5"><CardSkeleton rows={4} /></CardContent></Card>;
  if (isError) return <Card><CardContent className="pt-5"><CardError message="Failed to load treasury health." onRetry={() => refetch()} /></CardContent></Card>;
  if (!overview) return null;

  // Roll yield positions into Cash (tokenized MMFs) and DeFi using the
  // same categorization the dashboard uses, so the Treasury AI overview
  // mirrors what the user sees on the main balance card.
  let mmfTotalUsd = 0;
  let defiTotalUsd = 0;
  for (const p of yieldPositions ?? []) {
    if (!p.is_active) continue;
    const placement = getHoldingCardPlacement({
      kind: 'yield_position',
      protocol: p.protocol as YieldProtocolId,
    });
    const usdValue = parseFloat(p.current_value_usd);
    if (Number.isNaN(usdValue)) continue;
    if (placement === 'cash') mmfTotalUsd += usdValue;
    else if (placement === 'defi_positions') defiTotalUsd += usdValue;
  }

  const cashUsd = overview.totalBankBalanceUsd + mmfTotalUsd;
  const stablecoinUsd = overview.totalCryptoBalanceUsd;
  const defiUsd = defiTotalUsd;

  const health = overview.healthAnalysis;
  // Sum every bucket so the header AUM matches the card subtotals.
  // The pre-fix formula (bank + crypto) was missing MMFs and DeFi
  // entirely because totalCryptoBalanceUsd is narrowly the wallet
  // stablecoin total.
  const totalAum = cashUsd + stablecoinUsd + defiUsd;

  const statusConfig = {
    healthy: { icon: ShieldCheck, label: 'Healthy', dot: 'bg-green-500' },
    warning: { icon: AlertTriangle, label: 'Attention', dot: 'bg-amber-500' },
    critical: { icon: AlertOctagon, label: 'Action Required', dot: 'bg-red-500' },
  };

  const cfg = health ? statusConfig[health.status] : statusConfig.healthy;

  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        {/* Header — total + status */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Treasury</p>
              <p className="text-3xl font-bold tabular-nums tracking-tight mt-0.5 whitespace-nowrap">≈{fmt(totalAum)} <span className="text-lg font-semibold text-muted-foreground">{dc} equiv.</span></p>
            </div>
            <div className="flex items-center gap-1.5 pl-3 border-l border-border">
              <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
              <p className="text-sm font-medium text-foreground">{cfg.label}</p>
              {health && health.signal !== 'balanced' && (
                <p className="text-xs text-muted-foreground">
                  {health.signal === 'surplus'
                    ? `${fmt(health.surplusUsd)} above safety buffer`
                    : `${fmt(Math.abs(health.surplusUsd))} below safety buffer`}
                </p>
              )}
              {health && health.signal === 'balanced' && (
                <p className="text-xs text-muted-foreground">
                  Within safety buffer target
                </p>
              )}
            </div>
          </div>
          {overview.lastRecommendationAt && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Last analysis {timeAgo(overview.lastRecommendationAt)}
            </div>
          )}
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCell
            icon={Landmark}
            label="Cash & Stablecoins"
            value={fmt(cashUsd + stablecoinUsd)}
          />
          <MetricCell
            icon={TrendingUp}
            label="Yield Positions"
            value={fmt(defiUsd)}
          />
          {health ? (
            <>
              <MetricCell
                icon={Receipt}
                label={`Obligations (${health.lookaheadDays}d)`}
                value={fmt(health.totalObligationsUsd)}
                subtitle={health.obligationCount > 0 ? `${health.obligationCount} due` : undefined}
              />
              <MetricCell
                icon={Target}
                label="Safety Buffer"
                value={fmt(health.safetyBufferTargetUsd)}
                subtitle={
                  health.surplusUsd > 0
                    ? `+${fmt(health.surplusUsd)}`
                    : health.surplusUsd < 0
                      ? fmt(health.surplusUsd)
                      : undefined
                }
                subtitleColor={
                  health.surplusUsd > 0
                    ? 'text-green-500'
                    : health.surplusUsd < 0
                      ? 'text-red-500'
                      : undefined
                }
              />
            </>
          ) : (
            <div className="col-span-2 flex items-center justify-center text-xs text-muted-foreground py-2">
              Set up a treasury rule to see health analysis
            </div>
          )}
        </div>

        {/* Pending actions banner */}
        {overview.pendingRecommendations.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 text-xs">
            <div className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-muted-foreground">
              {overview.pendingRecommendations.length} pending{' '}
              {overview.pendingRecommendations.length === 1 ? 'action' : 'actions'}{' '}
              awaiting approval
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricCell({
  icon: Icon,
  label,
  value,
  subtitle,
  subtitleColor,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  subtitle?: string;
  subtitleColor?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
      {subtitle && (
        <p className={cn('text-xs', subtitleColor ?? 'text-muted-foreground')}>{subtitle}</p>
      )}
    </div>
  );
}
