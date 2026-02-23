import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  TreasuryRule,
  RecommendationAction,
  SimulationRecordResult,
  SimulationSummary,
  SimulationRun,
} from '@/types/database';
import { getActiveTreasuryRule } from './rules-engine';

export interface RuleOverrides {
  safety_buffer_multiplier?: number;
  obligation_lookahead_days?: number;
  approval_threshold_usd?: number;
  label?: string;
}

/**
 * Pure function that mirrors the rules-engine logic on pre-fetched snapshot values.
 * No DB calls — safe to unit test.
 */
export function simulateRecommendation(
  bankBalanceUsd: number,
  obligationsUsd: number,
  cryptoBalanceUsd: number,
  rule: Pick<TreasuryRule, 'safety_buffer_multiplier' | 'approval_threshold_usd'>
): {
  action: RecommendationAction;
  recommendedAmountUsd: number | null;
  safetyBufferTargetUsd: number;
  surplusUsd: number;
} {
  const multiplier = parseFloat(rule.safety_buffer_multiplier);
  const approvalThreshold = parseFloat(rule.approval_threshold_usd);

  const safetyBufferTargetUsd = obligationsUsd * multiplier;
  const surplusUsd = bankBalanceUsd - safetyBufferTargetUsd;

  let action: RecommendationAction = 'no_action';
  let recommendedAmountUsd: number | null = null;

  if (surplusUsd > 100) {
    action = 'offramp';
    recommendedAmountUsd = Math.round(surplusUsd * 100) / 100;
  } else if (surplusUsd < -100) {
    action = 'onramp';
    const needed = Math.abs(surplusUsd);
    recommendedAmountUsd = Math.round(Math.min(needed, cryptoBalanceUsd) * 100) / 100;
  }

  // Enforce approval threshold (simulation only computes what would be recommended)
  void approvalThreshold;

  return {
    action,
    recommendedAmountUsd,
    safetyBufferTargetUsd,
    surplusUsd,
  };
}

/**
 * Runs a historical simulation over the past 90 days of ai_recommendations.
 * Uses stored snapshot values — no live balance calls.
 * Merges active rule with optional overrides, then persists the run.
 */
