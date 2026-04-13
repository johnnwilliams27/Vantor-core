'use client';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SimpleMarkdown } from '@/components/ui/simple-markdown';
import { useApproveRecommendation, useRejectRecommendation } from '@/hooks/useTreasury';
import { useWallets } from '@/hooks/useWallets';
import { hasRole } from '@/lib/auth/rbac';
import { useToast } from '@/components/ui/toast';
import { ArrowRight } from 'lucide-react';
import type { AiRecommendation } from '@/types/database';

function formatUsd(v: string | number | null): string {
  if (v === null || v === undefined) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(Number(v));
}

const ACTION_LABELS: Record<string, string> = {
  onramp: 'On-ramp',
  offramp: 'Off-ramp',
  no_action: 'No Action',
};

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  pending_approval: { label: 'Pending Approval', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
  executed: { label: 'Executed', variant: 'success' },
  auto_executed: { label: 'Auto-executed', variant: 'success' },
  expired: { label: 'Expired', variant: 'secondary' },
};

interface Props {
  recommendationId: string;
  onClose: () => void;
}

export function ReviewRecommendationModal({ recommendationId, onClose }: Props) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const approve = useApproveRecommendation();
  const reject = useRejectRecommendation();
  const { data: wallets } = useWallets();

  const { data: rec, isLoading } = useQuery<AiRecommendation | null>({
    queryKey: ['recommendation', recommendationId],
    queryFn: async () => {
      const res = await fetch('/api/treasury/recommendations');
      if (!res.ok) throw new Error('Failed');
      const { data } = await res.json();
      return data?.find((r: AiRecommendation) => r.id === recommendationId) ?? null;
    },
    enabled: !!recommendationId,
  });

  if (isLoading || !rec) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <div className="py-8 text-center text-sm text-muted-foreground">
            {isLoading ? 'Loading recommendation...' : 'Recommendation not found.'}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const isTreasuryManager = hasRole((session?.user?.role as any) ?? 'auditor', 'treasury_manager');
  const canAct = isTreasuryManager && rec.status === 'pending_approval' && new Date(rec.expires_at) > new Date();
  const statusConfig = STATUS_CONFIG[rec.status] ?? { label: rec.status, variant: 'secondary' as const };
  const targetWallet = wallets?.find((w) => w.chain === rec.stablecoin_chain);
  const walletLabel = targetWallet?.label || (targetWallet?.address ? `${targetWallet.address.slice(0, 6)}...${targetWallet.address.slice(-4)}` : 'Wallet');
  const bankLabel = rec.bank_account
    ? `${rec.bank_account.institution_name}${rec.bank_account.last4 ? ` ****${rec.bank_account.last4}` : ''}`
    : 'Bank Account';
  const chainLabel = rec.stablecoin_chain ? rec.stablecoin_chain.charAt(0).toUpperCase() + rec.stablecoin_chain.slice(1) : '';

  const handleApprove = async () => {
    try {
      await approve.mutateAsync(rec.id);
      toast({ title: 'Recommendation approved and executed', variant: 'success' });
      onClose();
    } catch (err) {
      toast({ title: 'Approval failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleReject = async () => {
    try {
      await reject.mutateAsync({ id: rec.id, reason: rejectReason || undefined });
      toast({ title: 'Recommendation rejected', variant: 'success' });
      onClose();
    } catch (err) {
      toast({ title: 'Rejection failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  if (showReject) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reject Recommendation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Optionally provide a reason for rejecting this recommendation.</p>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              rows={3}
              placeholder="Reason (optional)..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReject(false)}>Back</Button>
            <Button
              variant="destructive-outline"
              onClick={handleReject}
              disabled={reject.isPending}
            >
              {reject.isPending ? 'Rejecting...' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>AI Recommendation — Review</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span>{ACTION_LABELS[rec.action] ?? rec.action}</span>
              {rec.recommended_amount_usd && (
                <span className="tabular-nums">{formatUsd(rec.recommended_amount_usd)}</span>
              )}
            </div>
            <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
          </div>

          <div className="border-l-2 border-[#19595b] pl-3 text-sm text-foreground space-y-2">
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

          <div className="text-[10px] text-muted-foreground">
            {new Date(rec.created_at).toLocaleDateString()} {new Date(rec.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
          </div>
        </div>

        {canAct ? (
          <DialogFooter className="gap-2">
            <Button
              variant="destructive-outline"
              onClick={() => setShowReject(true)}
              disabled={approve.isPending || reject.isPending}
            >
              Deny
            </Button>
            <Button
              onClick={handleApprove}
              disabled={approve.isPending || reject.isPending}
            >
              {approve.isPending ? 'Executing...' : 'Approve'}
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
