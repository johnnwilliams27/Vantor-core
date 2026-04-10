# Treasury Rules & Approval Policy Engine

**Date:** 2026-04-10
**Status:** Approved
**Replaces:** `src/lib/treasury/rules-engine.ts` and the legacy `ai_recommendations.status='pending_approval'` flow

---

## Overview

Build a versioned, per-enterprise policy engine that sits between every money-movement caller (human UI, agent tool, AI recommendation, scheduled operation) and every execution adapter (crypto transfers, fiat ramps, yield deposits/withdrawals, swaps, bridges, payments). The engine governs which movements can auto-execute, which require human approval, and which must be blocked outright.

This engine is the primary control surface treasurers use to feel safe delegating routine movement to Vantor's agents. It is also the artifact customer CFOs, boards, and auditors inspect to confirm controls exist.

### Core invariants

1. **Default deny.** If no rule explicitly permits a movement, it does not execute. Auto-execution requires an affirmative policy match.
2. **Hard limits are non-negotiable.** Structural limits cannot be overridden by any rule, approval, or agent. A transfer breaching a hard limit is blocked even if a human tries to approve it — they must first raise the limit, which is itself an audited action.
3. **AI/agent-initiated movements never auto-execute.** Regardless of policy match, any movement where `initiator.type ∈ {'ai_recommendation', 'agent'}` receives a verdict floor of `require_approval`. This is a system invariant built into the evaluator, not a user-authored rule.
4. **Approval thresholds gate automation, not just amount.** Above a threshold, the movement leaves the agent's hands and enters human approval. The agent cannot self-approve, cannot retry to find a workaround, and cannot split a transfer to evade the threshold.
5. **Splitting detection is always on.** For every `amount_compare` node on `transfer.amount`, the engine automatically also checks the 24h rolling sum grouped by (initiator, destination). Cannot be disabled.
6. **Every evaluation is auditable forever.** Each evaluation persists the full `EvaluationContext` as a snapshot so traces remain replayable and explainable indefinitely.
7. **Rules are versioned and immutable once active.** Editing a live rule creates a new draft version. A transfer evaluated under rule v3 must always be explainable against rule v3, even after v4 is published.
8. **Simulation reuses the live evaluator structurally.** Not a parallel implementation — the same pure function with a different policy version.
9. **Every error is human-actionable.** Stable reason code + human-readable explanation + user action + trace identifier + structured fields. No generic "blocked" or "failed."
10. **A rule the engine cannot fully evaluate must never let a transfer pass.** Rate failures, forecast outages, or aggregate query failures cause `block` with a specific reason — never silent rule-skipping.

### Scope

**In scope:**
- Domain model, append-only database enforcement, versioning
- Typed condition IR (discriminated union) + evaluator
- Hard limit checker (6 closed limit types)
- Splitting/aggregation detector (always-on + user-authored)
- Forecast interface + stub
- Approval workflow service (full lifecycle, stricter SoD, re-evaluation)
- Simulation engine (shared code path with live)
- Rule authoring API (draft/activate, full validation pipeline)
- Integration gate (single chokepoint for all execution paths)
- UI pages: Policies tab (replacing Treasury Rules), Evaluation Log, Simulation, Version History
- Dashboard widgets: Approvals card, Limit Utilization card
- Treasury AI Overview: Approvals widget, rename of AI Recommendations → AI Insights, removal of Yield Positions summary
- Error catalog
- Migration from existing `treasury_rules` and `ai_recommendations` approval flow

**Out of scope:**
- Treasurer-facing UI polish beyond the functional layouts specified here (design iterations are a separate workstream)
- The agent execution layer itself (this engine governs it)
- Sanctions screening implementation (already exists; consumed as input)
- Cash forecast / lookahead module implementation (separate workstream; this engine consumes the interface and ships with a stub)
- ERP integration (separate)
- Notification channel implementation (calls existing Vantor notification service)
- Cross-movement batching, two-phase commit, dry-run gate mode

---

## 1. Domain model

### Database tables

Nine tables, all prefixed `policy_*`. Six describe policy configuration (versioned, immutable once active). Three describe runtime state and history (append-only). Plus one observability table and one migration-warning table.

#### `policy_policies` — one row per enterprise

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `enterprise_id` | UUID FK → enterprises, UNIQUE | |
| `name` | TEXT | Display name (e.g., "Standard Controls") |
| `active_version_id` | UUID FK → policy_versions, nullable | NULL only during initial bootstrap |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

RLS: enterprise-scoped via existing multi-tenancy pattern.

#### `policy_versions` — immutable snapshots

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `enterprise_id` | UUID FK → enterprises | |
| `version_number` | INTEGER | Sequential per enterprise |
| `status` | TEXT | `draft` \| `active` \| `superseded` |
| `name` | TEXT | Inherited from policy on creation |
| `created_by` | UUID FK → user_profiles | |
| `created_at` | TIMESTAMPTZ | |
| `activated_at` | TIMESTAMPTZ nullable | NULL until activated |
| `activated_by` | UUID FK → user_profiles nullable | |
| `superseded_at` | TIMESTAMPTZ nullable | |
| `superseded_by_version_id` | UUID FK → policy_versions nullable | |

UNIQUE `(enterprise_id, version_number)`.

**Append-only enforcement:** a trigger blocks UPDATEs to rows where `status != 'draft'`, except for the transition to `superseded` (which is only allowed via the activation flow, verified by a session-level flag set by the activation transaction).

#### `policy_rules` — rules by version

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `version_id` | UUID FK → policy_versions | |
| `rule_type` | TEXT | `approval_threshold` \| `counterparty` \| `time_window` \| `lookahead` — UI category hint, not evaluation semantics |
| `name` | TEXT | |
| `rationale` | TEXT | Treasurer-authored "why this rule exists" |
| `condition` | JSONB | Typed condition IR (see §2) |
| `verdict` | TEXT | `allow_auto` \| `require_approval` \| `block` |
| `verdict_chain_id` | UUID FK → policy_approval_chains nullable | Required when verdict=`require_approval` |
| `priority` | INTEGER | Unique within version |
| `created_by` | UUID FK → user_profiles | |
| `created_at` | TIMESTAMPTZ | |

UNIQUE `(version_id, priority)`.

Trigger: UPDATEs/DELETEs forbidden when parent version's status ≠ `draft`.

#### `policy_hard_limits` — typed structural parameters

Hard limits are NOT condition-DSL rows. They are typed numeric/duration parameters with a small closed taxonomy.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `version_id` | UUID FK → policy_versions | |
| `limit_type` | TEXT ENUM | See below |
| `name` | TEXT | Display name |
| `limit_value` | NUMERIC | String-serialized to avoid float loss in JSONB |
| `limit_currency` | TEXT nullable | Asset code for monetary limits, NULL for percentage/duration |
| `scope` | JSONB | `{ asset?, venue?, include_venues? }` |
| `created_by` | UUID FK → user_profiles | |
| `created_at` | TIMESTAMPTZ | |

**Closed set of `limit_type` values in phase 1:**
- `min_cash_reserve_usd`
- `max_single_asset_concentration_pct`
- `max_daily_outflow_usd`
- `max_30day_outflow_usd`
- `obligation_coverage_days`
- `max_native_exposure` (one row per asset; scope specifies which)

Trigger: UPDATEs/DELETEs forbidden when parent version's status ≠ `draft`.
Permission: write access requires `is_policy_admin = true`.

#### `policy_approval_chains` — approval slot definitions

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `version_id` | UUID FK → policy_versions | |
| `name` | TEXT | Display name (e.g., "Dual Executive Approval") |
| `slots` | JSONB | Array of `{ slot_index, minimum_role, label? }` |
| `trigger_condition` | JSONB nullable | Condition IR; when matched, this chain applies |
| `priority` | INTEGER | Chain selection order when multiple match |
| `expiration_hours` | INTEGER DEFAULT 24 | |
| `created_by` | UUID FK → user_profiles | |
| `created_at` | TIMESTAMPTZ | |

