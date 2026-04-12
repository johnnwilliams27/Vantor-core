# Policy Gate — Design

**Date:** 2026-04-12
**Scope:** Wire the policy engine into `POST /api/transfers` as the reference callsite. Follow-up plans extend to yield, payments, bridges, swaps, ramps, and scheduled-operations.
**Depends on:** Plan 1 (engine, merged), Plan 2a (authoring API, merged), Plan 2b (approval workflow service, merged at `85848a1`).

---

## 1. Problem

The policy engine produces verdicts (`allow_auto` / `require_approval` / `block` / `block_hard_limit`), and the approval workflow service can persist approval requests — but nothing in production routes the two together. `POST /api/transfers` currently does sanctions screening + counterparty check, then inserts a `pending` transfer row and returns to the client for on-chain signing. The policy engine is not consulted.

The stub at `src/lib/insights/policy-gate.ts` only covers the insights engine's informational "recommended action" display; it does not create approval requests and is not used by money-movement endpoints.

This plan builds **the gate**: a thin service that takes a `ProposedMovement` + actor, consults `EvaluationEngine.evaluate()`, and either (a) passes the movement through, (b) creates an approval request via `ApprovalWorkflowService.createApprovalRequest()`, or (c) throws a typed `GateError`. It then wires the gate into `POST /api/transfers` as the reference callsite.

## 2. Non-goals

- Wiring any callsite other than `POST /api/transfers`. Yield, payments, bridges, swaps, ramps, scheduled-operations, and the insights action pipeline are follow-up plans.
- Changing the existing two-step transfer flow (server creates pending row → client signs on-chain → `/confirm`). The gate sits inside step 1; step 2 gains one status check.
- Implementing an approvals dashboard UI, in-app notifications, or the `/approvals` page (Plan 3).
- Changing the approval-request shape or `ApprovalWorkflowService` internals.
- Escalation / slot carry-forward (Plan 2c).
- Running the gate on `POST /api/transfers/confirm`. The gate runs once, before the pending row is committed as `pending`; `/confirm` only performs a status check.

## 3. Default behavior (important)

The gate is a **conditional enforcer**, not a universal one. When no policy rules match and no hard limits breach, the engine returns `allow_auto` and the transfer proceeds exactly as today.

| Scenario | Gate outcome |
|---|---|
| Enterprise has no policy rules configured at all | `allow_auto` — gate is a no-op |
| Policy rules exist but none match this movement | `allow_auto` — gate is a no-op |
| Rule matches with verdict=`require_approval` | approval request created |
| Rule matches with verdict=`block` | throws `GateError` with `policy_blocked` |
| Hard limit breached | throws `GateError` with `hard_limit_breached` |
| AI-initiator floor (agent/schedule) | `require_approval` (engine-level, always-on) |
| No `policy_version` exists for enterprise | `allow_auto` — policy is opt-in |

For a typical human-initiated transfer on an enterprise that hasn't authored any rules, the gate adds an engine call and returns `allow_auto`. Latency impact only, no behavioral change.

## 4. Architecture

### Module layout

```
src/lib/policy/gate/
├── gate.ts                  PolicyGateService class
├── gate.test.ts             unit tests, ~12 cases
├── errors.ts                GateError (extends PolicyError, module='gate')
├── errors.test.ts           ~3 cases
├── movement-mapper.ts       pure: transfer request body → ProposedMovement
├── movement-mapper.test.ts  ~5 cases
├── http.ts                  mapGateErrorToHttp, response helpers
├── http.test.ts             ~5 cases (status code mapping)
└── index.ts                 barrel, re-exported from src/lib/policy/index.ts
```

### Dependencies

- `EvaluationEngine` from `src/lib/policy/engine/` — Plan 1, already merged
- `ApprovalWorkflowService` from `src/lib/policy/approvals/` — Plan 2b, already merged
- `ProposedMovement`, `EvaluationResult`, `ResolvedApprovalChain` from `src/lib/policy/types/`

No circular deps: `gate` imports from `approvals` and `engine`, neither imports from `gate`.

## 5. Gate API

