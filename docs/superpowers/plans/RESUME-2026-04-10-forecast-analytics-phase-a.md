# Resume — Forecast Analytics Phase A

**Date paused:** 2026-04-10 (second pause of the day)
**Branch:** `feature/forecast-analytics`
**Worktree:** `C:/Users/John/crypto-treasury/.worktrees/forecast-analytics`
**Plan:** `docs/superpowers/plans/2026-04-10-forecast-analytics-phase-a.md`

## State at pause

Tasks 1, 2, and 3 completed under full subagent-driven-development protocol (implementer → spec review → code quality review → fix loops until both approve). T3 had a real review save — see "Lessons from T3" below.

**Commits on branch** (most recent last):
```
f46b5ae docs(forecast): Phase A design note and implementation plan
33f7baf feat(obligations): extend + rename manual_obligations to obligations (0036)
77ab38c fix(obligations): idempotent rename + legacy inactive status backfill + RLS with-check
9960e8a feat(obligations): add Obligation v2 types + deprecate ManualObligation
7e82e93 fix(obligations): tighten ObligationInput negative tests + VenueKind DRY + ObligationPatch status invariant
ba512a8 feat(obligations): pure recurrence expansion function   <-- T3, amended with calendar-month semantics
```

Plus cherry-picked from `feature/policy-engine` (unchanged):
```
e50e65e chore(test): install Vitest and add smoke test
a7b25ab refactor(test): simplify alias smoke + inherit Vitest default excludes
```

**Migration 0036 is on dev Supabase (`spllxotyxipdvfpkkvgu`)**. NOT on prod. Nothing new applied this session.

**Working tree**: clean except `tsconfig.tsbuildinfo` (ignorable build artifact).

**Test status**: `npx vitest run` should pass — smoke (1) + T2 types (4) + T3 recurrence (10) = 15 tests. Last verified green after calendar-month semantics landed.

**Master has advanced** since this branch was cut. Notable commits now on master that are NOT on `feature/forecast-analytics`:
- `0b7f910` refactor(venues): centralize display name + logo path lookups
- `6fabf6b` fix(banking): re-encode bridge.ts as UTF-8
- `2a217a6` feat(payments): disable bank payments with Coming Soon placeholder
- `73e802d` fix(venues): derive ALL_YIELD_PROTOCOLS from the venue registry
- `3331d58` feat(venues): tokenized MMF category + Cash card expansion + DeFi split

These don't collide with Phase A's file list, but T24 (final verification + PR) will need to merge master into the feature branch before opening the PR to make sure nothing regressed.

## Task list state

The in-session task tracker (`TaskList` tool) currently shows T3 as `completed` and T4-T24 as `pending`. Task IDs 1-22 in that tracker map to plan tasks T3-T24 — the tracker was recreated fresh this session so its IDs start at 1 for T3. If a new session starts, either continue using that tracker or re-create per T4-T24; the source of truth is still the plan file.

| Plan # | Status | Task |
|---|---|---|
| T1 | ✅ done | Migration 0036 — obligations v2 schema |
| T2 | ✅ done | Obligation v2 TypeScript types |
| T3 | ✅ done | Pure recurrence expansion function |
| T4 | ⏳ pending | ObligationsRepo + test DB helper — **START HERE** |
| T5 | ⏳ pending | Obligations CRUD API routes |
| T6 | ⏳ pending | Migration 0037 — treasury_state_snapshots |
| T7 | ⏳ pending | TreasuryStateService |
| T8 | ⏳ pending | Migration 0038 — forecast_snapshots |
| T9 | ⏳ pending | Forecast types module |
| T10 | ⏳ pending | ForecastEngine (pure projection) |
| T11 | ⏳ pending | Scenario resolver |
| T12 | ⏳ pending | ForecastService + persistence |
| T13 | ⏳ pending | Hypothetical mutation-safety tests |
| T14 | ⏳ pending | Migration 0039 — drop treasury_forecasts (unapplied) |
| T15 | ⏳ pending | Replace generateCashFlowForecast with ForecastService adapter |
| T16 | ⏳ pending | Update /api/treasury/forecast GET |
| T17 | ⏳ pending | Treasury AI Forecasting UI cutover |
| T18 | ⏳ pending | Rewire rules-engine to ForecastService |
| T19 | ⏳ pending | Recurring obligation materialization job |
| T20 | ⏳ pending | Apply 0039 + remove dead code |
| T21 | ⏳ pending | Performance benchmark (warn-only) |
| T22 | ⏳ pending | Full suite green (vitest + lint + tsc) |
| T23 | ⏳ pending | Architecture doc + README update |
| T24 | ⏳ pending | Merge master in, final verification, apply prod migrations, open PR |

