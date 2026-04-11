# Resume — Forecast Analytics Phase A

**Date paused:** 2026-04-10
**Branch:** `feature/forecast-analytics`
**Worktree:** `C:/Users/John/crypto-treasury/.worktrees/forecast-analytics`
**Plan:** `docs/superpowers/plans/2026-04-10-forecast-analytics-phase-a.md`

## State at pause

Tasks 1 and 2 completed under full subagent-driven-development protocol (implementer → spec review → code quality review → fix → re-review). Both have fix commits on top of their initial implementation — the review cycle caught real issues on both.

**Commits on branch** (most recent last):
```
f46b5ae docs(forecast): Phase A design note and implementation plan
33f7baf feat(obligations): extend + rename manual_obligations to obligations (0036)
77ab38c fix(obligations): idempotent rename + legacy inactive status backfill + RLS with-check
9960e8a feat(obligations): add Obligation v2 types + deprecate ManualObligation
7e82e93 fix(obligations): tighten ObligationInput negative tests + VenueKind DRY + ObligationPatch status invariant
```

Plus cherry-picked from `feature/policy-engine`:
```
e50e65e chore(test): install Vitest and add smoke test
a7b25ab refactor(test): simplify alias smoke + inherit Vitest default excludes
```

**Migration 0036 has been applied to dev Supabase (`spllxotyxipdvfpkkvgu`)**. NOT applied to prod (`lfujbwemavgiifkltrag`) — that happens in the final Phase A task (T24) after the full cutover.

**Working tree**: clean except for `tsconfig.tsbuildinfo` (build artifact, ignore).

**Test status** at pause: `npx vitest run` passes (smoke test + T2 types test = 5 tests).

## Task list state

Tasks are tracked via `TaskCreate`/`TaskList` in this project's task system (IDs 1-24). Run `TaskList` at session start to see current state. Summary:

| # | Status | Task |
|---|---|---|
| 1 | ✅ done | Migration 0036 — obligations v2 schema |
| 2 | ✅ done | Obligation v2 TypeScript types |
| 3 | ⏳ pending | Pure recurrence expansion function — **START HERE** |
| 4 | ⏳ pending | ObligationsRepo + test DB helper |
| 5 | ⏳ pending | Obligations CRUD API routes |
| 6 | ⏳ pending | Migration 0037 — treasury_state_snapshots |
| 7 | ⏳ pending | TreasuryStateService |
| 8 | ⏳ pending | Migration 0038 — forecast_snapshots |
| 9 | ⏳ pending | Forecast types module |
| 10 | ⏳ pending | ForecastEngine (pure projection) |
| 11 | ⏳ pending | Scenario resolver |
| 12 | ⏳ pending | ForecastService + persistence |
| 13 | ⏳ pending | Hypothetical mutation-safety tests |
| 14 | ⏳ pending | Migration 0039 — drop treasury_forecasts (unapplied) |
| 15 | ⏳ pending | Replace generateCashFlowForecast with ForecastService adapter |
| 16 | ⏳ pending | Update /api/treasury/forecast GET |
| 17 | ⏳ pending | Treasury AI Forecasting UI cutover |
| 18 | ⏳ pending | Rewire rules-engine to ForecastService |
| 19 | ⏳ pending | Recurring obligation materialization job |
| 20 | ⏳ pending | Apply 0039 + remove dead code |
| 21 | ⏳ pending | Performance benchmark (warn-only) |
| 22 | ⏳ pending | Full suite green (vitest + lint + tsc) |
| 23 | ⏳ pending | Architecture doc + README update |
| 24 | ⏳ pending | Final verification + PR |

## Resume protocol

When you open a fresh session in this worktree:

1. **`cd` into the worktree first**: `C:/Users/John/crypto-treasury/.worktrees/forecast-analytics`. All work happens here — never touch the main checkout at `C:/Users/John/crypto-treasury` (see `CLAUDE.md`).

2. **Invoke the executing-plans skill** — this is the parallel-session variant of subagent-driven-development. Point it at:
   - Plan: `docs/superpowers/plans/2026-04-10-forecast-analytics-phase-a.md`
   - Start at Task 3
   - Full subagent-driven protocol per task: implementer → spec review → code quality review → fix loops until both reviews approve → mark complete → next task.

3. **Read this RESUME file first** so you know:
   - Tasks 1 and 2 are done (don't redo them)
   - The TaskCreate-tracked task IDs (1-24) match the plan's T1-T24 numbering
   - The branch already has cherry-picked vitest infrastructure (don't reinstall)
   - Migration 0036 is already on dev (don't re-apply unless explicitly told)

4. **Observed lessons from T1 and T2**:
   - The quality reviewer is valuable. Both tasks had real issues that only surfaced in review, not in implementer self-review.
   - On DB migrations: always check idempotency for re-apply against a dev instance that already has the first apply. Wrap in `IF EXISTS` / `IF NOT EXISTS` guards.
   - On TS types: `@ts-expect-error` is the idiomatic way to assert "this shape must be rejected" — plain `satisfies` tests are security theater for negative assertions.
   - Vantor error shape per `feedback_vantor_error_design.md`: every API error must have `code`, `message`, `nextStep`, and `traceId` for 5xx. Zod validation errors should include `fields`.

5. **Environment quirks**:
   - The worktree needs `.env.local` to run migrations/tests against dev Supabase. The previous session copied it from the main checkout. It should still be in place. If missing, copy from `C:/Users/John/crypto-treasury/.env.local` — it's gitignored.
   - `npm run migrate supabase/migrations/<file>.sql` applies a single migration file to dev via the Supabase Management API.

6. **Don't push anything to remote** until T24. Don't apply any migration to prod until T24. Don't merge until T24.

## If any task is already half-done

Check `git log` for unexpected commits after `7e82e93`. If any exist, read them to understand what progress was made before dispatching new subagents. Do not assume the state is exactly as described here — verify.

## Context budget guidance

Each task under full protocol costs roughly 3-5 subagent dispatches. With 22 tasks remaining, expect 70-100 subagent calls to complete Phase A. If the session nears its context budget before T24, write a new RESUME doc and hand off to another fresh session at whichever task is currently in progress.
