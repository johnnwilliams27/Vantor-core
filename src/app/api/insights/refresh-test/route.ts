/**
 * POST /api/insights/refresh-test
 *
 * Test-mode-only on-demand insight refresh. Mirrors the per-enterprise
 * loop body in `src/app/api/cron/insights-engine/route.ts` but scoped
 * to a single user's effective (test) enterprise. Returns counts of
 * created and dedup-suppressed insights so the UI can give feedback.
 *
 * Guard: 401 unless the request comes from an authenticated session
 * with the `vantor_test_mode=1` cookie set. This is intentionally
 * narrower than the regular cron — we never want a user triggering
 * detectors against a paid live enterprise from the dashboard.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { cookies } from 'next/headers';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { buildTreasurySnapshot } from '@/lib/treasury/rules-engine';
import { getStablecoinPrices } from '@/lib/treasury/oracle';
import { buildYieldUniverse } from '@/lib/insights/yield-universe';
import { runAllDetectors } from '@/lib/insights/run';
import { createInsight } from '@/lib/insights/store';
import { evaluateInsightActionOrNull } from '@/lib/insights/policy-gate';
import { resolveInsightSettings } from '@/lib/insights/settings';
import { getProfile } from '@/lib/insights/risk-profiles';
import { createForecastService } from '@/lib/forecast/service';
import type { DetectorContext, ForecastBundle } from '@/lib/insights/detectors/types';

const PRIMARY_ASSET = 'USDC' as const;

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    requireRole(session.user.role as any, 'accountant');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isTest = cookies().get('vantor_test_mode')?.value === '1';
  if (!isTest) {
    return NextResponse.json(
      { error: 'Refresh is only available in test mode' },
      { status: 403 },
    );
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ error: 'No enterprise context' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const userId = session.user.id;
  const runStartedAt = new Date();

  try {
    const settings = await resolveInsightSettings(enterpriseId, supabase);
    const { prices } = await getStablecoinPrices();
    const snapshot = await buildTreasurySnapshot(supabase, userId, prices, enterpriseId);
    const yieldUniverse = await buildYieldUniverse(
      {
        riskProfileId: settings.riskProfileId,
        aumTier: settings.aumTier,
        asset: PRIMARY_ASSET,
      },
      supabase,
    );
    const profile = getProfile(settings.riskProfileId);

    let forecast: ForecastBundle | undefined;
    try {
      const forecastSvc = createForecastService({
        enterpriseId,
        db: supabase,
        scenario: 'base',
        consumer: 'alert_eval',
        persist: false,
      });
      const windowDays = 30;
      const [minBal, coverage, obligations] = await Promise.all([
        forecastSvc.getProjectedMinBalance('USD', null, windowDays),
        forecastSvc.areObligationsCovered(windowDays),
        forecastSvc.getObligationsDueInWindow(windowDays),
      ]);
      const totalObligationsUsd = obligations.reduce((sum, o) => sum + o.amount, 0);
      forecast = {
        projectedMinBalance: minBal,
        coverage,
        obligationsInWindow: obligations,
        safetyBufferUsd: totalObligationsUsd * profile.safetyBufferMultiplier,
        windowDays,
      };
    } catch (err) {
      console.warn(
        `[insights/refresh-test] forecast build failed for ${enterpriseId}:`,
        (err as Error).message,
      );
    }

    const ctx: DetectorContext = {
      enterpriseId,
      userId,
      snapshot,
      profile,
      aumTier: settings.aumTier,
      yieldUniverse,
      now: runStartedAt,
      forecast,
    };

    const runSummary = await runAllDetectors(ctx);

    let created = 0;
    let suppressed = 0;
    for (const result of runSummary.results) {
      if (result.error) continue;
      for (const detected of result.insights) {
        try {
          const policyResult = await evaluateInsightActionOrNull(detected.recommendedAction);
          const stored = await createInsight(
            {
              enterpriseId,
              userId,
              detectorName: result.detectorName,
              detected,
              policyVerdict: policyResult?.verdict ?? null,
              policyReason: policyResult?.reason ?? null,
            },
            supabase,
          );
          if (stored) created++;
          else suppressed++;
        } catch (err) {
          console.error(
            `[insights/refresh-test] persist failed for ${enterpriseId}:`,
            (err as Error).message,
          );
        }
      }
    }

    return NextResponse.json({
      data: {
        detectorsRun: runSummary.detectorsRun,
        detectorsFailed: runSummary.detectorsFailed,
        insightsDetected: runSummary.totalInsights,
        insightsCreated: created,
        insightsSuppressed: suppressed,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
