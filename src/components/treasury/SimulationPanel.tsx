'use client';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useRunSimulation } from '@/hooks/useTreasury';
import type { SimulationRun, SimulationRecordResult } from '@/types/database';
import { FlaskConical, Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const fmt = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
};

function rowColor(result: SimulationRecordResult): string {
  if (result.delta_usd === null) return '';
  if (result.delta_usd > 0) return 'bg-green-50 dark:bg-green-950/20';
  if (result.delta_usd < 0) return 'bg-red-50 dark:bg-red-950/20';
  return 'bg-muted/30';
}

function DeltaIcon({ delta }: { delta: number | null }) {
  if (delta === null) return <Minus className="h-3 w-3 text-muted-foreground" />;
  if (delta > 0) return <TrendingUp className="h-3 w-3 text-green-600" />;
  if (delta < 0) return <TrendingDown className="h-3 w-3 text-red-500" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

export function SimulationPanel() {
  const { toast } = useToast();
  const runSimulation = useRunSimulation();
  const [result, setResult] = useState<SimulationRun | null>(null);

  // Rule override form state
  const [multiplier, setMultiplier] = useState('');
  const [lookahead, setLookahead] = useState('');
  const [threshold, setThreshold] = useState('');
  const [label, setLabel] = useState('');

  const handleRun = async () => {
    const overrides: Record<string, number | string> = {};
    if (multiplier) overrides.safety_buffer_multiplier = parseFloat(multiplier);
    if (lookahead) overrides.obligation_lookahead_days = parseInt(lookahead, 10);
    if (threshold) overrides.approval_threshold_usd = parseFloat(threshold);
    if (label) overrides.label = label;

    try {
      const run = await runSimulation.mutateAsync(
        Object.keys(overrides).length > 0 ? { rule_overrides: overrides as any } : undefined
      );
      setResult(run);
      toast({ title: 'Simulation complete', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Simulation failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Override Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" />
            Paper Trading — Rule Override
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Replay the last 90 days of recommendations under different rule parameters.
            Leave fields blank to use the current active rule.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Safety Buffer Multiplier
              </label>
              <input
                type="number"
                step="0.1"
                min="1"
                max="10"
                placeholder="e.g. 2.0"
                value={multiplier}
                onChange={(e) => setMultiplier(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Lookahead Days
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max="365"
                placeholder="e.g. 14"
                value={lookahead}
                onChange={(e) => setLookahead(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Approval Threshold (USD)
              </label>
              <input
                type="number"
                step="1000"
                min="0"
                placeholder="e.g. 50000"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Scenario Label
              </label>
              <input
                type="text"
                placeholder="e.g. Conservative"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>
          <Button
            onClick={handleRun}
            disabled={runSimulation.isPending}
            className="flex items-center gap-2"
          >
            {runSimulation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Simulating…
              </>
            ) : (
              <>
                <FlaskConical className="h-4 w-4" />
                Run Simulation
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Simulation Results — {result.rule_snapshot.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground mb-1">Total Recs</div>
                <div className="text-lg font-bold">{result.summary.total_recommendations}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground mb-1">Actual Executed</div>
                <div className="text-lg font-bold">{result.summary.executed_count}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground mb-1">Sim Executed</div>
                <div className="text-lg font-bold">{result.summary.simulated_executed_count}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground mb-1">Avg Delta</div>
                <div className="text-lg font-bold">{fmt(result.summary.avg_delta_usd)}</div>
              </div>
            </div>

            {result.summary.total_recommendations === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg bg-muted/20">
                No recommendations in the past 90 days to simulate.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Actual</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Actual Amt</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Sim Action</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Sim Amt</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Delta</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((row) => (
                      <tr key={row.recommendation_id} className={`border-b ${rowColor(row)}`}>
                        <td className="px-3 py-2 font-mono">
                          {row.created_at.split('T')[0]}
                        </td>
                        <td className="px-3 py-2 capitalize">{row.action}</td>
                        <td className="px-3 py-2">{fmt(row.recommended_amount_usd)}</td>
                        <td className="px-3 py-2 capitalize">{row.simulated_action}</td>
                        <td className="px-3 py-2">{fmt(row.simulated_amount_usd)}</td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-1">
                            <DeltaIcon delta={row.delta_usd} />
                            {fmt(row.delta_usd)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">
                          {row.counterfactual_note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
