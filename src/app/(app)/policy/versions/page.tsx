'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, Plus, Copy, CircleCheck, CircleDashed, Archive, ArrowRight, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyStateCard } from '@/components/ui/empty-state-card';
import { IconTile } from '@/components/ui/icon-tile';
import { useToast } from '@/components/ui/toast';
import { ConfirmDeleteDialog } from '@/components/policy/ConfirmDeleteDialog';
import { formatRelativeOrDate, sanitizeErrorMessage } from '@/lib/utils';
import type { PolicyVersionSnapshot } from '@/lib/policy/types/policy-version';

type VersionRow = PolicyVersionSnapshot;

export default function VersionsListPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: '', name: '' });

  const versions = useQuery({
    queryKey: ['policy', 'versions'],
    queryFn: async (): Promise<VersionRow[]> => {
      const res = await fetch('/api/policy/versions');
      if (!res.ok) throw new Error('Failed to load versions');
      const json = await res.json();
      return json.data ?? [];
    },
  });

  const all = versions.data ?? [];
  const active = all.find((v) => v.status === 'active') ?? null;
  const drafts = all.filter((v) => v.status === 'draft');
  const superseded = all.filter((v) => v.status === 'superseded');

  async function createDraft(sourceVersionId?: string) {
    setCreating(true);
    try {
      const label = sourceVersionId ? 'Cloned from active' : 'New draft';
      const name = `${label} · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      const res = await fetch('/api/policy/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          ...(sourceVersionId ? { source_version_id: sourceVersionId } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.human_readable ?? err.error ?? `Create failed (${res.status})`);
      }
      const { data } = await res.json();
      qc.invalidateQueries({ queryKey: ['policy', 'versions'] });
      toast({ title: 'Draft created', variant: 'success' });
      window.location.href = `/policy/versions/${data.id}`;
    } catch (err) {
      toast({
        title: 'Could not create draft',
        description: sanitizeErrorMessage((err as Error).message),
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  }

  async function deleteDraft() {
    const res = await fetch(`/api/policy/versions/${deleteConfirm.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.human_readable ?? err.error ?? `Delete failed (${res.status})`);
    }
    qc.invalidateQueries({ queryKey: ['policy'] });
    toast({ title: 'Draft deleted', variant: 'success' });
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/policy" className="text-xs text-muted-foreground hover:text-foreground">
            ← Policy
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {active && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => createDraft(active.id)}
              disabled={creating}
            >
              <Copy className="w-3.5 h-3.5 mr-1.5" />
              Clone active
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            onClick={() => createDraft()}
            disabled={creating}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            New draft
          </Button>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Policy versions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          One version is active at a time. Draft changes, simulate them, then activate to supersede the current version.
        </p>
      </div>

      {versions.isLoading ? (
        <div className="space-y-3">
          <div className="h-32 rounded-lg bg-white/[0.02] animate-pulse" />
          <div className="h-24 rounded-lg bg-white/[0.02] animate-pulse" />
        </div>
      ) : all.length === 0 ? (
        <EmptyStateCard
          icon={<Gavel />}
          iconVariant="special"
          title="No policy versions yet"
          helper="Create your first draft to start defining rules. Nothing is enforced until a version is activated."
          cta={
            <Button variant="default" size="sm" onClick={() => createDraft()}>
              <Plus className="w-4 h-4 mr-1.5" />
              Create first draft
            </Button>
          }
        />
      ) : (
        <>
          {/* Active version — hero card */}
          <section>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-3">
              Active
            </div>
            {active ? (
              <VersionCard v={active} prominent />
            ) : (
              <EmptyStateCard
                icon={<CircleDashed />}
                iconVariant="inactive"
                title="No active version"
                helper="Activate a draft to start enforcing its rules on money movements."
                className="py-6"
              />
            )}
          </section>

          {/* Drafts */}
          <section className="mt-8">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                Drafts
              </div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {drafts.length}
              </div>
            </div>
            {drafts.length === 0 ? (
              <div className="text-sm text-muted-foreground italic py-4">
                No drafts in progress.
              </div>
            ) : (
              <div className="space-y-2">
                {drafts.map((v) => (
                  <VersionCard
                    key={v.id}
                    v={v}
                    onDelete={() => setDeleteConfirm({ open: true, id: v.id, name: v.name })}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Superseded — collapsed by default */}
          {superseded.length > 0 && (
            <section className="mt-8">
              <button
                onClick={() => setShowSuperseded(!showSuperseded)}
                className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-foreground transition-colors mb-3"
              >
                <Archive className="w-3 h-3" />
                Superseded · {superseded.length}
                <span className="text-muted-foreground normal-case">({showSuperseded ? 'hide' : 'show'})</span>
              </button>
              {showSuperseded && (
                <div className="space-y-2">
                  {superseded.map((v) => <VersionCard key={v.id} v={v} compact />)}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <ConfirmDeleteDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm((prev) => ({ ...prev, open }))}
        title="Delete this draft version"
        description="All rules, approval chains, and hard limits in this draft will be permanently removed."
        itemName={deleteConfirm.name}
        onConfirm={deleteDraft}
      />
    </div>
  );
}

function VersionCard({ v, prominent, compact, onDelete }: { v: VersionRow; prominent?: boolean; compact?: boolean; onDelete?: () => void }) {
  const statusBadge = () => {
    if (v.status === 'active') return <Badge variant="active" size="sm" dot>Active</Badge>;
    if (v.status === 'draft')  return <Badge variant="pending" size="sm" dot>Draft</Badge>;
    return <Badge variant="inactive" size="sm">Superseded</Badge>;
  };

  const ruleCount = v.rules?.length ?? 0;
  const chainCount = v.approval_chains?.length ?? 0;
  const hardLimitCount = v.hard_limits?.length ?? 0;

  return (
    <Card
      className={cardClass(prominent, compact)}
    >
      <CardContent className={prominent ? 'p-6' : compact ? 'p-3.5' : 'p-4'}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {prominent && (
              <IconTile variant="active" size="md" emphasized>
                <CircleCheck />
              </IconTile>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {statusBadge()}
                <span className="font-mono text-[11px] text-muted-foreground">v{v.version_number}</span>
              </div>
              <div className={prominent ? 'text-lg font-semibold mt-1.5' : 'text-sm font-semibold mt-1'}>
                {v.name}
              </div>
              {!compact && (
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground tabular-nums">
                  <span>{ruleCount} {ruleCount === 1 ? 'rule' : 'rules'}</span>
                  <span className="text-white/20">·</span>
                  <span>{chainCount} {chainCount === 1 ? 'chain' : 'chains'}</span>
                  <span className="text-white/20">·</span>
                  <span>{hardLimitCount} hard {hardLimitCount === 1 ? 'limit' : 'limits'}</span>
                  {v.activated_at && (
                    <>
                      <span className="text-white/20">·</span>
                      <span>activated {formatRelativeOrDate(new Date(v.activated_at).toISOString()).text}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onDelete && v.status === 'draft' && (
              <button
                onClick={onDelete}
                className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                aria-label="Delete draft"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <Link href={`/policy/versions/${v.id}`}>
              <Button variant={prominent ? 'default' : 'outline'} size="sm">
                {v.status === 'draft' ? 'Edit' : 'View'}
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function cardClass(prominent?: boolean, compact?: boolean): string {
  if (prominent) return 'rounded-lg border-teal-500/20 bg-teal-500/[0.03] shadow-card';
  if (compact)   return 'rounded-lg dark:border-white/[0.06] bg-card/50 shadow-none';
  return 'rounded-lg dark:border-white/[0.08] shadow-card';
}
