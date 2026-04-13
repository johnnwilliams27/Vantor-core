'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, GitCompareArrows, Plus, Minus, Pencil } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { EmptyStateCard } from '@/components/ui/empty-state-card';
import { IconTile } from '@/components/ui/icon-tile';
import { cn } from '@/lib/utils';
import type { PolicyVersionSnapshot } from '@/lib/policy/types/policy-version';
import { computeVersionDiff, type DiffEntry, type DiffSection } from '@/lib/policy/diff';

export default function DiffPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const versionId = params?.id ?? '';
  const againstId = searchParams?.get('against') ?? '';

  const versions = useQuery({
    queryKey: ['policy', 'versions'],
    queryFn: async (): Promise<PolicyVersionSnapshot[]> => {
      const res = await fetch('/api/policy/versions');
      if (!res.ok) return [];
      const json = await res.json();
      return json.data ?? [];
    },
  });

  const active = useQuery({
    queryKey: ['policy', 'active'],
    queryFn: async (): Promise<PolicyVersionSnapshot | null> => {
      const res = await fetch('/api/policy/active');
      if (!res.ok) return null;
      const json = await res.json();
      return json.data ?? null;
    },
  });

  // "after" is always the version in the URL (draft we're reviewing)
  const after = useQuery({
    queryKey: ['policy', 'version', versionId],
    queryFn: async (): Promise<PolicyVersionSnapshot | null> => {
      if (!versionId) return null;
      const res = await fetch(`/api/policy/versions/${versionId}`);
      if (!res.ok) return null;
      const json = await res.json();
      return json.data ?? null;
    },
    enabled: !!versionId,
  });

  // "before" defaults to the active version, or whatever is passed via ?against=
  const defaultAgainstId = againstId || active.data?.id || '';
  const before = useQuery({
    queryKey: ['policy', 'version', defaultAgainstId],
    queryFn: async (): Promise<PolicyVersionSnapshot | null> => {
      if (!defaultAgainstId) return null;
      const res = await fetch(`/api/policy/versions/${defaultAgainstId}`);
      if (!res.ok) return null;
      const json = await res.json();
      return json.data ?? null;
    },
    enabled: !!defaultAgainstId,
  });

  const diff = useMemo(() => {
    if (!before.data || !after.data) return null;
    return computeVersionDiff(before.data, after.data);
  }, [before.data, after.data]);

  const setAgainst = (id: string) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('against', id); else url.searchParams.delete('against');
    window.history.replaceState(null, '', url.toString());
    // react-query re-runs because the query key depends on defaultAgainstId — but replaceState
    // doesn't trigger re-render. Hard reload the before query.
    before.refetch();
  };

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <Link
        href={`/policy/versions/${versionId}`}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Version
      </Link>

      {/* Header + comparison picker */}
      <div className="flex items-start gap-3">
        <IconTile variant="info" size="md" emphasized>
          <GitCompareArrows />
        </IconTile>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Version diff</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            What changed between two versions. Rules, chains, and hard limits side-by-side.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Compare</span>
          <Select
            value={defaultAgainstId}
            onChange={(e) => setAgainst(e.target.value)}
            className="min-w-[220px]"
          >
            <option value="">— Select version —</option>
            {(versions.data ?? [])
              .filter((v) => v.id !== versionId)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version_number} · {v.name} ({v.status})
                </option>
              ))}
          </Select>
        </div>
        <div className="text-xs text-muted-foreground">→</div>
        <div className="text-sm">
          {after.data ? (
            <span className="flex items-center gap-2">
              <Badge variant={after.data.status === 'active' ? 'active' : after.data.status === 'draft' ? 'pending' : 'inactive'} size="sm" dot>
                {after.data.status}
              </Badge>
              <span>v{after.data.version_number} · <span className="font-semibold">{after.data.name}</span></span>
            </span>
          ) : (
            <span className="text-muted-foreground italic">…</span>
          )}
        </div>
      </div>

      {/* Summary */}
      {diff && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryTile kind="added" count={diff.totals.added} />
          <SummaryTile kind="changed" count={diff.totals.changed} />
          <SummaryTile kind="removed" count={diff.totals.removed} />
        </div>
      )}

      {!before.data || !after.data ? (
        <EmptyStateCard
          icon={<GitCompareArrows />}
          iconVariant="inactive"
          title={defaultAgainstId ? 'Loading versions…' : 'Pick a version to compare'}
          helper={defaultAgainstId ? undefined : 'Choose any version from the dropdown above.'}
          className="py-10"
        />
      ) : diff && diff.totals.added + diff.totals.changed + diff.totals.removed === 0 ? (
        <EmptyStateCard
          icon={<GitCompareArrows />}
          iconVariant="active"
          title="No differences"
          helper="These two versions are structurally identical."
          className="py-10"
        />
      ) : diff ? (
        <div className="space-y-6">
          <DiffSectionView
            title="Rules"
            section={diff.rules}
            renderRow={(e) => <RuleDiffRow entry={e} />}
          />
          <DiffSectionView
            title="Approval chains"
            section={diff.chains}
            renderRow={(e) => <ChainDiffRow entry={e} />}
          />
          <DiffSectionView
            title="Hard limits"
            section={diff.hardLimits}
            renderRow={(e) => <LimitDiffRow entry={e} />}
          />
        </div>
      ) : null}
    </div>
  );
}