```typescript
export class PolicyGateService {
  constructor(
    supabase: SupabaseLike,
    options: {
      evaluate: EvaluateFn;                      // real EvaluationEngine.evaluate in prod
      approvalService: ApprovalWorkflowService;  // built with same supabase instance
    },
  );

  /**
   * Gate a proposed money movement.
   *
   * Returns:
   *  - { verdict: 'allow_auto', evaluation }  — caller may proceed
   *  - { verdict: 'require_approval', approval_request, evaluation } — approval persisted
   *
   * Throws GateError for:
   *  - 'policy_blocked' (verdict=block)
   *  - 'hard_limit_breached' (verdict=block_hard_limit)
   *  - 'policy_engine_unavailable' (evaluate threw)
   *  - 'canonicalization_failed' (engine canonicalization error)
   *  - 'approval_creation_failed' (approvalService threw)
   */
  async gate(movement: ProposedMovement, actor: GateActor): Promise<GateResult>;
}

export type GateActor = {
  user_id: string;
  role: UserRole;
  enterprise_id: string;
};

export type GateResult =
  | { verdict: 'allow_auto'; evaluation: EvaluationResult }
  | { verdict: 'require_approval'; approval_request: ApprovalRequest; evaluation: EvaluationResult };
```

Key decisions:
- **Dependency injection** for `evaluate` and `approvalService` matches the `ApprovalWorkflowService` pattern. Tests inject mocks; HTTP handler injects real instances built with the admin supabase client.
- **Typed result union** so callers pattern-match on `verdict`; TypeScript narrows `approval_request` only on the `require_approval` branch.
- **Throws on block** — block verdicts become `GateError` rather than a result variant. Routes cannot accidentally ignore a block.
- **Evaluation trace included** in the returned result so routes can audit-log the full decision.
- **Enterprise isolation**: the gate asserts `movement.enterprise_id === actor.enterprise_id` at entry and throws `GateError` with `enterprise_mismatch` if violated. Defense-in-depth over the HTTP layer's session filtering.

## 6. Flow inside `POST /api/transfers`

Existing steps that run **before** the gate (unchanged):
1. Session + role + tier checks
2. Zod parse of request body
3. Wallet lookup scoped to user + enterprise
4. Sanctions screening on the destination address
5. Counterparty eligibility check (if `counterpartyId` provided)
6. Scheduled-transfer rejection (unchanged)

New steps:

```typescript
// 1. Map request body to ProposedMovement (pure function)
const movement = mapTransferToMovement(parsed.data, { wallet, actor, enterpriseId });
//   movement.id is a newly-generated UUID
//   transfer.id = movement.id (single identity, used as approval_request.movement_id)

// 2. Insert transfers row with defensive status='awaiting_approval'
const { data: transfer, error: pErr } = await supabase
  .from('transfers')
  .insert({ id: movement.id, ...transferFields, status: 'awaiting_approval' })
  .select()
  .single();
if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

// 3. Run the gate
let result: GateResult;
try {
  result = await policyGate.gate(movement, actor);
} catch (err) {
  // Rollback path: flip transfer to denied + capture reason
  if (err instanceof GateError) {
    await supabase.from('transfers')
      .update({ status: 'denied', denial_reason: err.reason_code })
      .eq('id', transfer.id);
    await writeAuditLog({
      userId: actor.user_id,
      action: 'transfer_create_blocked',
      entityType: 'transfer',
      entityId: transfer.id,
      details: { reason_code: err.reason_code, trace: err.details?.trace },
    });
    const { status, body } = mapGateErrorToHttp(err);
    return NextResponse.json(body, { status });
  }
  throw err; // unhandled — re-throw to global error boundary
}

// 4. Dispatch on verdict
if (result.verdict === 'allow_auto') {
  await supabase.from('transfers')
    .update({ status: 'pending' })
    .eq('id', transfer.id);
  await writeAuditLog({ action: 'transfer_create', /* existing fields */ });
  return NextResponse.json({ data: { ...transfer, status: 'pending' } });
}

// result.verdict === 'require_approval' — transfer stays in awaiting_approval
await writeAuditLog({
  action: 'transfer_create_requires_approval',
  details: { approval_request_id: result.approval_request.id, chain_id: result.approval_request.chain_id },
});
return NextResponse.json(
  { data: { ...transfer, status: 'awaiting_approval' }, approval_request: result.approval_request },
  { status: 202 },
);
```

### Why `awaiting_approval` at insert time, flipped to `pending` on `allow_auto`

Defensive ordering. If the gate throws between the insert and the status update, the row is never in a signable `pending` state. A crash or network partition leaves an auditable `awaiting_approval` row rather than a signable `pending` row that bypassed policy.

### `/confirm` endpoint change — lazy post-approval flip

Two additions to the handler:

1. **Lazy materialization of approval outcome onto the transfer row.** When the transfer is still `awaiting_approval`, look up the matching approval request by `movement_id = transfer.id` and flip the transfer status based on the approval's state:

