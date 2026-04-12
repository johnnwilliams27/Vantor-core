/**
 * Treasury Insights Engine cron orchestrator.
 *
 * Runs every 15 minutes (see vercel.json) — the "living breathing" heartbeat
 * that keeps the AI watching the treasury state. For each enterprise with
 * an active treasury rule:
 *
 *   1. Build the TreasurySnapshot (bank + crypto + yield positions)
 *   2. Build the YieldUniverseView for their primary asset (USDC)
 *   3. Resolve risk profile + AUM tier
 *   4. Assemble DetectorContext
 *   5. Run all registered detectors via runAllDetectors()
 *   6. For each detected insight: run policy gate, persist via store
 *      (dedup-aware), fire notifications for critical/warning severity
 *   7. Expire stale insights past their expires_at
 *
 * v1 runs only the Concentration detector. Liquidity and Yield Rebalance
 * register later when their dependencies land (forecast-analytics for
 * forecast queries, feature/policy-engine types for the policy gate).
 *
 * Risk profile and AUM tier are currently hardcoded to 'balanced' /
 * 'scale' for v1. A follow-up PR will read these from a new
 * customer_insight_settings table or extend treasury_rules.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/logger';
import { buildTreasurySnapshot } from '@/lib/treasury/rules-engine';
import { getStablecoinPrices } from '@/lib/treasury/oracle';
import { buildYieldUniverse } from '@/lib/insights/yield-universe';
import { runAllDetectors } from '@/lib/insights/run';
import { createInsight } from '@/lib/insights/store';
import { expireStaleInsights } from '@/lib/insights/store';
import { evaluateInsightActionOrNull } from '@/lib/insights/policy-gate';
import { NotificationService } from '@/lib/notifications/service';
import { createForecastService } from '@/lib/forecast/service';
import type { DetectorContext, ForecastBundle } from '@/lib/insights/detectors/types';
import type { RiskProfileId, AumTier } from '@/lib/insights/types';
import { getProfile } from '@/lib/insights/risk-profiles';
import type { TreasuryRule } from '@/types/database';
import type { NotificationEventType } from '@/types/notifications';

const BATCH_SIZE = 50;

/**
 * v1 defaults until per-customer insight settings exist.
 * Follow-up PR will read these from a customer_insight_settings table.
 */
