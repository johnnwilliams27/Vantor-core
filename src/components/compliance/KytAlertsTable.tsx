'use client';
import { useState } from 'react';
import { useKytAlerts, useUpdateKytAlert } from '@/hooks/useCompliance';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { RoleGate } from '@/components/auth/RoleGate';
import { useToast } from '@/components/ui/toast';
import type { KytAlertStatus, KytAlertSeverity } from '@/types/database';
import { capitalize } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TableRowsSkeleton } from '@/components/ui/operations-skeletons';

// Migrated to semantic Badge variants (style guide Stage 3d).
// Severity escalates: info-blue → pending → urgent → failed.
const SEVERITY_VARIANT: Record<string, string> = {
  low: 'info-blue',
  medium: 'pending',
  high: 'urgent',
  severe: 'failed',
};

const STATUS_VARIANT: Record<string, string> = {
  open: 'failed',
  under_review: 'pending',
  dismissed: 'inactive',
  escalated: 'special',
  resolved: 'active',
};

type AlertAction = 'under_review' | 'dismissed' | 'escalated' | 'resolved';

const ACTION_CONFIG: Record<AlertAction, { title: string; description: string; label: string; variant: 'destructive' | 'default' }> = {
  under_review: {
    title: 'Mark as Under Review',
    description: 'This alert will be moved to "Under Review" status. You can escalate, dismiss, or resolve it later.',
    label: 'Review',
    variant: 'default',
  },
  escalated: {
    title: 'Escalate Alert',
    description: 'This alert will be escalated for further investigation. This action signals that the alert requires higher-level attention.',
    label: 'Escalate',
    variant: 'destructive',
  },
  dismissed: {
    title: 'Dismiss Alert',
    description: 'Are you sure you want to dismiss this alert? Dismissed alerts will no longer appear in the active queue.',
    label: 'Dismiss',
    variant: 'destructive',
  },
  resolved: {
    title: 'Resolve Alert',
    description: 'This alert will be marked as resolved. Ensure all necessary actions have been taken before resolving.',
    label: 'Resolve',
    variant: 'default',
  },
};

export function KytAlertsTable() {
  const [statusFilter, setStatusFilter] = useState<KytAlertStatus | undefined>(undefined);
  const { data: alerts, isLoading } = useKytAlerts(statusFilter);
  const updateAlert = useUpdateKytAlert();
  const { toast } = useToast();
  const [confirmAction, setConfirmAction] = useState<{ id: string; action: AlertAction } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!confirmAction) return;
    try {
      await updateAlert.mutateAsync({ id: confirmAction.id, status: confirmAction.action });
      toast({ title: `Alert ${capitalize(confirmAction.action)}`, variant: 'success' });
      setConfirmAction(null);
    } catch (err) {
      toast({ title: 'Update failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const config = confirmAction ? ACTION_CONFIG[confirmAction.action] : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground">Status:</label>
        <Select
          value={statusFilter ?? ''}
          onChange={(e) => setStatusFilter((e.target.value || undefined) as KytAlertStatus | undefined)}
          className="w-44"
        >
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="under_review">Under Review</option>
          <option value="escalated">Escalated</option>
          <option value="dismissed">Dismissed</option>
          <option value="resolved">Resolved</option>
        </Select>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Severity</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableRowsSkeleton columns={6} rows={4} />
              ) : !alerts?.length ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                    No alerts found
                  </td>
                </tr>
              ) : (
                alerts.map((alert) => (
                  <tr key={alert.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <Badge variant={SEVERITY_VARIANT[alert.severity] as any}>
                        {capitalize(alert.severity)}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">{alert.category ?? '-'}</td>
                    <td
                      className="px-4 py-2 cursor-pointer"
                      onClick={() => setExpandedId(expandedId === alert.id ? null : alert.id)}
                    >
                      <p className={expandedId === alert.id ? 'text-sm' : 'text-sm truncate max-w-xs'}>
                        {alert.description ?? '-'}
                      </p>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_VARIANT[alert.status] as any}>
                        {capitalize(alert.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(alert.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">
                      {(alert.status === 'open' || alert.status === 'under_review') && (
                        <RoleGate requiredRole="treasury_manager">
                          <div className="flex gap-1">
                            {alert.status === 'open' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setConfirmAction({ id: alert.id, action: 'under_review' })}
                                disabled={updateAlert.isPending}
                                className="text-xs h-7"
                              >
                                Review
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirmAction({ id: alert.id, action: 'escalated' })}
                              disabled={updateAlert.isPending}
                              className="text-xs h-7"
                            >
                              Escalate
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirmAction({ id: alert.id, action: 'dismissed' })}
                              disabled={updateAlert.isPending}
                              className="text-xs h-7"
                            >
                              Dismiss
                            </Button>
                          </div>
                        </RoleGate>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {config && (
        <ConfirmDialog
          open={!!confirmAction}
          onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
          title={config.title}
          description={config.description}
          confirmLabel={config.label}
          variant={config.variant}
          isPending={updateAlert.isPending}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}