```typescript
if (transfer.status === 'awaiting_approval') {
  const { data: approval } = await supabase
    .from('policy_approval_requests')
    .select('status, denial_reason')
    .eq('movement_id', transfer.id)
    .eq('enterprise_id', enterpriseId)
    .maybeSingle();

  if (approval?.status === 'executed') {
    await supabase.from('transfers').update({ status: 'pending' }).eq('id', transfer.id);
    transfer.status = 'pending';
  } else if (approval?.status === 'denied' || approval?.status === 'cancelled') {
    await supabase.from('transfers')
      .update({
        status: 'denied',
        denial_reason: approval.denial_reason ?? approval.status,
      })
      .eq('id', transfer.id);
    transfer.status = 'denied';
  }
  // else: approval still pending — transfer stays awaiting_approval below
}
```

2. **Status check after materialization.** Only a `pending` transfer can be signed:

```typescript
if (transfer.status !== 'pending') {
  return NextResponse.json(
    { error: 'Transfer is not ready for signing', status: transfer.status },
    { status: 409 },
  );
}
```

The same lazy-flip logic is applied inside `GET /api/transfers/:id` so UI polling sees the updated status without a separate endpoint. This avoids needing a webhook, trigger, or sweeper to propagate approval outcomes into `transfers.status`; the flip happens on the next read of the row.

## 7. Error taxonomy

All failures produce a typed `GateError` extending `PolicyError` with `module='gate'`. Mapping to HTTP:

| Failure | reason_code | HTTP | transfer row state |
|---|---|---|---|
| `evaluate()` threw | `policy_engine_unavailable` | 503 | `denied`, `denial_reason='policy_engine_unavailable'` |
| Canonicalization error from engine | `canonicalization_failed` | 400 | `denied`, `denial_reason='canonicalization_failed'` |
| Verdict=`block` | `policy_blocked` | 403 | `denied`, `denial_reason='policy_blocked'` |
| Verdict=`block_hard_limit` | `hard_limit_breached` | 403 | `denied`, `denial_reason='hard_limit_breached'` |
| `createApprovalRequest()` threw | `approval_creation_failed` | 500 | `denied`, `denial_reason='approval_creation_failed'` |
| `movement.enterprise_id !== actor.enterprise_id` | `enterprise_mismatch` | 403 | `denied`, `denial_reason='enterprise_mismatch'` |

All responses follow the Vantor error convention: `{reason_code, human_readable, user_action, details, trace_id}`. Engine trace is included in `details` when available so CFO and support can see which rule matched.

## 8. Idempotency and races

- `ApprovalWorkflowService.createApprovalRequest` is already idempotent on `(enterprise_id, movement_id)` — a retried POST with the same `movement.id` returns the existing approval request.
- Transfer row insert uses a PK `id` (= `movement.id`) so duplicate inserts fail with a unique-constraint error. Route handles this as a conflict.
- Status flips use the transfer PK — no version column needed because only the route writes here (the approval workflow writes to `policy_approval_requests`, not `transfers`).

When the approval workflow later resolves the approval (via `reEvaluate`), it writes to `policy_approval_requests` — it does NOT write to `transfers`. The post-approval status flip happens **lazily inside `/confirm` and `GET /api/transfers/:id`**: on the next read, if `transfer.status='awaiting_approval'` and the approval request has resolved, the transfer is flipped to `pending` (on `executed`) or `denied` (on `denied`/`cancelled`). See section 6 for the code.

This keeps the plan self-contained — no webhook, trigger, or sweeper required — at the cost of a small pre-check on each `transfers` read. A future plan can replace the lazy flip with an eager push if polling overhead becomes a concern.

## 9. Migration

One new SQL migration:

```sql
-- Add awaiting_approval to transfers.status CHECK constraint
ALTER TABLE transfers DROP CONSTRAINT transfers_status_check;
ALTER TABLE transfers ADD CONSTRAINT transfers_status_check
  CHECK (status IN (
    'pending', 'processing', 'completed', 'failed',
    'cancelled', 'awaiting_approval', 'denied'
  ));

-- Add denial_reason column for audit trail
ALTER TABLE transfers ADD COLUMN denial_reason TEXT;
```

Applies to both dev and prod Supabase. No data backfill needed (existing rows keep their current status).

## 10. Test plan

### Unit tests (`src/lib/policy/gate/gate.test.ts`)

