'use client';
import { Card, CardContent } from '@/components/ui/card';
import { HoverTooltip } from '@/components/ui/hover-tooltip';
import { useToast } from '@/components/ui/toast';
import { useDismissInsight, useMarkInsightActedOn } from '@/hooks/useInsights';
import type { TreasuryInsightRow } from '@/lib/insights/types';
import type { InsightSeverity, InsightType } from '@/lib/insights/types';
import { useDisplayCurrency } from '@/hooks/useDisplayCurrency';
import { useFxRates } from '@/hooks/useFxRates';
import {
  AlertTriangle,
  AlertCircle,
  Coins,
  TrendingDown,
  TrendingUp,
  Layers,
  Info,
  Clock,
} from 'lucide-react';

// ─── Type → icon only (no colored label) ────────────────────────────

const TYPE_ICONS: Record<InsightType, React.ReactNode> = {
  liquidity_below_buffer: <AlertTriangle className="h-4 w-4" />,
  liquidity_idle_cash: <Coins className="h-4 w-4" />,
  yield_drop: <TrendingDown className="h-4 w-4" />,
  yield_opportunity: <TrendingUp className="h-4 w-4" />,
  yield_idle_opportunity: <TrendingUp className="h-4 w-4" />,
  concentration_warning: <Layers className="h-4 w-4" />,
  concentration_breach: <Layers className="h-4 w-4" />,
};

// ─── Severity → single left border color (quiet signal) ────────────

const SEVERITY_BORDER: Record<InsightSeverity, string> = {
  critical: 'border-l-red-500',
  warning: 'border-l-amber-500',
  info: 'border-l-teal-500',
};

import { StatusDot, type StatusDotVariant } from '@/components/ui/status-dot';

const SEVERITY_VARIANT: Record<InsightSeverity, StatusDotVariant> = {
  critical: 'failed',
  warning: 'pending',
  info: 'active',
};

// ─── Formatters ─────────────────────────────────────────────────────

function formatUsd(v: number | null | undefined): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v);
}

function formatBps(v: number | null | undefined): string {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v} bps`;
}

function formatDays(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Math.round(v * 10) / 10}d`;
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

// ─── Component ──────────────────────────────────────────────────────

export function InsightCard({ insight }: { insight: TreasuryInsightRow }) {
  const { toast } = useToast();
  const dismiss = useDismissInsight();
  const markActedOn = useMarkInsightActedOn();
  const isPending = dismiss.isPending || markActedOn.isPending;
  const { currency: dc } = useDisplayCurrency();
  const { data: fxData } = useFxRates();
  const fxRate = fxData?.rates?.[dc] ?? 1;
  const fmtCurrency = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: dc, maximumFractionDigits: 0 }).format(v * fxRate);

  const hasImpact =
    insight.impact_dollar_value != null ||
    insight.impact_apy_delta_bps != null ||
    insight.impact_buffer_days != null;

  const isStale = insight.data_freshness === 'stale_over_10min';
  const requiresApproval = insight.policy_verdict === 'require_approval';

  const handleDismiss = async () => {
    try {
      await dismiss.mutateAsync(insight.id);
      toast({ title: 'Insight dismissed', variant: 'success' });
    } catch (err) {
      toast({ title: 'Failed to dismiss', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleMarkActedOn = async () => {
    try {
      await markActedOn.mutateAsync(insight.id);
      toast({ title: 'Marked as acted on', variant: 'success' });
    } catch (err) {
      toast({ title: 'Failed to update', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <Card className={`overflow-hidden border-l-4 ${SEVERITY_BORDER[insight.severity]}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header — icon + title + status + time */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-muted-foreground shrink-0">
              {TYPE_ICONS[insight.insight_type]}
            </span>
            <HoverTooltip label={insight.title}>
              <p className="text-sm font-medium text-foreground truncate cursor-pointer" onClick={(e) => e.currentTarget.classList.toggle('truncate')}>{insight.title}</p>
            </HoverTooltip>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <StatusDot variant={SEVERITY_VARIANT[insight.severity]} size="xs" />
              {insight.severity === 'critical' ? 'Critical' : insight.severity === 'warning' ? 'Warning' : 'Info'}
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(insight.created_at)}
            </span>
          </div>
        </div>

        {/* Summary — full width */}
        <p className="text-sm text-muted-foreground">{insight.summary}</p>

        {/* AI reasoning — shown when Claude has generated analysis */}
        {insight.ai_reasoning && (
          <div className="text-sm text-muted-foreground/80 whitespace-pre-line border-l-2 border-border/50 pl-3">
            {insight.ai_reasoning}
          </div>
        )}

        {/* Impact metrics — quiet grid */}
        {hasImpact && (
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-border/50 p-3">
            {insight.impact_dollar_value != null && (
              <div>
                <div className="text-2xs text-muted-foreground uppercase tracking-wider">Impact</div>
                <div className="text-sm font-semibold tabular-nums mt-0.5">{fmtCurrency(insight.impact_dollar_value)}</div>
              </div>
            )}
            {insight.impact_apy_delta_bps != null && (
              <div>
                <div className="text-2xs text-muted-foreground uppercase tracking-wider">APY Delta</div>
                <div className="text-sm font-semibold tabular-nums mt-0.5">{formatBps(insight.impact_apy_delta_bps)}</div>
              </div>
            )}
            {insight.impact_buffer_days != null && (
              <div>
                <div className="text-2xs text-muted-foreground uppercase tracking-wider">Buffer</div>
                <div className="text-sm font-semibold tabular-nums mt-0.5">{formatDays(insight.impact_buffer_days)}</div>
              </div>
            )}
          </div>
        )}

        {/* Flags — inline text, no colored backgrounds */}
        {(isStale || requiresApproval) && (
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {isStale && (
              <span className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3 text-amber-500" />
                Data over 10 min old
              </span>
            )}
            {requiresApproval && (
              <span className="flex items-center gap-1">
                <Info className="h-3 w-3 text-teal-500" />
                Requires approval
              </span>
            )}
          </div>
        )}

        {/* Actions — primary text link + secondary text link */}
        <div className="flex gap-4 pt-1 text-xs font-medium">
          <button
            onClick={handleMarkActedOn}
            disabled={isPending}
            className="text-teal-500 hover:text-teal-400 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 rounded-sm"
          >
            Mark acted on
          </button>
          <button
            onClick={handleDismiss}
            disabled={isPending}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 rounded-sm"
          >
            Dismiss
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
