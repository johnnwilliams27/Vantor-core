'use client';
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, Scissors, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { SlippageEstimate } from '@/lib/yield/slippage';

interface SlippageWarningProps {
  estimate: SlippageEstimate;
  onConfirm: () => void;
  onCancel: () => void;
  isExecuting?: boolean;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

const fmtCompact = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n);

const SEVERITY_CONFIG = {
  green: {
    border: 'border-green-500/30',
    bg: 'bg-green-500/5',
    icon: CheckCircle2,
    iconColor: 'text-green-500',
    label: 'Low Slippage',
    description: 'This transaction has minimal price impact.',
  },
  yellow: {
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/5',
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    label: 'Moderate Slippage',
    description: 'This transaction may incur noticeable price impact. Please review before proceeding.',
  },
  red: {
    border: 'border-red-500/30',
    bg: 'bg-red-500/5',
    icon: ShieldAlert,
    iconColor: 'text-red-500',
    label: 'High Slippage Warning',
    description: 'This transaction has significant price impact. Automatic execution is blocked.',
  },
};

export function SlippageWarning({ estimate, onConfirm, onCancel, isExecuting }: SlippageWarningProps) {
  const [confirmText, setConfirmText] = useState('');
  const config = SEVERITY_CONFIG[estimate.severity];
  const Icon = config.icon;
  const needsTypedConfirm = estimate.severity === 'red';
  const canConfirm = needsTypedConfirm ? confirmText.toLowerCase() === 'approved' : true;

  return (
    <div className={cn('rounded-lg border p-4 space-y-4', config.border, config.bg)}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', config.iconColor)} />
        <div>
          <div className="font-semibold text-sm">{config.label}</div>
          <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-md border bg-background/50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Est. Slippage</div>
          <div className={cn('text-sm font-bold tabular-nums', estimate.severity === 'red' ? 'text-red-400' : estimate.severity === 'yellow' ? 'text-amber-400' : 'text-foreground')}>
            {estimate.estimatedSlippageBps} bps
          </div>
        </div>
        <div className="rounded-md border bg-background/50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Est. Cost</div>
          <div className="text-sm font-bold">{fmt(estimate.estimatedSlippageCostUsd)}</div>
        </div>
        <div className="rounded-md border bg-background/50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pool Liquidity</div>
          <div className="text-sm font-bold">{fmtCompact(estimate.poolLiquidity.availableLiquidityUsd)}</div>
        </div>
        <div className="rounded-md border bg-background/50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Utilization</div>
          <div className="text-sm font-bold">{(estimate.poolLiquidity.utilizationRate * 100).toFixed(1)}%</div>
        </div>
      </div>

      {/* Tranche suggestion */}
      {estimate.suggestedTranches && (
        <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Scissors className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">Order Splitting Recommended</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Split into <span className="font-semibold text-foreground">{estimate.suggestedTranches.numberOfTranches} tranches</span> of{' '}
            <span className="font-semibold text-foreground">{fmt(estimate.suggestedTranches.trancheSizeUsd)}</span> each
            for ~<span className="font-semibold text-foreground">{estimate.suggestedTranches.estimatedBpsPerTranche} bps</span> per tranche.
          </p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Suggested delay: {estimate.suggestedTranches.suggestedDelayMinutes} minutes between tranches
          </div>
        </div>
      )}

      {/* Alternatives */}
      {estimate.severity !== 'green' && (
        <div className="text-xs text-muted-foreground space-y-1">
          <div className="font-medium text-foreground text-[10px] uppercase tracking-wider">Alternatives</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Split into smaller tranches to reduce impact</li>
            <li>Delay execution until pool liquidity increases</li>
            <li>Route to a protocol with deeper liquidity</li>
          </ul>
        </div>
      )}

      {/* Red severity: type to confirm */}
      {needsTypedConfirm && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-red-500">
            Type &quot;approved&quot; to proceed with high-slippage execution
          </label>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type approved..."
            className="h-8 text-sm border-red-500/30 focus-visible:ring-red-500/30"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1">
        <Button
          onClick={onConfirm}
          disabled={!canConfirm || isExecuting}
          variant={estimate.severity === 'red' ? 'destructive-outline' : 'default'}
        >
          {isExecuting ? 'Executing…' : estimate.severity === 'green' ? 'Continue' : 'Acknowledge & Proceed'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={isExecuting}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