1. `allow_auto` verdict → returns `{verdict: 'allow_auto', evaluation}` without touching approvals.
2. `require_approval` → creates approval request, returns `{verdict: 'require_approval', approval_request, evaluation}`.
3. `block` verdict → throws `GateError` with `policy_blocked`.
4. `block_hard_limit` → throws with `hard_limit_breached`.
5. `evaluate()` throws → throws `GateError` with `policy_engine_unavailable`.
6. Canonicalization error → throws with `canonicalization_failed`.
7. `createApprovalRequest()` throws → throws with `approval_creation_failed`.
8. AI-initiator floor: `initiator.type='agent'` + no rules → `require_approval` (engine behavior regression test).
9. No policy version for enterprise → `allow_auto` (policy is opt-in).
10. `approval_request.movement_id` equals `movement.id` (identity key preserved).
11. Evaluation trace is included in the returned `GateResult`.
12. Enterprise mismatch between `movement.enterprise_id` and `actor.enterprise_id` → throws `enterprise_mismatch`.

### Route-level integration test (`src/app/api/transfers/route.test.ts`)

- 200 + `status='pending'` when gate returns `allow_auto`
- 202 + `approval_request` in body when gate returns `require_approval`
- 403 + structured error body on `block` verdict
- Transfer row state is `denied` with populated `denial_reason` after a block
- `/confirm` returns 409 when transfer is `awaiting_approval` AND approval is still pending
- `/confirm` flips transfer to `pending` and succeeds when the approval is `executed`
- `/confirm` flips transfer to `denied` and returns 409 when the approval is `denied`
- `GET /api/transfers/:id` returns `status='pending'` after an `executed` approval (lazy materialization)

### Mapper tests (`src/lib/policy/gate/movement-mapper.test.ts`)

- Maps a valid crypto_transfer request to a well-formed ProposedMovement
- Generates a fresh UUID as `movement.id` each call
- Correctly populates `initiator.type='human'` and `user_id`
- Preserves chain/asset/amount/memo fields
- Rejects a request body with impossible field combinations (e.g., chain mismatch between wallet and request)

## 11. File layout summary

| Path | Purpose | Lines |
|---|---|---|
| `src/lib/policy/gate/gate.ts` | `PolicyGateService` class | ~150 |
| `src/lib/policy/gate/gate.test.ts` | unit tests | ~300 |
| `src/lib/policy/gate/errors.ts` | `GateError` class | ~30 |
| `src/lib/policy/gate/errors.test.ts` | error tests | ~40 |
| `src/lib/policy/gate/movement-mapper.ts` | body → ProposedMovement | ~60 |
| `src/lib/policy/gate/movement-mapper.test.ts` | mapper tests | ~80 |
| `src/lib/policy/gate/http.ts` | error → HTTP response mapping | ~40 |
| `src/lib/policy/gate/http.test.ts` | HTTP tests | ~60 |
| `src/lib/policy/gate/index.ts` | barrel | ~20 |
| `src/lib/policy/index.ts` | add `export * from './gate';` | +1 |
| `src/app/api/transfers/route.ts` | integrate gate into POST | ~+50 |
| `src/app/api/transfers/confirm/route.ts` | status check on `/confirm` | ~+5 |
| `src/app/api/transfers/route.test.ts` | integration tests | ~250 |
| `supabase/migrations/XXXX_transfers_awaiting_approval.sql` | schema migration | ~15 |

Total new or changed: ~1,100 lines of code + ~730 lines of tests.

## 12. Tier classification for plan tasks

The implementation plan will mark these tasks as **TIER 1 (adversarial review)**:
- Gate core logic (verdict dispatch, error mapping, approval-request creation)
- Route integration (the `POST /api/transfers` modifications, especially the status flip ordering)
- Lazy post-approval flip in `/confirm` and `GET /api/transfers/:id` (enterprise scoping and status transition correctness)

All other tasks (types, errors, HTTP helpers, barrel, migration, mapper) are TIER 2.

## 13. Known follow-ups (not in scope)

- Replacing the lazy post-approval flip (section 6) with an eager push (webhook, trigger, or sweeper) if polling overhead becomes a concern at scale.
- Removing the `stub_no_engine` audit tag from `ApprovalWorkflowService.reEvaluate()` once the HTTP handler for approvals is updated to inject the real `evaluate` function.
- Extending the gate to other money-movement callsites: yield, payments, bridges, swaps, ramps, scheduled-operations.
- Approvals dashboard UI (`/approvals` page) for treasurers to action pending requests (Plan 3).
- Snapshot `rule_authors` onto approval_request at creation time (Plan 2b follow-up).
