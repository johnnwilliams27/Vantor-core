import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';
import { getActiveTreasuryRule, buildTreasurySnapshot } from '@/lib/treasury/rules-engine';
import { generateCashFlowForecast } from '@/lib/treasury/predictions';
import { generateForecastSummary } from '@/lib/treasury/claude';
import { checkRateLimit } from '@/lib/api/rate-limit';

const schema = z.object({
  lookahead_days: z.number().int().min(7).max(365).default(30),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  // 10 forecast generations per hour per user
  if (!checkRateLimit('treasury-forecast', session.user.id, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again in an hour.' }, { status: 429 });
  }

  let body: unknown = {};
  try {
    const text = await req.text();
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
    // Require an active rule to exist
    const rule = await getActiveTreasuryRule(supabase, userId);
    if (!rule) {
      return NextResponse.json(
        { error: 'No active treasury rule found. Create a rule before generating a forecast.' },
        { status: 422 }
      );
    }

    const [snapshot, forecastPoints] = await Promise.all([
      buildTreasurySnapshot(supabase, userId),
      generateCashFlowForecast(supabase, userId, lookahead_days),
    ]);

    const dangerDays = forecastPoints.filter((p) => p.isBelow).length;
    const worstProjectedBalance = forecastPoints.reduce(
      (min, p) => Math.min(min, p.projectedBalanceUsd),
      Infinity
    );
    const totalObligationsInWindow = forecastPoints.reduce(
      (sum, p) => sum + p.obligationsDueUsd,
      0
    );

    const summaryResult = await generateForecastSummary({
      lookaheadDays: lookahead_days,
      currentBankBalanceUsd: snapshot.totalBankBalanceUsd,
      forecastPoints,
      dangerDays,
      worstProjectedBalance: worstProjectedBalance === Infinity ? 0 : worstProjectedBalance,
      totalObligationsInWindow,
    });

    // Upsert forecast (one row per user_id + lookahead_days)
    const { data: forecast, error } = await supabase
      .from('treasury_forecasts')
      .upsert(
        {
          user_id: userId,
          enterprise_id: session.user.enterprise_id,
          lookahead_days,
          forecast_data: forecastPoints,
          ai_summary: summaryResult.reasoning,
          generated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,lookahead_days' }
      )
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await writeAuditLog({
      userId,
      action: 'treasury_forecast_generate',
      entityType: 'treasury_forecast',
      entityId: forecast.id,
      details: { lookahead_days, dangerDays, totalObligationsInWindow },
    });

    return NextResponse.json({ data: forecast }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
