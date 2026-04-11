import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { generateCashFlowForecast } from '@/lib/treasury/predictions';
import type { TreasuryForecast } from '@/types/database';
import type { ForecastScenario } from '@/lib/forecast/types';

const VALID_SCENARIOS: readonly ForecastScenario[] = ['base', 'conservative', 'stress'] as const;
function parseScenario(raw: string | null): ForecastScenario {
  return (VALID_SCENARIOS as readonly string[]).includes(raw ?? '')
    ? (raw as ForecastScenario)
    : 'base';
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) return NextResponse.json({ data: null });

  const { searchParams } = new URL(req.url);
  const daysRaw = parseInt(searchParams.get('days') ?? '30', 10);
  const days = Number.isInteger(daysRaw) && daysRaw >= 7 && daysRaw <= 365 ? daysRaw : 30;
  const scenario = parseScenario(searchParams.get('scenario'));

  const supabase = createAdminClient();

  try {
    // T16 cutover: stop reading treasury_forecasts. The GET endpoint now
    // live-computes via the T15 adapter on top of ForecastService, which
    // pulls obligations and state from the source tables directly. The
    // treasury_forecasts dependency is fully removed from the read path;
    // the legacy table is only kept alive by the POST (generate) upsert
    // until T20 drops it.
    //
    // `ai_summary` is null here because forecast_snapshots doesn't store
    // the Claude-generated summary — that still lives on the legacy
    // treasury_forecasts row written by POST. The UI (ForecastingPageClient)
    // already treats ai_summary as nullable (`forecast?.ai_summary && ...`),
    // so a null from live compute renders as no-summary, which is the
    // correct transitional behavior until T17 moves the UI off the legacy
    // TreasuryForecast shape entirely.
    const forecastData = await generateCashFlowForecast(
      supabase,
      session.user.id,
      days,
      enterpriseId,
      scenario,
    );

    const now = new Date().toISOString();
    const data: TreasuryForecast = {
      id: `live-${enterpriseId}-${days}`,
      user_id: session.user.id,
      lookahead_days: days,
      forecast_data: forecastData,
      ai_summary: null,
      generated_at: now,
      created_at: now,
    };

    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
