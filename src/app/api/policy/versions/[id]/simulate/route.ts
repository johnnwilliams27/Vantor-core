// src/app/api/policy/versions/[id]/simulate/route.ts
//
// Historical replay. Dry-runs the draft version against the last N
// days of persisted policy_evaluations and reports where the draft
// would change outcomes. "Impact preview" before activation.
//
// LIMITATION: each historical evaluation's context_snapshot captures
// the state that was loaded at that time — including pre-computed
// aggregate_window_results and forecast_snapshot. Those are scoped
// to the THEN-active version's rules, not the draft's. A draft rule
// that references an aggregate window not present in the snapshot
// will see a structured failure in its trace. The engine already
// tolerates these failures in its default-deny path, so the verdict
// still computes; the failure count is returned alongside the
// results so callers can distinguish a clean simulation from one
// that partially degraded.
//
// Full-fidelity simulation (re-loading live context for every
// historical movement) is a separate feature — more expensive and
// blurs the line between "what would have happened" and "what
// would happen now".

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { requireRole } from '@/lib/auth/rbac';
import { EvaluationEngine } from '@/lib/policy/engine/evaluator';
import type { ProposedMovement } from '@/lib/policy/types/movement';
import type { EvaluationContext } from '@/lib/policy/types/context';
import type { PolicyVersionSnapshot } from '@/lib/policy/types/policy-version';
import { PolicyAuthoringService } from '@/lib/policy/authoring/service';

export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) return NextResponse.json({ error: 'No enterprise' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const days = Math.max(1, Math.min(90, Number(body?.days) || 7));
  const limit = Math.max(1, Math.min(500, Number(body?.limit) || 200));

  const supabase = createAdminClient();

  // Load the draft version via the authoring service so we reuse the
  // same hydration logic used elsewhere (returns a PolicyVersionSnapshot
  // with rules + hard_limits + chains already joined).
  const authoring = new PolicyAuthoringService(supabase);
  const actor = {
    user_id: session.user.id,
    role: session.user.role as any,
    enterprise_id: enterpriseId,
  };
  let draft: PolicyVersionSnapshot | null;
  try {
    draft = await authoring.getVersionById(actor, params.id);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
  if (!draft) return NextResponse.json({ error: 'Version not found' }, { status: 404 });

  // Load recent evaluations (compact + full trace). Prefer allow_auto +
  // require_approval outcomes as the interesting simulation set — they
  // represent movements that actually existed. Blocked historical
  // evaluations still simulate, but they're less actionable for
  // change review.
  const windowStart = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data: evalRows, error: evalErr } = await supabase
    .from('policy_evaluations')
    .select('id, proposed_movement, context_snapshot, verdict, created_at')
    .eq('enterprise_id', enterpriseId)
    .gte('created_at', windowStart)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (evalErr) return NextResponse.json({ error: evalErr.message }, { status: 500 });
  const rows = (evalRows ?? []) as Array<{
    id: string;
    proposed_movement: ProposedMovement;
    context_snapshot: EvaluationContext;
    verdict: string;
    created_at: string;
  }>;

  const engine = new EvaluationEngine();

  // Per-movement re-eval. Substitute the draft's policy_version into the
  // historical context; leave everything else (treasury state, aggregate
  // snapshots, forecast) alone so we're actually replaying — not
  // re-querying live state.
  const results: Array<{
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
  }> = [];

  for (const row of rows) {
    const ctx: EvaluationContext = {
      ...row.context_snapshot,
      policy_version: draft,
    };
    let draftVerdict: string;
    let failures = 0;
    try {
      const result = engine.evaluate(row.proposed_movement, ctx);
      draftVerdict = result.verdict;
      // Count rule evaluation failures in the trace — signals
      // aggregate/forecast gaps in the historical snapshot.
      const rulesEvaluated = (result.trace as unknown as { rules_evaluated?: Array<{ failure?: unknown }> }).rules_evaluated ?? [];
      for (const re of rulesEvaluated) if (re.failure) failures += 1;
    } catch (err) {
      // Engine threw — uncommon. Record as an unevaluable row and keep going.
      draftVerdict = 'engine_error';
      failures = -1;
    }

    results.push({
      evaluation_id: row.id,
      historical_verdict: row.verdict,
      draft_verdict: draftVerdict,
      changed: draftVerdict !== row.verdict,
      movement: {
        id: row.proposed_movement.id,
        kind: row.proposed_movement.kind,
        amount: row.proposed_movement.amount,
      },
      rule_failures: failures,
      created_at: row.created_at,
    });
  }

  const summary = {
    total: results.length,
    changed: results.filter((r) => r.changed).length,
    newly_blocked: results.filter((r) => r.changed && (r.draft_verdict === 'block' || r.draft_verdict === 'block_hard_limit')).length,
    newly_held: results.filter((r) => r.changed && r.draft_verdict === 'require_approval').length,
    newly_allowed: results.filter((r) => r.changed && r.draft_verdict === 'allow_auto').length,
    errors: results.filter((r) => r.draft_verdict === 'engine_error').length,
    rows_with_rule_failures: results.filter((r) => r.rule_failures > 0).length,
  };

  return NextResponse.json({
    data: {
      draft_version_id: draft.id,
      draft_version_number: draft.version_number,
      window_days: days,
      summary,
      results,
    },
  });
}
