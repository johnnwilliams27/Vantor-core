'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  useTreasuryRecommendations,
  useApproveRecommendation,
  useRejectRecommendation,
} from '@/hooks/useTreasury';
import { useSession } from 'next-auth/react';
import { hasRole } from '@/lib/auth/rbac';
import { CardSpinner } from '@/components/ui/spinner';
import {
  BrainCircuit,
  ArrowUpFromLine,
  ArrowDownToLine,
  Minus,
  Check,
  X,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import type { AiRecommendation } from '@/types/database';

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
  offramp: <ArrowUpFromLine className="h-3.5 w-3.5" />,
  onramp: <ArrowDownToLine className="h-3.5 w-3.5" />,
  no_action: <Minus className="h-3.5 w-3.5" />,
};

const ACTION_LABELS: Record<string, string> = {
  offramp: 'Offramp',
  onramp: 'Onramp',
  no_action: 'No Action',
};

function CompactRec({ rec }: { rec: AiRecommendation }) {
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();
  const { data: session } = useSession();
  const approve = useApproveRecommendation();
  const reject = useRejectRecommendation();

  const isTreasuryManager = hasRole((session?.user?.role as any) ?? 'auditor', 'treasury_manager');
  const canAct = isTreasuryManager && rec.status === 'pending_approval' && new Date(rec.expires_at) > new Date();

  const handleApprove = async () => {
    try {
      await approve.mutateAsync(rec.id);
      toast({ title: 'Recommendation approved', variant: 'success' });
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
      <div
        className="py-2 border-b last:border-b-0 cursor-pointer hover:bg-muted/30 rounded transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
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
              {!expanded && (
                <p className="text-xs text-muted-foreground truncate">
                  {rec.ai_reasoning}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
          {canAct ? (
            <>
              <button
                className="p-1 rounded-md text-green-700 bg-green-50 hover:bg-green-100 transition-colors disabled:opacity-40"
                onClick={(e) => { e.stopPropagation(); setShowApprove(true); }}
                disabled={approve.isPending || reject.isPending}
                title="Approve"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                className="p-1 rounded-md text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-40"
                onClick={(e) => { e.stopPropagation(); setShowReject(true); }}
                disabled={approve.isPending || reject.isPending}
                title="Deny"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <Badge
              variant={
                rec.status === 'approved' || rec.status === 'executed' || rec.status === 'auto_executed'
                  ? 'success'
                  : rec.status === 'rejected'
                    ? 'destructive'
                    : rec.status === 'expired'
                      ? 'secondary'
                      : 'warning'
              }
              className="text-[10px] px-1.5 py-0"
            >
              {rec.status === 'pending_approval' ? 'Pending' : rec.status.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </Badge>
          )}
        </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-2 space-y-2 pl-6">
            <blockquote className="border-l-2 border-[#19595b] pl-3 text-xs text-muted-foreground italic">
              {rec.ai_reasoning}
            </blockquote>
            <div className="grid grid-cols-3 gap-2 text-xs bg-muted/40 rounded-md p-2">
              <div>
                <span className="text-muted-foreground">Fiat</span>
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
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
              <span>Model: {rec.ai_model}</span>
              {rec.stablecoin_token && <span>Token: {rec.stablecoin_token} on {rec.stablecoin_chain}</span>}
              <span>{new Date(rec.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        )}
      </div>

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

export function RecommendationsCard() {
  const { data: recommendations, isLoading } = useTreasuryRecommendations();

  // Show the most recent recommendations (up to 5)
  const recent = (recommendations ?? []).slice(0, 5);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5" />
            AI Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CardSpinner />
        </CardContent>
      </Card>
    );
  }

  if (!recent.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5" />
            AI Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
            No AI recommendations yet. Configure treasury rules to get started.
          </div>
        </CardContent>
      </Card>
    );
  }

  const pendingCount = recent.filter((r) => r.status === 'pending_approval').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5" />
            AI Recommendations
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
          {recent.map((rec) => (
            <CompactRec key={rec.id} rec={rec} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
