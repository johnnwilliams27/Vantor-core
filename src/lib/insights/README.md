# Treasury Insights Engine

The "intelligence" half of the agentic treasury platform. A continuous
analysis loop that watches treasury state, the on-chain yield universe,
and forward cash flow — and surfaces structured recommendations to the
treasurer for review and action.

**This engine never moves money.** It produces insights; the rules engine
and execution layer handle anything that touches funds. Every actionable
insight carries a policy engine verdict.

## Architectural principles

1. **Insights are recommendations, not actions.** Treasurer reviews and approves.
2. **Every insight is explainable.** Structured rationale + supporting market data + (for critical) Claude-generated narrative.
3. **Risk profile is a first-class input.** Shapes which detectors run, which thresholds apply, which venues are eligible.
4. **Insights respect the policy engine.** Actionable recommendations are simulated through `evaluateInsightAction` before surfacing.
5. **Forward-looking, not just current-state.** Detectors that need a forward view consume forecast queries.
6. **Deduplicate aggressively.** Insight fatigue is the biggest failure mode — cooldowns and dedup keys prevent spam.
7. **Inline triggers for responsiveness, cron for depth.** (Inline triggers land after the foundation detectors are stable.)
8. **Venue category determines applicable logic.** Tokenized MMFs are not interchangeable with DeFi vaults. TVL-based concentration math applies to DeFi only.

## Module layout

```
src/lib/insights/
├── README.md                       — this file
├── types.ts                        — InsightType, Severity, State, ProposedAction, PolicyVerdict
├── risk-profiles.ts                — Conservative/Balanced/Growth presets + per-tier overrides
├── store.ts                        — dedup-aware persistence, state transitions, cooldowns
├── yield-universe.ts               — filter pipeline + TVL-based concentration math
├── policy-gate.ts                  — wrapper around the policy engine's evaluate() (currently a stub)
├── run.ts                          — Promise.allSettled orchestration for all detectors
└── detectors/
    ├── types.ts                    — Detector interface + DetectorContext
    ├── registry.ts                 — ALL_DETECTORS array
    ├── concentration.ts            — Concentration Risk detector (v1, shipped)
    ├── concentration.test.ts       — Unit tests
    ├── liquidity.ts                — Liquidity & Safety Buffer (deferred; soft-blocked on forecast-analytics)
    └── yield-rebalance.ts          — Yield Rebalance (deferred; soft-blocked on policy-engine types)

src/app/api/insights/
├── route.ts                        — GET list, with state filter + cursor pagination
└── [id]/route.ts                   — GET single + PATCH state (view/dismiss/acted_on)

src/app/api/cron/insights-engine/
└── route.ts                        — 15-minute cron orchestrator

supabase/migrations/0037_treasury_insights.sql
```

## The three v1 detectors

### 1. Concentration Risk (shipped)

Monitors treasury composition against risk-profile concentration limits.
Fires `concentration_warning` at 80% of cap and `concentration_breach`
over cap across four axes:

- **Per-vault** (DeFi): customer position vs `min(TVL * profilePct, profileMaxUsd)`
- **Per-curator** (DeFi vaults, Growth profile only): % of satellite AUM in one curator
- **Per-issuer** (MMFs): % of primary allocation in one issuer
- **Per-chain**: % of total yield AUM on one chain (skips single-chain portfolios)

No external dependencies — unblocked as of v1 merge.

### 2. Liquidity & Safety Buffer (deferred)

**Soft-blocked on `feature/forecast-analytics`.** Needs the forecast query
interface (`getProjectedMinBalance`, `areObligationsCovered`, `getObligationsDueInWindow`)
to reason about forward liquidity. Merges to `proactive-ai` once forecast-analytics
ships that interface.

Will fire:
- `liquidity_below_buffer` when projected minimum drops below safety buffer
- `liquidity_idle_cash` when balances exceed buffer + obligations by a configurable margin

Treats tokenized MMFs as near-cash but weights them by `time_to_cash_hours`
from venue metadata (BUIDL T+0 > BENJI T+1).

### 3. Yield Rebalance (deferred)

**Soft-blocked on `feature/policy-engine` types landing on master.** Needs
the real `Verdict`/`EvaluationResult` types so every actionable
recommendation carries a true policy decision.

Will fire:
- `yield_drop` when a position's APY drops materially below alternatives (100bps gap >24h)
- `yield_opportunity` for better alternatives on currently-deployed capital
- `yield_idle_opportunity` for idle cash above safety buffer

Core behavior: **cross-category comparison**. Surfaces "your USDC in Aave V3
yields 2.4%; Spiko USD yields 5.0%; recommend rebalancing $X. No additional
smart contract risk." Runs concentration cap check before surfacing to
avoid recommending positions the vault can't absorb.

