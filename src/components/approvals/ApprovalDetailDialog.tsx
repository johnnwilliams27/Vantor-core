'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { formatCurrency, formatRelativeOrDate, capitalize, sanitizeErrorMessage } from '@/lib/utils';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui/toast';
import type { ApprovalRequest } from '@/lib/policy/approvals/types';
import { Check, X, CircleSlash } from 'lucide-react';
import { cn } from '@/lib/utils';

type Mode = 'detail' | 'approve' | 'deny' | 'cancel';

interface Props {
  request: ApprovalRequest;
  onClose: () => void;
  onActionComplete: () => void;
}

export function ApprovalDetailDialog({ request, onClose, onActionComplete }: Props) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('detail');
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const m = request.proposed_movement;
  const amount = `${formatCurrency(m.amount.amount)} ${m.amount.asset}`;

  const isPending = request.status === 'pending';
  const isInitiator = request.created_by === session?.user?.id;
  const role = session?.user?.role;
  const canApprove = isPending && !isInitiator && role && ['accountant', 'treasury_manager', 'executive', 'enterprise_admin'].includes(role);
  const canDeny = isPending && role && ['treasury_manager', 'executive', 'enterprise_admin'].includes(role);
  const canCancel = isPending && (isInitiator || role === 'enterprise_admin');

  async function submit(action: 'approve' | 'deny' | 'cancel') {
    if (action !== 'cancel' && justification.trim().length < 3) {
      toast({ title: 'Justification required', description: 'Enter at least 3 characters.', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const url = `/api/policy/approvals/${request.id}/${action}`;
      const body = action === 'cancel'
        ? { reason: justification || undefined }
        : { justification };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.human_readable ?? err.error ?? `Request failed (${res.status})`);
      }
      toast({
        title: action === 'approve' ? 'Approval recorded' : action === 'deny' ? 'Request denied' : 'Request cancelled',
        variant: 'success',
      });
      onActionComplete();
      onClose();
    } catch (err) {
      toast({
        title: `${capitalize(action)} failed`,
        description: sanitizeErrorMessage((err as Error).message),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{capitalize(m.kind.replace(/_/g, ' '))} — {amount}</DialogTitle>
          <DialogDescription>
            Requested {formatRelativeOrDate(request.created_at).text} · Status:{' '}
            <Badge variant={statusVariant(request.status)}>{capitalize(request.status)}</Badge>
          </DialogDescription>
        </DialogHeader>

        {mode === 'detail' && (
          <div className="space-y-5 text-sm">
            <Section label="Movement">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Row label="From" value={m.source.label ?? m.source.address ?? m.source.venue} />
                <Row label="To" value={m.destination.label ?? m.destination.address ?? m.destination.venue} />
                <Row label="Amount" value={amount} />
                <Row label="Initiator" value={m.initiator.type} />
              </dl>
            </Section>

            <Section label="Approval chain">
              <div className="space-y-2">
                {request.slot_assignments.map((slot) => (
                  <div
                    key={slot.slot_index}
                    className={cn(
                      'flex items-center justify-between rounded-md border px-3 py-2',
                      slot.filled_by
                        ? 'border-emerald-500/20 bg-emerald-500/5'
                        : 'border-white/[0.08]',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {slot.filled_by ? (
                        <Check className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <CircleSlash className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm">
                        Slot {slot.slot_index + 1} · Requires {slot.minimum_role}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {slot.filled_by ? `Approved ${slot.filled_at ? formatRelativeOrDate(slot.filled_at).text : ''}` : 'Unfilled'}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {request.triggered_rule_ids?.length > 0 && (
              <Section label="Triggered rules">
                <div className="flex flex-wrap gap-2">
                  {request.triggered_rule_ids.map((ruleId) => (
                    <Badge key={ruleId} variant="secondary" className="font-mono text-xs">
                      {ruleId}
                    </Badge>
                  ))}
                </div>
              </Section>
            )}

            {request.resolution_notes ? (
              <Section label="Resolution notes">
                <pre className="text-xs bg-muted/40 rounded p-3 overflow-x-auto">
                  {JSON.stringify(request.resolution_notes, null, 2)}
                </pre>
              </Section>
            ) : null}
          </div>
        )}

        {(mode === 'approve' || mode === 'deny' || mode === 'cancel') && (
          <div className="space-y-3">
            <Label htmlFor="justification">
              {mode === 'cancel' ? 'Cancellation reason (optional)' : 'Justification'}
            </Label>
            <textarea
              id="justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              className="w-full rounded-md border border-white/[0.08] bg-background px-3 py-2 text-sm min-h-[100px]"
              placeholder={
                mode === 'approve'
                  ? 'e.g., Confirmed with treasury team; within quarterly budget.'
                  : mode === 'deny'
                  ? 'e.g., Recipient flagged in sanctions review; blocking until cleared.'
                  : 'Why are you cancelling? (optional)'
              }
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground">{justification.length} / 2000</p>
          </div>
        )}

        <DialogFooter>
          {mode === 'detail' ? (
            <>
              <Button variant="outline" onClick={onClose}>Close</Button>
              {canCancel && (
                <Button variant="outline" onClick={() => setMode('cancel')}>
                  Cancel request
                </Button>
              )}
              {canDeny && (
                <Button
                  variant="outline"
                  className="text-red-400 border-red-500/20 hover:bg-red-500/10"
                  onClick={() => setMode('deny')}
                >
                  <X className="h-4 w-4 mr-1" /> Deny
                </Button>
              )}
              {canApprove && (
                <Button className="btn-gradient" onClick={() => setMode('approve')}>
                  <Check className="h-4 w-4 mr-1" /> Approve
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => { setMode('detail'); setJustification(''); }} disabled={submitting}>
                Back
              </Button>
              <Button
                className={mode === 'approve' ? 'btn-gradient' : ''}
                variant={mode === 'approve' ? 'default' : 'destructive'}
                disabled={submitting}
                onClick={() => submit(mode)}
              >
                {submitting ? 'Submitting…' : `Confirm ${mode}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{label}</div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm truncate">{value}</dd>
    </>
  );
}

function statusVariant(status: string): any {
  switch (status) {
    case 'pending': return 'warning';
    case 'approved': return 'info';
    case 'executed': return 'success';
    case 'denied': return 'destructive';
    case 'cancelled': return 'secondary';
    default: return 'secondary';
  }
}