function SummaryTile({ kind, count }: { kind: 'added' | 'changed' | 'removed'; count: number }) {
  const meta = {
    added:   { label: 'Added',   variant: 'active'  as const, Icon: Plus  },
    changed: { label: 'Changed', variant: 'pending' as const, Icon: Pencil },
    removed: { label: 'Removed', variant: 'failed'  as const, Icon: Minus },
  }[kind];

  return (
    <Card className="rounded-lg dark:border-white/[0.08]">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <IconTile variant={meta.variant} size="sm" emphasized>
            <meta.Icon />
          </IconTile>
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              {meta.label}
            </div>
            <div className="text-2xl font-bold tabular-nums tracking-tight">
              {count}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DiffSectionView<T>({
  title,
  section,
  renderRow,
}: {
  title: string;
  section: DiffSection<T>;
  renderRow: (entry: DiffEntry<T>) => React.ReactNode;
}) {
  const total = section.added.length + section.changed.length + section.removed.length;
  if (total === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            {section.added.length} added
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            {section.changed.length} changed
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
            {section.removed.length} removed
          </span>
          {section.unchanged > 0 && (
            <span className="text-muted-foreground/60">{section.unchanged} unchanged</span>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        {section.added.map((e) => (
          <div key={e.id} className={diffRowClass('added')}>
            <DiffGutter kind="added" />
            {renderRow(e)}
          </div>
        ))}
        {section.changed.map((e) => (
          <div key={e.id} className={diffRowClass('changed')}>
            <DiffGutter kind="changed" />
            {renderRow(e)}
          </div>
        ))}
        {section.removed.map((e) => (
          <div key={e.id} className={diffRowClass('removed')}>
            <DiffGutter kind="removed" />
            {renderRow(e)}
          </div>
        ))}
      </div>
    </section>
  );
}

function diffRowClass(kind: 'added' | 'changed' | 'removed'): string {
  return cn(
    'flex items-start gap-0 rounded-lg border overflow-hidden',
    kind === 'added' && 'border-green-500/15 bg-green-500/[0.03]',
    kind === 'changed' && 'border-amber-500/15 bg-amber-500/[0.03]',
    kind === 'removed' && 'border-red-500/15 bg-red-500/[0.03]',
  );
}

function DiffGutter({ kind }: { kind: 'added' | 'changed' | 'removed' }) {
  const meta = {
    added:   { label: '+', color: 'text-green-400 bg-green-500/10' },
    changed: { label: '~', color: 'text-amber-400 bg-amber-500/10' },
    removed: { label: '−', color: 'text-red-400 bg-red-500/10' },
  }[kind];
  return (
    <div className={cn('w-7 self-stretch flex items-center justify-center font-mono text-sm font-bold', meta.color)}>
      {meta.label}
    </div>
  );
}

function RuleDiffRow({ entry }: { entry: DiffEntry<import('@/lib/policy/types/policy-version').PolicyRule> }) {
  const primary = entry.after ?? entry.before;
  if (!primary) return null;
  return (
    <div className="flex-1 p-3 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold truncate">{primary.name}</span>
        <Badge variant="inactive" size="xs" className="font-mono">priority {primary.priority}</Badge>
        <Badge
          variant={primary.verdict === 'block' || primary.verdict === 'block_hard_limit' ? 'failed' : primary.verdict === 'require_approval' ? 'pending' : 'active'}
          size="xs"
        >
          {String(primary.verdict).replace(/_/g, ' ')}
        </Badge>
      </div>
      {entry.changedFields && entry.changedFields.length > 0 && (
        <div className="text-[11px] text-amber-400 mt-1 font-mono">
          changed: {entry.changedFields.join(' · ')}
        </div>
      )}
      <div className="font-mono text-[10px] text-muted-foreground mt-1">
        {entry.id.slice(0, 12)}…
      </div>
    </div>
  );
}

function ChainDiffRow({ entry }: { entry: DiffEntry<import('@/lib/policy/types/policy-version').ApprovalChain> }) {
  const primary = entry.after ?? entry.before;
  if (!primary) return null;
  const slotCount = primary.slots?.length ?? 0;
  return (
    <div className="flex-1 p-3 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold truncate">{primary.name}</span>
        <Badge variant="info-blue" size="xs" className="font-mono tabular-nums">
          {slotCount} {slotCount === 1 ? 'slot' : 'slots'}
        </Badge>
      </div>
      {entry.changedFields && entry.changedFields.length > 0 && (
        <div className="text-[11px] text-amber-400 mt-1 font-mono">
          changed: {entry.changedFields.join(' · ')}
        </div>
      )}
    </div>
  );
}

function LimitDiffRow({ entry }: { entry: DiffEntry<import('@/lib/policy/types/hard-limit').HardLimit> }) {
  const primary = entry.after ?? entry.before;
  if (!primary) return null;
  return (
    <div className="flex-1 p-3 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold truncate">{primary.name}</span>
        <Badge variant="inactive" size="xs" className="font-mono">{primary.limit_type}</Badge>
        <Badge variant="failed" size="xs" className="font-mono tabular-nums">
          max {primary.limit_value}
        </Badge>
      </div>
      {entry.changedFields && entry.changedFields.length > 0 && (
        <div className="text-[11px] text-amber-400 mt-1 font-mono">
          changed: {entry.changedFields.join(' · ')}
        </div>
      )}
    </div>
  );
}
