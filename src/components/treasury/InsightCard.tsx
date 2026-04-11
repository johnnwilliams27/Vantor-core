'use client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useDismissInsight, useMarkInsightActedOn } from '@/hooks/useInsights';
import type { TreasuryInsightRow } from '@/lib/insights/types';
import type { InsightSeverity, InsightType } from '@/lib/insights/types';
import {
  AlertTriangle,
  AlertCircle,
  Coins,
  TrendingDown,
  TrendingUp,
  Layers,
  Info,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

// ─── Type → presentation ─────────────────────────────────────────────

interface InsightTypeConfig {
  label: string;
  icon: React.ReactNode;
}

const INSIGHT_TYPE_CONFIG: Record<InsightType, InsightTypeConfig> = {
  liquidity_below_buffer: {
    label: 'Cash below safety buffer',
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  liquidity_idle_cash: {
    label: 'Idle cash',
    icon: <Coins className="h-4 w-4" />,
  },
  yield_drop: {
    label: 'Yield drop',
    icon: <TrendingDown className="h-4 w-4" />,
  },
  yield_opportunity: {
    label: 'Yield opportunity',
    icon: <TrendingUp className="h-4 w-4" />,
  },
  yield_idle_opportunity: {
    label: 'Idle cash yield opportunity',
    icon: <TrendingUp className="h-4 w-4" />,
  },
  concentration_warning: {
    label: 'Concentration warning',
    icon: <Layers className="h-4 w-4" />,
  },
  concentration_breach: {
    label: 'Concentration breach',
    icon: <Layers className="h-4 w-4" />,
  },
};

// ─── Severity → badge + border + icon color ──────────────────────────

interface SeverityConfig {
  badgeVariant: 'info' | 'warning' | 'destructive';
  borderClass: string;
  iconClass: string;
  label: string;
}

const SEVERITY_CONFIG: Record<InsightSeverity, SeverityConfig> = {
  critical: {
    badgeVariant: 'destructive',
    borderClass: 'border-l-red-500',
    iconClass: 'text-red-600',
    label: 'Critical',
  },
  warning: {
    badgeVariant: 'warning',
    borderClass: 'border-l-yellow-500',
    iconClass: 'text-yellow-700',
    label: 'Warning',
  },
  info: {
    badgeVariant: 'info',
    borderClass: 'border-l-[#19595b]',
    iconClass: 'text-[#134849]',
    label: 'Info',
  },
};

// ─── Formatters ──────────────────────────────────────────────────────

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
  const rounded = Math.round(v * 10) / 10;
  return `${rounded}d`;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  if (diffMs < 60_000) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Component ───────────────────────────────────────────────────────

interface Props {
  insight: TreasuryInsightRow;
}

export function InsightCard({ insight }: Props) {
  const { toast } = useToast();
  const dismiss = useDismissInsight();
  const markActedOn = useMarkInsightActedOn();

  const severityConfig = SEVERITY_CONFIG[insight.severity];
  const typeConfig = INSIGHT_TYPE_CONFIG[insight.insight_type];

  const hasImpact =
    insight.impact_dollar_value != null ||
    insight.impact_apy_delta_bps != null ||
    insight.impact_buffer_days != null;

  const isStale = insight.data_freshness === 'stale_over_10min';
  const requiresApproval = insight.policy_verdict === 'require_approval';
  const isPending = dismiss.isPending || markActedOn.isPending;

  const handleDismiss = async () => {
    try {
      await dismiss.mutateAsync(insight.id);
      toast({ title: 'Insight dismissed', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Failed to dismiss',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleMarkActedOn = async () => {
    try {
      await markActedOn.mutateAsync(insight.id);
      toast({ title: 'Marked as acted on', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Failed to update',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className={`overflow-hidden border-l-4 ${severityConfig.borderClass}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header: type icon + label + severity badge + timestamp */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className={`flex items-center gap-2 font-semibold ${severityConfig.iconClass}`}>
            {typeConfig.icon}
            <span>{typeConfig.label}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={severityConfig.badgeVariant}>{severityConfig.label}</Badge>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(insight.created_at)}
            </span>
          </div>
        </div>

        {/* Title + summary */}
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{insight.title}</div>
          <div className="text-sm text-muted-foreground">{insight.summary}</div>
        </div>

        {/* Impact grid */}
        {hasImpact && (
          <div className="grid grid-cols-3 gap-3 bg-muted/40 rounded-lg p-3 text-sm">
            {insight.impact_dollar_value != null && (
              <div>
                <div className="text-xs text-muted-foreground">Impact</div>
                <div className="font-semibold tabular-nums">
                  {formatUsd(insight.impact_dollar_value)}
                </div>
              </div>
            )}
            {insight.impact_apy_delta_bps != null && (
              <div>
                <div className="text-xs text-muted-foreground">APY delta</div>
                <div className="font-semibold tabular-nums">
                  {formatBps(insight.impact_apy_delta_bps)}
                </div>
              </div>
            )}
            {insight.impact_buffer_days != null && (
              <div>
                <div className="text-xs text-muted-foreground">Buffer days</div>
                <div className="font-semibold tabular-nums">
                  {formatDays(insight.impact_buffer_days)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Flags: stale data, policy verdict */}
        {(isStale || requiresApproval) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {isStale && (
              <span className="inline-flex items-center gap-1 rounded-md bg-yellow-50 px-2 py-1 text-yellow-800">
                <AlertCircle className="h-3 w-3" />
                Data over 10 minutes old
              </span>
            )}
            {requiresApproval && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[#19595b]/10 px-2 py-1 text-[#134849]">
                <Info className="h-3 w-3" />
                Requires treasurer approval
              </span>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={handleMarkActedOn}
            disabled={isPending}
            className="flex items-center gap-1"
          >
            <CheckCircle2 className="h-4 w-4" />
            Mark acted on
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDismiss}
            disabled={isPending}
            className="flex items-center gap-1 text-muted-foreground"
          >
            <XCircle className="h-4 w-4" />
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
