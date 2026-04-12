# RBAC Hierarchy — Roles, Separation of Duties, and Approval Enforcement

**Branch:** `feature/rbac-hierarchy` (rebased onto master `9e68e1b` after PRs #5/#6/#7/#8 merged)
**Worktree:** `.worktrees/rbac-hierarchy/`
**Author:** Claude Opus 4.6 (planning session)
**Date:** 2026-04-12 — scope trimmed after Plan 2b (PR #6) landed
**Status:** DRAFT — awaiting user review before execution

## What changed from v1 of this plan

Plan 2b (`src/lib/policy/approvals/`) merged to master in PR #6 before this plan was executed. It landed a lot of what v1 of this plan was going to build. Summary of the delta — see §2.5 for specifics:

- ✅ Role rank hierarchy **is built** in `approvals/sod.ts` (`COMBINED_ROLE_RANK`, `roleSatisfiesSlot`) — includes `executive` at rank 4
- ✅ Distinct-approver enforcement **is built** (`sod_already_filled` check)
- ✅ Author-approver separation **is built** (`sod_rule_editor_conflict`) — but hardcoded strict, not yet configurable
- ✅ Initiator-approver separation **is built** (`sod_initiator_conflict`) — bonus, not in v1 plan
- ❌ DB `user_role` enum does NOT yet have `executive` — TS knows the role but no user can be assigned it
- ❌ Source of truth is still drifting across DB enum / `ApproverRole` TS type / `COMBINED_ROLE_RANK` map
- ❌ `enterprise_admin` strict exclusion is accidental (rank -1) — needs explicit check
- ❌ Author-approver separation not configurable per enterprise
- ❌ `treasury_manager` still has authoring permission (not transferred to `enterprise_admin`)
- ❌ Chain authoring guardrails, default ladder seed, UI — all remain to do

---

## 1. Goals

1. **Align role model across DB, TS types, runtime validation, and UI.** Today `user_role` enum, `ApproverRole` union, `VALID_SLOT_ROLES` runtime Set, and the Account Management UI each carry a slightly different list. Pick one source of truth.
2. **Add `executive` role** between `treasury_manager` and `enterprise_admin` — CFO/Treasurer-level approver who can approve high-threshold chains but cannot author policies.
3. **Enforce separation of duties:**
   - `enterprise_admin` cannot approve transfers (strict).
   - `treasury_manager` cannot author policies (removal of current permission).
   - Author-approver separation on the same policy version is **configurable per enterprise** (default: on).
4. **Encode hierarchy.** Slot matching uses role rank (`executive ≥ treasury_manager ≥ accountant ≥ auditor`) instead of equality. One `executive` satisfies a slot that requires `treasury_manager` minimum.
5. **Enforce distinct approvers on multi-slot chains.** Two slots = two *distinct user_ids*. Today the satisfiability checker counts distinct ranks, not distinct users (`satisfiability.ts:49-101`).
6. **Authoring guardrails.** Validation-time checks: if a rule routes to a chain with amount > $N, chain must have ≥ M slots. Prevents a policy author from writing a "$10M → single accountant approval" chain.
7. **Seed default approval ladder** for new enterprises: `$50K / $500K / $1M` with one / two / executive-required slots.
8. **Map every permission in the Account Management UI** — users see who can do what, and role-change actually persists (fix suspected bug at `settings/accounts/page.tsx:189`).

---

## 2. Role model

### Roles — final list (ordered, lowest to highest rank)

| Role | Rank | Can author policies | Can approve | Notes |
|---|---|---|---|---|
| `auditor` | 1 | ❌ | ✅ (when explicitly placed on chain) | Read-only elsewhere |
| `accountant` | 2 | ❌ | ✅ (low-threshold slots) | Reconcile + approve |
| `treasury_manager` | 3 | ❌ **(removed)** | ✅ (standard slots) | Day-to-day operator |
| **`executive` (NEW)** | 4 | ❌ | ✅ (required for high-threshold slots) | CFO/Treasurer |
| `enterprise_admin` | 5 | ✅ | ❌ **(strict)** | Policy author + user admin |

Rank is a **monotonic integer**. Slot matching: `user_can_fill(slot) iff user.role !== 'enterprise_admin' AND rank(user.role) >= rank(slot.minimum_role)`.

### Why strict exclusion of `enterprise_admin` from approval
They write the policy. Letting them also approve under it collapses the dual-control principle that the chain model exists to enforce.

### Why author-approver separation is configurable (not strict)
Small orgs with a single `enterprise_admin` and two `treasury_manager`s may legitimately have the same person authoring *and* approving (e.g. they self-serve during bootstrap). Default **on**; expose as an enterprise setting for the rare case someone needs to disable it with a clear audit trail.

### `is_policy_admin` flag — retiring
**Retiring entirely.** Role becomes the single source of truth for policy-authoring capability. Rationale:

- The whole point of this redesign is clean role hierarchy. A per-user override flag is a loophole that undermines that hierarchy.
- Our `enterprise_admin` is already narrower than a typical "admin" (strict approval exclusion, can't touch money directly). So elevating a user to `enterprise_admin` to grant them policy-author power isn't the dangerous ask it would be in a typical system.
- Small orgs wanting a dedicated policy specialist can just provision multiple `enterprise_admin` users.
- One source of truth = one mental model, fewer code paths to test, clearer Permission Map UI.

**Migration path for existing users:**
- Any row with `is_policy_admin=true AND role != 'enterprise_admin'` → upgrade to `role = 'enterprise_admin'`. They keep their power, we keep the clean model.
- The `is_policy_admin` column gets dropped in a follow-up migration (not this one — keep the drop isolated so a rollback path exists for 1-2 weeks).

---

## 2.5 Inventory: what Plan 2b (PR #6) already built

Read these before writing any code — much of the approval-side work is done.

### `src/lib/policy/approvals/sod.ts`
```ts
const COMBINED_ROLE_RANK: Record<string, number> = {
  auditor: 0,
  accountant: 1,
  treasury_manager: 2,
  approver: 3,          // ← to be REMOVED (not in user/product model)
  executive: 4,
};

function roleSatisfiesSlot(approverRole, slotMinimumRole) {
  // rank >= rank check. enterprise_admin not in map → rank -1 → returns false (accidental exclusion).
}

export function validateSoD(params) {
  // Order: initiator conflict → rule-editor conflict → already filled slot → no matching slot.
  // Returns { ok: true, slot_index } | { ok: false, reason_code }.
}
```

### Approval service + HTTP + notifications + sweeper
- `approvals/service.ts` (651 lines): full approval request lifecycle — create, approve, deny, cancel.
- `approvals/http.ts`: HTTP wrapper used by route handlers.
- `approvals/notifications.ts`: approval-lifecycle emails.
- `approvals/sweeper.ts`: expires stale requests past `expires_at`.
- Routes: `POST /api/policy/approvals`, `POST /api/policy/approvals/[id]/{approve,deny,cancel}`, `GET /api/policy/approvals/[id]`.

### Reason codes added in PR #6
- `sod_initiator_conflict`
- `sod_rule_editor_conflict`
- `sod_already_filled`
- `no_matching_slot`

### What this PR should NOT re-implement
- The SoD check order, approval lifecycle, slot-fill tracking, HTTP endpoints, notification copy, sweeper.

### What this PR MUST modify in the existing approvals module
- `COMBINED_ROLE_RANK`: remove `approver`, add explicit `enterprise_admin: -1` (or branch on role), import from the new `roles.ts` single source of truth.
- `validateSoD`: read `enterprise_rbac_settings.author_approver_separation_enabled` and skip the `sod_rule_editor_conflict` step when it's `false`.
- Explicit reason code for `enterprise_admin` attempting to approve (e.g. `enterprise_admin_cannot_approve`) instead of the current accidental `no_matching_slot` fallthrough.

---

## 3. Database changes

### Migration `0049_rbac_hierarchy.sql`
(Next free after `0048_customer_insight_settings.sql` from PR #5. PRs #6 and #7 did not add migrations.)

```sql
-- 1. Add 'executive' to user_role enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'executive';

-- 2. Add enterprise-level settings table for RBAC config
CREATE TABLE IF NOT EXISTS enterprise_rbac_settings (
  enterprise_id UUID PRIMARY KEY REFERENCES enterprises(id) ON DELETE CASCADE,
  author_approver_separation_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS + grants + updated_at trigger — follow 0048 pattern

-- 3. Data migration — upgrade anyone who currently has authoring power
--    via is_policy_admin=true but whose role isn't enterprise_admin.
--    Keeps them powered; retires the flag as a gate in favor of pure
--    role-based gating. The column itself is dropped in a follow-up
--    migration (keeping a 1-2 week rollback window).
UPDATE user_profiles
SET role = 'enterprise_admin'
WHERE is_policy_admin = true
  AND role != 'enterprise_admin';
```

### Follow-up migration `00XX_drop_is_policy_admin.sql` (separate PR, 1-2 weeks later)
Dropped separately to preserve a rollback path:
```sql
ALTER TABLE user_profiles DROP COLUMN is_policy_admin;
```

### Seed
For each active enterprise without a default approval ladder, seed three chains + three rules (the `$50K / $500K / $1M` ladder). Idempotent — detect existing chains by name. Implemented in a TS script, not in the SQL migration (seed logic lives in `scripts/seed-*`).

---

## 4. Code changes

### 4.1 Single source of truth: role definitions
New file `src/lib/auth/roles.ts`:
```ts
export const APPROVER_ROLES = ['auditor', 'accountant', 'treasury_manager', 'executive'] as const;
export const ALL_ROLES = [...APPROVER_ROLES, 'enterprise_admin'] as const;

export type ApproverRole = (typeof APPROVER_ROLES)[number];
export type UserRole = (typeof ALL_ROLES)[number];

export const ROLE_RANK: Record<UserRole, number> = {
  auditor: 1,
  accountant: 2,
  treasury_manager: 3,
  executive: 4,
  enterprise_admin: 5,
};

export function canFillSlot(userRole: UserRole, slotMinimumRole: ApproverRole): boolean {
  if (userRole === 'enterprise_admin') return false; // strict separation
  return ROLE_RANK[userRole] >= ROLE_RANK[slotMinimumRole];
}
```

Existing `ApproverRole` at `src/lib/policy/types/verdict.ts:50` becomes a re-export of this. Runtime `VALID_SLOT_ROLES` becomes a re-export too. Remove the drift.

### 4.2 Rewrite `permissions.ts`
`src/lib/policy/authoring/permissions.ts` currently gates authoring on `treasury_manager`. Rewrite:
- `canViewActivePolicy`: any role (read)
- `canCreateDraft`: `role === 'enterprise_admin'` (pure role check — `is_policy_admin` flag no longer consulted)
- `canEditDraftRules`, `canEditDraftChains`: same as `canCreateDraft`
- `requirePolicyAdmin` (already exists, used for activation + hard-limits): same check

**Impact:** all existing `treasury_manager` users lose authoring ability immediately on merge. Any current user with `is_policy_admin=true AND role != 'enterprise_admin'` is upgraded to `enterprise_admin` by the migration backfill so they don't silently lose power. No pre-merge comms (per user direction) — ship and let people discover.

### 4.3 Satisfiability checker — distinct-user check (STILL NEEDED at authoring time)
`src/lib/policy/authoring/satisfiability.ts:49-101`. The **runtime** distinct-approver check landed in PR #6 via `sod_already_filled`. But the **authoring-time** satisfiability check still counts distinct ranks, not distinct users — which means authoring UI can warn "this chain is satisfiable" when at runtime it actually isn't.

Fix at authoring time:
- Track `assigned_user_ids: Set<string>` during rank matching
- A user can only fill one slot per chain in the satisfiability calculation
- Return the existing `unsatisfied_slots[]` plus a new `distinct_approver_violation: boolean` when enough rank-qualified users exist but not enough *distinct* ones

This closes the gap between authoring-time feedback and runtime enforcement.

### 4.4 Chain authoring guardrails
`src/lib/policy/authoring/validation.ts`. New check in `validateApprovalChainInput`:
- If any rule in the same version has `verdict='require_approval'` + `verdict_chain_id=this.id` + an `amount_compare` condition with `op='>'` and `value >= $500K`, enforce `chain.slots.length >= 2`.
- If `>= $1M`, additionally enforce at least one slot with `minimum_role >= 'executive'`.

Configurable later — start with these two thresholds hardcoded as constants named at the top of the file.

### 4.5 Route guards
- `/api/policy/versions/**` authoring endpoints: swap `canCreateDraft` for the new role check.
- New endpoint: `POST /api/enterprise/rbac-settings` for toggling `author_approver_separation_enabled`. Gated on `enterprise_admin` only.

### 4.6 Seed script
`scripts/seed-default-approval-ladder.ts` — given an enterprise_id, creates the three default chains + rules if absent. Idempotent via name-based lookup.

---

## 5. Account Management UI

**Approach:** load UX skills at the start of this step (`ecc:frontend-design`, `ecc:design-system`). Apply Vantor UI kit patterns from memory (`reference_vantor_ui_kit.md`) — no hand-rolled components if a shared one exists.

### 5.1 Fix the suspected role-change bug
`src/app/(app)/settings/accounts/page.tsx:189` — `handleRoleChange` must call the role-update API, not just local state. Verify during TDD.

### 5.2 Permission map section (NEW)
Add a "Permissions" section to the Accounts page that visibly maps role → capabilities. Roughly:

```
┌─ Roles & Permissions ────────────────────────────────────────┐
│                                                              │
│   Enterprise Admin   ✓ Author policies   ✗ Approve transfers │
│   Executive         ✗ Author policies   ✓ Approve (high)     │
│   Treasury Manager  ✗ Author policies   ✓ Approve (standard) │
│   Accountant        ✗ Author policies   ✓ Approve (low)      │
│   Auditor           ✗ Author policies   ✓ Approve (if placed)│
│                                                              │
│   [?] Author-approver separation is enabled                  │
│       [ Configure → ]                                        │
└──────────────────────────────────────────────────────────────┘
```

Use Vantor `Card`, `Badge` (muted-tint system), `InfoTooltip` for the `[?]` affordance. Toggle for author-approver separation opens a confirmation dialog.

### 5.3 RolePicker updates
Extend the existing `RolePicker` component (lines 79-139) to include `executive`. Visual differentiation for `enterprise_admin` (maybe a shield icon) to signal "super-user, cannot approve."

---

## 6. Seed data + migration strategy

1. On deploy:
   - Migration adds `executive` to enum and creates `enterprise_rbac_settings`.
   - One-time backfill script creates `enterprise_rbac_settings` rows for every existing enterprise (default separation on).
   - Seed script runs per-enterprise to create default chains (skipped if chains already exist).
2. Existing `treasury_manager` users with `is_policy_admin=true` are kept — but `canCreateDraft` returns false for them under the new logic. Ship with a clear release note; flag affected users pre-merge via a DB query.
3. Existing approval chains are untouched. New authoring guardrails apply going forward only; in-flight chains are grandfathered.

---

## 7. Test plan

### Unit
- `roles.ts`: `canFillSlot` truth table across all 5×5 combos including enterprise_admin strict-exclusion.
- `satisfiability.ts`: distinct-user enforcement — chain with 2 slots needs 2 users, not 1 user who could fill both on rank.
- `validation.ts`: chain-size guardrails — $500K / 1-slot chain rejected; $500K / 2-slot accepted.
- `permissions.ts`: every combination of role × is_policy_admin × gate function.

### Integration
- Seed + evaluate: new enterprise auto-gets the $50K/$500K/$1M ladder; a $750K transfer routes to the 2-slot chain.
- Author-approver separation on: same user who wrote the version cannot appear in `slot_assignments.filled_by` for a movement that version gates.
- Author-approver separation off: same scenario passes.

### UI
- Role change persists to DB (regression test for the suspected bug).
- Permission map renders accurately for all 5 roles.
- RolePicker includes `executive`; shield icon on `enterprise_admin`.

**Target:** ~30-40 new tests, broken down ~60% unit / 30% integration / 10% UI.

---

## 8. Out of scope

- **Approval runtime itself.** Already built in PR #6; this PR only tweaks `sod.ts` to (a) consume roles from the new single source of truth, (b) honor the configurable separation toggle, and (c) produce a distinct reason code for `enterprise_admin` blocks. No lifecycle or endpoint changes.
- **Chain-size guardrails as enterprise-configurable thresholds.** Start hardcoded. If needed, move to `enterprise_rbac_settings` later.
- **Role-based field-level redaction.** Auditor-only views, etc. Separate workstream.
- **SSO-provisioned roles.** Out of scope.
- **Email notification copy** for role changes and separation toggles. Separate cleanup.

---

## 9. Risk register

| Risk | Mitigation |
|---|---|
| Existing `treasury_manager` users lose authoring on merge | Pre-merge: query affected users, communicate. Post-merge: they still see active policies, just can't edit drafts. Reversible via role change. |
| Slot matching change produces different chain satisfiability verdicts | Pre-merge: dry-run satisfiability on every existing active version across enterprises, diff verdicts. |
| Guardrails reject in-flight draft chains | Grandfather: guardrails apply only to new chain creation in this version. Existing draft chains pass through. |
| Author-approver separation default=on blocks in-flight approvals | Seed `enterprise_rbac_settings` with `author_approver_separation_enabled=false` for any enterprise that already has open approval requests with self-authored policies. Opt-in flip after. |

---

## 10. Task breakdown (revised)

In suggested execution order. Each task produces an intermediate commit. Tasks marked `[sod.ts]` touch the existing `src/lib/policy/approvals/sod.ts` from PR #6 surgically.

1. **Roles module** — `src/lib/auth/roles.ts` with `ROLE_RANK`, `canFillSlot`, `ApproverRole`, `UserRole`, and an explicit rule that `enterprise_admin` can never fill slots. Unit tests.
2. **Database migration `0049_rbac_hierarchy.sql`** — add `executive` to `user_role` enum; create `enterprise_rbac_settings` table with `author_approver_separation_enabled` boolean default true. Apply to dev.
3. **Consolidate TS sources** — `ApproverRole` at `src/lib/policy/types/verdict.ts` becomes a re-export of `roles.ts`. `VALID_SLOT_ROLES` in `src/lib/policy/authoring/validation.ts` becomes a re-export. Delete drift.
4. **`[sod.ts]` — align rank map** — replace local `COMBINED_ROLE_RANK` with import from `roles.ts`. Remove `approver`. Add explicit `enterprise_admin` exclusion path with new reason code `enterprise_admin_cannot_approve` (register in `REASON_CODES`).
5. **`[sod.ts]` — configurable author-approver separation** — accept an optional `authorApproverSeparationEnabled: boolean` param (default true). When false, skip the `sod_rule_editor_conflict` check. Plumb the flag through from the approval service: read from `enterprise_rbac_settings` once per request.
6. **Rewrite `permissions.ts`** — `canCreateDraft` / `canEditDraftRules` / `canEditDraftChains` now require `enterprise_admin` (or non-`treasury_manager` with `is_policy_admin`). `requirePolicyAdmin` aligned. Unit tests.
7. **Satisfiability distinct-user fix** — `src/lib/policy/authoring/satisfiability.ts`. Match authoring-time output to runtime reality. Unit + integration tests.
8. **Chain authoring guardrails** — `src/lib/policy/authoring/validation.ts`. $500K→2 slots, $1M→executive slot. Unit tests.
9. **New endpoint** — `POST /api/enterprise/rbac-settings` for toggling `author_approver_separation_enabled`. Gated on `enterprise_admin` only.
10. **Seed script** — `scripts/seed-default-approval-ladder.ts`. Idempotent per-enterprise $50K/$500K/$1M chain + rule creation.
11. **Backfill script** — create `enterprise_rbac_settings` rows for existing enterprises. Idempotent. (Can be rolled into the seed script.)
12. **UI (load `ecc:frontend-design` + `ecc:design-system` skills before starting)** — fix suspected role-change persistence bug at `settings/accounts/page.tsx:189`; add Permission Map card; extend RolePicker with `executive` + `enterprise_admin` (shield icon); add separation-toggle UI for `enterprise_admin`.
13. **Release note in CHANGELOG / PR description** — list what changed for admins (new role, new ladder, removed flag). No pre-merge outreach per user direction; users discover on next login.

Each task is reviewable independently. Target ~1.5-2 days of focused work total (shorter than v1 because the approval runtime pieces are done).

---

## Open questions

All resolved — see "Decisions already confirmed" below.

## Decisions already confirmed (2026-04-12)

- New role name: **`executive`** (between `treasury_manager` and `enterprise_admin`)
- `enterprise_admin` → **strict** separation of duties, cannot approve
- `treasury_manager` → **loses** authoring permission (transferred to `enterprise_admin`)
- Author-approver separation → **configurable** per enterprise (default on)
- Default ladder thresholds → **$50K / $500K / $1M**
- Every permission **visibly mapped** on Account Management page
- Load UX skills (`ecc:frontend-design`, `ecc:design-system`) before Task 12
- Migration number: **`0049_rbac_hierarchy.sql`**
- Reason code for `enterprise_admin` attempting to approve: **`enterprise_admin_cannot_approve`** (specific, not generic)
- `is_policy_admin` flag: **retire** in favor of pure role-based gating; migration upgrades affected users to `enterprise_admin`; column drop in a follow-up migration 1-2 weeks later
- Pre-merge user comms: **skip** — ship and let people discover
