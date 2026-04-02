'use client';
import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useApproveRecommendation, useRejectRecommendation } from '@/hooks/useTreasury';
import { useSession } from 'next-auth/react';
import { hasRole } from '@/lib/auth/rbac';
import type { AiRecommendation } from '@/types/database';
import { ArrowDownToLine, ArrowUpFromLine, Minus, CheckCircle2, XCircle, Clock, ArrowRight } from 'lucide-react';
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

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  pending_approval: { label: 'Pending Approval', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
  executed: { label: 'Executed', variant: 'success' },
  auto_executed: { label: 'Auto-executed', variant: 'success' },
  expired: { label: 'Expired', variant: 'secondary' },
};

const ACTION_CONFIG: Record<string, { label: string; icon: React.ReactNode; colorClass: string }> = {
  onramp: {
    label: 'On-ramp',
    icon: <ArrowUpFromLine className="h-4 w-4" />,
    colorClass: 'text-green-600',
  },
  offramp: {
    label: 'Off-ramp',
    icon: <ArrowDownToLine className="h-4 w-4" />,
    colorClass: 'text-blue-600',
  },
  no_action: {
    label: 'No Action Needed',
    icon: <Minus className="h-4 w-4" />,
    colorClass: 'text-gray-500',
  },
};

interface Props {
  rec: AiRecommendation;
}

export function RecommendationCard({ rec }: Props) {
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const { toast } = useToast();
  const { data: session } = useSession();
  const countdown = useCountdown(rec.expires_at);

  const approve = useApproveRecommendation();
  const reject = useRejectRecommendation();
  const { data: wallets } = useWallets();

  // Find the wallet matching this recommendation's chain
  const targetWallet = wallets?.find((w) => w.chain === rec.stablecoin_chain);
  const walletLabel = targetWallet?.label || (targetWallet?.address ? `${targetWallet.address.slice(0, 6)}…${targetWallet.address.slice(-4)}` : 'Wallet');
  const bankLabel = rec.bank_account
    ? `${rec.bank_account.institution_name}${rec.bank_account.last4 ? ` ****${rec.bank_account.last4}` : ''}`
    : 'Bank Account';

  const isTreasuryManager = hasRole((session?.user?.role as any) ?? 'auditor', 'treasury_manager');
  const canAct = isTreasuryManager && rec.status === 'pending_approval' && new Date(rec.expires_at) > new Date();

  const actionConfig = ACTION_CONFIG[rec.action] ?? ACTION_CONFIG.no_action;
  const statusConfig = STATUS_CONFIG[rec.status] ?? { label: rec.status, variant: 'secondary' as const };

  const handleApprove = async () => {
    try {
      await approve.mutateAsync(rec.id);
      toast({ title: 'Recommendation approved and executed', variant: 'success' });
      setShowApprove(false);
    } catch (err) {
      toast({ title: 'Approval failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleReject = async () => {
    try {
      await reject.mutateAsync({ id: rec.id, reason: rejectReason || undefined });
      toast({ title: 'Recommendation rejected', variant: 'success' });
      setShowReject(false);
      setRejectReason('');
    } catch (err) {
      toast({ title: 'Rejection failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <>
      <Card className="overflow-hidden">
        <CardContent className="p-4 space-y-4">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className={`flex items-center gap-2 font-semibold ${actionConfig.colorClass}`}>
              {actionConfig.icon}
              <span>{actionConfig.label}</span>
              {rec.recommended_amount_usd && (
                <span className="text-lg tabular-nums">
                  {formatUsd(rec.recommended_amount_usd)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
              {rec.status === 'pending_approval' && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {countdown}
                </span>
              )}
            </div>
          </div>

          {/* Context grid */}
          <div className="grid grid-cols-3 gap-3 bg-muted/40 rounded-lg p-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Fiat Balance</div>
              <div className="font-semibold tabular-nums">{formatUsd(rec.total_bank_balance_usd)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Obligations ({rec.obligation_lookahead_days}d)</div>
              <div className="font-semibold tabular-nums">{formatUsd(rec.obligations_in_window_usd)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Safety Target</div>
              <div className="font-semibold tabular-nums">{formatUsd(rec.safety_buffer_target_usd)}</div>
            </div>
          </div>

          {/* AI Reasoning */}
          <div className="border-l-2 border-[#19595b] pl-3 text-sm text-foreground space-y-2">
            <SimpleMarkdown text={rec.ai_reasoning} />
          </div>

          {/* Movement details */}
          <div className="space-y-2">
            {rec.action !== 'no_action' && rec.stablecoin_token && (
              <div className="flex items-center gap-2 text-xs bg-muted/40 rounded-md px-3 py-2">
                {rec.action === 'offramp' ? (
                  <>
                    <span className="font-medium text-foreground">{rec.stablecoin_token} on {rec.stablecoin_chain ? rec.stablecoin_chain.charAt(0).toUpperCase() + rec.stablecoin_chain.slice(1) : ''} ({walletLabel})</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-medium text-foreground">USD ({bankLabel})</span>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-foreground">USD ({bankLabel})</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-medium text-foreground">{rec.stablecoin_token} on {rec.stablecoin_chain ? rec.stablecoin_chain.charAt(0).toUpperCase() + rec.stablecoin_chain.slice(1) : ''} ({walletLabel})</span>
                  </>
                )}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              <span>{new Date(rec.created_at).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Action buttons */}
          {canAct && (
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => setShowApprove(true)}
                disabled={approve.isPending || reject.isPending}
                className="flex items-center gap-1"
              >
                <CheckCircle2 className="h-4 w-4" />
                Approve & Execute
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowReject(true)}
                disabled={approve.isPending || reject.isPending}
                className="flex items-center gap-1 text-red-600 hover:text-red-700"
              >
                <XCircle className="h-4 w-4" />
                Reject
              </Button>
            </div>
          )}

          {rec.rejection_reason && (
            <div className="text-xs text-red-600 bg-red-50 rounded-md p-2">
              Rejection reason: {rec.rejection_reason}
            </div>
          )}

          {rec.execution_error && (
            <div className="text-xs text-red-600 bg-red-50 rounded-md p-2">
              Execution error: {rec.execution_error}
            </div>
          )}
        </CardContent>
      </Card>

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
              className="text-red-600 border-red-300 hover:bg-red-50"
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
