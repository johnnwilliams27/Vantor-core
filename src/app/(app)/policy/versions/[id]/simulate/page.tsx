'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, PlayCircle, AlertTriangle, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { EmptyStateCard } from '@/components/ui/empty-state-card';
import { IconTile } from '@/components/ui/icon-tile';
import { StatCard } from '@/components/ui/stat-card';
import { capitalize, formatRelativeOrDate } from '@/lib/utils';
import type { PolicyVersionSnapshot } from '@/lib/policy/types/policy-version';

type SimRow = {
  evaluation_id: string;
  historical_verdict: string;
  draft_verdict: string;
  changed: boolean;
  movement: {
    id: string;
    kind: string;
    amount: { amount: string; asset: string };
  };
  rule_failures: number;
  created_at: string;
};

type SimResponse = {
  draft_version_id: string;
  draft_version_number: number;
  window_days: number;
  summary: {
    total: number;
    changed: number;
    newly_blocked: number;
    newly_held: number;
    newly_allowed: number;
    errors: number;
    rows_with_rule_failures: number;
  };
  results: SimRow[];
};

const VERDICT_VARIANT: Record<string, 'active' | 'pending' | 'failed' | 'inactive'> = {
  allow_auto: 'active',
  require_approval: 'pending',
  block: 'failed',
  block_hard_limit: 'failed',
  engine_error: 'inactive',
};

const VERDICT_LABEL: Record<string, string> = {
  allow_auto: 'Allowed',
  require_approval: 'Held',
  block: 'Blocked',
  block_hard_limit: 'Hard limit',
  engine_error: 'Error',
};

