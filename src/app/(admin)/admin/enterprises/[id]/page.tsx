'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  useEnterprise,
  useFreezeEnterprise,
  useUnfreezeEnterprise,
} from '@/hooks/useAdmin';
import { Spinner } from '@/components/ui/spinner';
import {
  ArrowLeft,
  Loader2,
  Snowflake,
  Play,
  Users,
  ArrowRightLeft,
  Pencil,
  Check,
  X,
  AlertCircle,
  Shield,
} from 'lucide-react';

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-400',
    frozen: 'bg-blue-500/15 text-blue-400',
    suspended: 'bg-red-500/15 text-red-400',
    pending_kyc: 'bg-amber-500/15 text-amber-400',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-500/15 text-gray-400'}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

function KycBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    verified: 'bg-emerald-500/15 text-emerald-400',
    pending: 'bg-amber-500/15 text-amber-400',
    rejected: 'bg-red-500/15 text-red-400',
    none: 'bg-gray-500/15 text-gray-400',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-500/15 text-gray-400'}`}
    >
      {status}
    </span>
  );
}

export default function EnterpriseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { data: enterprise, isLoading, isError } = useEnterprise(id);
  const freeze = useFreezeEnterprise();
  const unfreeze = useUnfreezeEnterprise();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    if (!enterprise) return;
    setEditName(enterprise.name);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!editName.trim() || !enterprise) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/enterprises/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      });
      if (!res.ok) throw new Error('Failed to update');
      setEditing(false);
      // Refetch
      window.location.reload();
    } catch {
      // keep editing open
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !enterprise) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-muted-foreground">Failed to load enterprise details.</p>
        <Button variant="outline" onClick={() => router.push('/admin')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Admin
        </Button>
      </div>
    );
  }

  const isFrozen = enterprise.status === 'frozen';

  return (
    <div className="space-y-6">
        {/* Back button */}
        <Button variant="ghost" size="sm" onClick={() => router.push('/admin')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Admin Dashboard
        </Button>

        {/* Enterprise Info */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Enterprise Details</CardTitle>
            <div className="flex items-center gap-2">
              {isFrozen ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => unfreeze.mutate(id)}
                  disabled={unfreeze.isPending}
                >
                  {unfreeze.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Unfreeze
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => freeze.mutate(id)}
                  disabled={freeze.isPending}
                >
                  {freeze.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Snowflake className="h-4 w-4 mr-2" />
                  )}
                  Freeze
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div>
                <dt className="text-muted-foreground mb-1">Name</dt>
                <dd className="flex items-center gap-2">
                  {editing ? (
                    <>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <Button size="sm" variant="ghost" onClick={handleSave} disabled={saving}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="font-medium">{enterprise.name}</span>
                      <Button size="sm" variant="ghost" onClick={startEdit}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-1">Status</dt>
                <dd><StatusBadge status={enterprise.status} /></dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-1">KYC Status</dt>
                <dd><KycBadge status={enterprise.kyc_status} /></dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-1">Created</dt>
                <dd>{new Date(enterprise.created_at).toLocaleString()}</dd>
              </div>
              {enterprise.kyc_submitted_at && (
                <div>
                  <dt className="text-muted-foreground mb-1">KYC Submitted</dt>
                  <dd>{new Date(enterprise.kyc_submitted_at).toLocaleString()}</dd>
                </div>
              )}
              {enterprise.kyc_verified_at && (
                <div>
                  <dt className="text-muted-foreground mb-1">KYC Verified</dt>
                  <dd>{new Date(enterprise.kyc_verified_at).toLocaleString()}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* Counts — no financial data */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="rounded-lg bg-blue-500/15 p-3">
                <Users className="h-6 w-6 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Users</p>
                <p className="text-2xl font-bold">{enterprise.user_count}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="rounded-lg bg-purple-500/15 p-3">
                <ArrowRightLeft className="h-6 w-6 text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Transactions</p>
                <p className="text-2xl font-bold">{enterprise.transaction_count}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Audit Logs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Recent Audit Logs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!enterprise.recent_audit_logs?.length ? (
              <p className="text-sm text-muted-foreground py-4">No audit logs found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-3 pr-4 font-medium">Action</th>
                      <th className="pb-3 pr-4 font-medium">User</th>
                      <th className="pb-3 pr-4 font-medium">Entity</th>
                      <th className="pb-3 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {enterprise.recent_audit_logs.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/50 transition-colors">
                        <td className="py-3 pr-4">
                          <span className="inline-flex items-center rounded-full bg-gray-500/15 px-2.5 py-0.5 text-xs font-medium text-gray-300">
                            {log.action}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {log.user_email ?? log.user_id?.slice(0, 8) ?? 'system'}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {log.entity_type ? `${log.entity_type}` : '-'}
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
    </div>
  );
}