## Risk profiles

Three presets with yield-aware satellite allocation and per-tier overrides:

| Profile | Default split | Yield premium trigger | Per-vault cap |
|---|---|---|---|
| Conservative | 100% primary | 50bps | 5% of TVL or $10M |
| Balanced | 70/30 | 100bps | 7.5% of TVL or $15M |
| Growth | 30/70 | 0bps (parity OK) | 10% of TVL or $20M |

### Per-tier overrides

Larger customers can't absorb small-vault capacity, so AUM tier overrides
the defaults:

| | Conservative | Balanced | Growth |
|---|---|---|---|
| Starter / Growth-tier | base | base | base |
| **Scale** ($30-70M) | base | 70/30 fixed | 50/50 |
| **Enterprise** ($250M+) | 100/0 forced | 80/20 | 60/40 |

### Cross-profile vault disqualifiers

A satellite vault is excluded from the eligible universe if:
- TVL below profile threshold
- Incident within profile disqualifier window (12mo Conservative / 6mo Balanced / 3mo Growth)
- Curator is on the contagion blacklist (Stream Finance, Resolv — Conservative/Balanced)
- Status is not `live`

## Data source quality tiers

Every APY that feeds the detectors carries a source-quality tier:

| Tier | Source | Examples | Actionable? |
|---|---|---|---|
| 1 | On-chain authoritative | Aave V3, Compound V3, Sky | Yes |
| 2 | Protocol API | Morpho Steakhouse, Morpho Reservoir, Kamino Lend, Ondo USDY | Yes |
| 3 | Derived (modeled) | Kamino Multiply (supply × 2.5) | **NO — display only** |
| 4 | Reference (seed values) | All coming_soon MMFs (BUIDL, OUSG, BENJI, USTB, USYC, Spiko USD) | **NO — informational only** |

The Yield Rebalance detector **must not** generate actionable
recommendations based on tier 3 or tier 4 data. The yield universe
service tags each venue with its tier and sets `nonActionableReason`
accordingly.

**Staleness guard:** if a rate's `fetched_at` is older than 10 minutes,
the insight's `dataFreshness` is set to `stale_over_10min` and severity
is downgraded. If a rate moved >100bps in a single refresh cycle, the
cycle flags it rather than auto-firing (TODO — wire the rate-change
detector in a follow-up).

## Insight lifecycle

```
created → new → viewed → [dismissed | acted_on]
                 ↓
              expired (auto, 48h TTL)
```

- **new**: freshly created by the cron, not yet seen by any user
- **viewed**: user has opened the feed (marks timestamp, no cooldown)
- **dismissed**: user chose to dismiss; the `dedup_key` is locked until `cooldown_until`
- **acted_on**: user took the recommended action (or an equivalent)
- **expired**: 48h old without any user action

State transitions are tracked in `audit_logs` via `insight_view`,
`insight_dismiss`, `insight_acted_on`, and `insight_expire` audit actions.

## Deduplication

Every insight has a stable `dedup_key` derived from the detector name
and the triggering parameters. Examples:

- `concentration_breach:per_vault:morpho_steakhouse`
- `concentration_warning:per_issuer:BlackRock`
- `yield_opportunity:aave_v3:USDC:spiko_usd` (v1.5)

Before creating a new insight, the store calls `isDuplicate()` which
checks for any existing insight with:
1. The same `dedup_key` AND an active state (`new`/`viewed`), OR
2. The same `dedup_key` in dismissed state with a `cooldown_until` in the future

Default cooldown windows by type:

| Insight type | Cooldown |
|---|---|
| liquidity_below_buffer | 6h  (critical — re-surface quickly) |
| liquidity_idle_cash | 72h |
| yield_drop | 24h |
| yield_opportunity | 48h |
| yield_idle_opportunity | 72h |
| concentration_warning | 48h |
| concentration_breach | 12h |

## Cron orchestrator

Runs every 15 minutes via `/api/cron/insights-engine` (see `vercel.json`).
Per cycle:

1. Expire stale insights past `expires_at`
2. List active enterprises (skipping test enterprises)
3. For each enterprise:
   - Build `TreasurySnapshot` (bank + crypto + yield positions)
   - Build `YieldUniverseView` for the customer's primary asset
   - Resolve risk profile + AUM tier (v1 hardcoded to `balanced` / `scale`, TODO)
   - Assemble `DetectorContext`
   - Call `runAllDetectors(ctx)` — Promise.allSettled across all detectors
   - For each detected insight: run policy gate, call `createInsight()` (dedup-aware)
   - Fire notification for `critical` / `warning` severity via `NotificationService`