export default function SimulatePage() {
  const params = useParams<{ id: string }>();
  const versionId = params?.id ?? '';
  const [days, setDays] = useState(7);
  const [onlyChanged, setOnlyChanged] = useState(true);

  const version = useQuery({
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

  const simulate = useMutation({
    mutationFn: async (): Promise<SimResponse> => {
      const res = await fetch(`/api/policy/versions/${versionId}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, limit: 200 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.human_readable ?? err.error ?? `Simulation failed (${res.status})`);
      }
      const json = await res.json();
      return json.data;
    },
  });

  const sim = simulate.data;
  const rows = sim?.results ?? [];
  const visibleRows = onlyChanged ? rows.filter((r) => r.changed) : rows;
  const v = version.data;

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <Link
        href={`/policy/versions/${versionId}`}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Version
      </Link>

      <div className="flex items-start gap-3">
        <IconTile variant="special" size="md" emphasized>
          <Sparkles />
        </IconTile>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Impact preview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Replay this draft over recent evaluations and see what would change. Ship with confidence, not crossed fingers.
          </p>
        </div>
      </div>

      {v && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 text-sm">
          Simulating <span className="font-mono">v{v.version_number}</span>
          <span className="mx-1.5 text-muted-foreground">·</span>
          <span className="font-semibold">{v.name}</span>
          <span className="mx-1.5 text-muted-foreground">·</span>
          <Badge variant={v.status === 'active' ? 'active' : v.status === 'draft' ? 'pending' : 'inactive'} size="xs">
            {v.status}
          </Badge>
        </div>
      )}

      {/* Controls */}
      <Card className="rounded-lg dark:border-white/[0.08]">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <Field label="Replay window" helper="How far back to sample past evaluations.">
              <Select
                value={String(days)}
                onChange={(e) => setDays(Number(e.target.value))}
                disabled={simulate.isPending}
              >
                <option value="1">Last 24 hours</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </Select>
            </Field>
            <Button
              variant="default"
              onClick={() => simulate.mutate()}
              disabled={simulate.isPending}
              className="h-10"
            >
              {simulate.isPending ? (
                <>
                  <Sparkles className="w-4 h-4 mr-1.5 animate-pulse" />
                  Running…
                </>
              ) : (
                <>
                  <PlayCircle className="w-4 h-4 mr-1.5" />
                  Run simulation
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {simulate.isError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] p-4 text-sm text-red-400">
          {(simulate.error as Error).message}
        </div>
      )}

      {sim && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Evaluated"
              value={<span className="tabular-nums">{sim.summary.total.toLocaleString()}</span>}
              trend={`${sim.window_days}d window`}
              direction="neutral"
            />
            <StatCard
              icon={<AlertTriangle />}
              iconVariant="pending"
              label="Changed outcomes"
              value={<span className="tabular-nums">{sim.summary.changed}</span>}
              trend={sim.summary.total ? `${Math.round((sim.summary.changed / sim.summary.total) * 100)}%` : '—'}
              direction={sim.summary.changed > 0 ? 'down' : 'neutral'}
              context="vs historical"
            />
            <StatCard
              iconVariant="failed"
              label="Newly blocked"
              value={<span className="tabular-nums">{sim.summary.newly_blocked}</span>}
              trend={`${sim.summary.newly_held} newly held`}
              direction={sim.summary.newly_blocked > 0 ? 'down' : 'neutral'}
            />
            <StatCard
              iconVariant="active"
              label="Newly allowed"
              value={<span className="tabular-nums">{sim.summary.newly_allowed}</span>}
              trend={sim.summary.rows_with_rule_failures ? `${sim.summary.rows_with_rule_failures} w/ rule failures` : 'clean'}
              direction={sim.summary.rows_with_rule_failures > 0 ? 'down' : 'up'}
            />
          </div>

          {sim.summary.rows_with_rule_failures > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3.5 text-xs">
              <div className="font-semibold text-amber-400 mb-1">Partial results</div>
              <p className="text-muted-foreground">
                {sim.summary.rows_with_rule_failures} evaluation{sim.summary.rows_with_rule_failures === 1 ? '' : 's'} had rule failures during simulation.
                Usually this means the draft's new rules reference aggregate or forecast queries that weren't pre-computed in the historical
                context snapshots — re-evaluations with live state would resolve those correctly. Counts above already fold the affected rows in.
              </p>
            </div>
          )}

          <Card className="rounded-lg dark:border-white/[0.08]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                {visibleRows.length} {onlyChanged ? 'changed' : 'total'} outcome{visibleRows.length === 1 ? '' : 's'}
              </CardTitle>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={onlyChanged}
                  onChange={(e) => setOnlyChanged(e.target.checked)}
                  className="accent-teal-400"
                />
                Only show changed
              </label>
            </CardHeader>
            <CardContent>
              {visibleRows.length === 0 ? (
                <EmptyStateCard
                  icon={<Sparkles />}
                  iconVariant={sim.summary.changed === 0 ? 'active' : 'inactive'}
                  title={sim.summary.changed === 0 ? 'No changed outcomes' : 'Nothing matches filter'}
                  helper={sim.summary.changed === 0
                    ? 'Every historical evaluation would have the same verdict under this draft. Safe to activate.'
                    : 'Toggle "Only show changed" off to see all simulated evaluations.'}
                  className="border-0 shadow-none"
                />
              ) : (
                <ul className="divide-y divide-white/[0.04]">
                  {visibleRows.map((r) => (
                    <li key={r.evaluation_id} className="flex items-center gap-3 py-2.5 px-2 text-sm">
                      <div className="flex items-center gap-2 shrink-0 w-[220px]">
                        <Badge variant={VERDICT_VARIANT[r.historical_verdict] ?? 'inactive'} size="sm">
                          {VERDICT_LABEL[r.historical_verdict] ?? r.historical_verdict}
                        </Badge>
                        <span className="text-muted-foreground text-xs">→</span>
                        <Badge variant={VERDICT_VARIANT[r.draft_verdict] ?? 'inactive'} size="sm" dot={r.changed}>
                          {VERDICT_LABEL[r.draft_verdict] ?? r.draft_verdict}
                        </Badge>
                      </div>
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="text-muted-foreground">{capitalize(r.movement.kind.replace(/_/g, ' '))}</span>
                        <span className="font-mono tabular-nums">{Number(r.movement.amount.amount).toLocaleString()}</span>
                        <span className="text-muted-foreground text-xs">{r.movement.amount.asset}</span>
                        {r.rule_failures > 0 && (
                          <Badge variant="pending" size="xs" className="font-mono">
                            {r.rule_failures} rule failure{r.rule_failures === 1 ? '' : 's'}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {formatRelativeOrDate(r.created_at).text}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!sim && !simulate.isError && (
        <EmptyStateCard
          icon={<PlayCircle />}
          iconVariant="inactive"
          title="Pick a window and run"
          helper="The simulator replays each recent movement through this draft and compares the verdicts. Takes a few seconds."
          className="py-10"
        />
      )}
    </div>
  );
}
