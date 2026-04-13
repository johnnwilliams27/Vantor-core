'use client';
import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { HoverTooltip } from '@/components/ui/hover-tooltip';
import { useToast } from '@/components/ui/toast';
import { Building2, Check, CheckCircle2, ChevronDown, Shield, Trash2, UserPlus, XCircle, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/types/database';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  initials: string;
  color: string;
  kycStatus: string;
}


const ROLES: UserRole[] = ['enterprise_admin', 'executive', 'treasury_manager', 'accountant', 'auditor'];

// Copy reflects the new RBAC hierarchy. Each description leads with what
// the role CAN do, then flags a strict constraint when one applies.
// Badge tints match Vantor's muted-tint system (bg-{color}-500/8 class).
const ROLE_LABELS: Record<UserRole, string> = {
  enterprise_admin: 'Enterprise Admin',
  executive:        'Executive',
  treasury_manager: 'Treasury Manager',
  accountant:       'Accountant',
  auditor:          'Auditor',
};

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  enterprise_admin: 'Authors policies, manages team, billing. Cannot approve transfers — strict separation of duties.',
  executive:        'Senior approver for high-value transfers ($1M+). Cannot author policies.',
  treasury_manager: 'Day-to-day operator and standard approver. Cannot author policies.',
  accountant:       'Manages invoices, vendors, wallets, ERP. Can approve low-threshold transfers when placed on a chain.',
  auditor:          'Read-only access to records and reports. Can sit on chains as a check.',
};

// Migrated to semantic Badge variants (style guide Stage 3e).
// Amber signals "author role" (elevated), purple signals "high-threshold
// approver," teal is the operator, blue is ops-support, gray is audit/read.
const ROLE_VARIANT: Record<UserRole, string> = {
  enterprise_admin: 'pending',   // amber
  executive:        'special',   // purple
  treasury_manager: 'active',    // teal
  accountant:       'info-blue', // blue
  auditor:          'inactive',  // gray
};

