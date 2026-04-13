'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, Plus, Trash2, ArrowLeft, CheckCircle2, ShieldAlert, Users, Zap, GitBranch, Gauge, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyStateCard } from '@/components/ui/empty-state-card';
import { IconTile } from '@/components/ui/icon-tile';
import { useToast } from '@/components/ui/toast';
import { formatRelativeOrDate, sanitizeErrorMessage } from '@/lib/utils';
import type { PolicyVersionSnapshot, PolicyRule, ApprovalChain } from '@/lib/policy/types/policy-version';
import type { HardLimit } from '@/lib/policy/types/hard-limit';
import { TemplatePicker } from '@/components/policy/TemplatePicker';
import { ChainDesignerDialog } from '@/components/policy/ChainDesignerDialog';
import { HardLimitDialog } from '@/components/policy/HardLimitDialog';
import { Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';

type TriggerRow = {
  rule_id: string;
  trigger_count: number;
  last_triggered_at: string;
};

function describeRule(rule: PolicyRule): string {
  const v = rule.verdict as string;
  const prefix =
    v === 'block' || v === 'block_hard_limit' ? 'Block'
    : v === 'require_approval' ? 'Require approval for'
    : 'Allow';

  const cond = rule.condition as any;
  if (cond?.kind === 'amount_compare') {
    const amt = cond.value?.amount ? Number(cond.value.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—';
    const op = cond.op === 'gte' ? '≥' : cond.op === 'gt' ? '>' : cond.op === 'lte' ? '≤' : cond.op === 'lt' ? '<' : '=';
    return `${prefix} transfers where amount ${op} ${amt}`;
  }
  if (cond?.kind === 'sanctions_status') {
    return `${prefix} counterparties with sanctions match`;
  }
  if (cond?.kind === 'time_compare' && cond.field === 'counterparty.first_seen_age_days') {
    return `${prefix} transfers to counterparties newer than ${cond.value} days`;
  }
  if (cond?.kind === 'aggregate_window') {
    const amt = cond.value?.amount ? Number(cond.value.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—';
    return `${prefix} initiators whose trailing 24h outflow reaches ${amt}`;
  }
  if (cond?.kind === 'string_compare' && cond.field === 'kind') {
    return `${prefix} ${String(cond.value).replace(/_/g, ' ')} movements`;
  }
  if (cond?.kind === 'string_compare' && cond.field === 'initiator.type') {
    return `${prefix} ${cond.value}-initiated movements`;
  }
  if (cond?.kind === 'forecast_query') {
    return `${prefix} outflows that leave obligations uncovered within ${cond.window_days} days`;
  }
  return `${prefix} movements matching this condition`;
}

export default function VersionEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chainDialog, setChainDialog] = useState<{ open: boolean; chain?: ApprovalChain | null }>({ open: false });
  const [limitDialog, setLimitDialog] = useState<{ open: boolean; limit?: HardLimit | null }>({ open: false });
  const [activateOpen, setActivateOpen] = useState(false);
  const [activateReason, setActivateReason] = useState('');
  const [activating, setActivating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const versionId = params?.id ?? '';

  const version = useQuery({
    queryKey: ['policy', 'version', versionId],
    queryFn: async (): Promise<PolicyVersionSnapshot | null> => {
      if (!versionId) return null;
      const res = await fetch(`/api/policy/versions/${versionId}`);
      if (!res.ok) throw new Error('Failed to load version');
      const json = await res.json();
      return json.data ?? null;
    },
    enabled: !!versionId,
  });

  const triggers = useQuery({
    queryKey: ['policy', 'triggers', versionId, 30],
    queryFn: async (): Promise<Record<string, TriggerRow>> => {
      const res = await fetch(`/api/policy/rule-trigger-counts?days=30&version_id=${versionId}`);
      if (!res.ok) return {};
      const json = await res.json();
      const rows = (json.data ?? []) as TriggerRow[];
      return Object.fromEntries(rows.map((r) => [r.rule_id, r]));
    },
    enabled: !!versionId,
  });

  const v = version.data;
  const rules = (v?.rules ?? []).slice().sort((a, b) => a.priority - b.priority);

  async function deleteRule(ruleId: string) {
    setDeletingId(ruleId);
    try {
      const res = await fetch(`/api/policy/versions/${versionId}/rules/${ruleId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.human_readable ?? err.error ?? `Delete failed (${res.status})`);
      }
      qc.invalidateQueries({ queryKey: ['policy', 'version', versionId] });
      toast({ title: 'Rule removed', variant: 'success' });
    } catch (err) {
      toast({ title: 'Could not delete', description: sanitizeErrorMessage((err as Error).message), variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteChain(chainId: string) {
    if (!confirm('Delete this approval chain? Rules referencing it will be left with a dangling reference.')) return;
    try {
      const res = await fetch(`/api/policy/versions/${versionId}/approval-chains/${chainId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.human_readable ?? err.error ?? `Delete failed (${res.status})`);
      }
      qc.invalidateQueries({ queryKey: ['policy', 'version', versionId] });
      toast({ title: 'Chain removed', variant: 'success' });
    } catch (err) {
      toast({ title: 'Could not delete chain', description: sanitizeErrorMessage((err as Error).message), variant: 'destructive' });
    }
  }

  async function deleteHardLimit(limitId: string) {
    if (!confirm('Delete this hard limit?')) return;
    try {
      const res = await fetch(`/api/policy/versions/${versionId}/hard-limits/${limitId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.human_readable ?? err.error ?? `Delete failed (${res.status})`);
      }
      qc.invalidateQueries({ queryKey: ['policy', 'version', versionId] });
      toast({ title: 'Limit removed', variant: 'success' });
    } catch (err) {
      toast({ title: 'Could not delete limit', description: sanitizeErrorMessage((err as Error).message), variant: 'destructive' });
    }
  }

  async function activate() {
    if (!activateReason.trim()) {
      toast({ title: 'Reason required', variant: 'destructive' });
      return;
    }
    setActivating(true);
    try {
      const res = await fetch(`/api/policy/versions/${versionId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: activateReason.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.human_readable ?? err.error ?? `Activate failed (${res.status})`);
      }
      toast({ title: 'Version activated', description: 'Enforcement is live.', variant: 'success' });
      qc.invalidateQueries({ queryKey: ['policy'] });
      setActivateOpen(false);
      router.push('/policy/versions');
    } catch (err) {
      toast({ title: 'Activation failed', description: sanitizeErrorMessage((err as Error).message), variant: 'destructive' });
    } finally {
      setActivating(false);
    }
  }

  if (version.isLoading) {
    return (
      <div className="p-4 sm:p-8 space-y-4">
        <div className="h-20 rounded-lg bg-white/[0.02] animate-pulse" />
        <div className="h-64 rounded-lg bg-white/[0.02] animate-pulse" />
      </div>
    );
  }

  if (!v) {
    return (
      <div className="p-4 sm:p-8">
        <EmptyStateCard
          icon={<Gavel />}
          iconVariant="failed"
          title="Version not found"
          helper="It may have been deleted or you don't have access."
          cta={<Link href="/policy/versions"><Button variant="default" size="sm">Back to versions</Button></Link>}
        />
      </div>
    );
  }

  const isDraft = v.status === 'draft';
  const isActive = v.status === 'active';
  const chains = v.approval_chains ?? [];
  const hardLimits = v.hard_limits ?? [];

  return (
    <div className="space-y-6 p-4 sm:p-8 pb-24">
      {/* Breadcrumb */}
      <Link
        href="/policy/versions"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Versions
      </Link>

      {/* Sticky version header */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-8 px-4 sm:px-8 py-4 bg-background/95 backdrop-blur-sm border-b border-white/[0.06]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <IconTile variant={isActive ? 'active' : isDraft ? 'pending' : 'inactive'} size="md" emphasized>
              <Gavel />
            </IconTile>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight truncate">{v.name}</h1>
                <span className="font-mono text-xs text-muted-foreground">v{v.version_number}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                {isActive && <Badge variant="active" size="sm" dot>Active</Badge>}
                {isDraft && <Badge variant="pending" size="sm" dot>Draft</Badge>}
                {v.status === 'superseded' && <Badge variant="inactive" size="sm">Superseded</Badge>}
                {v.activated_at && (
                  <span className="text-[11px] text-muted-foreground">
                    activated {formatRelativeOrDate(new Date(v.activated_at).toISOString()).text}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" disabled title="Coming in PR 3">
              Simulate
            </Button>
            {isDraft && (
              <Button variant="default" size="sm" onClick={() => setActivateOpen(true)}>
                <CheckCircle2 className="w-4 h-4 mr-1.5" />
                Activate
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Rules section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Rules</h2>
            <span className="text-[11px] text-muted-foreground tabular-nums">{rules.length}</span>
          </div>
          {isDraft && (
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add rule
            </Button>
          )}
        </div>

        {rules.length === 0 ? (
          <EmptyStateCard
            icon={<Zap />}
            iconVariant="inactive"
            title="No rules authored"
            helper={isDraft ? 'Start with a template — covers the common safety patterns.' : 'This version has no rules; nothing is enforced.'}
            cta={isDraft ? (
              <Button variant="default" size="sm" onClick={() => setPickerOpen(true)}>
                <Plus className="w-4 h-4 mr-1.5" />
                Add your first rule
              </Button>
            ) : undefined}
          />
        ) : (
          <Card className="rounded-lg dark:border-white/[0.08] overflow-hidden">
            <ul className="divide-y divide-white/[0.04]">
              {rules.map((r, i) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  index={i}
                  triggerCount={triggers.data?.[r.id]?.trigger_count ?? 0}
                  canDelete={isDraft}
                  onDelete={() => deleteRule(r.id)}
                  deleting={deletingId === r.id}
                />
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* Approval chains */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Approval chains</h2>
            <span className="text-[11px] text-muted-foreground tabular-nums">{chains.length}</span>
          </div>
          {isDraft && (
            <Button variant="outline" size="sm" onClick={() => setChainDialog({ open: true, chain: null })}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add chain
            </Button>
          )}
        </div>
        {chains.length === 0 ? (
          <div className="text-sm text-muted-foreground italic py-2">
            No approval chains. Rules with verdict <span className="font-mono">require_approval</span> need at least one chain to route to.
          </div>
        ) : (
          <div className="space-y-2">
            {chains.map((c: ApprovalChain) => (
              <ChainCard
                key={c.id}
                chain={c}
                canEdit={isDraft}
                onEdit={() => setChainDialog({ open: true, chain: c })}
                onDelete={() => deleteChain(c.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Hard limits */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Hard limits</h2>
            <span className="text-[11px] text-muted-foreground tabular-nums">{hardLimits.length}</span>
          </div>
          {isDraft && (
            <Button variant="outline" size="sm" onClick={() => setLimitDialog({ open: true, limit: null })}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add hard limit
            </Button>
          )}
        </div>
        {hardLimits.length === 0 ? (
          <div className="text-sm text-muted-foreground italic py-2">No hard limits configured.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {hardLimits.map((h: HardLimit) => (
              <HardLimitCard
                key={h.id}
                limit={h}
                canEdit={isDraft}
                onEdit={() => setLimitDialog({ open: true, limit: h })}
                onDelete={() => deleteHardLimit(h.id)}
              />
            ))}
          </div>
        )}
      </section>

      <TemplatePicker
        versionId={versionId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ['policy', 'version', versionId] });
        }}
      />

      <ChainDesignerDialog
        versionId={versionId}
        chain={chainDialog.chain}
        open={chainDialog.open}
        onOpenChange={(o) => setChainDialog({ open: o, chain: o ? chainDialog.chain : null })}
        onSaved={() => qc.invalidateQueries({ queryKey: ['policy', 'version', versionId] })}
      />

      <HardLimitDialog
        versionId={versionId}
        limit={limitDialog.limit}
        open={limitDialog.open}
        onOpenChange={(o) => setLimitDialog({ open: o, limit: o ? limitDialog.limit : null })}
        onSaved={() => qc.invalidateQueries({ queryKey: ['policy', 'version', versionId] })}
      />

      {/* Activate confirmation */}
      <Dialog open={activateOpen} onOpenChange={setActivateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activate this version</DialogTitle>
            <DialogDescription>
              Activation supersedes the current active version. Every new money movement will be gated by these rules starting immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3.5 text-xs">
              <div className="font-semibold text-amber-400 mb-1 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                Heads up
              </div>
              This version has <span className="font-mono tabular-nums">{rules.length}</span> {rules.length === 1 ? 'rule' : 'rules'},{' '}
              <span className="font-mono tabular-nums">{chains.length}</span> chains and{' '}
              <span className="font-mono tabular-nums">{hardLimits.length}</span> hard limits. Simulation is coming in PR 3 — for now, consider activating during low-volume hours.
            </div>
            <Field label="Reason for activation" required helper="Shown in the audit log for future reference.">
              <Input
                value={activateReason}
                onChange={(e) => setActivateReason(e.target.value)}
                placeholder="e.g. Monthly policy review; adjusted counterparty threshold"
                maxLength={500}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivateOpen(false)} disabled={activating}>Cancel</Button>
            <Button variant="default" onClick={activate} disabled={activating || !activateReason.trim()}>
              {activating ? 'Activating…' : 'Confirm activation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RuleRow({ rule, index, triggerCount, canDelete, onDelete, deleting }: {
  rule: PolicyRule;
  index: number;
  triggerCount: number;
  canDelete: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const v = rule.verdict as string;
  const verdictBadge = v === 'block' || v === 'block_hard_limit'
    ? <Badge variant="failed" size="sm">Block</Badge>
    : v === 'require_approval'
    ? <Badge variant="pending" size="sm">Requires approval</Badge>
    : <Badge variant="active" size="sm">Allow</Badge>;

  return (
    <li>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 py-3 px-4 hover:bg-white/[0.02] transition-colors text-left"
      >
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums w-6 text-right shrink-0">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate">{rule.name}</span>
            {verdictBadge}
            {(rule as unknown as { enabled?: boolean }).enabled === false && <Badge variant="inactive" size="xs">disabled</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-1">{describeRule(rule)}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {triggerCount > 0 && (
            <Badge variant="pending" size="sm" className="font-mono tabular-nums">
              {triggerCount}× · 30d
            </Badge>
          )}
          {canDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Remove rule "${rule.name}"?`)) onDelete();
              }}
              disabled={deleting}
              className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
              aria-label="Delete rule"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-0">
          <div className="ml-9 rounded-md bg-white/[0.02] border border-white/[0.04] p-3">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">Condition (IR)</div>
            <pre className="font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-words overflow-x-auto">
              {JSON.stringify(rule.condition, null, 2)}
            </pre>
            {rule.rationale && (
              <>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5 mt-3">Rationale</div>
                <div className="text-xs text-muted-foreground">{rule.rationale}</div>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function ChainCard({ chain, canEdit, onEdit, onDelete }: {
  chain: ApprovalChain;
  canEdit?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <Card className="rounded-lg dark:border-white/[0.08]">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <IconTile variant="info" size="sm"><Users /></IconTile>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold truncate">{chain.name}</div>
              {canEdit && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={onEdit}
                    className="p-1.5 rounded-md hover:bg-white/[0.04] text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Edit chain"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={onDelete}
                    className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                    aria-label="Delete chain"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              {chain.slots?.map((s, i) => (
                <div key={i} className="flex items-center gap-1">
                  <Badge variant="info-blue" size="sm" className="font-mono">
                    {s.minimum_role.replace('_', ' ')}
                  </Badge>
                  {i < (chain.slots?.length ?? 0) - 1 && (
                    <GitBranch className="w-3 h-3 text-muted-foreground rotate-90" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HardLimitCard({ limit, canEdit, onEdit, onDelete }: {
  limit: HardLimit;
  canEdit?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const formatValue = () => {
    const v = limit.limit_value;
    if (limit.limit_currency === 'USD' || limit.limit_type.endsWith('_usd')) {
      return Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    }
    if (limit.limit_type.endsWith('_pct')) {
      return `${v}%`;
    }
    if (limit.limit_type === 'obligation_coverage_days') {
      return `${v} days`;
    }
    return String(v);
  };

  const scopeSummary = () => {
    const parts: string[] = [];
    if (limit.scope?.asset) parts.push(limit.scope.asset);
    if (limit.scope?.venue) parts.push(limit.scope.venue);
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  return (
    <Card className="rounded-lg dark:border-white/[0.08]">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <IconTile variant="failed" size="sm"><Gauge /></IconTile>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold truncate">{limit.name}</div>
              {canEdit && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={onEdit}
                    className="p-1.5 rounded-md hover:bg-white/[0.04] text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Edit limit"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={onDelete}
                    className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                    aria-label="Delete limit"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1 font-mono">
              {limit.limit_type} · max {formatValue()}
              {scopeSummary() && (
                <>
                  <span className="mx-1.5">·</span>
                  <span>{scopeSummary()}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
