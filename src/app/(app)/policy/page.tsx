'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Gavel, Activity, ShieldOff, CheckSquare, ArrowRight, Flame } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyStateCard } from '@/components/ui/empty-state-card';
import { IconTile } from '@/components/ui/icon-tile';
import { formatRelativeOrDate, capitalize } from '@/lib/utils';
import type { PolicyVersionSnapshot } from '@/lib/policy/types/policy-version';
import type { ApprovalRequest } from '@/lib/policy/approvals/types';

// Shape returned by /api/policy/evaluations — matches select projection.
type EvaluationRow = {
  id: string;
  version_id: string;
  movement_id: string;
  proposed_movement: {
    id: string;
    kind: string;
    amount: { amount: string; asset: string };
  };
  verdict: 'allow_auto' | 'require_approval' | 'block' | 'block_hard_limit';
  created_at: string;
  executed_at: string | null;
};

type RuleTriggerRow = {
  rule_id: string;
  rule_name: string;
  trigger_count: number;
  last_triggered_at: string;
};

const VERDICT_VARIANT: Record<string, 'active' | 'pending' | 'failed'> = {
  allow_auto: 'active',
  require_approval: 'pending',
  block: 'failed',
  block_hard_limit: 'failed',
};

const VERDICT_LABEL: Record<string, string> = {
  allow_auto: 'Allowed',
  require_approval: 'Held',
  block: 'Blocked',
  block_hard_limit: 'Hard limit',
};