// Permission matrix reflecting the RBAC hierarchy:
//   - enterprise_admin authors policies + manages org but CANNOT approve
//     transfers or directly execute movements (strict SoD)
//   - executive approves high-value transfers, does not execute day-to-day
//   - treasury_manager is the operator — executes transfers, approves at
//     standard thresholds
//   - accountant does back-office ops, can approve low-threshold chains
//   - auditor is read-only with placement-based approval
const CAPABILITIES: { label: string; enterprise_admin: boolean; executive: boolean; treasury_manager: boolean; accountant: boolean; auditor: boolean }[] = [
  // Read — everyone sees
  { label: 'View dashboard & analytics',      enterprise_admin: true,  executive: true,  treasury_manager: true,  accountant: true,  auditor: true  },
  { label: 'View transactions & audit trail', enterprise_admin: true,  executive: true,  treasury_manager: true,  accountant: true,  auditor: true  },
  { label: 'View compliance',                 enterprise_admin: true,  executive: true,  treasury_manager: true,  accountant: true,  auditor: true  },
  { label: 'View reporting',                  enterprise_admin: true,  executive: true,  treasury_manager: true,  accountant: true,  auditor: false },
  { label: 'View yield positions',            enterprise_admin: true,  executive: true,  treasury_manager: true,  accountant: true,  auditor: false },

  // Back-office — accountant + ops
  { label: 'Manage invoices & vendors',       enterprise_admin: true,  executive: false, treasury_manager: true,  accountant: true,  auditor: false },
  { label: 'Link wallets & bank accounts',    enterprise_admin: true,  executive: false, treasury_manager: true,  accountant: true,  auditor: false },
  { label: 'Link ERP systems',                enterprise_admin: true,  executive: false, treasury_manager: true,  accountant: true,  auditor: false },

  // Execution — operator role
  { label: 'Initiate transfers',              enterprise_admin: false, executive: false, treasury_manager: true,  accountant: false, auditor: false },
  { label: 'Initiate swaps',                  enterprise_admin: false, executive: false, treasury_manager: true,  accountant: false, auditor: false },
  { label: 'Initiate ramps',                  enterprise_admin: false, executive: false, treasury_manager: true,  accountant: false, auditor: false },
  { label: 'Initiate bridges',                enterprise_admin: false, executive: false, treasury_manager: true,  accountant: false, auditor: false },
  { label: 'Initiate payments',               enterprise_admin: false, executive: false, treasury_manager: true,  accountant: false, auditor: false },
  { label: 'Initiate yield deposit/withdraw', enterprise_admin: false, executive: false, treasury_manager: true,  accountant: false, auditor: false },

  // Approval — placement-based; matrix shows baseline slot eligibility
  { label: 'Approve low-threshold transfers',    enterprise_admin: false, executive: true,  treasury_manager: true,  accountant: true,  auditor: true  },
  { label: 'Approve standard-threshold transfers', enterprise_admin: false, executive: true,  treasury_manager: true,  accountant: false, auditor: false },
  { label: 'Approve high-threshold transfers ($1M+)', enterprise_admin: false, executive: true,  treasury_manager: false, accountant: false, auditor: false },

  // Authoring — strict
  { label: 'Author policy rules & chains',    enterprise_admin: true,  executive: false, treasury_manager: false, accountant: false, auditor: false },
  { label: 'Activate policy versions',        enterprise_admin: true,  executive: false, treasury_manager: false, accountant: false, auditor: false },
  { label: 'Edit hard limits',                enterprise_admin: true,  executive: false, treasury_manager: false, accountant: false, auditor: false },
  { label: 'Edit RBAC settings',              enterprise_admin: true,  executive: false, treasury_manager: false, accountant: false, auditor: false },

  // Org-level — admin-only
  { label: 'Manage integrations & billing',   enterprise_admin: true,  executive: false, treasury_manager: false, accountant: false, auditor: false },
  { label: 'Manage users & permissions',      enterprise_admin: true,  executive: false, treasury_manager: false, accountant: false, auditor: false },
];