export async function runHistoricalSimulation(
  supabase: SupabaseClient,
  userId: string,
  ruleOverrides?: RuleOverrides
): Promise<SimulationRun> {
  // Get active rule
  const activeRule = await getActiveTreasuryRule(supabase, userId);

  // Build effective rule (merge overrides into active rule defaults)
  const effectiveRule = {
    safety_buffer_multiplier: String(
      ruleOverrides?.safety_buffer_multiplier ??
        (activeRule ? parseFloat(activeRule.safety_buffer_multiplier) : 1.5)
    ),
    obligation_lookahead_days:
      ruleOverrides?.obligation_lookahead_days ??
      activeRule?.obligation_lookahead_days ??
      7,
    approval_threshold_usd: String(
      ruleOverrides?.approval_threshold_usd ??
        (activeRule ? parseFloat(activeRule.approval_threshold_usd) : 100000)
    ),
    label: ruleOverrides?.label ?? activeRule?.label ?? 'Simulated Rule',
  };

  // Fetch past 90 days of recommendations
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawRecs, error } = await supabase
    .from('ai_recommendations')
    .select(
      'id, created_at, action, recommended_amount_usd, status, ' +
        'total_bank_balance_usd, total_crypto_balance_usd, obligations_in_window_usd, safety_buffer_target_usd'
    )
    .eq('user_id', userId)
    .gte('created_at', ninetyDaysAgo.toISOString())
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recommendations: any[] = rawRecs ?? [];

  // Build results
  const results: SimulationRecordResult[] = [];
  let totalMissedOpportunity = 0;
  let executedCount = 0;
  let simulatedExecutedCount = 0;
  const deltas: number[] = [];

  for (const rec of recommendations) {
    const bankBalance = parseFloat(rec.total_bank_balance_usd as string);
    const cryptoBalance = parseFloat(rec.total_crypto_balance_usd as string);
    const obligationsUsd = parseFloat(rec.obligations_in_window_usd as string);
    const actualSafetyBuffer = parseFloat(rec.safety_buffer_target_usd as string);
    const actualAmount = rec.recommended_amount_usd
      ? parseFloat(rec.recommended_amount_usd as string)
      : 0;
    const wasExecuted = ['executed', 'auto_executed'].includes(rec.status as string);

    if (wasExecuted) executedCount++;

    const sim = simulateRecommendation(bankBalance, obligationsUsd, cryptoBalance, {
      safety_buffer_multiplier: effectiveRule.safety_buffer_multiplier,
      approval_threshold_usd: effectiveRule.approval_threshold_usd,
    } as any);

    if (sim.action !== 'no_action' && sim.recommendedAmountUsd !== null) {
      simulatedExecutedCount++;
    }

    const actualAction = rec.action as RecommendationAction;
    const simAmount = sim.recommendedAmountUsd;

    // Delta: simulated amount vs actual amount (positive = sim would move more funds)
    let deltaUsd: number | null = null;
    if (simAmount !== null && actualAmount !== null) {
      deltaUsd = simAmount - actualAmount;
      deltas.push(deltaUsd);
    }

    // Missed opportunity: if sim says onramp but actual was no_action or different
    if (
      sim.action === 'onramp' &&
      actualAction !== 'onramp' &&
      simAmount !== null
    ) {
      totalMissedOpportunity += simAmount;
    }

    // Coverage improvement: how much better is sim safety buffer coverage
    const simSafetyBuffer = sim.safetyBufferTargetUsd;

    let note = '';
    if (sim.action === actualAction) {
      note = 'Same action as actual';
    } else if (sim.action === 'no_action' && actualAction !== 'no_action') {
      note = 'Sim: no action needed under these rules';
    } else if (sim.action !== 'no_action' && actualAction === 'no_action') {
      note = `Sim: would have recommended ${sim.action}`;
    } else {
      note = `Sim: ${sim.action} vs actual: ${actualAction}`;
    }

    results.push({
      recommendation_id: rec.id as string,
      created_at: rec.created_at as string,
      action: actualAction,
      recommended_amount_usd: actualAmount,
      status: rec.status as any,
      actual_bank_balance_usd: bankBalance,
      actual_obligations_usd: obligationsUsd,
      actual_safety_buffer_usd: actualSafetyBuffer,
      simulated_action: sim.action,
      simulated_amount_usd: simAmount,
      simulated_safety_buffer_usd: simSafetyBuffer,
      delta_usd: deltaUsd,
      was_executed: wasExecuted,
      counterfactual_note: note,
    });
  }

  const totalRecs = recommendations.length;
  const avgDeltaUsd =
    deltas.length > 0
      ? Math.round((deltas.reduce((s, d) => s + d, 0) / deltas.length) * 100) / 100
      : null;

  // Coverage improvement %: compare simulated vs actual executed counts
  const coverageImprovementPct =
    totalRecs > 0 && executedCount < simulatedExecutedCount
      ? Math.round(((simulatedExecutedCount - executedCount) / totalRecs) * 100 * 100) / 100
      : null;

  const summary: SimulationSummary = {
    total_recommendations: totalRecs,
    executed_count: executedCount,
    simulated_executed_count: simulatedExecutedCount,
    avg_delta_usd: avgDeltaUsd,
    total_missed_opportunity_usd: Math.round(totalMissedOpportunity * 100) / 100,
    coverage_improvement_pct: coverageImprovementPct,
  };

  const ruleSnapshot = {
    safety_buffer_multiplier: parseFloat(effectiveRule.safety_buffer_multiplier),
    obligation_lookahead_days: effectiveRule.obligation_lookahead_days,
    approval_threshold_usd: parseFloat(effectiveRule.approval_threshold_usd),
    label: effectiveRule.label,
  };

  // Persist to simulation_runs
  const { data: runData, error: insertError } = await supabase
    .from('simulation_runs')
    .insert({
      user_id: userId,
      rule_snapshot: ruleSnapshot,
      results,
      summary,
    })
    .select()
    .single();

  if (insertError) throw new Error(insertError.message);

  return runData as unknown as SimulationRun;
}
