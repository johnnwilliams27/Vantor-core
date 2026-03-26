'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  useSystemHealth,
  useEnterprises,
  useCreateEnterprise,
} from '@/hooks/useAdmin';
import {
  Building2,
  Users,
  ArrowRightLeft,
  Plus,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { CardSpinner } from '@/components/ui/spinner';
import { InviteUserForm } from '@/components/admin/InviteUserForm';

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

function CreateEnterpriseForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const create = useCreateEnterprise();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate({ name: name.trim() }, { onSuccess: () => { setName(''); onClose(); } });
  };

  return (
    <Card className="border-teal-500/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Create New Enterprise</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="ent-name" className="block text-sm font-medium mb-1.5 text-muted-foreground">
              Enterprise Name
            </label>
            <input
              id="ent-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            />
          </div>
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </form>
        {create.isError && (
          <p className="mt-2 text-sm text-red-400 flex items-center gap-1">
            <AlertCircle className="h-4 w-4" />
            {(create.error as Error).message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminDashboardPage() {
  const health = useSystemHealth();
  const enterprises = useEnterprises();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-6">
        {/* System Health Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="rounded-lg bg-teal-500/15 p-3">
                <Building2 className="h-6 w-6 text-teal-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Enterprises</p>
                <p className="text-2xl font-bold">
                  {health.isLoading ? '...' : health.data?.totalEnterprises ?? 0}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="rounded-lg bg-blue-500/15 p-3">
                <Users className="h-6 w-6 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Users</p>
                <p className="text-2xl font-bold">
                  {health.isLoading ? '...' : health.data?.totalUsers ?? 0}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="rounded-lg bg-purple-500/15 p-3">
                <ArrowRightLeft className="h-6 w-6 text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Transactions</p>
                <p className="text-2xl font-bold">
                  {health.isLoading ? '...' : health.data?.totalTransactions ?? 0}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Invite Users */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Invite Users</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Send an invitation email with a secure signup link. Invitations expire after 7 days.
            </p>
            <InviteUserForm />
          </CardContent>
        </Card>

        {/* Create Enterprise */}
        {showCreate ? (
          <CreateEnterpriseForm onClose={() => setShowCreate(false)} />
        ) : (
          <div className="flex justify-end">
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Enterprise
            </Button>
          </div>
        )}

        {/* Enterprises Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Enterprises</CardTitle>
          </CardHeader>
          <CardContent>
            {enterprises.isLoading ? (
              <CardSpinner />
            ) : enterprises.isError ? (
              <p className="text-sm text-red-400 py-4">Failed to load enterprises.</p>
            ) : !enterprises.data?.length ? (
              <p className="text-sm text-muted-foreground py-4">No enterprises yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-3 pr-4 font-medium">Name</th>
                      <th className="pb-3 pr-4 font-medium">Status</th>
                      <th className="pb-3 pr-4 font-medium">KYC</th>
                      <th className="pb-3 pr-4 font-medium">Users</th>
                      <th className="pb-3 pr-4 font-medium">Created</th>
                      <th className="pb-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {enterprises.data.map((ent) => (
                      <tr key={ent.id} className="hover:bg-muted/50 transition-colors">
                        <td className="py-3 pr-4 font-medium">{ent.name}</td>
                        <td className="py-3 pr-4">
                          <StatusBadge status={ent.status} />
                        </td>
                        <td className="py-3 pr-4">
                          <KycBadge status={ent.kyc_status} />
                        </td>
                        <td className="py-3 pr-4">{ent.user_count}</td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {new Date(ent.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3">
                          <Link
                            href={`/admin/enterprises/${ent.id}`}
                            className="text-teal-400 hover:text-teal-300 text-sm font-medium"
                          >
                            View
                          </Link>
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