// ── RBAC Settings Card ────────────────────────────────────────────────────────
// Enterprise-admin-only surface for the author-approver separation toggle.
// Mirrors the locked CTA hierarchy — the toggle is a real Switch, Save
// is `btn-gradient` (filled primary per Vantor convention), the action
// always confirms with a short inline note explaining the blast radius.
function RbacSettingsCard({ sessionRole }: { sessionRole: UserRole | undefined }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const canEdit = sessionRole === 'enterprise_admin';

  useEffect(() => {
    let cancelled = false;
    fetch('/api/enterprise/rbac-settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d?.data?.authorApproverSeparationEnabled !== undefined) {
          setEnabled(d.data.authorApproverSeparationEnabled);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/enterprise/rbac-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorApproverSeparationEnabled: enabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.reason ?? body?.error ?? `HTTP ${res.status}`);
      }
      toast({
        title: 'RBAC settings updated',
        description: `Author-approver separation is now ${enabled ? 'strict' : 'off'}.`,
        variant: 'success',
      });
      setDirty(false);
    } catch (err) {
      toast({
        title: 'Could not save',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary dark:text-teal-400" />
          Policy & Approval Settings
        </CardTitle>
        <CardDescription>
          Controls how strictly the approval workflow enforces separation of duties.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-6 rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm">Author-approver separation</span>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                  enabled
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
                )}
              >
                {loading ? '…' : enabled ? 'strict' : 'off'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">
              When strict, a user who authored a rule cannot approve transfers triggered by that rule.
              Recommended for production orgs. Small teams may disable for self-serve bootstrap.
            </p>
            {!canEdit && (
              <p className="text-[11px] text-muted-foreground mt-2 italic">
                Only enterprise admins can change this setting.
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Author-approver separation"
              disabled={!canEdit || loading || saving}
              onClick={() => {
                if (!canEdit) return;
                setEnabled((v) => !v);
                setDirty(true);
              }}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                enabled ? 'bg-primary dark:bg-teal-500' : 'bg-gray-300 dark:bg-gray-600',
                (!canEdit || loading || saving) && 'opacity-50 cursor-not-allowed',
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
                  enabled ? 'translate-x-5' : 'translate-x-0.5',
                )}
              />
            </button>
            {dirty && canEdit && (
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Role Picker ────────────────────────────────────────────────────────────────
function RolePicker({ value, onChange }: { value: UserRole; onChange: (r: UserRole) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-muted/60"
      >
        <Badge variant={ROLE_VARIANT[value] as any}>
          {ROLE_LABELS[value]}
        </Badge>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="animate-dropdown absolute right-0 z-50 mt-1.5 w-72 rounded-xl border border-border bg-popover p-1.5 shadow-xl">
          {ROLES.map((role) => (
            <button
              key={role}
              onClick={() => { onChange(role); setOpen(false); }}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                value === role
                  ? 'bg-primary/8 dark:bg-teal-500/10'
                  : 'hover:bg-muted/60'
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <Badge variant={ROLE_VARIANT[role] as any}>
                    {ROLE_LABELS[role]}
                  </Badge>
                  {/* Shield signals strict separation of duties: enterprise_admin cannot
                      fill approval slots regardless of rank. Surfaces the invariant up
                      front so admins don't wonder why they can't approve later. */}
                  {role === 'enterprise_admin' && (
                    <HoverTooltip label="Enterprise admins cannot approve transfers — strict separation of duties">
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        <Shield className="h-3 w-3" />
                        no approvals
                      </span>
                    </HoverTooltip>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-snug">{ROLE_DESCRIPTIONS[role]}</p>
              </div>
              {value === role && (
                <Check className="h-4 w-4 shrink-0 mt-0.5 text-primary dark:text-teal-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AccountManagementPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<TeamMember[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<TeamMember | null>(null);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('auditor');
  const [confirmRole, setConfirmRole] = useState<{ user: TeamMember; newRole: UserRole } | null>(null);
  const { toast } = useToast();
  const [enterpriseName, setEnterpriseName] = useState<string | null>(null);
  const enterpriseId = session?.user?.enterprise_id;


  // Fetch KYB status for enterprise
  const { data: kybData } = useQuery({
    queryKey: ['kyb-status'],
    queryFn: () => fetch('/api/kyb/status').then(r => r.ok ? r.json() : null),
    enabled: !!enterpriseId,
  });

  const kybStatus = kybData?.status as string | undefined;
  const kybVerified = kybStatus === 'completed';

  // Load real team members from API
  useEffect(() => {
    if (!enterpriseId) return;
    fetch('/api/user/enterprise')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.name) setEnterpriseName(d.name);
        if (d?.team?.length) {
          const colors = ['bg-primary', 'bg-emerald-600', 'bg-blue-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-400', 'bg-sky-500', 'bg-indigo-500'];
          setUsers(d.team.map((m: any, i: number) => ({
            id: m.id,
            name: m.name,
            email: m.email,
            role: m.role,
            initials: m.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase(),
            color: colors[i % colors.length],
            kycStatus: m.kycStatus,
          })));
        }
      })
      .catch(() => {});
  }, [enterpriseId]);

  const handleRoleChange = (id: string, newRole: UserRole) => {
    const user = users.find((u) => u.id === id);
    if (!user || user.role === newRole) return;
    setConfirmRole({ user, newRole });
  };

  const [roleChangeInFlight, setRoleChangeInFlight] = useState(false);

  const applyRoleChange = async () => {
    if (!confirmRole) return;
    const { user, newRole } = confirmRole;
    setRoleChangeInFlight(true);

    // Optimistic UI: flip locally, roll back on failure. The previous
    // implementation ONLY mutated local state and never persisted —
    // refresh and the change reverted. This is the bug fix.
    const previousRole = user.role;
    setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, role: newRole } : u));

    try {
      const res = await fetch(`/api/user/enterprise/team/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.reason ?? body?.error ?? `HTTP ${res.status}`);
      }
      toast({
        title: 'Role updated',
        description: `${user.name} is now ${ROLE_LABELS[newRole]}.`,
        variant: 'success',
      });
      setConfirmRole(null);
    } catch (err) {
      // Roll back optimistic update
      setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, role: previousRole } : u));
      toast({
        title: 'Role change failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setRoleChangeInFlight(false);
    }
  };

  const handleRemove = (id: string) => {
    const user = users.find((u) => u.id === id);
    if (!user) return;
    setUsers((prev) => prev.filter((u) => u.id !== id));
    setConfirmRemove(null);
    toast({ title: 'User removed', description: `${user.name} has been removed from the organization.`, variant: 'default' });
  };

  const handleInvite = () => {
    if (!inviteName.trim() || !inviteEmail.trim()) return;
    const initials = inviteName.trim().split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    const colors = ['bg-sky-500', 'bg-emerald-500', 'bg-orange-400', 'bg-pink-500', 'bg-indigo-500'];
    const color = colors[users.length % colors.length];
    setUsers((prev) => [
      ...prev,
      { id: String(Date.now()), name: inviteName.trim(), email: inviteEmail.trim(), role: inviteRole, initials, color, kycStatus: 'not_started' },
    ]);
    toast({ title: 'Invitation sent', description: `${inviteName.trim()} has been invited as a${inviteRole === 'auditor' ? 'n' : ''} ${ROLE_LABELS[inviteRole]}.`, variant: 'success' });
    setInviteName('');
    setInviteEmail('');
    setInviteRole('auditor');
    setInviteOpen(false);
  };

  return (
    <div className="space-y-6">

        {/* Organization Info */}
        {enterpriseName && (
          <Card>
            <CardContent className="flex items-center gap-4 py-5">
              <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-primary/10 dark:bg-teal-500/15">
                <Building2 className="h-6 w-6 text-primary dark:text-teal-400" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold">{enterpriseName}</h2>
                <p className="text-sm text-muted-foreground">Organization</p>
              </div>
              <div className="flex items-center gap-2">
                {kybVerified ? (
                  <>
                    <Shield className="h-4 w-4 text-emerald-500" />
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">KYB Verified</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-400">KYB Not Verified</span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* RBAC Settings — author-approver separation toggle */}
        <RbacSettingsCard sessionRole={session?.user?.role as UserRole | undefined} />

        {/* Confirm role change dialog */}
        <Dialog open={!!confirmRole} onOpenChange={(o) => { if (!o) setConfirmRole(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change role</DialogTitle>
              <DialogDescription>
                Change <span className="font-medium text-foreground">{confirmRole?.user.name}</span>'s role from{' '}
                <Badge variant={(confirmRole ? ROLE_VARIANT[confirmRole.user.role] : 'default') as any}>
                  {confirmRole ? ROLE_LABELS[confirmRole.user.role] : ''}
                </Badge>{' '}
                to{' '}
                <Badge variant={(confirmRole ? ROLE_VARIANT[confirmRole.newRole] : 'default') as any}>
                  {confirmRole ? ROLE_LABELS[confirmRole.newRole] : ''}
                </Badge>?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmRole(null)} disabled={roleChangeInFlight}>
                Cancel
              </Button>
              <Button onClick={applyRoleChange} disabled={roleChangeInFlight}>
                {roleChangeInFlight ? 'Updating…' : 'Confirm'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirm remove dialog */}
        <Dialog open={!!confirmRemove} onOpenChange={(o) => { if (!o) setConfirmRemove(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove team member</DialogTitle>
              <DialogDescription>
                Are you sure you want to remove <span className="font-medium text-foreground">{confirmRemove?.name}</span> from the organization? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmRemove(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => confirmRemove && handleRemove(confirmRemove.id)}
              >
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Invite dialog */}
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
              <DialogDescription>They'll receive an email to join your Vantor organization.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Full name</Label>
                <Input
                  placeholder="Jane Smith"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email address</Label>
                <Input
                  type="email"
                  placeholder="jane@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <div className="flex flex-col gap-2 pt-0.5">
                  {ROLES.map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setInviteRole(role)}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                        inviteRole === role
                          ? 'border-primary/40 bg-primary/5 dark:border-teal-500/40 dark:bg-teal-500/10'
                          : 'border-border hover:bg-muted/50'
                      )}
                    >
                      <div className={cn(
                        'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center',
                        inviteRole === role ? 'border-primary dark:border-teal-400' : 'border-muted-foreground/40'
                      )}>
                        {inviteRole === role && <div className="h-2 w-2 rounded-full bg-primary dark:bg-teal-400" />}
                      </div>
                      <div>
                        <Badge variant={ROLE_VARIANT[role] as any} className="mb-0.5">
                          {ROLE_LABELS[role]}
                        </Badge>
                        <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
              <Button onClick={handleInvite} disabled={!inviteName.trim() || !inviteEmail.trim()}>
                Send Invite
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Team Members */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Team Members</CardTitle>
              <CardDescription className="mt-1">Manage roles and permissions for all users in your organization.</CardDescription>
            </div>
            <Button size="sm" onClick={() => setInviteOpen(true)} className="shrink-0">
              <UserPlus className="mr-2 h-4 w-4" />
              Invite User
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {users.map((user) => (
                <div key={user.id} className="flex items-center gap-4 px-6 py-4">
                  <div className={`h-9 w-9 rounded-full ${user.color} flex items-center justify-center text-white text-xs font-semibold shrink-0`}>
                    {user.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{user.name}</div>
                    <div className="text-xs text-muted-foreground">{user.email}</div>
                  </div>
                  <span className="hidden md:flex items-center gap-1.5 shrink-0">
                    {user.kycStatus === 'completed' ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">KYC Verified</span>
                      </>
                    ) : user.kycStatus === 'pending' ? (
                      <>
                        <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-xs text-amber-600 dark:text-amber-400">KYC Pending</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3.5 w-3.5 text-muted-foreground/50" />
                        <span className="text-xs text-muted-foreground/50">No KYC</span>
                      </>
                    )}
                  </span>
                  <RolePicker value={user.role} onChange={(r) => handleRoleChange(user.id, r)} />
                  <button
                    onClick={() => setConfirmRemove(user)}
                    className="ml-1 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                    aria-label={`Remove ${user.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Role Permissions Matrix */}
        <Card>
          <CardHeader>
            <CardTitle>Role Permissions</CardTitle>
            <CardDescription>High-level actions available to each role.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-6 py-3 text-left font-medium text-muted-foreground w-1/2">Capability</th>
                  {ROLES.map((role) => {
                    const count = CAPABILITIES.filter((c) => c[role]).length;
                    return (
                      <th key={role} className="px-4 py-3 text-center font-medium">
                        <div className="flex flex-col items-center gap-1">
                          <Badge variant={ROLE_VARIANT[role] as any}>
                            {ROLE_LABELS[role]}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground font-normal">{count} of {CAPABILITIES.length}</span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {CAPABILITIES.map((cap, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-3 text-sm">{cap.label}</td>
                    {ROLES.map((role) => (
                      <td key={role} className="px-4 py-3 text-center">
                        {cap[role] ? (
                          <CheckCircle2 className="h-4 w-4 text-primary dark:text-teal-400 mx-auto" />
                        ) : (
                          <XCircle className="h-4 w-4 text-gray-300 dark:text-gray-600 mx-auto" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

      </div>
  );
}
