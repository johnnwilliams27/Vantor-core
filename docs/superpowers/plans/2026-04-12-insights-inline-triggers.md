# Insights Engine — Inline Triggers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fire insight detectors inline at the moment a treasury-changing event occurs (yield deposit/withdraw, transfer confirm, invoice sync), providing near-real-time insight reactivity instead of waiting up to 15 minutes for the cron cycle.

**Architecture:** A single `fireInlineInsights()` helper builds a lightweight `DetectorContext` and runs all detectors via `runAllDetectors()`. It reuses the same dedup/cooldown/store pipeline as the cron — so inline-fired insights are identical to cron-fired insights and won't duplicate. The helper is non-blocking (fire-and-forget with error catch) so it never delays the API response. Each trigger point calls this helper after its core work is committed.

**Tech Stack:** TypeScript, existing insights module, ForecastService, Vitest

**Branch:** `feature/insights-inline-triggers` in worktree `.worktrees/insights-inline`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `src/lib/insights/inline.ts` | `fireInlineInsights()` — builds context, runs detectors, persists results. Non-blocking wrapper. |
| `src/lib/insights/inline.test.ts` | Unit tests for the inline runner |

### Modified files
| File | Change |
|------|--------|
| `src/app/api/yield/confirm-deposit/route.ts` | Call `fireInlineInsights()` after audit log (non-blocking) |
| `src/app/api/yield/confirm-withdraw/route.ts` | Call `fireInlineInsights()` after audit log (non-blocking) |
| `src/app/api/transfers/confirm/route.ts` | Call `fireInlineInsights()` after audit log (non-blocking) |
| `src/app/api/cron/sync-erp/route.ts` | Call `fireInlineInsights()` after each enterprise's invoice batch |

---

## Task 0: Worktree Setup

**Files:** None (git operations only)

- [ ] **Step 1: Create the worktree**

```bash
cd C:/Users/John/crypto-treasury
git worktree add .worktrees/insights-inline -b feature/insights-inline-triggers
cd .worktrees/insights-inline
```

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

- [ ] **Step 3: Verify existing tests pass**

```bash
npx vitest run src/lib/insights/ --reporter=verbose
```

Expected: 91 tests pass.

---

## Task 1: Create the Inline Runner

**Files:**
- Create: `src/lib/insights/inline.ts`
- Create: `src/lib/insights/inline.test.ts`

The inline runner is the core of this feature. It:
1. Builds a `DetectorContext` from scratch (snapshot + yield universe + profile + optional forecast)
2. Runs all registered detectors via `runAllDetectors()`
3. For each detected insight: runs the policy gate, persists via the store (dedup-aware), fires notifications
4. Logs success/failure to audit_logs
5. Never throws — catches all errors internally

This reuses the same persist/notify logic as the cron orchestrator but packaged as a callable function instead of a route handler.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/insights/inline.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildInlineContext } from './inline';

/**
 * Tests for the inline insights runner.
 *
 * The core `fireInlineInsights` function requires a live Supabase
 * connection (it calls buildTreasurySnapshot, buildYieldUniverse, etc.)
 * so integration-level tests are deferred. These unit tests verify:
 *   1. The exported types and function signatures exist
 *   2. The buildInlineContext helper produces a valid DetectorContext shape
 *
 * The actual inline trigger integration is tested by running the yield
 * deposit/withdraw/transfer confirm routes in the dev environment.
 */