#### `policy_approval_requests` — runtime approval queue

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `enterprise_id` | UUID FK → enterprises | |
| `version_id` | UUID FK → policy_versions | Pinned at creation |
| `movement_id` | TEXT | Idempotency key |
| `proposed_movement` | JSONB | Full snapshot |
| `triggered_rule_ids` | UUID[] | Rules that caused this approval |
| `chain_id` | UUID FK → policy_approval_chains | |
| `slot_assignments` | JSONB | Array of `{ slot_index, minimum_role, filled_by, filled_at, justification }` |
| `status` | TEXT | `pending` \| `approved` \| `executed` \| `denied` \| `escalated` \| `cancelled` |
| `denial_reason` | TEXT nullable | `manual` \| `expired` \| `stale_reeval` |
| `expires_at` | TIMESTAMPTZ | |
| `created_by` | UUID FK → user_profiles nullable | NULL for agent/schedule initiators |
| `created_at` | TIMESTAMPTZ | |
| `approved_at` | TIMESTAMPTZ nullable | |
| `resolved_at` | TIMESTAMPTZ nullable | |
| `resolution_notes` | JSONB nullable | |
| `version` | INTEGER DEFAULT 0 | Optimistic lock column |

DELETE forbidden. UPDATEs allowed for lifecycle transitions.

#### `policy_evaluations` — append-only evaluation traces

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `enterprise_id` | UUID FK → enterprises | |
| `version_id` | UUID FK → policy_versions | Pinned |
| `movement_id` | TEXT | |
| `proposed_movement` | JSONB | |
| `context_snapshot` | JSONB | **Full EvaluationContext for replay (Section 7)** |
| `verdict` | TEXT | |
| `trace` | JSONB | Full evaluation trace |
| `canonicalization` | JSONB | Rate + source + timestamp |
| `approval_request_id` | UUID FK → policy_approval_requests nullable | |
| `executed_at` | TIMESTAMPTZ nullable | Populated only after adapter success |
| `execution_ref` | TEXT nullable | Adapter's execution id |
| `created_at` | TIMESTAMPTZ | |

**Append-only trigger:** UPDATEs allowed ONLY on `executed_at` and `execution_ref` fields. All other columns are frozen at INSERT. DELETE forbidden.

Indexes:
- `(enterprise_id, executed_at DESC) WHERE executed_at IS NOT NULL` — for aggregate queries
- `(enterprise_id, created_at DESC)` — for evaluation log browsing
- `(movement_id)` — for idempotency lookups

#### `policy_simulation_runs` — shadow mode results

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `enterprise_id` | UUID FK → enterprises | |
| `draft_version_id` | UUID FK → policy_versions | |
| `window_start` | TIMESTAMPTZ | |
| `window_end` | TIMESTAMPTZ | |
| `status` | TEXT | `running` \| `completed` \| `cancelled` \| `failed` |
| `progress` | JSONB | `{ processed, total }` |
| `result` | JSONB nullable | Capped result payload |
| `failure` | JSONB nullable | |
| `created_by` | UUID FK → user_profiles | |
| `created_at` | TIMESTAMPTZ | |
| `completed_at` | TIMESTAMPTZ nullable | |

#### `policy_activation_events` — append-only activation log

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `enterprise_id` | UUID FK → enterprises | |
| `from_version_id` | UUID FK → policy_versions nullable | NULL for v1 |
| `to_version_id` | UUID FK → policy_versions | |
| `activated_by` | UUID FK → user_profiles | |
| `activated_at` | TIMESTAMPTZ | |
| `reason` | TEXT | Required, min 20 chars |
| `diff_summary` | JSONB | Precomputed diff for history display |
| `actor_source` | TEXT | `customer` \| `vantor_staff` (for is_app_admin actions) |

DELETE and UPDATE forbidden.

#### `policy_forecast_stub_calls` — observability

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `enterprise_id` | UUID | Not FK (engineering observability, not customer data) |
| `method` | TEXT | |
| `args_json` | JSONB | |
| `called_at` | TIMESTAMPTZ | |

No RLS (engineering observability; not customer data).

#### `policy_migration_warnings` — one-shot migration hints

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `enterprise_id` | UUID FK → enterprises | |
| `user_id` | UUID FK → user_profiles nullable | Per-user warnings if applicable |
| `warning_code` | TEXT | |
| `human_readable` | TEXT | |
| `details` | JSONB | |
| `acknowledged_at` | TIMESTAMPTZ nullable | |
| `created_at` | TIMESTAMPTZ | |

### Schema addition to existing tables

**`user_profiles`** — add column:
```sql
ALTER TABLE user_profiles
ADD COLUMN is_policy_admin BOOLEAN NOT NULL DEFAULT false;
```

Scoped per-enterprise (same scoping as existing `role` column). Grants: editing hard limits in drafts, activating policy versions, assigning `is_policy_admin` to other users within the same enterprise. `is_app_admin = true` implicitly satisfies `is_policy_admin` checks (with audit log `actor_source: 'vantor_staff'`).

**`ai_recommendations`** — add column:
```sql
ALTER TABLE ai_recommendations
ADD COLUMN approval_request_id UUID REFERENCES policy_approval_requests(id);
```

Links AI recommendations to their corresponding policy engine approval requests.

---

## 2. Evaluation engine

### Architectural separation: async context loading, pure evaluation

```
┌────────────────────────────────────────────┐
│  PHASE 1 — Context loader (async)          │
│  Loads: treasury state, rates, forecast,   │
│  aggregates, sanctions, counterparty       │
└──────────────────┬─────────────────────────┘
                   │ EvaluationContext (fully hydrated)
                   ▼
┌────────────────────────────────────────────┐
│  PHASE 2 — Evaluator (synchronous, pure)   │
│  Pattern-matches IR, returns verdict+trace │
│  SAME function called by live + simulation │
└────────────────────────────────────────────┘
```

This split enables: (a) simulation reuses the pure evaluator unchanged, (b) unit tests feed fixtures with no DB mocking, (c) the engine never races against mid-evaluation state changes.

### Key TypeScript types

```typescript
// Normalized proposed movement — what the gate builds and passes in
interface ProposedMovement {
  id: string;                           // idempotency key
  kind: MovementKind;                   // 'crypto_transfer' | 'fiat_ramp' | 'yield_deposit'
                                        // | 'yield_withdraw' | 'swap' | 'bridge' | 'payment'
  source: MovementEndpoint;
  destination: MovementEndpoint;
  amount: { amount: string; asset: AssetCode };
  counterparty?: CounterpartyRef;
  initiator: Initiator;
  purpose_code?: string;
  rail?: string;
  metadata?: Record<string, unknown>;
  requested_at: string;                 // ISO timestamp
}

type InitiatorType = 'human' | 'agent' | 'ai_recommendation' | 'schedule';

interface Initiator {
  type: InitiatorType;
  user_id?: string;
  agent_id?: string;
  recommendation_id?: string;
  scheduled_op_id?: string;
}

interface EvaluationContext {
  now: Date;
  enterprise_id: string;
  policy_version: PolicyVersionSnapshot;
  treasury_state: TreasuryState;
  canonicalization: CanonicalizationResult;
  aggregates: AggregateWindowResults;
  sanctions: SanctionsStatus;
  forecast: ForecastSnapshot;
  counterparty?: CounterpartyHistoryRecord;
}

type Verdict = 'allow_auto' | 'require_approval' | 'block' | 'block_hard_limit';

interface EvaluationResult {
  verdict: Verdict;
  trace: EvaluationTrace;
  required_chain?: ResolvedApprovalChain;  // populated iff verdict='require_approval'
  reason_codes: ReasonCode[];
}

interface EvaluationEngine {
  evaluate(movement: ProposedMovement, context: EvaluationContext): EvaluationResult;
}

interface EvaluationContextLoader {
  load(movement: ProposedMovement, enterpriseId: string): Promise<EvaluationContext>;
}
```

### Condition IR — closed discriminated union

9 node kinds. Any expansion requires adding a new kind to the union, which TypeScript exhaustiveness checking flags in every consumer.

```typescript
type Condition =
  | { kind: 'and';    children: Condition[] }
  | { kind: 'or';     children: Condition[] }
  | { kind: 'not';    child: Condition }
  | { kind: 'amount_compare';
      attr: AmountAttribute;   // 'transfer.amount' | 'treasury.position'
                               // | 'treasury.post_position' | 'rolling_sum'
      scope?: AmountScope;
      op: NumericOp;           // '>' | '>=' | '<' | '<=' | '==' | '!=' | 'between'
      value: AmountValue;      // { amount: string, currency: AssetCode } — explicit
      value_upper?: AmountValue }
  | { kind: 'string_compare';
      attr: StringAttribute;   // 'transfer.counterparty_id' | 'transfer.purpose_code'
                               // | 'transfer.initiator_type' | 'transfer.rail' | ...
      op: StringOp;            // '==' | '!=' | 'in' | 'not_in'
      value: string | string[] }
  | { kind: 'time_compare';
      attr: TimeAttribute;
      op: TimeOp;
      value: TimeValue }
  | { kind: 'sanctions_status';
      op: 'in' | 'not_in';
      values: SanctionsStatus[] }
  | { kind: 'forecast_query';
      query: ForecastQueryKind;
      window_days: number;
      scope?: ForecastScope;
      comparator: NumericOp;
      value: AmountValue }
  | { kind: 'aggregate_window';
      window: WindowSpec;
      attr: AggregateAttr;     // 'sum_amount' | 'count' | 'distinct_destinations' | 'distinct_counterparties'
      scope?: AggregateScope;
      op: NumericOp;
      value: AmountValue };
```

