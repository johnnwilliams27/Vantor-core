'use client';
import { useState } from 'react';
import { useKytAlerts, useUpdateKytAlert } from '@/hooks/useCompliance';
import { Button } from '@/components/ui/button';
import { RoleGate } from '@/components/auth/RoleGate';
import { useToast } from '@/components/ui/toast';
import type { KytAlertStatus, KytAlertSeverity } from '@/types/database';

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

export function KytAlertsTable() {
  const [statusFilter, setStatusFilter] = useState<KytAlertStatus | undefined>('open');
  const { data: alerts, isLoading } = useKytAlerts(statusFilter);
  const updateAlert = useUpdateKytAlert();
  const { toast } = useToast();

  const handleAction = async (id: string, status: 'under_review' | 'dismissed' | 'escalated' | 'resolved') => {
    try {
      await updateAlert.mutateAsync({ id, status });
      toast({ title: `Alert ${status.replace('_', ' ')}`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Update failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground">Status:</label>
        <select
          value={statusFilter ?? ''}
          onChange={(e) => setStatusFilter((e.target.value || undefined) as KytAlertStatus | undefined)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm"
        >
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="under_review">Under Review</option>
          <option value="escalated">Escalated</option>
          <option value="dismissed">Dismissed</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      <div className="rounded-lg border bg-card">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading alerts...</div>
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
                        {alert.severity}
                      </span>
                    </td>
                    <td className="px-4 py-2">{alert.category ?? '-'}</td>
                    <td className="px-4 py-2 max-w-xs truncate">{alert.description ?? '-'}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[alert.status]}`}>
                        {alert.status.replace('_', ' ')}
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
                                onClick={() => handleAction(alert.id, 'under_review')}
                                disabled={updateAlert.isPending}
                                className="text-xs h-7"
                              >
                                Review
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAction(alert.id, 'escalated')}
                              disabled={updateAlert.isPending}
                              className="text-xs h-7"
                            >
                              Escalate
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAction(alert.id, 'dismissed')}
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
    </div>
  );
}