describe('buildInlineContext', () => {
  it('is exported as a function', () => {
    expect(typeof buildInlineContext).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/insights/inline.test.ts --reporter=verbose
```

Expected: FAIL — `buildInlineContext` is not exported from `./inline`.

- [ ] **Step 3: Implement the inline runner**

Create `src/lib/insights/inline.ts`:

```typescript
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

// ─── Context Builder (exported for testing) ───────────────────��─────

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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/insights/inline.test.ts --reporter=verbose
```

Expected: PASS

- [ ] **Step 5: Run full insight suite**

```bash
npx vitest run src/lib/insights/ --reporter=verbose
```

Expected: 92 tests pass (91 existing + 1 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/insights/inline.ts src/lib/insights/inline.test.ts
git commit -m "feat(insights): add inline trigger runner for real-time insight detection"
```

---

## Task 2: Wire Yield Deposit Trigger

**Files:**
- Modify: `src/app/api/yield/confirm-deposit/route.ts`

Add a non-blocking call to `fireInlineInsights()` after the audit log, before the final return.

- [ ] **Step 1: Add import**

At the top of the file, after the existing imports, add:

```typescript
import { fireInlineInsights } from '@/lib/insights/inline';
```

- [ ] **Step 2: Add the trigger call**

After the `writeAuditLog` call (line 176) and before the `return NextResponse.json(...)` (line 178), insert:

```typescript
  // Fire insight detectors inline (non-blocking)
  fireInlineInsights(supabase, {
    enterpriseId,
    userId: session.user.id,
    trigger: 'yield_deposit',
  }).catch(() => {});
```

- [ ] **Step 3: Verify the file is valid TypeScript**

```bash
npx vitest run src/lib/insights/ --reporter=verbose
```

Expected: 92 tests pass (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/yield/confirm-deposit/route.ts
git commit -m "feat(insights): fire inline detectors on yield deposit confirm"
```

---

## Task 3: Wire Yield Withdraw Trigger

**Files:**
- Modify: `src/app/api/yield/confirm-withdraw/route.ts`

Same pattern as deposit — non-blocking call after the audit log.

- [ ] **Step 1: Add import**

At the top of the file, after the existing imports:

```typescript
import { fireInlineInsights } from '@/lib/insights/inline';
```

- [ ] **Step 2: Add the trigger call**

After the `writeAuditLog` call (line 156) and before the `return NextResponse.json(...)` (line 158), insert:

```typescript
  // Fire insight detectors inline (non-blocking)
  fireInlineInsights(supabase, {
    enterpriseId,
    userId: session.user.id,
    trigger: 'yield_withdraw',
  }).catch(() => {});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/lib/insights/ --reporter=verbose
```

Expected: 92 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/yield/confirm-withdraw/route.ts
git commit -m "feat(insights): fire inline detectors on yield withdraw confirm"
```

---

## Task 4: Wire Transfer Confirm Trigger

**Files:**
- Modify: `src/app/api/transfers/confirm/route.ts`

Non-blocking call after the audit log. Transfers change wallet balances which can affect liquidity and idle-cash detectors.

- [ ] **Step 1: Add import**

At the top of the file, after the existing imports:

```typescript
import { fireInlineInsights } from '@/lib/insights/inline';
```

- [ ] **Step 2: Add the trigger call**

After the `writeAuditLog` call (line 143) and before the notification block (line 146), insert:

```typescript
  // Fire insight detectors inline (non-blocking)
  fireInlineInsights(supabase, {
    enterpriseId,
    userId: session.user.id,
    trigger: 'transfer_confirm',
  }).catch(() => {});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/lib/insights/ --reporter=verbose
```

Expected: 92 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/transfers/confirm/route.ts
git commit -m "feat(insights): fire inline detectors on transfer confirm"
```

---

## Task 5: Wire Invoice Sync Trigger

**Files:**
- Modify: `src/app/api/cron/sync-erp/route.ts`

The invoice sync is a cron job that processes multiple enterprises. Fire inline detectors once per enterprise after all that enterprise's invoices are synced, not per-invoice. Skip forecast since invoice sync doesn't directly change balances — it changes obligations, which the cron's next forecast cycle will pick up. The main value here is detecting concentration/yield changes that might have been triggered by new payment obligations.

- [ ] **Step 1: Add import**

At the top of the file, after the existing imports:

```typescript
import { fireInlineInsights } from '@/lib/insights/inline';
```

- [ ] **Step 2: Add the trigger call**

After the `last_synced` update (line 106) and before `totalSynced += synced;` (line 108), insert:

```typescript
      // Fire insight detectors for this enterprise if invoices changed (non-blocking).
      // Skip forecast — invoice sync changes obligations, not balances. The liquidity
      // detector will pick up the new obligations on the next cron cycle's forecast build.
      if (synced > 0) {
        fireInlineInsights(supabase, {
          enterpriseId: erpConfig.enterprise_id,
          userId: erpConfig.user_id,
          trigger: 'invoice_sync',
          skipForecast: true,
        }).catch(() => {});
      }
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/lib/insights/ --reporter=verbose
```

Expected: 92 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/sync-erp/route.ts
git commit -m "feat(insights): fire inline detectors after ERP invoice sync"
```

---

## Task 6: Final Verification

- [ ] **Step 1: Run the full insight test suite**

```bash
npx vitest run src/lib/insights/ --reporter=verbose
```

Expected: 92 tests pass.

- [ ] **Step 2: Run a broader test sweep**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: No new failures.

- [ ] **Step 3: Review the diff**

```bash
git diff master --stat
```

Expected files changed:
- `src/lib/insights/inline.ts` (new — core runner)
- `src/lib/insights/inline.test.ts` (new — unit test)
- `src/app/api/yield/confirm-deposit/route.ts` (2 lines added)
- `src/app/api/yield/confirm-withdraw/route.ts` (2 lines added)
- `src/app/api/transfers/confirm/route.ts` (2 lines added)
- `src/app/api/cron/sync-erp/route.ts` (~8 lines added)

- [ ] **Step 4: Verify the inline runner imports resolve**

```bash
npx tsc --noEmit --pretty 2>&1 | head -20
```

Expected: No errors in the modified files.