### Mapping the spec's 6 rule types to the IR

| Spec rule type | Lives in | Uses condition IR? |
|---|---|---|
| Approval threshold | `policy_rules` | Yes — `amount_compare` or compositions |
| Counterparty | `policy_rules` | Yes — `string_compare` + `sanctions_status` |
| Time-window | `policy_rules` | Yes — `time_compare` |
| Lookahead | `policy_rules` | Yes — `forecast_query` |
| Hard limit | `policy_hard_limits` | **No** — typed structural rows (§3) |
| Approval chain | `policy_approval_chains` | Yes — `trigger_condition` field |

The `rule_type` column on `policy_rules` is a UI category hint, not an evaluation-semantic distinction.

### Evaluation order

```
1. Hard limit check (§3)
   → Any breach: verdict = 'block_hard_limit', still evaluate user rules for complete trace
2. User rules in priority order
   → For each rule, evaluate condition IR recursively
   → Cannot-fully-evaluate any node: rule fails with typed reason, verdict becomes 'block'
3. System invariants
   → AI-initiator floor: if initiator.type ∈ {ai_recommendation, agent} and verdict='allow_auto',
     promote to 'require_approval'
   → Default deny: non-human initiators with no explicit allow → 'require_approval'
4. Resolve approval chain when verdict='require_approval'
```

Verdict composition: **lowest-privilege wins** (`block` > `block_hard_limit` > `require_approval` > `allow_auto`). Hard-limit block does not short-circuit user rule evaluation (keeps traces complete).

### Evaluation trace

```typescript
interface EvaluationTrace {
  engine_version: string;
  policy_version_id: string;
  policy_version_number: number;
  proposed_movement_id: string;

  canonicalization: CanonicalizationTrace;
  hard_limit_check: HardLimitCheckTrace;
  rules_evaluated: RuleEvaluationTrace[];
  system_invariants_applied: SystemInvariantTrace[];

  final_verdict: Verdict;
  final_verdict_source: 'hard_limit' | 'user_rule' | 'system_invariant' | 'default_deny';
  final_verdict_reasons: ReasonCode[];

  forecast_mode: 'stub' | 'real';         // for UI badging
  forecast_warnings: string[];

  evaluation_duration_ms: number;
}

interface RuleEvaluationTrace {
  rule_id: string;
  rule_name: string;
  rule_type: RuleType;
  priority: number;
  condition_result: ConditionEvaluationTrace;   // mirrors IR tree
  matched: boolean;
  matched_via?: 'direct' | 'splitting';         // for splitting guard annotations
  verdict_contribution: Verdict | null;
  failure?: RuleEvaluationFailure;
}

interface RuleEvaluationFailure {
  reason_code: string;                           // from error catalog (§10)
  human_readable: string;
  details: Record<string, unknown>;
  affected_condition_path: (string | number)[]; // JSON path into IR tree
  user_action?: string;
}
```

---

## 3. Hard limit checker

### Module contract

Synchronous, pure, reads only from pre-loaded `EvaluationContext`. Runs first in evaluation pipeline.

```typescript
interface HardLimitChecker {
  check(movement: ProposedMovement, context: EvaluationContext): HardLimitCheckResult;
}

interface HardLimitCheckResult {
  any_breached: boolean;
  breaches: HardLimitBreach[];
  evaluated: HardLimitEvaluation[];  // ALL limits, even when not breached — drives utilization UI
}

interface HardLimitEvaluation {
  limit_id: string;
  limit_type: HardLimitType;
  limit_value: string;
  limit_currency?: AssetCode;
  scope: HardLimitScope;
  current_value: string;
  post_transfer_value: string;
  breached: boolean;
  headroom?: string;
  overage?: string;
  utilization_pct?: number;
  failure?: HardLimitFailure;
}
```

### The 6 phase-1 hard limit types

#### `min_cash_reserve_usd`
- **Inputs:** `context.treasury_state.cash_equivalent_usd`, proposed movement's USD-equivalent delta
- **Post-state:** `cash_equivalent_usd + (inflow_usd - outflow_usd)`
- **Check:** `post_state >= limit_value`
- **Scope:** `{ include_venues? }` — reserved for phase 2
- **Failure modes:** `treasury_state_unavailable`, `canonicalization_failed`

#### `max_single_asset_concentration_pct`
- **Inputs:** per-asset USD-equivalent positions + total treasury value
- **Post-state:** adjust moved asset(s), recompute total, recompute max concentration
- **Check:** `max_concentration_pct <= limit_value`
- **Special case:** swaps adjust two positions atomically
- **Failure modes:** `treasury_state_unavailable`, `canonicalization_failed`

#### `max_daily_outflow_usd` / `max_30day_outflow_usd`
- **Inputs:** pre-computed `trailing_outflow_usd` from context (from aggregate detector)
- **Post-state:** `trailing + proposed_canonical`
- **Check:** `post_state <= limit_value`
- **Rate semantics:** past transfers use historical rates from their original traces (rate-at-booking), proposed uses current
- **Failure modes:** `historical_outflow_unavailable`, `canonicalization_failed`

#### `obligation_coverage_days`
- **Inputs:** `context.forecast.hypothetical(movement).areObligationsCovered(windowDays)`
- **Check:** `covered === true`
- **Failure mode:** `forecast_unavailable` — but stub mode returns `covered: true` by design, so stub period is loudly flagged with `forecast_stub_mode` warning and advisory badge
- **Note:** `limit_value` here is a duration (days), not monetary — an allowed exception

#### `max_native_exposure`
- **Scope:** `{ asset }` required — one row per asset
- **Inputs:** current native position for scoped asset
- **Post-state:** `native_position + transfer_delta` in native units
- **Check:** `post_state <= limit_value` (never canonicalized)
- **Only applies when movement's asset matches scope asset**
- **Failure modes:** `treasury_state_unavailable` only — no canonicalization involved

### Override protection

- **No approval workflow branch reads `breach`.** Approval workflows consume `require_approval`. Hard-limit breaches produce `block_hard_limit`, not approval-eligible.
- **The gate refuses to execute on `block_hard_limit` regardless of caller.** No admin override, no force flag.
- **The only remediation is raising the limit** via a new policy version. Requires `is_policy_admin`, requires non-empty 20+ character reason, is audited in `policy_activation_events`.

### Live utilization probe

```typescript
interface HardLimitUtilizationProbe {
  probe(enterpriseId: string): Promise<HardLimitEvaluation[]>;
}
```

Feeds:
1. `GET /api/policy/utilization` endpoint
2. Policy view Hard Guardrails live gauges
3. Dashboard "Limit Utilization" card (top 2-3 most-utilized)

---

## 4. Splitting / aggregation detector

### Layer 1 — Always-on 24h splitting guard (system invariant)

For every `amount_compare` node where `attr = 'transfer.amount'`, the evaluator automatically also evaluates the same comparison against the 24h rolling sum grouped by (initiator, destination). Cannot be disabled.

```typescript
function evalAmountCompare(node, movement, ctx): LeafResult {
  if (node.attr === 'transfer.amount') {
    const direct  = compareDirect(movement.amount, node, ctx.canonicalization);
    const rolling = compareRolling(
      ctx.aggregates.system_splitting_guard_24h,
      node,
      ctx.canonicalization
    );
    if (direct.matches)  return { matches: true, via: 'direct' };
    if (rolling.matches) return { matches: true, via: 'splitting', splitting_note: '...' };
    return { matches: false, via: 'direct' };
  }
  // other attrs — no splitting guard needed (already cumulative by nature)
}
```

**The Policy view announces the invariant** as a read-only row inside Approval Thresholds section:

> 🔒 *System invariant: splitting detection. Every amount threshold above is also enforced against the 24-hour rolling sum grouped by (initiator, destination). This cannot be disabled.*

### Layer 2 — User-authored `aggregate_window` rules

