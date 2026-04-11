'use client';
import { Card, CardContent } from '@/components/ui/card';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import { useYieldPositions } from '@/hooks/useYield';
import { CardSpinner } from '@/components/ui/spinner';
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

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

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
  const { data: overview, isLoading } = useTreasuryOverview();
  const { data: yieldPositions } = useYieldPositions();

  if (isLoading) return <CardSpinner />;
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
  const totalAum = overview.totalBankBalanceUsd + overview.totalCryptoBalanceUsd;

  const statusConfig = {
    healthy: {
      icon: ShieldCheck,
      label: 'Healthy',
      color: 'text-green-500',
      bg: 'bg-green-500/10',
      border: 'border-green-500/20',
    },
    warning: {
      icon: AlertTriangle,
      label: 'Attention',
      color: 'text-yellow-500',
      bg: 'bg-yellow-500/10',
      border: 'border-yellow-500/20',
    },
    critical: {
      icon: AlertOctagon,
      label: 'Action Required',
      color: 'text-red-500',
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
    },
  };

  const cfg = health ? statusConfig[health.status] : statusConfig.healthy;
  const StatusIcon = cfg.icon;

  return (
    <Card className={cn('border', health ? cfg.border : '')}>
      <CardContent className="pt-5 pb-4">
        {/* Status header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className={cn('p-1.5 rounded-lg', cfg.bg)}>
              <StatusIcon className={cn('h-4 w-4', cfg.color)} />
            </div>
            <div>
              <p className={cn('text-sm font-semibold', cfg.color)}>{cfg.label}</p>
              {health && health.signal !== 'balanced' && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {health.signal === 'surplus'
                    ? `${formatUsd(health.surplusUsd)} above safety buffer`
                    : `${formatUsd(Math.abs(health.surplusUsd))} below safety buffer`}
                </p>
              )}
              {health && health.signal === 'balanced' && (
                <p className="text-xs text-muted-foreground mt-0.5">
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <MetricCell
            icon={Landmark}
            label="Cash"
            value={formatUsd(cashUsd)}
          />
          <MetricCell
            icon={Wallet}
            label="Stablecoin"
            value={formatUsd(stablecoinUsd)}
          />
          <MetricCell
            icon={TrendingUp}
            label="DeFi"
            value={formatUsd(defiUsd)}
          />
          {health ? (
            <>
              <MetricCell
                icon={Receipt}
                label={`Obligations (${health.lookaheadDays}d)`}
                value={formatUsd(health.totalObligationsUsd)}
                subtitle={health.obligationCount > 0 ? `${health.obligationCount} due` : undefined}
              />
              <MetricCell
                icon={Target}
                label="Safety Buffer"
                value={formatUsd(health.safetyBufferTargetUsd)}
                subtitle={
                  health.surplusUsd > 0
                    ? `+${formatUsd(health.surplusUsd)}`
                    : health.surplusUsd < 0
                      ? formatUsd(health.surplusUsd)
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
            <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
            <span className="text-muted-foreground">
              {overview.pendingRecommendations.length} pending{' '}
              {overview.pendingRecommendations.length === 1 ? 'recommendation' : 'recommendations'}{' '}
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
      <p className="text-sm font-semibold">{value}</p>
      {subtitle && (
        <p className={cn('text-xs', subtitleColor ?? 'text-muted-foreground')}>{subtitle}</p>
      )}
    </div>
  );
}
