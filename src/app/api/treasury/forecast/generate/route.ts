import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';
import { getActiveTreasuryRule } from '@/lib/treasury/rules-engine';
import { generateCashFlowForecast } from '@/lib/treasury/predictions';
import { checkRateLimit } from '@/lib/api/rate-limit';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import type { TreasuryForecast } from '@/types/database';

const schema = z.object({
  lookahead_days: z.number().int().min(7).max(365).default(30),
});

/**
 * POST /api/treasury/forecast/generate
 *
 * After T20's cutover the route no longer persists to treasury_forecasts
 * (the table was dropped). It computes a live forecast via the T15 adapter
 * and returns it in the same TreasuryForecast shape the mutation hook
 * expects. The audit log is still written so we have a trail of who
 * triggered generation and what they saw.
 *
 * The legacy ai_summary path (Claude-generated text stored on the forecast
 * row) is intentionally removed. The Treasury AI UI no longer renders it
 * since T16's GET returns null for it, and keeping the Claude call alive
 * would be compute spent on an output no consumer reads. A future phase
 * can reintroduce AI narratives against forecast_snapshots directly.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  // 10 forecast generations per hour per user
  if (!checkRateLimit('treasury-forecast', session.user.id, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again in an hour.' }, { status: 429 });
  }

  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.length > 10_000) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 400 });
    }
    if (text) body = JSON.parse(text);
  } catch {
    // empty body is fine — defaults apply
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { lookahead_days } = parsed.data;
  const supabase = createAdminClient();
  const userId = session.user.id;

  try {
    // Require an active treasury rule. The rule itself isn't consumed
    // by the forecast anymore (that logic moved into ForecastService)
    // but its existence is still the feature gate: no rule = no forecast
    // access, matching the legacy UX.
    const rule = await getActiveTreasuryRule(supabase, userId, enterpriseId);
    if (!rule) {
      return NextResponse.json(
        { error: 'No active treasury rule found. Create a rule before generating a forecast.' },
        { status: 422 }
      );
    }

    const forecastPoints = await generateCashFlowForecast(
      supabase,
      userId,
      lookahead_days,
      enterpriseId ?? '',
    );

    const dangerDays = forecastPoints.filter((p) => p.isBelow).length;
    const worstProjectedBalance = forecastPoints.reduce(
      (min, p) => Math.min(min, p.projectedBalanceUsd),
      Infinity
    );
    const totalObligationsInWindow = forecastPoints.reduce(
      (sum, p) => sum + p.obligationsDueUsd,
      0
    );

    await writeAuditLog({
      userId,
      action: 'treasury_forecast_generate',
      entityType: 'treasury_forecast',
      // entityId intentionally omitted — no treasury_forecasts row to
      // link to post-T20. Future: link to the forecast_snapshots row
      // once the POST persists one.
      details: {
        lookahead_days,
        dangerDays,
        totalObligationsInWindow,
        worstProjectedBalance: worstProjectedBalance === Infinity ? 0 : worstProjectedBalance,
      },
    });

    // Synthesize a TreasuryForecast-shaped response so callers that read
    // data.forecast_data / data.ai_summary keep compiling. Mirrors the
    // pattern from the T16 GET route.
    const now = new Date().toISOString();
    const data: TreasuryForecast = {
      id: `live-${enterpriseId ?? 'none'}-${lookahead_days}`,
      user_id: userId,
      lookahead_days,
      forecast_data: forecastPoints,
      ai_summary: null,
      generated_at: now,
      created_at: now,
    };

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
