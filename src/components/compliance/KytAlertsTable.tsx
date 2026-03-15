'use client';
import { useState } from 'react';
import { useKytAlerts, useUpdateKytAlert } from '@/hooks/useCompliance';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { RoleGate } from '@/components/auth/RoleGate';
import { useToast } from '@/components/ui/toast';
import type { KytAlertStatus, KytAlertSeverity } from '@/types/database';
import { capitalize } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CardSpinner } from '@/components/ui/spinner';

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  severe: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  under_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  dismissed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  escalated: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  resolved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
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
        {isLoading ? (
          <CardSpinner />
        ) : !alerts?.length ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No alerts found</div>
        ) : (
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
                {alerts.map((alert) => (
                  <tr key={alert.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_COLORS[alert.severity]}`}>
                        {capitalize(alert.severity)}
                      </span>
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
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[alert.status]}`}>
                        {capitalize(alert.status)}
                      </span>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
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