export default function PolicyDashboardPage() {
  const active = useQuery({
    queryKey: ['policy', 'active'],
    queryFn: async (): Promise<PolicyVersionSnapshot | null> => {
      const res = await fetch('/api/policy/active');
      if (!res.ok) return null;
      const json = await res.json();
      return json.data ?? null;
    },
  });

  const versions = useQuery({
    queryKey: ['policy', 'versions'],
    queryFn: async (): Promise<PolicyVersionSnapshot[]> => {
      const res = await fetch('/api/policy/versions');
      if (!res.ok) return [];
      const json = await res.json();
      return json.data ?? [];
    },
  });

  const triggers = useQuery({
    queryKey: ['policy', 'triggers', 7],
    queryFn: async (): Promise<RuleTriggerRow[]> => {
      const res = await fetch('/api/policy/rule-trigger-counts?days=7');
      if (!res.ok) return [];
      const json = await res.json();
      return json.data ?? [];
    },
  });

  const evals = useQuery({
    queryKey: ['policy', 'recent-evals'],
    queryFn: async (): Promise<EvaluationRow[]> => {
      const res = await fetch('/api/policy/evaluations?since_days=7&limit=50');
      if (!res.ok) return [];
      const json = await res.json();
      return json.data ?? [];
    },
  });

  const pendingApprovals = useQuery({
    queryKey: ['approvals', 'pending-count'],
    queryFn: async (): Promise<number> => {
      const res = await fetch('/api/policy/approvals?status=pending&limit=500');
      if (!res.ok) return 0;
      const json = await res.json();
      const items = (json.data ?? []) as ApprovalRequest[];
      return items.filter((i) => i.status === 'pending').length;
    },
  });

  const evalRows = evals.data ?? [];
  const total7d = evalRows.length;
  const denied7d = evalRows.filter((e) => e.verdict === 'block' || e.verdict === 'block_hard_limit').length;
  const held7d = evalRows.filter((e) => e.verdict === 'require_approval').length;
  const denyRate = total7d ? Math.round((denied7d / total7d) * 100) : 0;
  const draftCount = (versions.data ?? []).filter((v) => v.status === 'draft').length;

  return (
    <div className="space-y-6 p-4 sm:p-8">
      {/* Hero header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <IconTile variant="special" size="md">
              <Gavel />
            </IconTile>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Policy</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Guardrails that gate every money movement before it executes.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/policy/history">
            <Button variant="outline" size="sm">History</Button>
          </Link>
          <Link href="/policy/versions">
            <Button variant="default" size="sm">
              Manage versions
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Activity />}
          iconVariant="active"
          label="Active version"
          value={
            active.data
              ? <span className="font-mono text-2xl">v{active.data.version_number}</span>
              : <span className="text-muted-foreground text-xl">None</span>
          }
          trend={active.data?.name}
          direction="neutral"
          context={active.data ? `activated ${active.data.activated_at ? formatRelativeOrDate(new Date(active.data.activated_at).toISOString()).text : '—'}` : undefined}
        />
        <StatCard
          icon={<Flame />}
          iconVariant="pending"
          label="Evaluations · 7d"
          value={<span className="tabular-nums">{total7d.toLocaleString()}</span>}
          trend={`${held7d} held`}
          direction="neutral"
          context="awaiting approval"
        />
        <StatCard
          icon={<ShieldOff />}
          iconVariant="failed"
          label="Deny rate · 7d"
          value={<span className="tabular-nums">{denyRate}%</span>}
          trend={`${denied7d} blocked`}
          direction={denyRate > 10 ? 'down' : 'neutral'}
          context={total7d === 0 ? 'no evaluations' : 'of total'}
        />
        <StatCard
          icon={<CheckSquare />}
          iconVariant="special"
          label="Pending approvals"
          value={<span className="tabular-nums">{pendingApprovals.data ?? 0}</span>}
          trend={
            (pendingApprovals.data ?? 0) > 0
              ? <Link href="/approvals" className="underline hover:text-teal-400">Open queue →</Link>
              : 'All clear'
          }
          direction="neutral"
        />
      </div>

      {/* Two-column: Top firing rules + Recent evaluations */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Top firing rules */}
        <Card className="rounded-lg dark:border-white/[0.08] lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Top firing rules · 7d</CardTitle>
            <Badge variant="inactive" size="xs">
              {(triggers.data ?? []).length} active
            </Badge>
          </CardHeader>
          <CardContent>
            {triggers.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-12 rounded-md bg-white/[0.02] animate-pulse" />
                ))}
              </div>
            ) : (triggers.data ?? []).length === 0 ? (
              <EmptyStateCard
                icon={<Flame />}
                iconVariant="inactive"
                title="No rules fired this week"
                helper="Either no rules are authored, or none have matched recent movements."
                className="border-0 shadow-none"
              />
            ) : (
              <ul className="space-y-1">
                {(triggers.data ?? []).slice(0, 6).map((row, i) => (
                  <li
                    key={row.rule_id}
                    className="flex items-center justify-between gap-3 py-2 px-2 rounded-md hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-[11px] text-muted-foreground w-5 text-right">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm truncate">{row.rule_name || <span className="text-muted-foreground italic">unnamed</span>}</div>
                        <div className="font-mono text-[10px] text-muted-foreground truncate">
                          {row.rule_id.slice(0, 8)}… · last {formatRelativeOrDate(row.last_triggered_at).text}
                        </div>
                      </div>
                    </div>
                    <Badge variant="pending" size="sm" className="font-mono tabular-nums shrink-0">
                      {row.trigger_count}×
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent evaluations */}
        <Card className="rounded-lg dark:border-white/[0.08] lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent evaluations</CardTitle>
            <Link href="/policy/history" className="text-xs text-muted-foreground hover:text-teal-400">
              View all →
            </Link>
          </CardHeader>
          <CardContent>
            {evals.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-10 rounded-md bg-white/[0.02] animate-pulse" />
                ))}
              </div>
            ) : evalRows.length === 0 ? (
              <EmptyStateCard
                icon={<Activity />}
                iconVariant="inactive"
                title="No evaluations yet"
                helper="Once policy is active, every money movement will write an evaluation row here."
                className="border-0 shadow-none"
              />
            ) : (
              <ul className="divide-y divide-white/[0.04]">
                {evalRows.slice(0, 10).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 px-1">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Badge variant={VERDICT_VARIANT[e.verdict] ?? 'inactive'} size="sm" dot>
                        {VERDICT_LABEL[e.verdict] ?? e.verdict}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">
                          <span className="text-muted-foreground">{capitalize(e.proposed_movement.kind.replace(/_/g, ' '))}</span>
                          <span className="mx-1.5 text-muted-foreground">·</span>
                          <span className="font-mono tabular-nums">
                            {Number(e.proposed_movement.amount.amount).toLocaleString()}
                          </span>
                          <span className="text-muted-foreground ml-1">{e.proposed_movement.amount.asset}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">
                      {formatRelativeOrDate(e.created_at).text}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Drafts CTA band */}
      {draftCount > 0 && (
        <Card className="rounded-lg dark:border-white/[0.08] bg-teal-500/[0.03] border-teal-500/20">
          <CardContent className="flex items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <IconTile variant="active" size="md" emphasized>
                <Gavel />
              </IconTile>
              <div>
                <div className="text-sm font-semibold">
                  {draftCount} draft {draftCount === 1 ? 'version' : 'versions'} pending review
                </div>
                <div className="text-xs text-muted-foreground">
                  Review and activate changes or keep iterating.
                </div>
              </div>
            </div>
            <Link href="/policy/versions">
              <Button variant="default" size="sm">
                Review drafts
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
