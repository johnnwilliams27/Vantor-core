'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Activity, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { EmptyStateCard } from '@/components/ui/empty-state-card';
import { IconTile } from '@/components/ui/icon-tile';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { formatRelativeOrDate, capitalize } from '@/lib/utils';

type EvaluationRow = {
  id: string;
  version_id: string;
  movement_id: string;
  proposed_movement: {
    id: string;
    kind: string;
    amount: { amount: string; asset: string };
    source?: { venue?: string; address?: string };
    destination?: { venue?: string; address?: string; label?: string };
    initiator?: { type?: string };
  };
  verdict: 'allow_auto' | 'require_approval' | 'block' | 'block_hard_limit';
  reason_codes?: string[];
  executed_at: string | null;
  execution_ref?: string | null;
  created_at: string;
  trace: any;
  canonicalization: any;
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

const DAYS_OPTIONS = [1, 7, 30, 90] as const;

export default function HistoryPage() {
  const [days, setDays] = useState<number>(7);
  const [verdict, setVerdict] = useState<string>('all');
  const [ruleSearch, setRuleSearch] = useState('');
  const [selected, setSelected] = useState<EvaluationRow | null>(null);

  const evals = useQuery({
    queryKey: ['policy', 'history', days, verdict, ruleSearch],
    queryFn: async (): Promise<EvaluationRow[]> => {
      const params = new URLSearchParams({ since_days: String(days), limit: '200' });
      if (verdict !== 'all') params.set('verdict', verdict);
      if (ruleSearch.trim()) params.set('rule_id', ruleSearch.trim());
      const res = await fetch(`/api/policy/evaluations?${params}`);
      if (!res.ok) return [];
      const json = await res.json();
      return json.data ?? [];
    },
  });

  const rows = evals.data ?? [];

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <Link
        href="/policy"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Policy
      </Link>

      <div className="flex items-center gap-3">
        <IconTile variant="info" size="md">
          <Activity />
        </IconTile>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Evaluation history</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every gate decision — verdict, trace, canonicalization, execution timestamp.
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card className="rounded-lg dark:border-white/[0.08]">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Time range">
              <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
                {DAYS_OPTIONS.map((d) => (
                  <option key={d} value={d}>Last {d} {d === 1 ? 'day' : 'days'}</option>
                ))}
              </Select>
            </Field>
            <Field label="Verdict">
              <Select value={verdict} onChange={(e) => setVerdict(e.target.value)}>
                <option value="all">All</option>
                <option value="allow_auto">Allowed</option>
                <option value="require_approval">Held</option>
                <option value="block">Blocked</option>
                <option value="block_hard_limit">Hard limit</option>
              </Select>
            </Field>
            <Field label="Rule ID" helper="Filter to evaluations where this rule matched.">
              <Input
                value={ruleSearch}
                onChange={(e) => setRuleSearch(e.target.value)}
                placeholder="uuid (partial ok)"
                className="font-mono text-xs"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card className="rounded-lg dark:border-white/[0.08]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            {evals.isLoading ? 'Loading…' : `${rows.length.toLocaleString()} ${rows.length === 1 ? 'evaluation' : 'evaluations'}`}
          </CardTitle>
          <span className="text-[11px] text-muted-foreground">click a row for full trace</span>
        </CardHeader>
        <CardContent>
          {evals.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 rounded-md bg-white/[0.02] animate-pulse" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyStateCard
              icon={<Activity />}
              iconVariant="inactive"
              title="No evaluations match"
              helper="Widen the time range or clear filters."
              className="border-0 shadow-none"
            />
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {rows.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => setSelected(e)}
                    className="w-full flex items-center gap-3 py-2.5 px-2 hover:bg-white/[0.02] transition-colors text-left rounded-md"
                  >
                    <Badge variant={VERDICT_VARIANT[e.verdict] ?? 'inactive'} size="sm" dot className="shrink-0">
                      {VERDICT_LABEL[e.verdict] ?? e.verdict}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">{capitalize(e.proposed_movement.kind.replace(/_/g, ' '))}</span>
                        <span className="text-muted-foreground/50">·</span>
                        <span className="font-mono tabular-nums">{Number(e.proposed_movement.amount.amount).toLocaleString()}</span>
                        <span className="text-muted-foreground text-xs">{e.proposed_movement.amount.asset}</span>
                        {e.executed_at && (
                          <>
                            <span className="text-muted-foreground/50">·</span>
                            <Badge variant="active" size="xs">executed</Badge>
                          </>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                        {e.movement_id.slice(0, 12)}…
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0 tabular-nums" title={e.created_at}>
                      {formatRelativeOrDate(e.created_at).text}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {selected && <TraceDialog row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function TraceDialog({ row, onClose }: { row: EvaluationRow; onClose: () => void }) {
  const rulesEvaluated: Array<any> = row.trace?.rules_evaluated ?? [];
  const matchedRules = rulesEvaluated.filter((r) => r.matched);
  const finalSource = row.trace?.final_verdict_source ?? 'unknown';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>{capitalize(row.proposed_movement.kind.replace(/_/g, ' '))} — evaluation</DialogTitle>
              <DialogDescription className="font-mono text-[11px] mt-1">
                {row.id}
              </DialogDescription>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-white/[0.04] text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pr-1 -mr-1">
          {/* Summary grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Stat label="Verdict">
              <Badge variant={VERDICT_VARIANT[row.verdict] ?? 'inactive'} size="sm" dot>
                {VERDICT_LABEL[row.verdict] ?? row.verdict}
              </Badge>
            </Stat>
            <Stat label="Source" value={finalSource.replace(/_/g, ' ')} />
            <Stat label="Rules evaluated" value={String(rulesEvaluated.length)} mono />
            <Stat label="Matched" value={String(matchedRules.length)} mono />
          </div>

          {/* Matched rules */}
          {matchedRules.length > 0 && (
            <section>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                Matched rules
              </div>
              <div className="space-y-1.5">
                {matchedRules.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5">
                    <Badge variant={r.verdict_contribution === 'block' ? 'failed' : r.verdict_contribution === 'require_approval' ? 'pending' : 'active'} size="sm">
                      {r.verdict_contribution ?? 'neutral'}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{r.rule_name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {r.rule_id?.slice(0, 12)}… · priority {r.priority}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Canonicalization */}
          {row.canonicalization && (
            <section>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                Canonicalization
              </div>
              <div className="rounded-md bg-white/[0.02] border border-white/[0.06] p-3 font-mono text-[11px] space-y-1">
                <div><span className="text-muted-foreground">native:</span> {row.canonicalization.native_amount} {row.canonicalization.native_asset}</div>
                <div><span className="text-muted-foreground">usd:</span> {row.canonicalization.canonical_amount} USD</div>
                <div><span className="text-muted-foreground">rate:</span> {row.canonicalization.rate} ({row.canonicalization.rate_source})</div>
                {row.canonicalization.failure && (
                  <div className="text-red-400">failure: {row.canonicalization.failure.reason_code}</div>
                )}
              </div>
            </section>
          )}

          {/* Raw trace */}
          <section>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
              Full trace
            </div>
            <pre className="rounded-md bg-white/[0.02] border border-white/[0.06] p-3 font-mono text-[10px] text-muted-foreground overflow-x-auto">
              {JSON.stringify(row.trace, null, 2)}
            </pre>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, children, mono }: { label: string; value?: React.ReactNode; children?: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold mt-1 ${mono ? 'font-mono tabular-nums' : ''}`}>
        {children ?? value}
      </div>
    </div>
  );
}
