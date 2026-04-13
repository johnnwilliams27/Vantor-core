'use client';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyStateCard } from '@/components/ui/empty-state-card';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import {
  useTreasuryRecommendations,
  useApproveRecommendation,
  useRejectRecommendation,
} from '@/hooks/useTreasury';
import { usePendingApprovals } from '@/hooks/useScheduledOperations';
import { useSession } from 'next-auth/react';
import { hasRole } from '@/lib/auth/rbac';
import { CardError, CardSkeleton } from '@/components/ui/spinner';
import { StatusDot } from '@/components/ui/status-dot';
import {
  BrainCircuit,
  ArrowUpFromLine,
  ArrowDownToLine,
  ArrowRight,
  Minus,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import type { AiRecommendation } from '@/types/database';
import type { ScheduledOperation, SwapParams, BridgeParams, RampParams } from '@/types/scheduled-operations';
import { ApprovalModal } from '@/components/scheduled/ApprovalModal';
import { SimpleMarkdown } from '@/components/ui/simple-markdown';
import { useWallets } from '@/hooks/useWallets';

function formatUsd(v: string | number | null): string {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(v));
}

function useCountdown(expiresAt: string): string {
  const [label, setLabel] = useState('');

  useEffect(() => {
    function update() {
      const ms = new Date(expiresAt).getTime() - Date.now();
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

const ACTION_ICONS: Record<string, React.ReactNode> = {
  onramp: <ArrowUpFromLine className="h-3.5 w-3.5" />,
  offramp: <ArrowDownToLine className="h-3.5 w-3.5" />,
  no_action: <Minus className="h-3.5 w-3.5" />,
};

const ACTION_LABELS: Record<string, string> = {
  onramp: 'On-ramp',
  offramp: 'Off-ramp',
  no_action: 'No Action',
};

/* ─── helper: scheduled op summary ─────────────────────────────────── */
function scheduledOpSummary(op: ScheduledOperation): string {
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
  return 'Operation';
}

/* ─── CompactScheduledOp ────────────────────────────────────────────── */
function CompactScheduledOp({
  op,
  onReview,
}: {
  op: ScheduledOperation;
  onReview: (op: ScheduledOperation) => void;
}) {
  const isResolved =
    op.status === 'completed' ||
    op.status === 'cancelled' ||
    op.status === 'failed' ||
    op.status === 'expired';

  const typeLabel =
    op.type === 'swap' ? 'Swap' : op.type === 'bridge' ? 'Bridge' : 'Ramp';

  return (
    <div className="py-3 border-b border-border/50 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-2xs font-medium text-muted-foreground shrink-0 w-10">{typeLabel}</span>
          <p className="text-sm text-foreground truncate">
            {scheduledOpSummary(op)}
          </p>
        </div>

        <div className="shrink-0">
          {isResolved ? (
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              op.status === 'completed' ? 'text-green-600 dark:text-green-400'
              : op.status === 'cancelled' ? 'text-red-600 dark:text-red-400'
              : 'text-muted-foreground'
            }`}>
              <StatusDot
                variant={
                  op.status === 'completed' ? 'active'
                  : op.status === 'cancelled' ? 'failed'
                  : 'inactive'
                }
                size="xs"
              />
              {op.status === 'completed'
                ? 'Approved'
                : op.status === 'cancelled'
                ? 'Denied'
                : op.status.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
          ) : (
            <button
              onClick={() => onReview(op)}
              className="text-xs font-medium text-teal-500 hover:text-teal-400 transition-colors"
            >
              Review →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── CompactRec ────────────────────────────────────────────────────── */
function CompactRec({ rec }: { rec: AiRecommendation }) {
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const { toast } = useToast();
  const { data: session } = useSession();
  const approve = useApproveRecommendation();
  const reject = useRejectRecommendation();
  const { data: wallets } = useWallets();

  const targetWallet = wallets?.find((w) => w.chain === rec.stablecoin_chain);
  const walletLabel = targetWallet?.label || (targetWallet?.address ? `${targetWallet.address.slice(0, 6)}…${targetWallet.address.slice(-4)}` : 'Wallet');
  const bankLabel = rec.bank_account
    ? `${rec.bank_account.institution_name}${rec.bank_account.last4 ? ` ****${rec.bank_account.last4}` : ''}`
    : 'Bank Account';
  const chainLabel = rec.stablecoin_chain ? rec.stablecoin_chain.charAt(0).toUpperCase() + rec.stablecoin_chain.slice(1) : '';

  const isTreasuryManager = hasRole((session?.user?.role as any) ?? 'auditor', 'treasury_manager');
  const canAct = isTreasuryManager && rec.status === 'pending_approval' && new Date(rec.expires_at) > new Date();

  const handleApprove = async () => {
    try {
      await approve.mutateAsync(rec.id);
      toast({ title: 'Recommendation approved', variant: 'success' });
      setShowApprove(false);
      setShowReview(false);
    } catch (err) {
      toast({ title: 'Approval failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleReject = async () => {
    try {
      await reject.mutateAsync({ id: rec.id, reason: rejectReason || undefined });
      toast({ title: 'Recommendation rejected', variant: 'success' });
      setShowReject(false);
      setShowReview(false);
      setRejectReason('');
    } catch (err) {
      toast({ title: 'Rejection failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <>
      <div className="py-3 border-b border-border/50 last:border-b-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-muted-foreground shrink-0">
              {ACTION_ICONS[rec.action] ?? ACTION_ICONS.no_action}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <span>{ACTION_LABELS[rec.action] ?? rec.action}</span>
                {rec.recommended_amount_usd && (
                  <span className="tabular-nums">{formatUsd(rec.recommended_amount_usd)}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {rec.action !== 'no_action' && rec.stablecoin_token ? (
                  rec.action === 'offramp'
                    ? `${rec.stablecoin_token} on ${chainLabel} (${walletLabel}) → USD (${bankLabel})`
                    : `USD (${bankLabel}) → ${rec.stablecoin_token} on ${chainLabel} (${walletLabel})`
                ) : (
                  'No action required'
                )}
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {canAct ? (
              <button
                onClick={() => setShowReview(true)}
                disabled={approve.isPending || reject.isPending}
                className="text-xs font-medium text-teal-500 hover:text-teal-400 transition-colors disabled:opacity-50"
              >
                Review →
              </button>
            ) : (
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                rec.status === 'approved' || rec.status === 'executed' || rec.status === 'auto_executed'
                  ? 'text-green-600 dark:text-green-400'
                  : rec.status === 'rejected'
                    ? 'text-red-600 dark:text-red-400'
                    : rec.status === 'expired'
                      ? 'text-muted-foreground'
                      : 'text-amber-600 dark:text-amber-400'
              }`}>
                <StatusDot
                  variant={
                    rec.status === 'approved' || rec.status === 'executed' || rec.status === 'auto_executed'
                      ? 'active'
                      : rec.status === 'rejected'
                        ? 'failed'
                        : rec.status === 'expired'
                          ? 'inactive'
                          : 'pending'
                  }
                  size="xs"
                />
                {rec.status === 'pending_approval' ? 'Pending' : rec.status.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Review Dialog */}
      <Dialog open={showReview} onOpenChange={setShowReview}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              AI Recommendation — Review
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="text-muted-foreground">
                {ACTION_ICONS[rec.action] ?? ACTION_ICONS.no_action}
              </span>
              <span>{ACTION_LABELS[rec.action] ?? rec.action}</span>
              {rec.recommended_amount_usd && (
                <span className="tabular-nums">{formatUsd(rec.recommended_amount_usd)}</span>
              )}
            </div>

            <div className="border-l-2 border-teal-500 pl-3 text-sm text-foreground space-y-2">
              <SimpleMarkdown text={rec.ai_reasoning} />
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs bg-muted/40 rounded-md p-2">
              <div>
                <span className="text-muted-foreground">Bank Cash</span>
                <div className="font-medium tabular-nums">{formatUsd(rec.total_bank_balance_usd)}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Obligations ({rec.obligation_lookahead_days}d)</span>
                <div className="font-medium tabular-nums">{formatUsd(rec.obligations_in_window_usd)}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Safety Target</span>
                <div className="font-medium tabular-nums">{formatUsd(rec.safety_buffer_target_usd)}</div>
              </div>
            </div>

            {rec.action !== 'no_action' && rec.stablecoin_token && (
              <div className="flex items-center gap-2 text-xs bg-muted/40 rounded-md px-3 py-2">
                {rec.action === 'offramp' ? (
                  <>
                    <span className="font-medium text-foreground">{rec.stablecoin_token} on {chainLabel} ({walletLabel})</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-medium text-foreground">USD ({bankLabel})</span>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-foreground">USD ({bankLabel})</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-medium text-foreground">{rec.stablecoin_token} on {chainLabel} ({walletLabel})</span>
                  </>
                )}
              </div>
            )}

            <div className="text-3xs text-muted-foreground">
              {new Date(rec.created_at).toLocaleDateString()} {new Date(rec.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="text-red-400 border-red-500/30 hover:bg-red-500/10"
              onClick={() => { setShowReview(false); setShowReject(true); }}
              disabled={approve.isPending || reject.isPending}
            >
              Deny
            </Button>
            <Button
              onClick={() => { setShowReview(false); setShowApprove(true); }}
              disabled={approve.isPending || reject.isPending}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve Dialog */}
      <Dialog open={showApprove} onOpenChange={setShowApprove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Approval</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will execute a{' '}
            <strong>{rec.action}</strong> of{' '}
            <strong>{formatUsd(rec.recommended_amount_usd)}</strong> immediately.
            This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApprove(false)}>Cancel</Button>
            <Button onClick={handleApprove} disabled={approve.isPending}>
              {approve.isPending ? 'Executing…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={showReject} onOpenChange={setShowReject}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Recommendation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Optionally provide a reason for rejecting this recommendation.
            </p>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              rows={3}
              placeholder="Reason (optional)…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReject(false)}>Cancel</Button>
            <Button
              variant="outline"
              className="text-red-400 border-red-500/30 hover:bg-red-500/10"
              onClick={handleReject}
              disabled={reject.isPending}
            >
              {reject.isPending ? 'Rejecting…' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─── RecommendationsCard ───────────────────────────────────────────── */
export function RecommendationsCard() {
  const { data: recommendations, isLoading, isError, refetch } = useTreasuryRecommendations();
  const { data: pendingOps } = usePendingApprovals();
  const [selectedOp, setSelectedOp] = useState<ScheduledOperation | null>(null);

  // Show the most recent recommendations (up to 5)
  const recent = (recommendations ?? []).slice(0, 5);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5" />
            AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CardSkeleton rows={4} />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5" />
            AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CardError message="Failed to load AI recommendations." onRetry={() => refetch()} />
        </CardContent>
      </Card>
    );
  }

  const hasPendingOps = (pendingOps ?? []).length > 0;

  if (!recent.length && !hasPendingOps) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5" />
            AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyStateCard
            icon={<BrainCircuit />}
            iconVariant="special"
            title="No AI insights yet"
            helper="Configure your treasury rules and Vantor AI will start surfacing rebalancing opportunities."
            cta={
              <Link href="/treasury?tab=rules" className={cn(buttonVariants({ size: 'sm' }))}>
                Configure rules
              </Link>
            }
            className="h-48 border-0 shadow-none bg-transparent"
          />
        </CardContent>
      </Card>
    );
  }

  const pendingCount =
    recent.filter((r) => r.status === 'pending_approval').length +
    (pendingOps ?? []).length;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5" />
              AI Insights
            </span>
            {pendingCount > 0 && (
              <Badge variant="warning" className="tabular-nums">
                {pendingCount} Pending
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y-0">
            {/* Scheduled operations awaiting authorization */}
            {(pendingOps ?? []).map((op) => (
              <CompactScheduledOp key={op.id} op={op} onReview={setSelectedOp} />
            ))}

            {/* AI recommendations */}
            {recent.map((rec) => (
              <CompactRec key={rec.id} rec={rec} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Approval modal for scheduled operations */}
      <ApprovalModal
        op={selectedOp}
        open={!!selectedOp}
        onOpenChange={(o) => !o && setSelectedOp(null)}
      />
    </>
  );
}