Treasurers can author arbitrary aggregate window rules via the `aggregate_window` IR kind (§2). Supported groupings: `initiator`, `counterparty`, `destination`, `asset`, and combinations. Supported attrs: `sum_amount`, `count`, `distinct_destinations`, `distinct_counterparties`.

### The detector module (async context-load phase)

```typescript
interface AggregationDetector {
  loadAggregates(
    movement: ProposedMovement,
    enterpriseId: string,
    policyVersion: PolicyVersionSnapshot
  ): Promise<AggregateWindowResults>;
}

interface AggregateWindowResults {
  system_splitting_guard_24h: AggregateWindowResult;     // always populated
  user_specs: Map<WindowSpecHash, AggregateWindowResult>;
}
```

Workflow:
1. Walk active policy's rules + chains for every `aggregate_window` node
2. Compute deterministic hash over each node's `window` field — dedup key
3. Add always-on 24h `(initiator, destination)` spec
4. Run one SQL query per unique hashed spec against `policy_evaluations`
5. Return populated map

### Critical semantic: only executed outflows count

```sql
WHERE executed_at IS NOT NULL
  AND final_verdict = 'allow_auto'
  AND proposed_movement->'amount'->>'direction' = 'outflow'
```

Blocked attempts and held approvals do NOT count against future thresholds. A retry after a block does not carry the blocked attempt's amount.

### Rate semantics

Past movements' USD-equivalent amounts were captured at the time on their original traces. The detector sums these pre-captured values directly — no re-canonicalization at current rates. Prevents rate fluctuations from retroactively changing what counts against a window.

---

## 5. Approval workflow service

### State machine

States: `pending`, `approved`, `executed`, `denied`, `escalated` (transient), `cancelled`.

Denial reasons collapsed into one column + `denial_reason` enum: `manual` | `expired` | `stale_reeval`.

Transitions:
```
create → pending
pending → approved (all slots filled) → re-evaluate → executed | escalated | denied(stale_reeval)
pending → denied (manual / expired / stale_reeval)
pending → escalated → pending (new chain, reset expires_at)
pending → cancelled (initiator or enterprise admin)
approved → executed (gate call success)
approved → denied(stale_reeval) (re-evaluation produced block)
```

### Creation flow

1. Gate calls `createRequest(movement, evaluationResult)` within a transaction
2. Writes `policy_approval_requests` row pinned to current active version
3. Writes `policy_evaluations` row with `approval_request_id` link
4. Writes `audit_logs` row
5. Dispatches notifications **outside** the transaction
6. Gate returns held-for-approval response with `trace_id` and `human_readable`

### Stricter separation of duties