## Resume protocol

1. **`cd` into the worktree first**: `C:/Users/John/crypto-treasury/.worktrees/forecast-analytics`. All work happens here. Never touch the main checkout.

2. **Invoke subagent-driven-development** (preferred) — the full protocol per task: implementer → spec review → code quality review → fix loops until both approve → mark complete → next task. T3 justified the protocol: the plan had a bug the implementer tried to paper over, the quality review cycle would have caught it anyway, and the spec reviewer confirmed the correction was clean.

3. **Read this RESUME file first.** Then proceed to T4 at plan line 586.

4. **T4 starting context**:
   - T4 creates three files: `src/lib/obligations/repo.ts`, `tests/helpers/test-db.ts`, `tests/obligations/repo.test.ts`.
   - T4 tests hit the real dev Supabase — they need `.env.local` in the worktree with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Previous session copied `.env.local` in; if it's gone, copy from `C:/Users/John/crypto-treasury/.env.local` (gitignored).
   - The test helper at `tests/helpers/test-db.ts` will be reused by every integration test from T4 onward. Pay attention to whether the plan's helper cleans up cascading rows correctly — if the obligations table's FK to `enterprises` is not `ON DELETE CASCADE`, the cleanup in the plan will fail and tests will accumulate garbage on dev. Verify the FK behavior in migration 0036 before trusting the cleanup.

## Lessons from T3 (carry forward)

- **The plan had two bugs.** Both were caught before the commit landed cleanly:
  1. Custom-cron error message didn't match the test regex `/cron.*required/i` (wrong word order AND "requires" vs "required"). Legitimate fix.
  2. Quarterly test expected `['2026-04-15', '2026-07-14']` but `2026-07-14` is 4 days past the declared `to = 2026-07-10` window. The implementer initially added a 4-day grace period to paper over it — **this is the anti-pattern to watch for**. The grace period silently widened the semantic meaning of `to`, which would have corrupted every downstream caller (T10 ForecastEngine, T19 materialization job). The fix was to correct the test expected value to `['2026-04-15']` and revert strict `<=`. General rule: when a test expectation doesn't match correct arithmetic, fix the test, not the implementation.
- **The quality reviewer flagged a design concern about monthly drift — resolved before T4.** The original T3 implementation used fixed 30-day intervals for monthly/quarterly/annual, which causes end-of-month drift (Jan 31 → Mar 2 → Apr 1 → drift). The product decision: switch to calendar-month semantics. `monthly` (+1 month), `quarterly` (+3 months), and `annual` (+12 months) now use `addCalendarMonths(base, N * step)` — always computing the Nth occurrence from the base date, never by successive addition. End-of-month days clamp to the last valid day in the target month (Jan 31 → Feb 28 → Mar 31 → Apr 30). Two new tests added (end-of-month clamping + leap-year annual) bring T3's suite to 10 tests. Weekly and biweekly remain on fixed-day intervals — no edge cases there. This is captured in the JSDoc on `expandRecurrence`. T10 ForecastEngine builds on calendar semantics with no further design question outstanding.
- **Review cycle cost**: T3 took ~4 subagent dispatches (implementer + fix + spec review + quality review). Previous estimate of 3-5 per task is holding. With 21 tasks remaining and the controller doing prep work each time, plan for roughly 70-100 total dispatches through T24.

## Environment quirks (unchanged)

- Worktree needs `.env.local` to run integration tests (gitignored — copy from main checkout if missing).
- `npm run migrate supabase/migrations/<file>.sql` applies a single migration to dev via the Supabase Management API.
- `npx vitest run` runs the full vitest suite; `npx vitest run <path>` runs a single file.

## Hard rules (unchanged)

- Don't push to remote until T24.
- Don't apply any migration to prod until T24.
- Don't merge until T24.
- All feature work stays in this worktree. The main checkout (`C:/Users/John/crypto-treasury`) is read-only.

## If this session ran partway into T4

Check `git log` for unexpected commits after `ba512a8`. If any exist, read them to understand what progress was made before dispatching new subagents. Do not assume the state is exactly as described here — verify.
