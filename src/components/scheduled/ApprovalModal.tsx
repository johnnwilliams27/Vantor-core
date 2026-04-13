'use client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import {
  useScheduledOperationQuote,
  useApproveScheduledOperation,
  useCancelScheduledOperation,
} from '@/hooks/useScheduledOperations';
import { extractRate, calculateDeviationBps } from '@/lib/scheduled-operations/tolerances';
import type { ScheduledOperation, SwapParams, BridgeParams, RampParams } from '@/types/scheduled-operations';
import { useState, useEffect } from 'react';

/* ─── countdown ────────────────────────────────────────────────────── */
function useCountdown(expiresAt: string | null): string {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!expiresAt) { setLabel(''); return; }
    function update() {
      const ms = new Date(expiresAt!).getTime() - Date.now();
      if (ms <= 0) { setLabel('Expired'); return; }
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setLabel(h > 0 ? `${h}h ${m}m` : `${m}m`);
    }
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return label;
}

/* ─── operation summary helpers ────────────────────────────────────── */
function operationTypeLabel(type: ScheduledOperation['type']): string {
  switch (type) {
    case 'swap': return 'Swap';
    case 'bridge': return 'Bridge';
    case 'ramp': return 'Ramp';
  }
}

function operationSummary(op: ScheduledOperation): string {
  const { type, params } = op;
  if (type === 'swap') {
    const p = params as SwapParams;
    return `${Number(p.amount).toLocaleString()} ${p.fromToken} → ${p.toToken} on ${p.chain}`;
  }
  if (type === 'bridge') {
    const p = params as BridgeParams;
    return `${Number(p.amount).toLocaleString()} ${p.token}: ${p.fromChain} → ${p.toChain}`;
  }
  if (type === 'ramp') {
    const p = params as RampParams;
    const dir = p.direction === 'onramp' ? 'Buy' : 'Sell';
    return `${dir} ${p.cryptoAmount.toLocaleString()} ${p.cryptoToken} (${p.fiatCurrency})`;
  }
  return 'Unknown operation';
}

function formatRate(rate: number): string {
  if (rate === 0) return '—';
  return rate.toFixed(6);
}

/* ─── component ────────────────────────────────────────────────────── */
interface Props {
  op: ScheduledOperation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ApprovalModal({ op, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const approve = useApproveScheduledOperation();
  const cancel = useCancelScheduledOperation();
  const [confirmAction, setConfirmAction] = useState<'approve' | 'deny' | null>(null);

  // Reset confirmation when modal closes or op changes
  useEffect(() => {
    setConfirmAction(null);
  }, [open, op?.id]);

  // Fetch fresh quote when modal opens
  const { data: freshData, isLoading: quoteLoading } = useScheduledOperationQuote(
    op?.id ?? ''
  );

  const freshOp = freshData?.data ?? op;
  const countdown = useCountdown(op?.expires_at ?? null);

  if (!op) return null;

  const originalRate = op.initial_quote
    ? extractRate(op.type, op.initial_quote)
    : 0;

  const currentRate = freshOp?.execution_quote
    ? extractRate(op.type, freshOp.execution_quote)
    : 0;

  const deviationBps =
    freshOp?.deviation_bps ??
    (originalRate > 0 && currentRate > 0
      ? calculateDeviationBps(originalRate, currentRate)
      : null);

  const withinTolerance =
    deviationBps !== null && deviationBps <= op.tolerance_bps;

  const handleApprove = async () => {
    try {
      await approve.mutateAsync(op.id);
      toast({ title: 'Operation approved & executing', variant: 'success' });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Approval failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleDeny = async () => {
    try {
      await cancel.mutateAsync(op.id);
      toast({ title: 'Operation denied', variant: 'success' });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Denial failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const busy = approve.isPending || cancel.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Scheduled {operationTypeLabel(op.type)} — Review
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Summary */}
          <div className="text-sm font-medium text-foreground">
            {operationSummary(op)}
          </div>

          {/* Memo */}
          {op.memo && (
            <p className="text-xs text-muted-foreground italic border-l-2 border-primary pl-3">
              {op.memo}
            </p>
          )}

          {/* Rate comparison */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            {quoteLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Fetching current rate…
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground block mb-0.5">Original Rate</span>
                  <span className="font-mono font-medium tabular-nums">
                    {formatRate(originalRate)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block mb-0.5">Current Rate</span>
                  <span className="font-mono font-medium tabular-nums">
                    {currentRate > 0 ? formatRate(currentRate) : '—'}
                  </span>
                </div>
              </div>
            )}

            {/* Deviation badge */}
            {!quoteLoading && deviationBps !== null && (
              <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                <span className="text-xs text-muted-foreground">Deviation</span>
                <Badge
                  variant={withinTolerance ? 'success' : 'destructive'}
                  className="text-[10px] px-1.5 py-0"
                >
                  {deviationBps} bps
                </Badge>
                <span className="text-xs text-muted-foreground">
                  (tolerance: {op.tolerance_bps} bps)
                </span>
                {withinTolerance && (
                  <span className="text-xs text-green-600 font-medium">
                    Within tolerance
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Expiry countdown */}
          {countdown && (
            <p className="text-xs text-muted-foreground">
              Expires in{' '}
              <span className={countdown === 'Expired' ? 'text-red-500 font-medium' : 'font-medium'}>
                {countdown}
              </span>
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          {confirmAction === null ? (
            <>
              <Button
                variant="destructive-outline"
                onClick={() => setConfirmAction('deny')}
                disabled={busy}
              >
                Deny
              </Button>
              <Button onClick={() => setConfirmAction('approve')} disabled={busy}>
                Approve &amp; Execute
              </Button>
            </>
          ) : (
            <div className="w-full space-y-3">
              <p className="text-sm text-muted-foreground">
                {confirmAction === 'approve'
                  ? 'This will execute the operation at the current market rate. This action cannot be undone.'
                  : 'This will permanently cancel the scheduled operation.'}
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setConfirmAction(null)}
                  disabled={busy}
                >
                  Go Back
                </Button>
                {confirmAction === 'approve' ? (
                  <Button onClick={handleApprove} disabled={busy}>
                    {approve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                    Confirm Execute
                  </Button>
                ) : (
                  <Button
                    variant="destructive-outline"
                    onClick={handleDeny}
                    disabled={busy}
                  >
                    {cancel.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                    Confirm Deny
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