Approver cannot fill a slot if they:
1. Are the initiator of the movement (`movement.initiator.user_id`)
2. Are listed in `policy_rules.created_by` for any rule in `triggered_rule_ids` (uses pinned version's authorship, not full edit history)
3. Have already filled a different slot on this request

Each failure returns a typed reason code (`sod_initiator_conflict`, `sod_rule_editor_conflict`, `sod_already_filled`) with a human-readable message.

### Slot filling

```typescript
POST /api/policy/approvals/[id]/approve
Body: { justification: string }  // required, non-empty
```

1. Authenticate via NextAuth
2. Lock request row `FOR UPDATE`
3. Verify `status = 'pending'`
4. Run stricter SoD check
5. Find first unfilled slot matching approver's role
6. Fill slot in `slot_assignments` JSONB
7. If all slots filled: transition to `approved`, enqueue execution attempt
8. Write audit log `policy_approval_slot_filled`
9. Notify remaining approvers (or initiator on full approval)

### Re-evaluation at execution time (critical)

When status transitions to `approved`:

1. Reload request and load CURRENT active policy version (may differ from pinned)
2. Build fresh `EvaluationContext` against current treasury state
3. Run `evaluator.evaluate()` with current policy version
4. Branch on verdict:
   - `allow_auto` → execute via gate
   - `require_approval` same chain → execute via gate (approval stands)
   - `require_approval` different chain → escalate, carrying compatible filled slots
   - `block` | `block_hard_limit` → deny with reason `stale_reeval`, notify initiator with structured explanation

### Expiration sweeper

```
POST /api/cron/sweep-policy-approvals
```

Runs every 5 minutes:
1. `SELECT ... WHERE status='pending' AND expires_at < now() FOR UPDATE SKIP LOCKED LIMIT batch`
2. Transition to `denied` with `denial_reason='expired'`
3. Write audit log `policy_approval_expired`
4. Dispatch notification
5. `SKIP LOCKED` enables safe concurrent cron runs

Default expiration: 24 hours (per-chain overridable via `policy_approval_chains.expiration_hours`).

### Escalation

- **Manual escalation** by approver (requires reason)
- **System escalation** from re-evaluation (chain mismatch)

Mechanics:
1. Lock request `FOR UPDATE`
2. Compute new chain's slot list
3. Preserve compatible filled slots (role match)
4. Update `chain_id` + `slot_assignments`
5. **Reset `expires_at = now() + new_chain.expiration_hours`** (fresh clock)
6. Audit log + notify newly-eligible approvers

### Authoring-time chain satisfiability check

Before activation, verify every chain in the draft is satisfiable by current enterprise user base (accounting for stricter SoD). Unsatisfiable chain → blocking validation error.

### Concurrency model

- `FOR UPDATE` row locking during slot fills
- `SKIP LOCKED` batch in sweeper
- Optimistic `version` column as secondary defense
- Notifications dispatched outside transactions

---

## 6. Forecast interface and stub

### Interface contract

```typescript
interface ForecastQuery {
  getProjectedMinBalance(asset: AssetCode, venue: VenueId | null, windowDays: number): Promise<AmountNative>;
  getProjectedPosition(asset: AssetCode, venue: VenueId | null, atDate: Date): Promise<AmountNative>;
  areObligationsCovered(windowDays: number): Promise<ObligationCoverageResult>;
  getObligationsDueInWindow(windowDays: number): Promise<Obligation[]>;
  hypothetical(proposedMovement: ProposedMovement): ForecastQuery;
  readonly metadata: ForecastQueryMetadata;
}

interface ForecastQueryFactory {
  createForEnterprise(enterpriseId: string): Promise<ForecastQuery>;
}
```

`hypothetical()` returns a NEW query scoped to post-transfer state, independent of the original.

### Stub implementation

`StubForecastQuery` returns permissive defaults:
- `getProjectedMinBalance` → effectively infinite
- `getProjectedPosition` → effectively infinite
- `areObligationsCovered` → `{ covered: true }`
- `getObligationsDueInWindow` → `[]`
- `hypothetical()` → new stub instance

Every call:
1. Logs to console with `[POLICY_FORECAST_STUB]` prefix
2. Inserts row into `policy_forecast_stub_calls`
3. Emits Sentry breadcrumb (warning level)

Metadata always reports `mode: 'stub'`.

### Removal contract

**When the real forecast module ships:**
1. Delete `src/lib/policy/forecast/stub.ts`
2. Delete `src/lib/policy/forecast/stub-logger.ts`
3. Change one line in `src/lib/policy/gate.ts`:
   ```typescript
   // BEFORE:  new StubForecastQueryFactory(stubLogger)
   // AFTER:   new RealForecastQueryFactory(treasuryForecastsTable, ...)
   ```
4. `forecast_mode: 'stub'` disappears from new traces; advisory badges auto-disappear from UI

### Trace + UI integration

Every `EvaluationTrace` carries `forecast_mode: 'stub' | 'real'`, `forecast_warnings[]`, `forecast_source`.

UI:
- Policy view: advisory badge next to forecast-dependent rules/limits
- Evaluation Log: yellow banner on traces with `forecast_mode: 'stub'`
- Admin view at `/admin/policy-forecast-stub` — stub call counts, top-using enterprises, graph

### Contract tests

Both stub and any future real implementation must pass:
- `hypothetical()` returns a new instance (no mutation)
- Repeated calls on same instance return consistent results
- Async methods never throw; return structured-failure values
- `metadata.mode` ∈ `'stub' | 'real'`

---

## 7. Simulation engine

### The replay mechanism

Given: draft policy version + time window + enterprise id
Produces: per-rule stats, divergences list, warnings

**Load-bearing design:** every `policy_evaluations` row persists the full `context_snapshot` JSONB. Replay reads this column and passes it (with draft policy version swapped in) to the **unchanged live evaluator**.

```typescript
function replay(
  original: PolicyEvaluationRow,
  draftVersion: PolicyVersionSnapshot,
  freshForecastFactory: ForecastQueryFactory
): ReplayResult {
  // Swap policy_version in the stored context
  const context: EvaluationContext = {
    ...original.context_snapshot,
    policy_version: draftVersion,
  };

  // Synthesize any new forecast queries from current forecast
  // Synthesize any new aggregate windows from audit log
  // (both with loud warnings)

  // Run the EXACT same pure evaluator live uses
  const simulatedResult = evaluator.evaluate(
    rebuildMovementFromSnapshot(original.context_snapshot),
    context
  );

  return diffAgainst(original.final_verdict, simulatedResult);
}
```

### Handling new queries / new aggregate windows in the draft

When the draft introduces rules the historical context never saw:
- **Option 1 (chosen):** synthesize from current data, loud warning
- Option 2 (rejected): skip the rule — inaccurate
- Option 3 (rejected): mark evaluation incomplete — unhelpful

### Historical stub preservation

Traces served by the stub replay as stub. Each contributes to `SimulationWarning{ code: 'obligation_coverage_stub_at_time' }`.

### Background job execution

- Async worker via Vercel cron
- Progress streamed to row every batch
- Window cap: **90 days**
- Concurrency: **1 per enterprise**
- Divergence list capped at **500 rows** in stored result; full list paginated via separate endpoint

### Strictly read-only

Simulation NEVER:
- Creates approval requests
- Sends notifications
- Touches execution gate
- Runs expiration clock

Only the verdict decision is replayed; lifecycle dynamics are out of scope.

### UI surface (Treasury AI → Policies → Simulation sub-tab)

- Draft version selector
- Window selector (capped 90d)
- Progress bar while running
- Summary cards: total / unchanged / stricter / looser / different-block-reason
- Per-rule impact table
- Divergences list with inline "view trace diff" links
- Side-by-side trace comparison modal reusing the Evaluation Log trace viewer

---

## 8. Rule authoring API

### Authoring model

**A draft is a mutable workspace; activation is the freezing point.** Edits happen in place within a draft version; append-only DB rules apply only to rows whose parent version is `active` or `superseded`.

### Permissions

| Action | Required |
|---|---|
| View active policy | `auditor` or higher |
| Create draft | `treasury_manager` or higher |
| Edit rules in draft | `treasury_manager` or higher |
| Edit chains in draft | `treasury_manager` or higher |
| **Edit hard limits in draft** | **`is_policy_admin = true`** |
| **Activate draft** | **`is_policy_admin = true`** |
| Delete draft | creator OR `is_policy_admin = true` |

`is_app_admin = true` implicitly satisfies `is_policy_admin` checks, but every such action writes audit log with `actor_source: 'vantor_staff'`.

### API endpoints

```
── Policies / Versions ─────────────────────────────────
GET     /api/policy/active
GET     /api/policy/versions
GET     /api/policy/versions/[id]
POST    /api/policy/versions                        Create draft from source version
DELETE  /api/policy/versions/[id]                   Delete draft only
POST    /api/policy/versions/[id]/activate          Body: { reason: string ≥20 chars }
POST    /api/policy/versions/[id]/clone
GET     /api/policy/versions/[id]/diff/[otherId]

── Rules ───────────────────────────────────────────────
POST    /api/policy/versions/[id]/rules
PATCH   /api/policy/versions/[id]/rules/[ruleId]
DELETE  /api/policy/versions/[id]/rules/[ruleId]
POST    /api/policy/versions/[id]/rules/validate    Dry-run, same code path as save

── Hard limits (is_policy_admin required) ─────────────
POST    /api/policy/versions/[id]/hard-limits
PATCH   /api/policy/versions/[id]/hard-limits/[limitId]
DELETE  /api/policy/versions/[id]/hard-limits/[limitId]

── Approval chains ─────────────────────────────────────
POST    /api/policy/versions/[id]/approval-chains
PATCH   /api/policy/versions/[id]/approval-chains/[chainId]
DELETE  /api/policy/versions/[id]/approval-chains/[chainId]

── Satisfiability dry-run ──────────────────────────────
POST    /api/policy/versions/[id]/satisfiability

── Runtime endpoints ───────────────────────────────────
GET     /api/policy/approvals                       Query: status, limit, cursor
GET     /api/policy/approvals/[id]                  Full detail with trace
POST    /api/policy/approvals/[id]/approve          Body: { justification: string }
POST    /api/policy/approvals/[id]/deny             Body: { justification: string }
POST    /api/policy/approvals/[id]/escalate         Body: { to_chain_id?, reason }
POST    /api/policy/approvals/[id]/cancel           Body: { reason }

GET     /api/policy/evaluations                     Query: verdict, since, until, limit, cursor
GET     /api/policy/evaluations/[id]                Full trace

POST    /api/policy/simulate                        Body: { draft_version_id, window_start, window_end }
GET     /api/policy/simulate/[id]
GET     /api/policy/simulate/[id]/divergences       Paginated
POST    /api/policy/simulate/[id]/cancel

GET     /api/policy/utilization                     Live hard limit utilization

── Cron ────────────────────────────────────────────────
POST    /api/cron/sweep-policy-approvals
```

### Save-time validation cascade

Every POST/PATCH runs (in order, all must pass):

1. **Schema parse** via zod against the discriminated-union TypeScript types
2. **IR type-path validation** — `amount_compare.attr` must be an AmountAttribute; etc.
3. **Reference validation** — referenced chains exist in same draft
4. **Currency consistency** — USD thresholds on rate-less assets rejected with `usd_rule_on_rateless_asset`
5. **Priority uniqueness** — within version
6. **Business-rule validation** — durations positive, no circular chain refs, hard-limit values in range

Each failure: structured error with `reason_code`, `human_readable`, `user_action`, `details.path` JSON path.

### Version activation flow

Transactional:
1. Require `is_policy_admin` (or `is_app_admin`)
2. Require `reason.trim().length >= 20`
3. Lock draft + enterprise + current active rows `FOR UPDATE`
4. Re-run full validation on all rules/limits/chains (belt + suspenders — state may have shifted since individual edits)
5. Check chain satisfiability against live user base
6. Supersede current active
7. Promote draft to active + bump `version_number`
8. Update `policy_policies.active_version_id`
9. Write `policy_activation_events` + `audit_logs`
10. Post-commit: dispatch notifications

### Dry-run validation

`POST /api/policy/versions/[id]/rules/validate` uses the **exact same** validation function as the save endpoint — no parallel implementation. UI calls it on every edit (debounced) for inline feedback.

### Multiple concurrent drafts

Per-enterprise drafts may coexist. Activation serialized via `FOR UPDATE` on enterprise row. Race conflicts return `activation_race_conflict` with a rebase hint.

---

## 9. Integration gate

### Single chokepoint

```typescript
export async function gateMoneyMovement(
  input: ProposedMovementInput,
  actor: ActorContext
): Promise<GateResult>;
```

### Flow

1. Normalize input → `ProposedMovement` (generate idempotency key if absent)
2. Idempotency check: if existing evaluation for this movement_id, return reconstructed result
3. Load `EvaluationContext` async
4. Run pure `evaluator.evaluate()`
5. **Persist `policy_evaluations` row BEFORE touching rails** (audit-first)
6. Dispatch on verdict:
   - `allow_auto` → call appropriate `*.internal.ts` adapter → mark `executed_at`
   - `require_approval` → `approvalService.createRequest()` → return held result
   - `block` → return blocked result with reason extracted from trace
   - `block_hard_limit` → return blocked_hard_limit result with breach details

### Adapter hiding

All rail-touching adapters renamed to `*.internal.ts`:
- `src/lib/transfers/executor.ts` → `executor.internal.ts`
- `src/lib/banking/adapters/*.ts` → `*.internal.ts`
- `src/lib/yield/adapters/*.ts` → `*.internal.ts`
- `src/lib/scheduled-operations/executor.ts` → `executor.internal.ts`
- Swaps, bridges, payments adapters similarly

### Lint enforcement (defense in depth)

**Layer 1:** ESLint `no-restricted-imports`
```javascript
{
  patterns: [{
    group: ['**/*.internal', '**/*.internal.ts'],
    message: 'Adapter .internal files can only be imported by src/lib/policy/gate.ts. ' +
             'All money movement MUST go through gateMoneyMovement().'
  }]
}
```

**Layer 2:** CI grep check — GitHub Action that scans for any `from '.*\.internal.*'` outside `gate.ts`. Catches anyone disabling ESLint inline.

**The only legal escape hatch** is `src/lib/policy/gate.ts` with explicit `/* eslint-disable no-restricted-imports */` wrapping the adapter imports block.

### Result shape

```typescript
type GateResult =
  | { status: 'executed';          execution: ExecutionRecord; evaluation: EvaluationResult; trace_id: string }
  | { status: 'held_for_approval'; approval_request: ApprovalRequest; evaluation: EvaluationResult; trace_id: string; human_readable: string }
  | { status: 'blocked';           reason: BlockReason; evaluation: EvaluationResult; trace_id: string; human_readable: string }
  | { status: 'blocked_hard_limit';reason: HardLimitBreach; evaluation: EvaluationResult; trace_id: string; human_readable: string };
```

### HTTP status mapping

- `executed` → **200 OK**
- `held_for_approval` → **202 Accepted**
- `blocked` / `blocked_hard_limit` → **422 Unprocessable Entity**
- `adapter_execution_failed` → **502 Bad Gateway**
- Unexpected → **500**

### Idempotency

Default 1-minute window, derived hash over `(enterprise, kind, source, destination, amount, initiator, minute-floored-timestamp)`.

Scheduled ops use `scheduled_op_id`-derived keys (deterministic, so re-firing a held op returns the held result).

Agent tools use `tool_call_id`-derived keys.

### Audit-first ordering

`policy_evaluations` is written BEFORE the adapter is called. `executed_at` is NULL until adapter returns success. Aggregate queries filter on `executed_at IS NOT NULL`, so failed adapter calls correctly do not count against splitting thresholds.

### Integration with each caller

| Caller | Refactor |
|---|---|
| `POST /api/transfers` | Convert body → `ProposedMovementInput`, call gate, map result to 200/202/422 |
| `POST /api/ramps/execute` | Same pattern |
| `POST /api/yield/deposit` | Same pattern |
| `POST /api/yield/withdraw` | Same pattern |
| `POST /api/swaps/*` | Same pattern |
| `POST /api/bridges/*` | Same pattern |
| `POST /api/payments/*` | Same pattern |
| `POST /api/cron/process-scheduled-operations` | Convert each pending op, call gate, update op state based on gate result |
| Agent `sendPayment` tool | Always returns held_for_approval due to AI-initiator invariant; tool response tells user "I've prepared it; approve it here" |
| AI recommendation approval | Executes via `approvalService.attemptExecution()` which calls gate |

---

## 10. UI changes

### Sidebar

No new sidebar items. Existing structure preserved. "Treasury AI" remains the only entry into `/treasury`.

### Treasury AI page tab changes

**`TreasuryPageClient.tsx` tabs:**
- Before: `Overview | Treasury Rules | Forecasting`
- After: `Overview | Policies | Forecasting`

The `Treasury Rules` tab is removed entirely; `TreasuryRulesForm.tsx` is deleted.

### Overview tab card order changes

Before:
1. `TreasuryHealthCard`
2. `YieldPositionsSummary`
3. `RecommendationList` (heading "AI Recommendations")

After:
1. `TreasuryHealthCard`
2. **NEW:** Approvals widget (fed by `/api/policy/approvals?status=pending`)
3. `RecommendationList` with heading renamed to **"AI Insights"**

(`YieldPositionsSummary` is removed.)

### New Policies tab

Renders `PoliciesTabClient.tsx` with a TabNav for sub-tabs:

```
Policies
├── Policy              ← default view
├── Evaluation Log
├── Simulation
└── Version History
```

#### Policy sub-tab (the main view)

Top-to-bottom sections, scrollable:

1. **Header:** "Active Policy: [name] v[n]", edited by + activated by, buttons: [Clone for editing] [Simulate changes] [View version history]
2. **Hard Guardrails block** — bordered, locked, live utilization gauges
   - Rows for each hard limit with name, value, current state, headroom/overage, utilization %
   - Advisory badge next to forecast-dependent limits while forecast is stubbed
   - "Request change" button (requires `is_policy_admin`)
3. **Approval Thresholds** — list of rules with `verdict=require_approval`, edit per-section
   - Read-only row for the AI-initiator system invariant (🔒 "This cannot be disabled")
   - Read-only row for the splitting-guard system invariant
4. **Approval Chains** — role-to-slot assignments
5. **Counterparty Rules**
6. **Time-Window Rules**
7. **Lookahead Rules** — advisory badges while forecast is stubbed

Each section has its own "Edit" affordance. Edits accumulate into a draft version. Persistent banner at top of Policy view when unsaved draft exists: "You have 1 unsaved draft — [Activate] [Discard]".

#### Evaluation Log sub-tab

Paginated list of `policy_evaluations` with filters:
- Verdict (allow_auto / require_approval / block / block_hard_limit)
- Date range
- Movement kind
- Initiator type
- Rule that fired
- Forecast mode (stub / real)

Row click → full trace detail modal with:
- Proposed movement summary
- Canonicalization details
- Hard limit check results
- Rules evaluated (collapsed + expandable)
- System invariants applied
- Final verdict + source
- Link to original adapter execution record
- Link to approval request (if any)
- Yellow banner if `forecast_mode: 'stub'`

#### Simulation sub-tab

- Draft version selector
- Window selector (capped 90 days)
- "Run simulation" button
- Progress bar + cancel button while running
- Summary cards: total / unchanged / stricter / looser / different-block-reason
- Warnings card
- Per-rule impact table
- Divergences list (paginated, "Load more")
- Row click → side-by-side trace comparison modal (reuses Evaluation Log trace viewer rendered twice with diffs highlighted)

#### Version History sub-tab

List of `policy_versions` for the enterprise (ordered by version_number DESC):
- Version number, name, status (active/superseded/draft), created_by, created_at, activated_by, activated_at, reason
- Click → read-only Policy view for that specific version
- "View diff" between any two versions
- "Clone into new draft" action

### Dashboard changes

**`src/app/(app)/dashboard/page.tsx`:**

Before:
```
UnifiedBalanceCard
Row 1: YieldEarned | RecommendationsCard (titled "AI Approvals")
Row 2: BalanceOverTime | TokenDistribution
```

After:
```
UnifiedBalanceCard
Row 1: ApprovalsCard (renamed from RecommendationsCard, title "Approvals") | YieldEarned
Row 2: BalanceOverTime | TokenDistribution
Row 3: LimitUtilizationCard (NEW)
```

Changes:
- `RecommendationsCard.tsx` renamed to `ApprovalsCard.tsx`; title string changed from "AI Approvals" to "Approvals"; fed by `/api/policy/approvals?status=pending` instead of recommendations + scheduled ops
- `YieldEarned` moved to Row 1 right position (swapped with Approvals)
- New `LimitUtilizationCard` added to Row 3 — shows top 2-3 most-utilized hard limits with compact gauges, linking to Treasury AI → Policies → Policy view

### Admin observability view

New route `/admin/policy-forecast-stub` (app-admin only) showing:
- Total stub calls this week per method
- Top enterprises by stub reliance
- Stub calls over time graph
- Deployment status note for the real forecast module

---

## 11. Error catalog

Closed taxonomy — stable codes, considered API surface after phase 1 ships.

Full catalog below is persisted at `docs/reference/policy-engine-errors.md` (auto-generated from TypeScript constants so catalog and code never drift). Categories:

### Canonicalization
- `canonicalization_failed`
- `canonicalization_source_unavailable`
- `canonicalization_rate_stale`

### Evaluation engine
- `condition_node_evaluation_failed`
- `forecast_unavailable`
- `aggregate_query_failed`
- `sanctions_status_unavailable`
- `counterparty_lookup_failed`
- `policy_version_not_active`

### Hard limit checker
- `hard_limit_breached`
- `treasury_state_unavailable`
- `scope_resolution_failed`
- `historical_outflow_unavailable`

### Splitting detector
- `window_spec_invalid`

### Approval workflow
- `approval_not_pending`
- `sod_initiator_conflict`
- `sod_rule_editor_conflict`
- `sod_already_filled`
- `no_matching_slot`
- `approval_concurrent_modification`
- `stale_approval_chain_mismatch`
- `stale_approval_reevaluation_failed`
- `activation_reason_too_short`
- `chain_unsatisfiable_at_activation`

### Simulation
- `historical_context_incomplete`
- `new_forecast_query_fresh_data`
- `new_aggregate_window_approximated`
- `obligation_coverage_stub_at_time`
- `simulation_already_running`
- `draft_deleted`
- `simulation_window_too_large`

### Rule authoring
- `condition_ir_type_mismatch`
- `condition_ir_schema_invalid`
- `usd_rule_on_rateless_asset`
- `native_unit_currency_mismatch`
- `chain_reference_not_found`
- `rule_priority_collision`
- `activation_blocked_by_validation`
- `activation_race_conflict`
- `requires_policy_admin`
- `version_not_draft`
- `hard_limit_value_out_of_range`
- `obligation_coverage_advisory_only`

### Gate / execution
- `movement_validation_failed`
- `movement_kind_unsupported`
- `idempotency_key_conflict`
- `adapter_execution_failed`
- `gate_internal_error`

### Warnings (attached to traces, not blocks)
- `forecast_stub_mode`
- `ai_initiator_floor_applied`
- `splitting_matched`
- `default_deny_triggered`

### Error envelope shape

```json
{
  "error": {
    "reason_code": "hard_limit_breached",
    "module": "hard_limit_checker",
    "human_readable": "This transfer would breach hard limit 'Operating Cash Floor' ...",
    "user_action": "Reduce the transfer amount to at most $20,000, or request ...",
    "details": { "limit_name": "...", "limit_type": "...", ... },
    "trace_id": "eval-xyz789",
    "engine_version": "1.0.0",
    "occurred_at": "2026-04-10T14:22:33.000Z"
  }
}
```

---

## 12. Migration plan

### Phase 1: Schema additions (expand)

Single Supabase migration `0NN_policy_engine.sql`:

1. Create all 9 `policy_*` tables + `policy_forecast_stub_calls` + `policy_migration_warnings`
2. Append-only triggers on evaluations, activations, versions (non-draft), rules/limits/chains (non-draft)
3. RLS policies (enterprise-scoped)
4. Indexes (see §1 for specifics)
5. `ALTER TABLE user_profiles ADD COLUMN is_policy_admin BOOLEAN NOT NULL DEFAULT false`
6. `ALTER TABLE ai_recommendations ADD COLUMN approval_request_id UUID REFERENCES policy_approval_requests(id)`

### Phase 2: Data migration

Separate migration `0NN+1_policy_engine_data.sql`:

1. Create `policy_policies` row per enterprise
2. Create v1 `policy_versions` row per enterprise with `status='active'`
3. Wire `policy_policies.active_version_id`
4. Create migrated approval-threshold rule per enterprise from `treasury_rules.approval_threshold_usd`:
   ```json
   {
     "kind": "amount_compare",
     "attr": "transfer.amount",
     "op": ">",
     "value": { "amount": "<threshold>", "currency": "USD" }
   }
   ```
5. Create migrated `obligation_coverage_days` hard limit from `treasury_rules.obligation_lookahead_days`
6. **Do NOT auto-create `min_cash_reserve_usd`** from `safety_buffer_multiplier` — ambiguous mapping. Instead write `policy_migration_warnings` row asking treasurer to add one manually.
7. Write migration warning for enterprises with multi-user `treasury_rules` conflicts (picked most-recently-updated, need manual review)
8. Migrate recent (last 7 days) `ai_recommendations.status='pending_approval'` rows to `policy_approval_requests`
9. Backfill `ai_recommendations.approval_request_id` FK
10. Bootstrap `is_policy_admin`: A1 strategy — most-active `treasury_manager` per enterprise gets `true`
11. Write per-user migration warning for every auto-assigned policy admin (7-day review nudge banner)
12. Write summary `audit_logs` row

**Verification queries** post-Phase 2:
- Every enterprise has exactly one `policy_policies` row
- Every `policy_policies.active_version_id` is non-null
- Every active version has at least one rule
- Every enterprise has ≥1 `is_policy_admin` user
- Migrated approval_requests count matches recent pending ai_recommendations

### Phase 3: Code deployment (single PR)

**Additions:**
- Entire `src/lib/policy/*` module (engine, gate, approvals, forecast/stub, simulation, authoring, hard-limit-checker, aggregation-detector, canonicalizer)
- New API routes under `/api/policy/*`
- New cron endpoint `/api/cron/sweep-policy-approvals`
- New UI: Policies tab + sub-tabs, Policy view, Evaluation Log, Simulation workspace, Version History
- New dashboard card (`ApprovalsCard` renamed, `LimitUtilizationCard` new)
- New Approvals widget on Treasury AI Overview
- Admin observability page `/admin/policy-forecast-stub`
- ESLint rule + CI grep check

**Renames (adapter hiding):**
- `src/lib/transfers/executor.ts` → `executor.internal.ts`
- All banking/yield/swap/bridge adapter files → `*.internal.ts`
- `src/lib/scheduled-operations/executor.ts` → `executor.internal.ts`

**Refactors:**
- Every money-movement API route → calls `gateMoneyMovement()`
- `src/components/treasury/TreasuryPageClient.tsx` → replace "Treasury Rules" tab with "Policies" tab, swap card order on Overview, remove `YieldPositionsSummary`, rename heading to "AI Insights"
- `src/app/(app)/dashboard/page.tsx` → swap card positions, import `ApprovalsCard`, add `LimitUtilizationCard`
- `RecommendationsCard.tsx` renamed to `ApprovalsCard.tsx` with title change and data source change
- `src/lib/agent/tools.ts` `sendPayment` → calls gate

**Deletions:**
- `src/lib/treasury/rules-engine.ts`
- `src/app/api/treasury/recommendations/[id]/approve/route.ts`
- `src/components/treasury/TreasuryRulesForm.tsx`

**No feature flag.** Atomic swap (maintenance window ~60s during Phase 2 data migration; announce 48h ahead).

### Phase 4: Post-deploy verification (first 24 hours)

- Sentry monitoring for unexpected errors during transition
- Synthetic E2E: submit test transfer, verify held-for-approval flow
- Admin dashboard confirms zero unexpected failures
- Migration warning banners visible to every first-login user

### Phase 5: Legacy cleanup (2-4 weeks post-deploy)

Separate follow-up PR drops legacy tables after confirmed stability:
- `DROP TABLE treasury_rules`
- Recreate `ai_recommendations.status` enum without `pending_approval` value

### Phase 6: Forecast module activation (when ready, separate workstream)

One-line DI swap from stub factory to real factory; stub files deleted. Out of scope for this phase 1 work.

### Rollback scenarios

- **Bug in gate only:** Vercel instant code rollback. `policy_*` tables sit idle; `treasury_rules` still intact; old system resumes.
- **Corrupt data migration:** revert code, TRUNCATE `policy_*` tables, fix migration, re-run Phase 2.
- **Pre-existing table corruption:** `treasury_rules` is never modified by Phase 1 migration; `ai_recommendations.approval_request_id` is additive-nullable. Both safely rolled back.
- **Stuck evaluations from adapter bugs:** `executed_at NULL` evaluations are preserved; idempotency check prevents re-execution on retry.

---

## 13. Phase 1 completion criteria

### Functional
- [ ] All 6 hard limit types evaluate correctly against synthetic test cases
- [ ] All 9 condition IR node kinds evaluate correctly against synthetic test cases
- [ ] Evaluator produces complete traces with per-rule failure capture
- [ ] Context loader pre-loads aggregates, forecast (stub), canonicalization, sanctions
- [ ] Gate dispatches all 4 verdict cases correctly for all 7 movement kinds
- [ ] Approval workflow state machine handles all transitions including re-evaluation
- [ ] Splitting guard catches test-case evasion patterns (11×$5k split test passes)
- [ ] Simulation engine replays historical evaluations and produces divergence reports
- [ ] Rule authoring API validates all closed node kinds with structured errors
- [ ] Version activation enforces chain satisfiability and 20+ character reason

### Data
- [ ] Migration completed for all existing enterprises with verification queries passing
- [ ] Every enterprise has ≥1 `is_policy_admin = true` user
- [ ] Legacy recent pending `ai_recommendations` migrated to approval_requests
- [ ] Migration warnings surfaced as banner on first login

### Enforcement
- [ ] ESLint rule blocks `*.internal` imports outside gate.ts
- [ ] CI grep check verifies the same
- [ ] Append-only triggers fire correctly on attempted mutation of non-draft rows
- [ ] RLS prevents cross-enterprise data leakage

### UI
- [ ] Policies tab replaces Treasury Rules tab on Treasury AI page
- [ ] Hard Guardrails block displays with live utilization gauges
- [ ] Per-section edit affordances open draft and route to editors
- [ ] Evaluation Log sub-tab lists traces with filters and detail modal
- [ ] Simulation sub-tab runs simulations with progress and results
- [ ] Version History sub-tab lists past versions with activation events
- [ ] Dashboard Approvals card + LimitUtilization card + swap with YieldEarned
- [ ] Treasury AI Overview has Approvals widget beneath Treasury Health
- [ ] YieldPositionsSummary removed from Overview
- [ ] AI Recommendations heading renamed to AI Insights
- [ ] Admin forecast stub observability page at `/admin/policy-forecast-stub`

### Testing
- [ ] Unit coverage for engine, hard-limit checker, splitting detector, approval service, gate, authoring validation, simulation replay
- [ ] Integration test for each of 7 movement kinds end-to-end through gate
- [ ] E2E Playwright: human transfer → held → approved → executed
- [ ] E2E Playwright: human transfer → blocked by hard limit → structured error
- [ ] E2E Playwright: AI recommendation → forced hold → approved → executed
- [ ] Contract tests pass for `ForecastQuery` interface with stub implementation
- [ ] Lint rule has negative-case test

### Documentation
- [ ] Spec doc committed (this file)
- [ ] Error catalog auto-generated at `docs/reference/policy-engine-errors.md`
- [ ] `src/lib/policy/README.md` covering architecture, how to add condition kinds, hard limit types, movement kinds, rollback procedures
- [ ] JSDoc on every exported engine function

### Observability
- [ ] Sentry captures gate errors with structured context
- [ ] `policy_forecast_stub_calls` populated on every stub call
- [ ] Structured logs at INFO level for every verdict decision
- [ ] `policy_evaluations` queryable for "show me all blocks in the last 24h"

---

## 14. Deferred to phase 2

- Additional hard limit types (counterparty exposure, tenor, leverage)
- Per-venue scoping for existing limits
- Limit-increase approval workflows (dual-admin for governance changes)
- Real forecast module implementation
- Bulk approve / delegation / SLA tracking / mobile push
- Automatic retry of stale-reeval denials
- Cross-movement batching, two-phase commit
- Dry-run gate mode (separate from simulation)
- What-if free-form simulation
- A/B simulation of two drafts
- Baseline simulation with anomaly alerts
- Auto-rebase of drafts onto new active
- Scheduled activation
- Policy templates for new enterprises
- Rollback endpoint (currently achievable via clone + activate)
- Draft sharing with collaborative editing
- Suspicious pattern detector (blocked-attempt frequency signals)
- Native-unit rule authoring for assets beyond the initial rate-support set
- ML-based anomaly detection

---

## Appendix A — Files touched

### New
- `src/lib/policy/gate.ts`
- `src/lib/policy/engine/evaluator.ts`
- `src/lib/policy/engine/context-loader.ts`
- `src/lib/policy/engine/hard-limit-checker.ts`
- `src/lib/policy/engine/ir-evaluator.ts`
- `src/lib/policy/engine/verdict-composer.ts`
- `src/lib/policy/engine/aggregate-detector.ts`
- `src/lib/policy/engine/canonicalizer.ts`
- `src/lib/policy/engine/types.ts`
- `src/lib/policy/forecast/interface.ts`
- `src/lib/policy/forecast/stub.ts`
- `src/lib/policy/forecast/stub-logger.ts`
- `src/lib/policy/approvals/service.ts`
- `src/lib/policy/approvals/lifecycle.ts`
- `src/lib/policy/approvals/slot-resolver.ts`
- `src/lib/policy/approvals/reevaluation.ts`
- `src/lib/policy/approvals/notifier.ts`
- `src/lib/policy/approvals/expiration-sweeper.ts`
- `src/lib/policy/approvals/chain-satisfiability.ts`
- `src/lib/policy/authoring/validation/pipeline.ts`
- `src/lib/policy/authoring/validation/ir-schema.ts`
- `src/lib/policy/authoring/diff.ts`
- `src/lib/policy/authoring/activation.ts`
- `src/lib/policy/simulation/engine.ts`
- `src/lib/policy/simulation/replay.ts`
- `src/lib/policy/simulation/runner.ts`
- `src/lib/policy/simulation/diff.ts`
- `src/lib/policy/simulation/forecast-synthesis.ts`
- `src/lib/policy/errors/catalog.ts`
- `src/lib/policy/errors/templates.ts`
- `src/components/policy/PoliciesTabClient.tsx`
- `src/components/policy/PolicyView.tsx`
- `src/components/policy/HardGuardrailsBlock.tsx`
- `src/components/policy/RuleSection.tsx`
- `src/components/policy/ApprovalChainSection.tsx`
- `src/components/policy/EvaluationLogSubTab.tsx`
- `src/components/policy/SimulationSubTab.tsx`
- `src/components/policy/VersionHistorySubTab.tsx`
- `src/components/policy/TraceDetailModal.tsx`
- `src/components/policy/TraceComparisonModal.tsx`
- `src/components/policy/ApprovalsWidget.tsx`
- `src/components/charts/ApprovalsCard.tsx` (renamed from `RecommendationsCard.tsx`)
- `src/components/charts/LimitUtilizationCard.tsx`
- `src/app/(app)/admin/policy-forecast-stub/page.tsx`
- `src/app/api/policy/**/*` (many route files)
- `src/app/api/cron/sweep-policy-approvals/route.ts`
- `supabase/migrations/0NN_policy_engine.sql`
- `supabase/migrations/0NN+1_policy_engine_data.sql`
- `docs/reference/policy-engine-errors.md`
- `src/lib/policy/README.md`

### Modified
- `src/components/treasury/TreasuryPageClient.tsx` — tabs, overview cards
- `src/app/(app)/dashboard/page.tsx` — card order
- `src/lib/transfers/executor.ts` → renamed `.internal.ts`
- `src/lib/banking/adapters/*.ts` → renamed `.internal.ts`
- `src/lib/yield/adapters/*.ts` → renamed `.internal.ts`
- `src/lib/scheduled-operations/executor.ts` → renamed `.internal.ts`
- `src/lib/agent/tools.ts` — `sendPayment` refactored to call gate
- All `src/app/api/transfers/*`, `api/ramps/*`, `api/yield/*`, `api/swaps/*`, `api/bridges/*`, `api/payments/*`, `api/cron/process-scheduled-operations/*` — refactored to call gate
- `src/lib/notifications/events.ts` — add 8 new event types
- `src/lib/auth/rbac.ts` — document `is_policy_admin` semantics
- `.eslintrc.cjs` — add `no-restricted-imports` rule
- `.github/workflows/*.yml` — add grep check

### Deleted
- `src/lib/treasury/rules-engine.ts`
- `src/app/api/treasury/recommendations/[id]/approve/route.ts`
- `src/components/treasury/TreasuryRulesForm.tsx`
- `src/components/treasury/YieldPositionsSummary.tsx` (only if no other consumer; otherwise keep and stop importing from Treasury AI Overview)

---

## Appendix B — Glossary

- **ProposedMovement** — normalized shape for any money movement before evaluation
- **Verdict** — `allow_auto` | `require_approval` | `block` | `block_hard_limit`
- **EvaluationContext** — fully-hydrated input to the pure evaluator
- **EvaluationTrace** — structured record of what the evaluator did, persisted forever on `policy_evaluations`
- **context_snapshot** — the full EvaluationContext persisted on each evaluation row, enabling faithful replay
- **IR (Intermediate Representation)** — the typed discriminated-union condition tree authored by treasurers, stored as JSONB, evaluated by pattern matching
- **Hard limit** — structural parameter (not a rule) that cannot be overridden by any approval
- **Hard Guardrails** — UI name for the Hard Limits block in the Policy view
- **System invariant** — engine-level floor that cannot be configured (AI-initiator hold, splitting guard, default deny)
- **Splitting guard** — always-on 24h aggregate check grouped by (initiator, destination)
- **Canonicalization** — explicit conversion of amounts to USD via `PolicyRateProvider`, with strict failure semantics
- **Draft** — mutable policy version workspace; transitions to `active` via audited activation
- **Chain (approval chain)** — named set of approval slots, triggered by a condition, defining who must sign off
- **Slot** — single approval position in a chain, with a minimum role requirement
- **Stricter SoD** — initiator + rule author + already-filled exclusions on slot filling
- **is_policy_admin** — per-enterprise flag for hard-limit editing and version activation; separate from `is_app_admin` (Vantor staff)
- **Gate** — `gateMoneyMovement()`, the single chokepoint for all money movement
- **.internal.ts** — file naming convention for rail-touching adapters; lint-enforced as importable only by `gate.ts`