4. Write a cycle-level audit log entry

**Cadence choice (Hobby tier):** 15 minutes balances responsiveness
against Vercel Hobby cron limits. Pro tier could move to 10 or 5 min.

## Notifications

New notification event types (auto-appear in the user settings UI):

- `insight_critical` — Critical severity, respects per-user email/slack/in-app
- `insight_warning` — Warning severity, same

Info-level insights are NOT notified — they live in the UI feed only to
avoid fatigue. The cron orchestrator calls `NotificationService.notify()`
with `_emailHtml` and `_emailSubject` in metadata. Slack templating for
insights is a follow-up.

## Policy engine swap procedure

The current `policy-gate.ts` uses a local stub that returns
`require_approval` for every action. This is correct per the policy
engine invariant that AI-initiated movements never auto-execute.

When `feature/policy-engine` lands on master with its types available at
`@/lib/policy/types/*`:

1. Update `src/lib/insights/types.ts` to import `Verdict` from `@/lib/policy/types/verdict` instead of defining it locally
2. Replace the body of `evaluateInsightAction` in `policy-gate.ts`:
   ```typescript
   import { evaluate } from '@/lib/policy/engine';
   import { buildContext } from '@/lib/policy/context';

   export async function evaluateInsightAction(action: ProposedAction): Promise<InsightPolicyResult> {
     const movement = toMovement(action);
     const context = await buildContext(movement);
     const result = await evaluate(movement, context);
     return { verdict: result.verdict, reason: result.reason_codes.join(', ') };
   }
   ```
3. Run tests — detector tests should pass unchanged since the interface contract hasn't shifted
4. Deploy

No detector code needs to change. The swap is intentionally localized
to this single file.

## Extending

### Adding a new detector

1. Create `src/lib/insights/detectors/<name>.ts` implementing the `Detector` interface
2. Add it to `ALL_DETECTORS` in `detectors/registry.ts`
3. Write unit tests in `<name>.test.ts` with hand-crafted `DetectorContext` fixtures
4. If the detector produces a new `InsightType`, add it to the enum in:
   - `src/lib/insights/types.ts`
   - `supabase/migrations/` via a new migration that `ALTER TYPE insight_type ADD VALUE`
   - `src/lib/insights/store.ts` default cooldown map

### Adding a new risk profile

Risk profiles are currently static. If a future PR adds treasurer-customizable
profiles, the pattern to follow is:
1. Define a `customer_risk_profiles` table
2. Store customer choice
3. Read profile + apply per-tier overrides in a new `resolveCustomerProfile(userId)` helper
4. Replace the hardcoded `DEFAULT_RISK_PROFILE` in the cron orchestrator with this lookup

## v1.5 deferred work

Per the gap report and v3 spec:

- **Multi-currency obligations** (Gap 2) — requires schema change to `invoices` and `manual_obligations`
- **Currency Exposure detector** — blocked on Gap 2
- **Obligation/AR-AP detector** — blocked on Gap 2
- **Cash/Stablecoin/MMF ratio detector** — blocked on Gap 2 and multi-currency balance math
- **Protocol/Venue Risk Monitor detector** — not blocked, scope-cut
- **Hypothetical forecast simulation** — new forecast API method
- **Claude reasoning for critical insights** — wire up a `generateCriticalReasoning()` helper similar to `generateTreasuryReasoning()`
- **Inline triggers** — fire relevant detectors on yield deposit/withdraw, new invoice sync, large transfer
- **Rate-change detector** — pick up >100bps APY moves in a single yield-rates cron cycle

## Testing

Unit tests live alongside source files with `.test.ts` suffix. Run via
`npm test` from the repo root (after `npm install` in the main checkout).

Detectors are pure functions of `DetectorContext → DetectedInsight[]`, so
tests build synthetic contexts (see `concentration.test.ts` for the
fixture helpers). No DB, no network, no mocks.

Store tests (dedup, state transitions) require a Supabase test database
and are deferred until a test harness is set up.

## Environment variables

No new env vars. Reuses existing:

- `CRON_SECRET` — for the `/api/cron/insights-engine` auth
- `ANTHROPIC_API_KEY` — for future Claude reasoning (not wired in v1)
- Supabase service role key — for the store's admin client

## References

- Plan file: `C:/Users/John/.claude/plans/snoopy-herding-snail.md`
- Gap report: sections 1–7 of the same plan file
- v3 spec: `C:/Users/John/Downloads/Agentic_Treasury_Insights_v3.md`
- Venues registry: `src/lib/yield/venues/`
- Policy engine worktree: `.worktrees/policy-engine`
- Forecast analytics worktree: `.worktrees/forecast-analytics`
