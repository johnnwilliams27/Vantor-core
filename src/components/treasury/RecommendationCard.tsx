'use client';
import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
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
import { ArrowDownToLine, ArrowUpFromLine, Minus, Clock, ArrowRight } from 'lucide-react';
import { SimpleMarkdown } from '@/components/ui/simple-markdown';
import { useWallets } from '@/hooks/useWallets';
import { useDisplayCurrency } from '@/hooks/useDisplayCurrency';
import { useFxRates } from '@/hooks/useFxRates';

function formatUsd(v: string | number | null): string {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(v));
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
  onramp: <ArrowUpFromLine className="h-4 w-4" />,
  offramp: <ArrowDownToLine className="h-4 w-4" />,
  no_action: <Minus className="h-4 w-4" />,
};

const ACTION_LABELS: Record<string, string> = {
  onramp: 'On-ramp',
  offramp: 'Off-ramp',
  no_action: 'No Action Needed',
};

import { StatusDot, type StatusDotVariant } from '@/components/ui/status-dot';

const STATUS_VARIANT: Record<string, StatusDotVariant> = {
  pending_approval: 'pending',
  approved: 'active',
  rejected: 'failed',
  executed: 'active',
  auto_executed: 'active',
  expired: 'inactive',
};

const STATUS_LABELS: Record<string, string> = {
  pending_approval: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  executed: 'Executed',
  auto_executed: 'Auto-executed',
  expired: 'Expired',
};

export function RecommendationCard({ rec }: { rec: AiRecommendation }) {
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const { toast } = useToast();
  const { data: session } = useSession();
  const countdown = useCountdown(rec.expires_at);
  const approve = useApproveRecommendation();
  const reject = useRejectRecommendation();
  const { data: wallets } = useWallets();
  const { currency: dc } = useDisplayCurrency();
  const { data: fxData } = useFxRates();
  const fxRate = fxData?.rates?.[dc] ?? 1;
  const fmt = (v: string | number | null) => {
    if (v === null || v === undefined) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: dc, maximumFractionDigits: 0 }).format(Number(v) * fxRate);
  };

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
        <CardContent className="p-4 space-y-3">
          {/* Header — action + amount + status dot */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-foreground">
              <span className="text-muted-foreground shrink-0">
                {ACTION_ICONS[rec.action] ?? ACTION_ICONS.no_action}
              </span>
              <span className="text-sm font-medium">
                {ACTION_LABELS[rec.action] ?? rec.action}
              </span>
              {rec.recommended_amount_usd && (
                <span className="text-sm font-semibold tabular-nums">
                  {fmt(rec.recommended_amount_usd)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <StatusDot variant={STATUS_VARIANT[rec.status] ?? 'inactive'} size="xs" />
                {STATUS_LABELS[rec.status] ?? rec.status}
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {rec.status === 'pending_approval' ? countdown : formatRelativeTime(rec.created_at)}
              </span>
            </div>
          </div>

          {/* AI Reasoning */}
          <div className="text-sm text-muted-foreground space-y-2">
            <SimpleMarkdown text={rec.ai_reasoning} />
          </div>

          {/* Context grid — below reasoning, matching Insights pattern */}
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-border/50 p-3">
            <div>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Bank Balance</div>
              <div className="text-sm font-semibold tabular-nums mt-0.5">{fmt(rec.total_bank_balance_usd)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Obligations ({rec.obligation_lookahead_days}d)</div>
              <div className="text-sm font-semibold tabular-nums mt-0.5">{fmt(rec.obligations_in_window_usd)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Safety Target</div>
              <div className="text-sm font-semibold tabular-nums mt-0.5">{fmt(rec.safety_buffer_target_usd)}</div>
            </div>
          </div>

          {/* Movement + timestamp */}
          {rec.action !== 'no_action' && rec.stablecoin_token && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border border-border/50 px-3 py-2">
              {rec.action === 'offramp' ? (
                <>
                  <span className="text-foreground font-medium">{rec.stablecoin_token} on {chainLabel} ({walletLabel})</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  <span className="text-foreground font-medium">USD ({bankLabel})</span>
                </>
              ) : (
                <>
                  <span className="text-foreground font-medium">USD ({bankLabel})</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  <span className="text-foreground font-medium">{rec.stablecoin_token} on {chainLabel} ({walletLabel})</span>
                </>
              )}
            </div>
          )}


          {/* Actions — text links, not heavy buttons */}
          {canAct && (
            <div className="flex gap-4 pt-1 text-xs font-medium">
              <button
                onClick={() => setShowApprove(true)}
                disabled={approve.isPending || reject.isPending}
                className="text-teal-500 hover:text-teal-400 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 rounded-sm"
              >
                Approve & Execute →
              </button>
              <button
                onClick={() => setShowReject(true)}
                disabled={approve.isPending || reject.isPending}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 rounded-sm"
              >
                Reject
              </button>
            </div>
          )}

          {rec.rejection_reason && (
            <div className="text-xs text-red-400 bg-red-500/10 rounded-md p-2">
              Rejection reason: {rec.rejection_reason}
            </div>
          )}
          {rec.execution_error && (
            <div className="text-xs text-red-400 bg-red-500/10 rounded-md p-2">
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
            This will execute a <strong className="text-foreground">{rec.action}</strong> of{' '}
            <strong className="text-foreground">{fmt(rec.recommended_amount_usd)}</strong> immediately.
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
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-400/50"
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