const DEFAULT_RISK_PROFILE: RiskProfileId = 'balanced';
const DEFAULT_AUM_TIER: AumTier = 'scale';
const PRIMARY_ASSET = 'USDC' as const;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const runStartedAt = new Date();

  // Top-of-cycle sweep: expire any stale insights past expires_at
  let expired = 0;
  try {
    expired = await expireStaleInsights(supabase);
  } catch (err) {
    console.error('[cron/insights-engine] expiry sweep failed:', err);
  }

  // Exclude test enterprises
  const { data: testEnts } = await supabase
    .from('enterprises')
    .select('id')
    .eq('is_test_enterprise', true);
  const testEntIds = (testEnts ?? []).map((e) => e.id);

  // Get all active treasury rules. One treasury_rule per enterprise/user.
  let query = supabase
    .from('treasury_rules')
    .select('*, user_profiles!inner(id, enterprise_id, subscription_tier)')
    .eq('is_active', true)
    .limit(BATCH_SIZE);

  if (testEntIds.length > 0) {
    query = query.not('enterprise_id', 'in', `(${testEntIds.join(',')})`);
  }

  const { data: rules, error } = await query;

  if (error) {
    console.error('[cron/insights-engine]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!rules?.length) {
    return NextResponse.json({
      enterprisesProcessed: 0,
      insightsCreated: 0,
      expired,
      message: 'No active treasury rules found',
    });
  }

  // Fetch stablecoin prices once for the cycle
  const { prices } = await getStablecoinPrices();

  let enterprisesProcessed = 0;
  let enterprisesFailed = 0;
  let insightsCreated = 0;
  let insightsSuppressed = 0; // suppressed by dedup/cooldown
  let detectorFailures = 0;

  for (const ruleRow of rules) {
    const rule = ruleRow as TreasuryRule & {
      user_profiles: { id: string; enterprise_id: string; subscription_tier: string };
    };
    const userId = rule.user_id;
    const enterpriseId = rule.user_profiles.enterprise_id;

    try {
      // 1. Build the treasury snapshot
      const snapshot = await buildTreasurySnapshot(
        supabase,
        userId,
        prices,
        enterpriseId,
      );

      // 2. Build the yield universe view for the customer's primary asset
      const yieldUniverse = await buildYieldUniverse(
        {
          riskProfileId: DEFAULT_RISK_PROFILE,
          aumTier: DEFAULT_AUM_TIER,
          asset: PRIMARY_ASSET,
        },
        supabase,
      );

      // 3. Resolve the profile
      const profile = getProfile(DEFAULT_RISK_PROFILE);

      // 2b. Build forecast data for the liquidity detector.
      // Graceful: if forecast fails (no obligations, no state), skip it.
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
          `[cron/insights-engine] forecast build failed for ${enterpriseId}, skipping liquidity detector:`,
          (err as Error).message,
        );
      }

      // 4. Assemble detector context
      const ctx: DetectorContext = {
        enterpriseId,
        userId,
        snapshot,
        profile,
        aumTier: DEFAULT_AUM_TIER,
        yieldUniverse,
        now: runStartedAt,
        forecast,
      };

      // 5. Run all detectors
      const runSummary = await runAllDetectors(ctx);
      detectorFailures += runSummary.detectorsFailed;

      // 6. For each detected insight, policy-gate and persist
      for (const result of runSummary.results) {
        if (result.error) continue;

        for (const detected of result.insights) {
          try {
            // Run the proposed action (if any) through the policy gate
            const policyResult = await evaluateInsightActionOrNull(
              detected.recommendedAction,
            );

            const stored = await createInsight(
              {
                enterpriseId,
                userId,
                detectorName: result.detectorName,
                detected,
                policyVerdict: policyResult?.verdict ?? null,
                policyReason: policyResult?.reason ?? null,
                // Claude reasoning is deferred — critical insights get it
                // in a later phase. For now, template summary only.
              },
              supabase,
            );

            if (stored) {
              insightsCreated++;

              // Fire notification for critical/warning insights. Info-level
              // insights stay in the UI feed only — no email/slack spam.
              // NotificationService respects per-user email/slack/in-app
              // preferences from the notification_preferences table.
              if (detected.severity === 'critical' || detected.severity === 'warning') {
                const eventType: NotificationEventType =
                  detected.severity === 'critical' ? 'insight_critical' : 'insight_warning';

                const emailSubject =
                  detected.severity === 'critical'
                    ? `Critical Treasury Insight: ${detected.title}`
                    : `Treasury Insight: ${detected.title}`;

                // Minimal HTML email body — a proper template can be added later.
                // For v1 we just surface the title and summary so the user knows
                // to check the dashboard.
                const emailHtml = `
                  <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: 0 auto;">
                    <h2 style="color: ${detected.severity === 'critical' ? '#dc2626' : '#d97706'}; margin: 0 0 12px;">
                      ${detected.title}
                    </h2>
                    <p style="color: #334155; line-height: 1.6; margin: 0 0 16px;">
                      ${detected.summary}
                    </p>
                    <a href="${process.env.NEXTAUTH_URL ?? 'https://www.vantor.xyz'}/treasury"
                       style="display: inline-block; background: #19595b; color: white; padding: 10px 20px;
                              border-radius: 6px; text-decoration: none; font-weight: 600;">
                      Review in Vantor
                    </a>
                  </div>
                `;

                NotificationService.notify({
                  eventType,
                  enterpriseId,
                  title: detected.title,
                  body: detected.summary,
                  link: '/treasury',
                  metadata: {
                    insightId: stored.id,
                    detectorName: result.detectorName,
                    insightType: detected.type,
                    severity: detected.severity,
                    _emailSubject: emailSubject,
                    _emailHtml: emailHtml,
                    // Slack function intentionally omitted for v1 — a
                    // dedicated insights Slack template is a follow-up.
                  },
                  actorId: userId,
                }).catch((err) => {
                  console.error(
                    `[cron/insights-engine] notification failed for insight ${stored.id}:`,
                    err,
                  );
                });
              }
            } else {
              insightsSuppressed++;
            }
          } catch (err) {
            console.error(
              `[cron/insights-engine] Failed to persist insight for enterprise ${enterpriseId}:`,
              err,
            );
          }
        }
      }

      enterprisesProcessed++;
    } catch (err) {
      enterprisesFailed++;
      console.error(
        `[cron/insights-engine] Enterprise ${enterpriseId} failed:`,
        err,
      );
    }
  }

  // Cycle-level audit log (one entry per run, not per enterprise)
  try {
    await writeAuditLog({
      action: 'insight_create',
      entityType: 'insights_engine_cycle',
      details: {
        enterprises_processed: enterprisesProcessed,
        enterprises_failed: enterprisesFailed,
        insights_created: insightsCreated,
        insights_suppressed: insightsSuppressed,
        detector_failures: detectorFailures,
        expired_sweep: expired,
        started_at: runStartedAt.toISOString(),
        finished_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    // Non-blocking
    console.error('[cron/insights-engine] audit log failed:', err);
  }

  console.log(
    `[cron/insights-engine] enterprises=${enterprisesProcessed} failed=${enterprisesFailed} insights=${insightsCreated} suppressed=${insightsSuppressed} detector_failures=${detectorFailures} expired=${expired}`,
  );

  return NextResponse.json({
    enterprisesProcessed,
    enterprisesFailed,
    insightsCreated,
    insightsSuppressed,
    detectorFailures,
    expired,
  });
}
