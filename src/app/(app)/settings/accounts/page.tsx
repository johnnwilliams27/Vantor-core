'use client';
import { useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { Check, CheckCircle2, ChevronDown, Trash2, UserPlus, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/types/database';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  initials: string;
  color: string;
  lastActive: string;
}

const INITIAL_USERS: TeamMember[] = [
  { id: '1', name: 'Sarah Chen',      email: 'sarah.chen@vantor.io',  role: 'treasury_manager', initials: 'SC', color: 'bg-[#207679]',  lastActive: '2 minutes ago'  },
  { id: '2', name: 'Jordan Lee',      email: 'jordan.lee@vantor.io',  role: 'treasury_manager', initials: 'JL', color: 'bg-emerald-600', lastActive: '1 hour ago'      },
  { id: '3', name: 'Marcus Johnson',  email: 'marcus.j@vantor.io',    role: 'accountant',        initials: 'MJ', color: 'bg-blue-500',   lastActive: 'Yesterday'       },
  { id: '4', name: 'Emily Rodriguez', email: 'emily.r@vantor.io',     role: 'accountant',        initials: 'ER', color: 'bg-violet-500', lastActive: '3 days ago'      },
  { id: '5', name: 'David Kim',       email: 'david.kim@vantor.io',   role: 'auditor',           initials: 'DK', color: 'bg-amber-500',  lastActive: '2 weeks ago'     },
  { id: '6', name: 'Alex Thompson',   email: 'alex.t@vantor.io',      role: 'auditor',           initials: 'AT', color: 'bg-rose-400',   lastActive: 'Mar 1, 2026'     },
];

const ROLES: UserRole[] = ['auditor', 'accountant', 'treasury_manager'];

const ROLE_LABELS: Record<UserRole, string> = {
  auditor:          'Auditor',
  accountant:       'Accountant',
  treasury_manager: 'Treasury Manager',
};

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  auditor:          'View-only access to all records and reports',
  accountant:       'Manage invoices, wallets, and ERP connections',
  treasury_manager: 'Full access including payments, swaps, and AI',
};

