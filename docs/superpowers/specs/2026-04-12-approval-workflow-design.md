# Approval Workflow Service (Plan 2b) Design Spec

> **Prerequisite:** Plan 1 (evaluation engine, 432 tests) and Plan 2a (authoring API, 127 tests) are merged to master. The `enterprise_admin` role is live.

## Goal

Build the runtime approval workflow: when the evaluation engine returns `verdict='require_approval'`, create an approval request, let authorized users fill slots with SoD enforcement, re-evaluate against the current active policy on completion, and execute or deny. Sweep expired requests via cron.

## Scope

### In scope (Plan 2b)
- `ApprovalWorkflowService` class with full state machine
- Slot-filling with SoD validation and optimistic concurrency
- Re-evaluation against current active policy after all slots filled
- Manual denial and cancellation
- Expiration sweeper (Vercel cron, 15-minute interval)
- Email notifications via existing `actionNotificationEmail` template
- HTTP routes for all approval actions
- Tier 1 adversarial review on `fillSlot` and `reEvaluate`

### Out of scope (deferred)
- Escalation with slot carry-forward (Plan 2c) — denied with `stale_reeval` instead
- `gateMoneyMovement()` integration (Plan 2c) — `createApprovalRequest()` is exported but not wired
- `approver`/`executive` role tiers (Plan 3) — works with existing 4 roles
- In-app notification inbox (Plan 3) — email only
- Approval dashboard UI (Plan 3)
- Simulation of approval flows (Plan 3)

## Architecture

Two-layer split matching Plan 2a: `ApprovalWorkflowService` owns business logic, thin Next.js route handlers parse requests and delegate. Service takes `SupabaseLike` via constructor (same DI pattern as `PolicyAuthoringService`).

New module at `src/lib/policy/approvals/` — separate from `authoring/` since approvals are runtime (live transactions) vs authoring (policy editing).

## State Machine

```
create → pending
pending → approved  (all slots filled)
approved → executed (re-eval confirms verdict, gate executes)
approved → denied   (re-eval returns block/block_hard_limit, denial_reason='stale_reeval')
pending → denied    (manual denial, denial_reason='manual')
pending → denied    (sweeper expires, denial_reason='expired')
pending → cancelled (initiator or enterprise_admin/policy_admin cancels)
```

No `escalated` state — if re-eval returns a different chain, deny with `stale_reeval` and the user re-initiates. Escalation with slot carry-forward deferred to Plan 2c.

Terminal states: `executed`, `denied`, `cancelled`. Only `pending` and `approved` are mutable.

## Database

No new migrations — `policy_approval_requests` table already exists from migration 0038 with:
- `id`, `enterprise_id`, `version_id` (pinned at creation), `movement_id` (idempotency)
- `proposed_movement` (JSONB), `triggered_rule_ids` (UUID[]), `chain_id`
- `slot_assignments` (JSONB array), `status`, `denial_reason`
- `expires_at`, `version` (optimistic lock counter)
- `created_by`, `created_at`, `approved_at`, `resolved_at`, `resolution_notes`
- DELETE forbidden by DB rule (append-only audit trail)
- Partial index on `(enterprise_id, expires_at) WHERE status='pending'` for sweeper

## Service Methods

### `createApprovalRequest(movement, chain, triggeredRuleIds, createdBy)`
Called by the gate (Plan 2c) when `verdict='require_approval'`.
- Inserts row: status=`pending`, computes `expires_at = now() + chain.expiration_hours`
- Initializes `slot_assignments` from chain slots (all unfilled)
- Sets `version_id` to current active policy version (pinned)
- Emails all eligible approvers
- Returns created request

### `fillSlot(requestId, approverId, justification)`
The main approval action.
1. Load request with optimistic lock (`version` column)
2. Verify `status='pending'`
3. Run SoD checks (see below)
4. Find first unfilled slot with `minimum_role <= approver.role`
5. Update `slot_assignments[slot_index]` with `{filled_by, filled_at, justification}`
6. Write with `WHERE version = N` — return `approval_concurrent_modification` on miss
7. If all slots filled → transition to `approved`, call `reEvaluate()` inline
8. Email: progress notification to remaining approvers + initiator

### `reEvaluate(requestId)` (private)
Called after all slots filled.
1. Load original `proposed_movement` from request
2. Call `EvaluationEngine.evaluate()` against **current** active version
3. Decision matrix:
   - `require_approval` + same chain → `executed` (approval stands)
   - `require_approval` + different chain → `denied(stale_reeval)`
   - `block` / `block_hard_limit` → `denied(stale_reeval)`
   - `allow_auto` → `executed` (policy relaxed since request created)
4. On `executed`: stub call to gate adapter (Plan 2c wires this)
5. Email initiator with outcome

### `deny(requestId, denierId, justification)`
Manual denial.
- Requires `status='pending'`
- Any `treasury_manager`+ in the enterprise can deny
- Transitions to `denied(manual)`
- Emails initiator

### `cancel(requestId, cancellerId)`
- Requires `status='pending'`
- Must be original initiator OR `is_policy_admin=true` OR `enterprise_admin` role
- Transitions to `cancelled`
- Emails initiator (if different from canceller)

### `sweepExpired(batchSize = 100)`
- `SELECT ... WHERE status='pending' AND expires_at < now() FOR UPDATE SKIP LOCKED LIMIT $batchSize`
- Batch update to `denied(expired)`
- Emails each initiator
- Returns count of expired requests

