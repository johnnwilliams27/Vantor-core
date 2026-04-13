'use client';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
import { TableRowsSkeleton } from '@/components/ui/operations-skeletons';
import { Calendar } from 'lucide-react';
import { useScheduledOperations, useCancelScheduledOperation } from '@/hooks/useScheduledOperations';
import { formatDateTime, capitalize } from '@/lib/utils';
import type { ScheduledOperationType, ScheduledOperation, SwapParams, BridgeParams, RampParams } from '@/types/scheduled-operations';

// Migrated to semantic badge variants (style guide Stage 3b).
// awaiting_authorization kept as pending (user action required).
const STATUS_COLORS: Record<string, string> = {
  pending: 'pending',
  processing: 'pending',
  awaiting_authorization: 'pending',
  completed: 'active',
  failed: 'failed',
  cancelled: 'inactive',
  expired: 'inactive',
};

function operationSummary(op: ScheduledOperation): string {
  switch (op.type) {
    case 'swap': {
      const p = op.params as SwapParams;
      return `${Number(p.amount).toLocaleString()} ${p.fromToken} → ${p.toToken}`;
    }
    case 'bridge': {
      const p = op.params as BridgeParams;
      return `${Number(p.amount).toLocaleString()} ${p.token}: ${capitalize(p.fromChain)} → ${capitalize(p.toChain)}`;
    }
    case 'ramp': {
      const p = op.params as RampParams;
      const dir = p.direction === 'onramp' ? 'On-ramp' : 'Off-ramp';
      return `${dir} ${p.cryptoAmount.toLocaleString()} ${p.cryptoToken}`;
    }
    default:
      return 'Operation';
  }
}

function operationDetails(op: ScheduledOperation): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  switch (op.type) {
    case 'swap': {
      const p = op.params as SwapParams;
      details.push({ label: 'Amount', value: `${Number(p.amount).toLocaleString()} ${p.fromToken} → ${p.toToken}` });
      details.push({ label: 'Chain', value: capitalize(p.chain) });
      break;
    }
    case 'bridge': {
      const p = op.params as BridgeParams;
      details.push({ label: 'Amount', value: `${Number(p.amount).toLocaleString()} ${p.token}` });
      details.push({ label: 'Route', value: `${capitalize(p.fromChain)} → ${capitalize(p.toChain)}` });
      break;
    }
    case 'ramp': {
      const p = op.params as RampParams;
      details.push({ label: 'Amount', value: `${p.cryptoAmount.toLocaleString()} ${p.cryptoToken}` });
      details.push({ label: 'Direction', value: p.direction === 'onramp' ? 'On-ramp (Fiat → Crypto)' : 'Off-ramp (Crypto → Fiat)' });
      details.push({ label: 'Currency', value: p.fiatCurrency });
      break;
    }
  }
  return details;
}

interface Props {
  type: ScheduledOperationType;
  title: string;
}

export function ScheduledOperationsTable({ type, title }: Props) {
  const { data, isLoading } = useScheduledOperations({ type });
  const cancel = useCancelScheduledOperation();
  const { toast } = useToast();
  const [confirmCancelOp, setConfirmCancelOp] = useState<ScheduledOperation | null>(null);

  const handleCancel = async () => {
    if (!confirmCancelOp) return;
    try {
      await cancel.mutateAsync(confirmCancelOp.id);
      toast({ title: 'Scheduled operation cancelled', variant: 'success' });
      setConfirmCancelOp(null);
    } catch (err) {
      toast({ title: 'Cancel failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const ops = data ?? [];
  if (!isLoading && ops.length === 0) return null;

  const canCancel = (status: string) => status === 'pending' || status === 'awaiting_authorization';

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scheduled For</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRowsSkeleton columns={5} rows={3} />
                ) : (
                  ops.map((op) => (
                    <TableRow key={op.id}>
                      <TableCell className="text-sm font-medium">
                        {operationSummary(op)}
                        {op.memo && (
                          <span className="block text-xs text-muted-foreground truncate max-w-[200px]">{op.memo}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_COLORS[op.status] as any}>
                          {op.status === 'awaiting_authorization' ? 'Awaiting Approval' : capitalize(op.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDateTime(op.scheduled_for)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDateTime(op.created_at)}
                      </TableCell>
                      <TableCell>
                        {canCancel(op.status) && (
                          <Button
                            size="sm"
                            variant="destructive-outline"
                            className="h-7 text-xs px-3"
                            onClick={() => setConfirmCancelOp(op)}
                          >
                            Cancel
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!confirmCancelOp} onOpenChange={(o) => !o && setConfirmCancelOp(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel Scheduled {confirmCancelOp ? capitalize(confirmCancelOp.type) : ''}</DialogTitle>
          </DialogHeader>
          {confirmCancelOp && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Are you sure you want to cancel this scheduled {confirmCancelOp.type}?
              </p>
              <div className="text-sm bg-muted/40 rounded-md p-3 space-y-1">
                {operationDetails(confirmCancelOp).map((d) => (
                  <div key={d.label} className="flex justify-between">
                    <span className="text-muted-foreground">{d.label}</span>
                    <span className="font-medium">{d.value}</span>
                  </div>
                ))}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Scheduled</span>
                  <span>{formatDateTime(confirmCancelOp.scheduled_for)}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmCancelOp(null)}>
              Go Back
            </Button>
            <Button
              variant="destructive-outline"
              onClick={handleCancel}
              disabled={cancel.isPending}
            >
              {cancel.isPending ? 'Cancelling…' : 'Confirm Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