const ROLE_BADGE: Record<UserRole, string> = {
  treasury_manager: 'bg-[#207679]/10 text-[#195a5c] dark:bg-teal-500/20 dark:text-teal-300',
  accountant:       'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  auditor:          'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

const CAPABILITIES: { label: string; auditor: boolean; accountant: boolean; treasury_manager: boolean }[] = [
  { label: 'View dashboard & analytics',      auditor: true,  accountant: true,  treasury_manager: true  },
  { label: 'View transactions & audit trail', auditor: true,  accountant: true,  treasury_manager: true  },
  { label: 'View invoices & vendors',         auditor: true,  accountant: true,  treasury_manager: true  },
  { label: 'Manage invoices & vendors',       auditor: false, accountant: true,  treasury_manager: true  },
  { label: 'Link wallets & bank accounts',    auditor: false, accountant: true,  treasury_manager: true  },
  { label: 'Link ERP systems',                auditor: false, accountant: true,  treasury_manager: true  },
  { label: 'Execute payments',                auditor: false, accountant: false, treasury_manager: true  },
  { label: 'Execute swaps & ramps',           auditor: false, accountant: false, treasury_manager: true  },
  { label: 'Treasury AI & recommendations',   auditor: false, accountant: false, treasury_manager: true  },
  { label: 'Manage users & permissions',      auditor: false, accountant: false, treasury_manager: true  },
];

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
        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', ROLE_BADGE[value])}>
          {ROLE_LABELS[value]}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="animate-dropdown absolute right-0 z-50 mt-1.5 w-64 rounded-xl border border-border bg-popover p-1.5 shadow-xl">
          {ROLES.map((role) => (
            <button
              key={role}
              onClick={() => { onChange(role); setOpen(false); }}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                value === role
                  ? 'bg-[#207679]/8 dark:bg-teal-500/10'
                  : 'hover:bg-muted/60'
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', ROLE_BADGE[role])}>
                    {ROLE_LABELS[role]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">{ROLE_DESCRIPTIONS[role]}</p>
              </div>
              {value === role && (
                <Check className="h-4 w-4 shrink-0 mt-0.5 text-[#207679] dark:text-teal-400" />
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
  const [users, setUsers] = useState<TeamMember[]>(INITIAL_USERS);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<TeamMember | null>(null);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('auditor');
  const [confirmRole, setConfirmRole] = useState<{ user: TeamMember; newRole: UserRole } | null>(null);
  const { toast } = useToast();

  const handleRoleChange = (id: string, newRole: UserRole) => {
    const user = users.find((u) => u.id === id);
    if (!user || user.role === newRole) return;
    setConfirmRole({ user, newRole });
  };

  const applyRoleChange = () => {
    if (!confirmRole) return;
    const { user, newRole } = confirmRole;
    setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, role: newRole } : u));
    toast({
      title: 'Role updated',
      description: `${user.name} is now a${newRole === 'auditor' ? 'n' : ''} ${ROLE_LABELS[newRole]}.`,
      variant: 'success',
    });
    setConfirmRole(null);
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
      { id: String(Date.now()), name: inviteName.trim(), email: inviteEmail.trim(), role: inviteRole, initials, color, lastActive: 'Just now' },
    ]);
    toast({ title: 'Invitation sent', description: `${inviteName.trim()} has been invited as a${inviteRole === 'auditor' ? 'n' : ''} ${ROLE_LABELS[inviteRole]}.`, variant: 'success' });
    setInviteName('');
    setInviteEmail('');
    setInviteRole('auditor');
    setInviteOpen(false);
  };

  return (
    <AppShell title="Account Management">
      <div className="space-y-6">

        {/* Confirm role change dialog */}
        <Dialog open={!!confirmRole} onOpenChange={(o) => { if (!o) setConfirmRole(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change role</DialogTitle>
              <DialogDescription>
                Change <span className="font-medium text-foreground">{confirmRole?.user.name}</span>'s role from{' '}
                <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', confirmRole ? ROLE_BADGE[confirmRole.user.role] : '')}>
                  {confirmRole ? ROLE_LABELS[confirmRole.user.role] : ''}
                </span>{' '}
                to{' '}
                <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', confirmRole ? ROLE_BADGE[confirmRole.newRole] : '')}>
                  {confirmRole ? ROLE_LABELS[confirmRole.newRole] : ''}
                </span>?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmRole(null)}>Cancel</Button>
              <Button onClick={applyRoleChange}>Confirm</Button>
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
                          ? 'border-[#207679]/40 bg-[#207679]/5 dark:border-teal-500/40 dark:bg-teal-500/10'
                          : 'border-border hover:bg-muted/50'
                      )}
                    >
                      <div className={cn(
                        'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center',
                        inviteRole === role ? 'border-[#207679] dark:border-teal-400' : 'border-muted-foreground/40'
                      )}>
                        {inviteRole === role && <div className="h-2 w-2 rounded-full bg-[#207679] dark:bg-teal-400" />}
                      </div>
                      <div>
                        <div className={cn('text-xs font-medium rounded-full inline-flex px-2 py-0.5 mb-0.5', ROLE_BADGE[role])}>
                          {ROLE_LABELS[role]}
                        </div>
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
                  <span className="hidden md:block text-xs text-muted-foreground whitespace-nowrap w-28 text-right shrink-0">
                    {user.lastActive}
                  </span>
                  <RolePicker value={user.role} onChange={(r) => handleRoleChange(user.id, r)} />
                  <button
                    onClick={() => setConfirmRemove(user)}
                    className="ml-1 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                    title={`Remove ${user.name}`}
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
                          <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', ROLE_BADGE[role])}>
                            {ROLE_LABELS[role]}
                          </span>
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
                          <CheckCircle2 className="h-4 w-4 text-[#207679] dark:text-teal-400 mx-auto" />
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
    </AppShell>
  );
}