### `getRequest(requestId, actor)` / `listRequests(actor, filters)`
Read operations, enterprise-scoped. `listRequests` supports status filter, date range, pagination (cursor-based).

## Separation of Duties (SoD)

Pure function `validateSoD(request, approverId, approverRole, ruleAuthors)` checks 4 conditions:

1. **`sod_initiator_conflict`** — `approverId === request.created_by`
2. **`sod_rule_editor_conflict`** — `approverId` authored any rule in `triggered_rule_ids` (lookup `policy_rules.created_by`)
3. **`sod_already_filled`** — `approverId` already filled any slot on this request
4. **`no_matching_slot`** — no unfilled slot with `minimum_role <= approverRole`

Each returns the typed reason code. Checks run in order; first failure stops.

## Optimistic Concurrency

The `version` integer column on `policy_approval_requests` prevents lost-update races:

1. Service reads request including `version`
2. Performs SoD checks, finds matching slot
3. Writes with `UPDATE ... SET slot_assignments = $new, version = version + 1 WHERE id = $id AND version = $expectedVersion`
4. If 0 rows affected → throw `approval_concurrent_modification`
5. Client retries (GET fresh state, re-attempt)

## Email Notifications

All emails use `actionNotificationEmail` from `src/lib/notifications/email-templates.ts` (dark theme, detail rows table, teal gradient CTA button).

| Event | Recipients | CTA |
|-------|-----------|-----|
| Request created | All eligible approvers | "Review Approval" → `/approvals/{id}` |
| Slot filled (partial) | Remaining approvers + initiator | "View Progress" → `/approvals/{id}` |
| Executed | Initiator | "View Transaction" → `/transactions` |
| Denied (any reason) | Initiator | "View Details" → `/approvals/{id}` |
| Expired | Initiator | "View Details" → `/approvals/{id}` |
| Cancelled | Initiator (if different from canceller) | "View Details" → `/approvals/{id}` |

"Eligible approvers" = enterprise users with `role` rank >= the chain's lowest `minimum_role` slot.

## File Structure

### New files under `src/lib/policy/approvals/`
- `types.ts` — `ApprovalRequest`, `SlotAssignment`, `ApprovalStatus`, `DenialReason`, DTOs
- `errors.ts` — `ApprovalError` extending `PolicyError`
- `errors.test.ts`
- `sod.ts` — SoD validation, pure function
- `sod.test.ts` — 10-15 tests (hostile payloads for each SoD condition)
- `service.ts` — `ApprovalWorkflowService` class
- `service.test.ts` — 25-35 tests
- `sweeper.ts` — `sweepExpired()` extracted for testability
- `sweeper.test.ts` — 5-8 tests
- `notifications.ts` — approval email builders
- `notifications.test.ts` — 3-5 tests (template rendering)
- `http.ts` — `mapApprovalErrorToHttp()` + shared handler
- `http.test.ts` — 5-8 tests
- `index.ts` — barrel export

### HTTP routes
- `GET /api/policy/approvals` — list (query: `status`, `limit`, `cursor`)
- `GET /api/policy/approvals/[id]` — detail with slot assignments
- `POST /api/policy/approvals/[id]/approve` — body: `{justification: string}`
- `POST /api/policy/approvals/[id]/deny` — body: `{justification: string}`
- `POST /api/policy/approvals/[id]/cancel` — body: `{reason?: string}`
- `POST /api/cron/sweep-policy-approvals` — body: `{limit?: number}`

### Modified files
- `vercel.json` — add cron: `POST /api/cron/sweep-policy-approvals` every 15 min
- `src/lib/policy/index.ts` — add `export * from './approvals'`

## Reason Codes (all pre-existing in Plan 1)

| Code | HTTP | When |
|------|------|------|
| `approval_not_pending` | 409 | fillSlot/deny/cancel on non-pending request |
| `sod_initiator_conflict` | 403 | approver is the movement initiator |
| `sod_rule_editor_conflict` | 403 | approver authored a triggering rule |
| `sod_already_filled` | 409 | approver already filled a slot |
| `no_matching_slot` | 400 | no unfilled slot at approver's role level |
| `approval_concurrent_modification` | 409 | optimistic lock conflict |
| `stale_approval_reevaluation_failed` | 409 | re-eval changed the verdict |
| `requires_policy_admin` | 403 | cancel by non-initiator non-admin |

## Testing Strategy

- SoD checks: pure function, unit tested with hostile payloads (10-15 tests)
- Service: in-memory mock Supabase (same pattern as Plan 2a), 25-35 tests
- Sweeper: time-mocked fixtures, 5-8 tests
- Integration: create → fill slots → re-eval → executed flow
- **Tier 1 adversarial review** on `fillSlot` (SoD + concurrency gate) and `reEvaluate` (stale-policy decision point)

## Integration with Plan 2c

Plan 2b exports `ApprovalWorkflowService` and `createApprovalRequest()`. Plan 2c's `gateMoneyMovement()` will:
1. Call `EvaluationEngine.evaluate()`
2. If `require_approval`: resolve chain from matched rules, call `createApprovalRequest()`
3. Return `202 Accepted` with `approval_request_id`

The `reEvaluate()` method's "execute" path is a stub in Plan 2b — it marks status=`executed` but doesn't call the actual blockchain/bank adapter. Plan 2c wires the adapter.
