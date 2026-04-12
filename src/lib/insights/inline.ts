/**
 * Inline Insights Trigger.
 *
 * Fires insight detectors immediately after a treasury-changing event
 * (yield deposit/withdraw, transfer confirm, invoice sync) instead of
 * waiting for the 15-minute cron cycle.
 *
 * Uses the same dedup/cooldown/store/notification pipeline as the cron
 * orchestrator — inline-fired insights are indistinguishable from
 * cron-fired insights and will not duplicate.
 *
 * `fireInlineInsights()` is non-blocking: callers should fire-and-forget
 * with `.catch()`. It never throws — all errors are caught and logged.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildTreasurySnapshot } from '@/lib/treasury/rules-engine';
import { getStablecoinPrices } from '@/lib/treasury/oracle';
import { buildYieldUniverse } from '@/lib/insights/yield-universe';
import { runAllDetectors } from '@/lib/insights/run';
import { createInsight } from '@/lib/insights/store';
import { evaluateInsightActionOrNull } from '@/lib/insights/policy-gate';
import { NotificationService } from '@/lib/notifications/service';
import { getProfile } from '@/lib/insights/risk-profiles';
import { createForecastService } from '@/lib/forecast/service';
import { writeAuditLog } from '@/lib/audit/logger';
import type { DetectorContext, ForecastBundle } from '@/lib/insights/detectors/types';
import type { RiskProfileId, AumTier } from '@/lib/insights/types';
import type { NotificationEventType } from '@/types/notifications';

// ─── Defaults (same as cron) ────────────────────────────────────────

const DEFAULT_RISK_PROFILE: RiskProfileId = 'balanced';
const DEFAULT_AUM_TIER: AumTier = 'scale';
const PRIMARY_ASSET = 'USDC' as const;
const FORECAST_WINDOW_DAYS = 30;

// ─── Types ──────────────────────────────────────────────────────────

export interface InlineTriggerInput {
  enterpriseId: string;
  userId: string;
  /** What caused this trigger — logged to audit_logs for traceability. */
  trigger: 'yield_deposit' | 'yield_withdraw' | 'transfer_confirm' | 'invoice_sync';
  /** Optional: skip forecast for speed (e.g., invoice sync doesn't need it). */
  skipForecast?: boolean;
}

// ─── Context Builder (exported for testing) ─────────────────────────

/**
 * Build a DetectorContext for inline use. Same shape as the cron
 * orchestrator builds, but callable from any code path.
 */
export async function buildInlineContext(
  supabase: SupabaseClient,
  input: InlineTriggerInput,
): Promise<DetectorContext> {
  const { enterpriseId, userId } = input;

  // 1. Treasury snapshot
  const { prices } = await getStablecoinPrices();
  const snapshot = await buildTreasurySnapshot(supabase, userId, prices, enterpriseId);

  // 2. Yield universe
  const yieldUniverse = await buildYieldUniverse(
    { riskProfileId: DEFAULT_RISK_PROFILE, aumTier: DEFAULT_AUM_TIER, asset: PRIMARY_ASSET },
    supabase,
  );

  // 3. Profile
  const profile = getProfile(DEFAULT_RISK_PROFILE);

  // 4. Forecast (optional — skip for speed when caller doesn't need it)
  let forecast: ForecastBundle | undefined;
  if (!input.skipForecast) {
    try {
      const forecastSvc = createForecastService({
        enterpriseId,
        db: supabase,
        scenario: 'base',
        consumer: 'alert_eval',
        persist: false,
      });
      const [minBal, coverage, obligations] = await Promise.all([
        forecastSvc.getProjectedMinBalance('USD', null, FORECAST_WINDOW_DAYS),
        forecastSvc.areObligationsCovered(FORECAST_WINDOW_DAYS),
        forecastSvc.getObligationsDueInWindow(FORECAST_WINDOW_DAYS),
      ]);
      const totalObligationsUsd = obligations.reduce((sum, o) => sum + o.amount, 0);
      forecast = {
        projectedMinBalance: minBal,
        coverage,
        obligationsInWindow: obligations,
        safetyBufferUsd: totalObligationsUsd * profile.safetyBufferMultiplier,
        windowDays: FORECAST_WINDOW_DAYS,
      };
    } catch {
      // Graceful degradation — liquidity detector will skip
    }
  }

  return {
    enterpriseId,
    userId,
    snapshot,
    profile,
    aumTier: DEFAULT_AUM_TIER,
    yieldUniverse,
    now: new Date(),
    forecast,
  };
}

// ─── Main Entry Point ───────────────────────────────────────────────

/**
 * Fire all insight detectors inline. Non-blocking — never throws.
 * Callers should invoke as:
 *
 *   fireInlineInsights(supabase, { enterpriseId, userId, trigger: 'yield_deposit' })
 *     .catch(() => {});
 *
 * The function handles its own error logging via audit_logs.
 */
export async function fireInlineInsights(
  supabase: SupabaseClient,
  input: InlineTriggerInput,
): Promise<{ insightsCreated: number; detectorsFailed: number }> {
  const { enterpriseId, userId, trigger } = input;

  try {
    const ctx = await buildInlineContext(supabase, input);
    const runSummary = await runAllDetectors(ctx);

    let insightsCreated = 0;

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

          if (stored) {
            insightsCreated++;

            if (detected.severity === 'critical' || detected.severity === 'warning') {
              const eventType: NotificationEventType =
                detected.severity === 'critical' ? 'insight_critical' : 'insight_warning';

              const emailSubject =
                detected.severity === 'critical'
                  ? `Critical Treasury Insight: ${detected.title}`
                  : `Treasury Insight: ${detected.title}`;

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
                  trigger,
                  _emailSubject: emailSubject,
                  _emailHtml: emailHtml,
                },
                actorId: userId,
              }).catch(() => {});
            }
          }
        } catch (err) {
          console.error(
            `[insights/inline] persist failed for ${trigger}/${enterpriseId}:`,
            (err as Error).message,
          );
        }
      }
    }

    // Audit trail for the inline trigger
    if (insightsCreated > 0 || runSummary.detectorsFailed > 0) {
      writeAuditLog({
        userId,
        enterpriseId,
        action: 'insight_create',
        entityType: 'insights_inline_trigger',
        details: {
          trigger,
          insights_created: insightsCreated,
          detectors_run: runSummary.detectorsRun,
          detectors_failed: runSummary.detectorsFailed,
        },
      }).catch(() => {});
    }

    return { insightsCreated, detectorsFailed: runSummary.detectorsFailed };
  } catch (err) {
    console.error(`[insights/inline] ${trigger} failed for ${enterpriseId}:`, (err as Error).message);
    return { insightsCreated: 0, detectorsFailed: -1 };
  }
}
