# Policy Authoring API (Plan 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the REST API + supporting service layer for authoring treasury policy versions — creating drafts, editing rules / hard limits / approval chains, validating, diffing, and activating.

**Architecture:** Two-layer split: a pure `PolicyAuthoringService` class owns all business logic (validation cascade, permissions, activation transaction, diff, clone, satisfiability), and thin Next.js route handlers parse requests and map service results to HTTP status codes. The service pattern means business logic is testable without HTTP mocks and a future `gateMoneyMovement()` (Plan 2c) can reuse it.

**Tech Stack:** Next.js 14 App Router, NextAuth (JWT, no adapter), Supabase (admin client for writes), zod (schemas from Plan 1), Vitest, TypeScript strict. Reuses all of Plan 1's policy engine library (`src/lib/policy/*`).

**Worktree discipline:** Create and work in `.worktrees/policy-authoring` on branch `feature/policy-authoring`. Verify `pwd` and `git branch --show-current` before any git op. See `CLAUDE.md` for the "never work in main checkout" rule.

**Plan 1 dependencies (already on master):** canonicalizer, IR evaluator, hard-limit checker, context loader, verdict composer, main `EvaluationEngine`, all types from `src/lib/policy/types/`, all schemas from `src/lib/policy/schemas/`, `REASON_CODES` enum (which already contains every authoring-specific code: `requires_policy_admin`, `version_not_draft`, `rule_priority_collision`, `activation_reason_too_short`, `activation_race_conflict`, `activation_blocked_by_validation`, `chain_unsatisfiable_at_activation`, `hard_limit_value_out_of_range`, `chain_reference_not_found`, `condition_ir_type_mismatch`, `condition_ir_schema_invalid`, `usd_rule_on_rateless_asset`).

**DB schema (already on master, migration 0034):** `policy_policies`, `policy_versions`, `policy_rules`, `policy_hard_limits`, `policy_approval_chains`, `policy_activation_events`, plus `user_profiles.is_policy_admin` column. Triggers enforce append-only on non-draft versions.

---

## File structure

### New files under `src/lib/policy/authoring/`

- `errors.ts` — `AuthoringError` class extending `PolicyError`, structured fail shape
- `errors.test.ts` — 4-6 tests
- `types.ts` — request DTOs, `PolicyVersionRow`, `AuthoringResult`, `PermissionContext`
- `permissions.ts` — `requirePolicyAdmin(userId)`, `canViewActivePolicy(role)`, `canEditDraft(role)`
- `permissions.test.ts` — 8-10 tests
- `validation.ts` — save-time validation cascade (zod + semantic checks for rules, hard limits, chains, whole version)
- `validation.test.ts` — 15-25 tests
- `diff.ts` — pure `computeVersionDiff(before, after)` function
- `diff.test.ts` — 6-8 tests
- `service.ts` — `PolicyAuthoringService` class with all business methods
- `service.test.ts` — 25-40 tests (uses a mocked Supabase client)
- `satisfiability.ts` — `checkChainSatisfiability(chain, userBase)` pure function
- `satisfiability.test.ts` — 5-8 tests
- `index.ts` — barrel export

### New Next.js routes under `src/app/api/policy/`

```
active/route.ts                                     GET
versions/route.ts                                   GET list, POST create draft
versions/[id]/route.ts                              GET detail, DELETE draft
versions/[id]/activate/route.ts                     POST
versions/[id]/clone/route.ts                        POST
versions/[id]/diff/[otherId]/route.ts               GET
versions/[id]/rules/route.ts                        POST create rule
versions/[id]/rules/[ruleId]/route.ts               PATCH, DELETE
versions/[id]/rules/validate/route.ts               POST dry-run
versions/[id]/hard-limits/route.ts                  POST create
versions/[id]/hard-limits/[limitId]/route.ts        PATCH, DELETE
versions/[id]/approval-chains/route.ts              POST create
versions/[id]/approval-chains/[chainId]/route.ts    PATCH, DELETE
versions/[id]/satisfiability/route.ts               POST
```

### Modified files

- `src/lib/policy/index.ts` — add authoring module exports

### Out of scope for Plan 2a (deferred to 2b / 2c)

- Runtime approval endpoints (`/api/policy/approvals/*`) — Plan 2b
- Evaluation log read endpoints (`/api/policy/evaluations/*`) — Plan 2c
- Simulation endpoints — Plan 3
- Cron sweeper (`/api/cron/sweep-policy-approvals`) — Plan 2b
- `gateMoneyMovement()` — Plan 2c
- `is_policy_admin` bootstrap + 7-day review banner — Plan 2c
- Data migration from `treasury_rules` / `ai_recommendations` — Plan 2c
- Deletion of `src/lib/treasury/rules-engine.ts` / `TreasuryRulesForm` — Plan 2c
- UI — Plan 3

---

## Task 0: Create the worktree and verify Plan 1 baseline

**Files:** None yet. Setup task.

- [ ] **Step 1: Create the worktree from master**

```bash
cd /c/Users/John/crypto-treasury
git worktree list
git fetch origin master
git worktree add .worktrees/policy-authoring -b feature/policy-authoring master
cd .worktrees/policy-authoring
pwd
git branch --show-current
```

Expected: `pwd` ends in `.worktrees/policy-authoring`, branch is `feature/policy-authoring`.

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

The worktree has its own `node_modules` but shares `package.json`/`package-lock.json` with the main checkout.

- [ ] **Step 3: Verify Plan 1 baseline passes**

```bash
npm test -- src/lib/policy
npx tsc --noEmit
```

Expected: 432 policy tests pass, tsc clean. If either fails, STOP — the branch is not in a state to build on.

- [ ] **Step 4: Create the empty directories**

```bash
mkdir -p src/lib/policy/authoring
mkdir -p src/app/api/policy/active
mkdir -p src/app/api/policy/versions
mkdir -p 'src/app/api/policy/versions/[id]'
mkdir -p 'src/app/api/policy/versions/[id]/activate'
mkdir -p 'src/app/api/policy/versions/[id]/clone'
mkdir -p 'src/app/api/policy/versions/[id]/diff/[otherId]'
mkdir -p 'src/app/api/policy/versions/[id]/rules'
mkdir -p 'src/app/api/policy/versions/[id]/rules/[ruleId]'
mkdir -p 'src/app/api/policy/versions/[id]/rules/validate'
mkdir -p 'src/app/api/policy/versions/[id]/hard-limits'
mkdir -p 'src/app/api/policy/versions/[id]/hard-limits/[limitId]'
mkdir -p 'src/app/api/policy/versions/[id]/approval-chains'
mkdir -p 'src/app/api/policy/versions/[id]/approval-chains/[chainId]'
mkdir -p 'src/app/api/policy/versions/[id]/satisfiability'
```

No commit for this task — setup only.

---

## Task 1: AuthoringError class

**Files:**
- Create: `src/lib/policy/authoring/errors.ts`
- Create: `src/lib/policy/authoring/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/policy/authoring/errors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { AuthoringError } from './errors';
import { PolicyError } from '../errors/classes';
import { REASON_CODES } from '../errors/reason-codes';

describe('AuthoringError', () => {
  it('is a PolicyError with module=authoring and the caller-supplied reason_code', () => {
    const err = new AuthoringError({
      reason_code: REASON_CODES.rule_priority_collision,
      human_readable: 'Two rules have priority 100 in this version.',
      user_action: 'Change the priority of one of the rules.',
      details: { version_id: 'v-1', colliding_priorities: [100] },
    });

    expect(err).toBeInstanceOf(PolicyError);
    expect(err.reason_code).toBe('rule_priority_collision');
    expect(err.module).toBe('authoring');
    expect(err.name).toBe('AuthoringError');
    expect(err.details).toMatchObject({ version_id: 'v-1' });
  });

  it('carries an optional path for JSON-path error targeting', () => {
    const err = new AuthoringError({
      reason_code: REASON_CODES.condition_ir_schema_invalid,
      human_readable: 'Condition value must be a string.',
      user_action: 'Remove the array from the value field.',
      details: {},
      path: ['rules', 0, 'condition', 'value'],
    });

    expect(err.path).toEqual(['rules', 0, 'condition', 'value']);
  });

  it('path defaults to empty array when not provided', () => {
    const err = new AuthoringError({
      reason_code: REASON_CODES.requires_policy_admin,
      human_readable: 'x',
      user_action: 'y',
      details: {},
    });
    expect(err.path).toEqual([]);
  });

  it('serializes to JSON with path included', () => {
    const err = new AuthoringError({
      reason_code: REASON_CODES.version_not_draft,
      human_readable: 'Cannot edit a non-draft version.',
      user_action: 'Clone the version to create a new draft.',
      details: { version_id: 'v-1', status: 'active' },
      path: ['status'],
    });
    const json = err.toJSON() as Record<string, unknown>;
    expect(json.reason_code).toBe('version_not_draft');
    expect(json.path).toEqual(['status']);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test -- src/lib/policy/authoring/errors
```

Expected: FAIL with `Cannot find module './errors'`.

- [ ] **Step 3: Implement errors.ts**

Create `src/lib/policy/authoring/errors.ts`:

```typescript
// src/lib/policy/authoring/errors.ts

import { PolicyError, PolicyErrorInit, PolicyErrorEnvelope } from '../errors/classes';

export interface AuthoringErrorInit extends Omit<PolicyErrorInit, 'module'> {
  /**
   * JSON path from the root of the request body to the offending value.
   * Used by the UI to highlight the specific form field that caused the
   * error. Empty array means the error isn't attributable to a single path.
   */
  path?: (string | number)[];
}

/**
 * Structured error raised by the PolicyAuthoringService when a caller
 * attempts something that isn't allowed (wrong permissions, invalid data,
 * version state conflicts). Always carries a reason_code from the closed
 * REASON_CODES enum plus a UI-targetable path.
 */
export class AuthoringError extends PolicyError {
  readonly path: (string | number)[];

  constructor(init: AuthoringErrorInit) {
    super({ ...init, module: 'authoring' });
    this.name = 'AuthoringError';
    this.path = init.path ?? [];
  }

  toJSON(): PolicyErrorEnvelope & { path: (string | number)[] } {
    return {
      ...super.toJSON(),
      path: this.path,
    };
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- src/lib/policy/authoring/errors
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/authoring/errors.ts src/lib/policy/authoring/errors.test.ts
git commit -m "$(cat <<'EOF'
feat(policy-authoring): add AuthoringError class

Extends PolicyError with module='authoring' and adds an optional
JSON-path field so the UI can highlight the specific form field
that caused a validation or permission failure. Reuses the closed
REASON_CODES enum from Plan 1; every authoring-specific reason code
already exists there (requires_policy_admin, version_not_draft,
rule_priority_collision, etc.).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Permission helpers

**Files:**
- Create: `src/lib/policy/authoring/permissions.ts`
- Create: `src/lib/policy/authoring/permissions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/policy/authoring/permissions.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import {
  canViewActivePolicy,
  canCreateDraft,
  canEditDraftRules,
  canEditDraftChains,
  requirePolicyAdmin,
} from './permissions';
import { AuthoringError } from './errors';

describe('canViewActivePolicy', () => {
  it('returns true for auditor and higher', () => {
    expect(canViewActivePolicy('auditor')).toBe(true);
    expect(canViewActivePolicy('accountant')).toBe(true);
    expect(canViewActivePolicy('treasury_manager')).toBe(true);
  });
});

describe('canCreateDraft / canEditDraftRules / canEditDraftChains', () => {
  it('returns true only for treasury_manager and higher', () => {
    expect(canCreateDraft('auditor')).toBe(false);
    expect(canCreateDraft('accountant')).toBe(false);
    expect(canCreateDraft('treasury_manager')).toBe(true);

    expect(canEditDraftRules('auditor')).toBe(false);
    expect(canEditDraftRules('treasury_manager')).toBe(true);

    expect(canEditDraftChains('accountant')).toBe(false);
    expect(canEditDraftChains('treasury_manager')).toBe(true);
  });
});

describe('requirePolicyAdmin', () => {
  it('resolves when the user has is_policy_admin=true', async () => {
    const supabase = mkSupabase({ is_policy_admin: true, is_app_admin: false });
    await expect(requirePolicyAdmin(supabase, 'user-1')).resolves.toMatchObject({
      source: 'policy_admin',
    });
  });

  it('resolves when the user has is_app_admin=true (with actor_source=vantor_staff)', async () => {
    const supabase = mkSupabase({ is_policy_admin: false, is_app_admin: true });
    await expect(requirePolicyAdmin(supabase, 'user-1')).resolves.toMatchObject({
      source: 'vantor_staff',
    });
  });

  it('throws AuthoringError with reason_code=requires_policy_admin when neither flag is set', async () => {
    const supabase = mkSupabase({ is_policy_admin: false, is_app_admin: false });
    await expect(requirePolicyAdmin(supabase, 'user-1')).rejects.toMatchObject({
      reason_code: 'requires_policy_admin',
    });
  });

  it('throws when the user profile lookup returns no row', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    };
    await expect(requirePolicyAdmin(supabase as never, 'user-missing')).rejects.toBeInstanceOf(
      AuthoringError,
    );
  });
});

function mkSupabase(profile: { is_policy_admin: boolean; is_app_admin: boolean }) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: profile, error: null }),
        }),
      }),
    }),
  };
}
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test -- src/lib/policy/authoring/permissions
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement permissions.ts**

Create `src/lib/policy/authoring/permissions.ts`:

```typescript
// src/lib/policy/authoring/permissions.ts

import { UserRole } from '@/types/database';
import { hasRole } from '@/lib/auth/rbac';
import { REASON_CODES } from '../errors/reason-codes';
import { AuthoringError } from './errors';

type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        single: () => Promise<{ data: { is_policy_admin?: boolean; is_app_admin?: boolean } | null; error: unknown }>;
      };
    };
  };
};

/**
 * Who is authorized for an action, and (for audit) whether they got
 * there via the is_policy_admin flag or via the implicit is_app_admin
 * elevation. Vantor staff actions are audited separately.
 */
export interface PolicyAdminResolution {
  source: 'policy_admin' | 'vantor_staff';
}

export function canViewActivePolicy(role: UserRole): boolean {
  return hasRole(role, 'auditor');
}

export function canCreateDraft(role: UserRole): boolean {
  return hasRole(role, 'treasury_manager');
}

export function canEditDraftRules(role: UserRole): boolean {
  return hasRole(role, 'treasury_manager');
}

export function canEditDraftChains(role: UserRole): boolean {
  return hasRole(role, 'treasury_manager');
}

/**
 * Verify that a user has permission to edit hard limits OR activate a
 * draft — both gated by is_policy_admin. Returns the audit source so
 * the caller can tag audit log entries correctly. Throws AuthoringError
 * with reason_code=requires_policy_admin on failure.
 */
export async function requirePolicyAdmin(
  supabase: SupabaseLike,
  userId: string,
): Promise<PolicyAdminResolution> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('is_policy_admin, is_app_admin')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new AuthoringError({
      reason_code: REASON_CODES.requires_policy_admin,
      human_readable: 'Could not verify policy admin permissions: user profile not found.',
      user_action: 'Contact an app admin to ensure your user profile exists.',
      details: { user_id: userId },
    });
  }

  if (data.is_app_admin) {
    return { source: 'vantor_staff' };
  }

  if (data.is_policy_admin) {
    return { source: 'policy_admin' };
  }

  throw new AuthoringError({
    reason_code: REASON_CODES.requires_policy_admin,
    human_readable:
      'This action requires policy admin permissions. Only users with is_policy_admin=true (or a Vantor staff member) may edit hard limits or activate policy versions.',
    user_action:
      'Ask an existing policy admin to grant you is_policy_admin in Settings → Team, or request a Vantor staff elevation.',
    details: { user_id: userId },
  });
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- src/lib/policy/authoring/permissions
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/authoring/permissions.ts src/lib/policy/authoring/permissions.test.ts
git commit -m "$(cat <<'EOF'
feat(policy-authoring): add permission helpers

canViewActivePolicy / canCreateDraft / canEditDraftRules /
canEditDraftChains are pure role-hierarchy checks built on the
existing rbac.hasRole helper. requirePolicyAdmin does a live DB
lookup against user_profiles and returns an audit source
('policy_admin' or 'vantor_staff') so the caller can tag audit
log entries correctly per the spec's rule that is_app_admin
elevation writes audit_log with actor_source='vantor_staff'.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Authoring types (request/response DTOs)

**Files:**
- Create: `src/lib/policy/authoring/types.ts`

No test file — pure type declarations. Tested transitively via service.test.ts.

- [ ] **Step 1: Create types.ts**

Create `src/lib/policy/authoring/types.ts`:

```typescript
// src/lib/policy/authoring/types.ts

import { Condition } from '../types/ir';
import { HardLimitType, HardLimitScope } from '../types/hard-limit';
import { Verdict, ApprovalSlotRequirement } from '../types/verdict';
import { PolicyVersionSnapshot, PolicyRule, ApprovalChain } from '../types/policy-version';
import { HardLimit } from '../types/hard-limit';
import { UserRole } from '@/types/database';

/**
 * Context passed to every PolicyAuthoringService method so the service
 * can enforce per-enterprise scoping and permission checks without the
 * caller having to thread session data through every call.
 */
export interface AuthoringActor {
  user_id: string;
  role: UserRole;
  enterprise_id: string;
}

/**
 * Request to create a new draft version. If sourceVersionId is provided,
 * the new draft inherits rules/limits/chains from it; otherwise an empty
 * draft is created.
 */
export interface CreateDraftRequest {
  name: string;
  source_version_id?: string;
}

/**
 * Request to upsert a rule inside a draft.
 */
export interface UpsertRuleRequest {
  id?: string; // omit for create, include for update
  rule_type: PolicyRule['rule_type'];
  name: string;
  rationale: string;
  condition: Condition;
  verdict: Verdict;
  verdict_chain_id?: string;
  priority: number;
}

/**
 * Request to upsert a hard limit inside a draft. Requires is_policy_admin.
 */
export interface UpsertHardLimitRequest {
  id?: string;
  limit_type: HardLimitType;
  name: string;
  limit_value: string;
  limit_currency?: string;
  scope: HardLimitScope;
}

/**
 * Request to upsert an approval chain inside a draft.
 */
export interface UpsertApprovalChainRequest {
  id?: string;
  name: string;
  slots: ApprovalSlotRequirement[];
  trigger_condition?: Condition;
  priority: number;
  expiration_hours?: number;
}

/**
 * Request to activate a draft. Requires is_policy_admin and a human-
 * meaningful justification (min 20 chars).
 */
export interface ActivateRequest {
  reason: string;
}

/**
 * Full-version response shape — the canonical format every read endpoint
 * returns. Mirrors PolicyVersionSnapshot but with denormalized metadata
 * the authoring UI needs.
 */
export interface PolicyVersionResponse extends PolicyVersionSnapshot {
  created_by_email?: string;
  activated_by_email?: string;
  is_editable: boolean;
}

/**
 * Result of computing a diff between two versions.
 */
export interface VersionDiff {
  from_version_id: string;
  to_version_id: string;
  rules: {
    added: PolicyRule[];
    removed: PolicyRule[];
    modified: Array<{ before: PolicyRule; after: PolicyRule; changed_fields: string[] }>;
  };
  hard_limits: {
    added: HardLimit[];
    removed: HardLimit[];
    modified: Array<{ before: HardLimit; after: HardLimit; changed_fields: string[] }>;
  };
  approval_chains: {
    added: ApprovalChain[];
    removed: ApprovalChain[];
    modified: Array<{ before: ApprovalChain; after: ApprovalChain; changed_fields: string[] }>;
  };
}

/**
 * Result of a satisfiability check. A chain is unsatisfiable when there
 * is no slot-filling permutation the current user base can produce (e.g.,
 * a chain requires 2 executives but the enterprise has 0).
 */
export interface SatisfiabilityResult {
  version_id: string;
  all_satisfiable: boolean;
  chain_results: Array<{
    chain_id: string;
    chain_name: string;
    satisfiable: boolean;
    unsatisfied_slots?: Array<{ slot_index: number; minimum_role: string; required_count: number; available_count: number }>;
  }>;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: clean. No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/policy/authoring/types.ts
git commit -m "$(cat <<'EOF'
feat(policy-authoring): add request/response DTO types

Pure TypeScript declarations for the authoring API's wire format:
CreateDraftRequest, UpsertRuleRequest, UpsertHardLimitRequest,
UpsertApprovalChainRequest, ActivateRequest, PolicyVersionResponse,
VersionDiff, SatisfiabilityResult. AuthoringActor is the per-request
context threaded through every service call — carries user_id, role,
and enterprise_id so methods can enforce scoping without caller
boilerplate.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Save-time validation cascade

**Files:**
- Create: `src/lib/policy/authoring/validation.ts`
- Create: `src/lib/policy/authoring/validation.test.ts`

Implements the 6-step cascade from spec §8: (1) zod schema parse, (2) IR type-path validation, (3) reference validation, (4) currency consistency, (5) priority uniqueness, (6) business-rule validation. Every failure produces a structured AuthoringError with a JSON-path for UI targeting.

- [ ] **Step 1: Write failing tests**

Create `src/lib/policy/authoring/validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  validateRuleInput,
  validateHardLimitInput,
  validateApprovalChainInput,
  validateVersionCoherent,
} from './validation';
import { AuthoringError } from './errors';
import type {
  UpsertRuleRequest,
  UpsertHardLimitRequest,
  UpsertApprovalChainRequest,
} from './types';
import type { PolicyVersionSnapshot } from '../types/policy-version';

const mkValidRule = (overrides: Partial<UpsertRuleRequest> = {}): UpsertRuleRequest => ({
  rule_type: 'approval_threshold',
  name: 'Approval over $50k',
  rationale: 'Standard wire approval threshold',
  condition: {
    kind: 'amount_compare',
    attr: 'transfer.amount',
    op: '>',
    value: { amount: '50000', currency: 'USD' },
  },
  verdict: 'require_approval',
  priority: 100,
  ...overrides,
});

const mkValidHardLimit = (
  overrides: Partial<UpsertHardLimitRequest> = {},
): UpsertHardLimitRequest => ({
  limit_type: 'min_cash_reserve_usd',
  name: 'Operating Cash Floor',
  limit_value: '500000',
  limit_currency: 'USD',
  scope: {},
  ...overrides,
});

const mkEmptyVersion = (): PolicyVersionSnapshot => ({
  id: 'v-1',
  enterprise_id: 'ent-1',
  version_number: 1,
  status: 'draft',
  name: 'Draft',
  rules: [],
  hard_limits: [],
  approval_chains: [],
});

describe('validateRuleInput — schema parse + IR checks', () => {
  it('accepts a well-formed rule', () => {
    expect(() => validateRuleInput(mkValidRule())).not.toThrow();
  });

  it('rejects a rule with missing condition field', () => {
    const bad = { ...mkValidRule(), condition: undefined as unknown as never };
    expect(() => validateRuleInput(bad)).toThrow(AuthoringError);
  });

  it('rejects a rule with non-integer priority', () => {
    const bad = mkValidRule({ priority: 1.5 });
    expect(() => validateRuleInput(bad)).toThrow(AuthoringError);
  });

  it('rejects a rule with empty name', () => {
    const bad = mkValidRule({ name: '' });
    expect(() => validateRuleInput(bad)).toThrow(AuthoringError);
  });

  it('rejects a require_approval rule without verdict_chain_id', () => {
    const bad = mkValidRule({ verdict: 'require_approval', verdict_chain_id: undefined });
    expect(() =>
      validateRuleInput(bad, { requireChainForApproval: true }),
    ).toThrow(AuthoringError);
  });

  it('accepts a require_approval rule WITH verdict_chain_id', () => {
    const good = mkValidRule({ verdict: 'require_approval', verdict_chain_id: 'chain-1' });
    expect(() =>
      validateRuleInput(good, { requireChainForApproval: true }),
    ).not.toThrow();
  });
});

describe('validateRuleInput — currency consistency (usd_rule_on_rateless_asset)', () => {
  it('rejects a USD rule on a non-stablecoin asset when currency=USD and scope has rateless asset', () => {
    const bad = mkValidRule({
      condition: {
        kind: 'amount_compare',
        attr: 'treasury.position',
        scope: { asset: 'BTC' as never },
        op: '>',
        value: { amount: '100', currency: 'USD' },
      },
    });
    expect(() => validateRuleInput(bad)).toThrow(AuthoringError);
    try {
      validateRuleInput(bad);
    } catch (err) {
      expect((err as AuthoringError).reason_code).toBe('usd_rule_on_rateless_asset');
    }
  });
});

describe('validateHardLimitInput', () => {
  it('accepts a well-formed hard limit', () => {
    expect(() => validateHardLimitInput(mkValidHardLimit())).not.toThrow();
  });

  it('rejects a hard limit with negative limit_value', () => {
    const bad = mkValidHardLimit({ limit_value: '-500000' });
    expect(() => validateHardLimitInput(bad)).toThrow(AuthoringError);
  });

  it('rejects a hard limit with limit_value=0 for min_cash_reserve_usd', () => {
    const bad = mkValidHardLimit({ limit_value: '0' });
    expect(() => validateHardLimitInput(bad)).toThrow(AuthoringError);
  });

  it('rejects a max_native_exposure limit without scope.asset', () => {
    const bad = mkValidHardLimit({
      limit_type: 'max_native_exposure',
      limit_value: '1000000',
      limit_currency: undefined,
      scope: {},
    });
    expect(() => validateHardLimitInput(bad)).toThrow(AuthoringError);
    try {
      validateHardLimitInput(bad);
    } catch (err) {
      expect((err as AuthoringError).reason_code).toBe('hard_limit_value_out_of_range');
    }
  });

  it('rejects max_single_asset_concentration_pct > 100', () => {
    const bad = mkValidHardLimit({
      limit_type: 'max_single_asset_concentration_pct',
      limit_value: '150',
      limit_currency: undefined,
    });
    expect(() => validateHardLimitInput(bad)).toThrow(AuthoringError);
  });

  it('rejects obligation_coverage_days with non-integer value', () => {
    const bad = mkValidHardLimit({
      limit_type: 'obligation_coverage_days',
      limit_value: '14.5',
      limit_currency: undefined,
    });
    expect(() => validateHardLimitInput(bad)).toThrow(AuthoringError);
  });
});

describe('validateApprovalChainInput', () => {
  it('accepts a chain with at least one slot', () => {
    const chain: UpsertApprovalChainRequest = {
      name: 'Single approver',
      slots: [{ slot_index: 0, minimum_role: 'treasury_manager' }],
      priority: 1,
      expiration_hours: 48,
    };
    expect(() => validateApprovalChainInput(chain)).not.toThrow();
  });

  it('rejects a chain with zero slots', () => {
    const chain: UpsertApprovalChainRequest = {
      name: 'Empty chain',
      slots: [],
      priority: 1,
    };
    expect(() => validateApprovalChainInput(chain)).toThrow(AuthoringError);
  });

  it('rejects a chain with duplicate slot_index values', () => {
    const chain: UpsertApprovalChainRequest = {
      name: 'Dup slots',
      slots: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
        { slot_index: 0, minimum_role: 'executive' },
      ],
      priority: 1,
    };
    expect(() => validateApprovalChainInput(chain)).toThrow(AuthoringError);
  });

  it('rejects a chain with non-sequential slot_index values (0, 2 is invalid)', () => {
    const chain: UpsertApprovalChainRequest = {
      name: 'Gap',
      slots: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
        { slot_index: 2, minimum_role: 'executive' },
      ],
      priority: 1,
    };
    expect(() => validateApprovalChainInput(chain)).toThrow(AuthoringError);
  });
});

describe('validateVersionCoherent — whole-version checks', () => {
  it('accepts a version with no rules/limits/chains (empty draft is valid)', () => {
    expect(() => validateVersionCoherent(mkEmptyVersion())).not.toThrow();
  });

  it('rejects a version with duplicate rule priorities', () => {
    const v = mkEmptyVersion();
    v.rules = [
      {
        id: 'r1',
        version_id: 'v-1',
        rule_type: 'approval_threshold',
        name: 'A',
        rationale: '',
        priority: 100,
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>',
          value: { amount: '1', currency: 'USD' },
        },
        verdict: 'require_approval',
        created_by: 'u',
        created_at: new Date(),
      },
      {
        id: 'r2',
        version_id: 'v-1',
        rule_type: 'approval_threshold',
        name: 'B',
        rationale: '',
        priority: 100,
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>',
          value: { amount: '2', currency: 'USD' },
        },
        verdict: 'block',
        created_by: 'u',
        created_at: new Date(),
      },
    ];
    expect(() => validateVersionCoherent(v)).toThrow(AuthoringError);
    try {
      validateVersionCoherent(v);
    } catch (err) {
      expect((err as AuthoringError).reason_code).toBe('rule_priority_collision');
    }
  });

  it('rejects a rule with verdict=require_approval referencing a non-existent chain', () => {
    const v = mkEmptyVersion();
    v.rules = [
      {
        id: 'r1',
        version_id: 'v-1',
        rule_type: 'approval_threshold',
        name: 'A',
        rationale: '',
        priority: 100,
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>',
          value: { amount: '1', currency: 'USD' },
        },
        verdict: 'require_approval',
        verdict_chain_id: 'chain-does-not-exist',
        created_by: 'u',
        created_at: new Date(),
      },
    ];
    expect(() => validateVersionCoherent(v)).toThrow(AuthoringError);
    try {
      validateVersionCoherent(v);
    } catch (err) {
      expect((err as AuthoringError).reason_code).toBe('chain_reference_not_found');
    }
  });

  it('accepts a rule with verdict=require_approval referencing an existing chain', () => {
    const v = mkEmptyVersion();
    v.approval_chains = [
      {
        id: 'chain-1',
        version_id: 'v-1',
        name: 'Single',
        slots: [{ slot_index: 0, minimum_role: 'treasury_manager' }],
        priority: 1,
        expiration_hours: 48,
        created_by: 'u',
        created_at: new Date(),
      },
    ];
    v.rules = [
      {
        id: 'r1',
        version_id: 'v-1',
        rule_type: 'approval_threshold',
        name: 'A',
        rationale: '',
        priority: 100,
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>',
          value: { amount: '1', currency: 'USD' },
        },
        verdict: 'require_approval',
        verdict_chain_id: 'chain-1',
        created_by: 'u',
        created_at: new Date(),
      },
    ];
    expect(() => validateVersionCoherent(v)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test -- src/lib/policy/authoring/validation
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement validation.ts**

Create `src/lib/policy/authoring/validation.ts`:

```typescript
// src/lib/policy/authoring/validation.ts

import { REASON_CODES } from '../errors/reason-codes';
import { AuthoringError } from './errors';
import { conditionSchema } from '../schemas/ir.schema';
import {
  UpsertRuleRequest,
  UpsertHardLimitRequest,
  UpsertApprovalChainRequest,
} from './types';
import { PolicyVersionSnapshot } from '../types/policy-version';
import { AssetCode } from '../types/assets';

const RATE_SUPPORTED_ASSETS: ReadonlySet<AssetCode> = new Set(['USD', 'USDC', 'USDT']);

export interface ValidateRuleOptions {
  requireChainForApproval?: boolean;
}

/**
 * Validate a single rule upsert request. Runs steps 1-4 of the
 * save-time cascade: zod schema parse, IR type-path validation,
 * require-chain for approval verdicts, and currency consistency.
 *
 * Steps 5-6 (priority uniqueness, whole-version semantics) run in
 * validateVersionCoherent because they need the full version context.
 */
export function validateRuleInput(
  input: UpsertRuleRequest,
  opts: ValidateRuleOptions = {},
): void {
  // Step 1: Shape validation
  if (!input.name || input.name.trim().length === 0) {
    throw new AuthoringError({
      reason_code: REASON_CODES.condition_ir_schema_invalid,
      human_readable: 'Rule name cannot be empty.',
      user_action: 'Provide a human-readable name for the rule.',
      details: {},
      path: ['name'],
    });
  }

  if (!Number.isInteger(input.priority) || input.priority < 0) {
    throw new AuthoringError({
      reason_code: REASON_CODES.condition_ir_schema_invalid,
      human_readable: 'Rule priority must be a non-negative integer.',
      user_action: 'Enter a whole number for priority.',
      details: { priority: input.priority },
      path: ['priority'],
    });
  }

  // Step 2: Condition IR schema parse (uses Plan 1's zod schema)
  const parsed = conditionSchema.safeParse(input.condition);
  if (!parsed.success) {
    throw new AuthoringError({
      reason_code: REASON_CODES.condition_ir_schema_invalid,
      human_readable: `Rule condition is not a valid IR node: ${parsed.error.message}`,
      user_action: 'Fix the condition shape in the rule editor.',
      details: { zod_error: parsed.error.flatten() },
      path: ['condition'],
    });
  }

  // Step 3: Require chain for approval verdicts
  if (
    opts.requireChainForApproval &&
    input.verdict === 'require_approval' &&
    !input.verdict_chain_id
  ) {
    throw new AuthoringError({
      reason_code: REASON_CODES.chain_reference_not_found,
      human_readable:
        'Rules with verdict=require_approval must reference an approval chain.',
      user_action: 'Select an approval chain for this rule.',
      details: { rule_name: input.name },
      path: ['verdict_chain_id'],
    });
  }

  // Step 4: Currency consistency — reject USD rules on rate-less assets
  // (canonicalization only supports USD/USDC/USDT in phase 1)
  if (input.condition.kind === 'amount_compare' && input.condition.scope?.asset) {
    const scopedAsset = input.condition.scope.asset as AssetCode;
    if (
      input.condition.value.currency === 'USD' &&
      !RATE_SUPPORTED_ASSETS.has(scopedAsset)
    ) {
      throw new AuthoringError({
        reason_code: REASON_CODES.usd_rule_on_rateless_asset,
        human_readable:
          `Cannot use USD comparison on ${scopedAsset} — the canonicalizer does not have a rate source for this asset. Use a native-unit comparison instead.`,
        user_action: `Change the rule value.currency to ${scopedAsset}, or remove scope.asset to target the overall transfer.`,
        details: { scoped_asset: scopedAsset },
        path: ['condition', 'value', 'currency'],
      });
    }
  }
}

/**
 * Validate a single hard limit upsert request.
 */
export function validateHardLimitInput(input: UpsertHardLimitRequest): void {
  // Name required
  if (!input.name || input.name.trim().length === 0) {
    throw new AuthoringError({
      reason_code: REASON_CODES.hard_limit_value_out_of_range,
      human_readable: 'Hard limit name cannot be empty.',
      user_action: 'Provide a name for the limit.',
      details: {},
      path: ['name'],
    });
  }

  // limit_value must be a non-negative decimal string
  if (!/^(\d+)(\.\d+)?$/.test(input.limit_value)) {
    throw new AuthoringError({
      reason_code: REASON_CODES.hard_limit_value_out_of_range,
      human_readable: `Hard limit value "${input.limit_value}" is not a non-negative decimal.`,
      user_action: 'Enter a non-negative numeric value.',
      details: { limit_value: input.limit_value },
      path: ['limit_value'],
    });
  }

  const numericValue = parseFloat(input.limit_value);

  // Type-specific validation
  switch (input.limit_type) {
    case 'min_cash_reserve_usd':
      if (numericValue <= 0) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: 'min_cash_reserve_usd must be greater than 0.',
          user_action: 'Enter a positive value.',
          details: { limit_value: input.limit_value },
          path: ['limit_value'],
        });
      }
      if (input.limit_currency !== 'USD') {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: 'min_cash_reserve_usd requires limit_currency=USD.',
          user_action: 'Set limit_currency to USD.',
          details: { limit_currency: input.limit_currency },
          path: ['limit_currency'],
        });
      }
      break;

    case 'max_single_asset_concentration_pct':
      if (numericValue <= 0 || numericValue > 100) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: 'Concentration percentage must be between 0 and 100 (exclusive of 0).',
          user_action: 'Enter a value greater than 0 and at most 100.',
          details: { limit_value: input.limit_value },
          path: ['limit_value'],
        });
      }
      break;

    case 'max_daily_outflow_usd':
    case 'max_30day_outflow_usd':
      if (numericValue <= 0) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: `${input.limit_type} must be greater than 0.`,
          user_action: 'Enter a positive dollar amount.',
          details: { limit_value: input.limit_value },
          path: ['limit_value'],
        });
      }
      if (input.limit_currency !== 'USD') {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: `${input.limit_type} requires limit_currency=USD.`,
          user_action: 'Set limit_currency to USD.',
          details: { limit_currency: input.limit_currency },
          path: ['limit_currency'],
        });
      }
      break;

    case 'obligation_coverage_days':
      if (!Number.isInteger(numericValue) || numericValue <= 0) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: 'obligation_coverage_days must be a positive integer.',
          user_action: 'Enter a whole number of days.',
          details: { limit_value: input.limit_value },
          path: ['limit_value'],
        });
      }
      break;

    case 'max_native_exposure':
      if (numericValue <= 0) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: 'max_native_exposure must be greater than 0.',
          user_action: 'Enter a positive amount.',
          details: { limit_value: input.limit_value },
          path: ['limit_value'],
        });
      }
      if (!input.scope.asset) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: 'max_native_exposure requires scope.asset to specify which asset the cap applies to.',
          user_action: 'Select an asset in the scope field.',
          details: {},
          path: ['scope', 'asset'],
        });
      }
      break;
  }
}

/**
 * Validate a single approval chain upsert request.
 */
export function validateApprovalChainInput(input: UpsertApprovalChainRequest): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new AuthoringError({
      reason_code: REASON_CODES.chain_reference_not_found,
      human_readable: 'Chain name cannot be empty.',
      user_action: 'Provide a name for the chain.',
      details: {},
      path: ['name'],
    });
  }

  if (!Array.isArray(input.slots) || input.slots.length === 0) {
    throw new AuthoringError({
      reason_code: REASON_CODES.chain_reference_not_found,
      human_readable: 'Chain must have at least one slot.',
      user_action: 'Add at least one approver slot to the chain.',
      details: {},
      path: ['slots'],
    });
  }

  // Slot indices must be unique and sequential (0, 1, 2, ...)
  const indices = input.slots.map((s) => s.slot_index).sort((a, b) => a - b);
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i) {
      throw new AuthoringError({
        reason_code: REASON_CODES.chain_reference_not_found,
        human_readable:
          `Chain slot_index values must be sequential starting from 0 (got ${indices.join(', ')}).`,
        user_action: 'Re-number the slots so they form a contiguous 0-based sequence.',
        details: { indices },
        path: ['slots'],
      });
    }
  }

  // Trigger condition (if any) must parse
  if (input.trigger_condition) {
    const parsed = conditionSchema.safeParse(input.trigger_condition);
    if (!parsed.success) {
      throw new AuthoringError({
        reason_code: REASON_CODES.condition_ir_schema_invalid,
        human_readable: `Chain trigger_condition is not a valid IR node: ${parsed.error.message}`,
        user_action: 'Fix the trigger condition shape.',
        details: {},
        path: ['trigger_condition'],
      });
    }
  }
}

/**
 * Validate whole-version semantic invariants: unique rule priorities,
 * rule → chain references resolve to chains in the same version, etc.
 * Called at save time (after per-row validation) and at activation.
 */
export function validateVersionCoherent(version: PolicyVersionSnapshot): void {
  // Step 5: Priority uniqueness within version
  const priorities = new Map<number, string>();
  for (const rule of version.rules) {
    if (priorities.has(rule.priority)) {
      const existing = priorities.get(rule.priority);
      throw new AuthoringError({
        reason_code: REASON_CODES.rule_priority_collision,
        human_readable:
          `Rules '${existing}' and '${rule.name}' both have priority ${rule.priority}. Priorities must be unique within a version.`,
        user_action: 'Change the priority of one of the colliding rules.',
        details: { colliding_priority: rule.priority, rule_names: [existing, rule.name] },
        path: ['rules'],
      });
    }
    priorities.set(rule.priority, rule.name);
  }

  // Step 6: Rule → chain references resolve
  const chainIds = new Set(version.approval_chains.map((c) => c.id));
  for (const rule of version.rules) {
    if (rule.verdict === 'require_approval') {
      if (!rule.verdict_chain_id) {
        throw new AuthoringError({
          reason_code: REASON_CODES.chain_reference_not_found,
          human_readable: `Rule '${rule.name}' has verdict=require_approval but no verdict_chain_id.`,
          user_action: 'Select an approval chain for this rule.',
          details: { rule_id: rule.id },
          path: ['rules'],
        });
      }
      if (!chainIds.has(rule.verdict_chain_id)) {
        throw new AuthoringError({
          reason_code: REASON_CODES.chain_reference_not_found,
          human_readable:
            `Rule '${rule.name}' references chain '${rule.verdict_chain_id}' which does not exist in this version.`,
          user_action: 'Create the chain in this version or pick a different chain.',
          details: { rule_id: rule.id, chain_id: rule.verdict_chain_id },
          path: ['rules'],
        });
      }
    }
  }

  // Hard limit priority / uniqueness by (limit_type, scope.asset)
  const seenLimits = new Map<string, string>();
  for (const limit of version.hard_limits) {
    const key = `${limit.limit_type}:${limit.scope.asset ?? ''}`;
    if (seenLimits.has(key)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.hard_limit_value_out_of_range,
        human_readable:
          `Two hard limits of type '${limit.limit_type}' have the same scope. Only one is allowed.`,
        user_action: 'Delete the duplicate or change its scope.',
        details: { limit_type: limit.limit_type, scope: limit.scope },
        path: ['hard_limits'],
      });
    }
    seenLimits.set(key, limit.id);
  }
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- src/lib/policy/authoring/validation
```

Expected: all validation tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/authoring/validation.ts src/lib/policy/authoring/validation.test.ts
git commit -m "$(cat <<'EOF'
feat(policy-authoring): save-time validation cascade

Implements steps 1-6 of the spec's save-time cascade:
(1) zod schema parse via Plan 1's conditionSchema,
(2) IR type-path validation,
(3) reference validation (rule → chain),
(4) currency consistency (USD rules on rate-less assets rejected
    with usd_rule_on_rateless_asset),
(5) priority uniqueness within version,
(6) type-specific business-rule validation for each HardLimitType.

Every failure produces an AuthoringError with a JSON path so the UI
can highlight the specific form field. Split into per-row validators
(validateRuleInput, validateHardLimitInput, validateApprovalChainInput)
and whole-version (validateVersionCoherent) so individual edits get
fast feedback while activation gets the full semantic sweep.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Version diff computation

**Files:**
- Create: `src/lib/policy/authoring/diff.ts`
- Create: `src/lib/policy/authoring/diff.test.ts`

Pure function that compares two PolicyVersionSnapshot objects and returns a VersionDiff with added/removed/modified for rules, hard limits, and chains. Row matching is by `id`.

- [ ] **Step 1: Write failing tests**

Create `src/lib/policy/authoring/diff.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeVersionDiff } from './diff';
import type { PolicyVersionSnapshot, PolicyRule, ApprovalChain } from '../types/policy-version';
import type { HardLimit } from '../types/hard-limit';

const mkRule = (overrides: Partial<PolicyRule> = {}): PolicyRule => ({
  id: 'r-1',
  version_id: 'v-1',
  rule_type: 'approval_threshold',
  name: 'Approval over $50k',
  rationale: '',
  priority: 100,
  condition: {
    kind: 'amount_compare',
    attr: 'transfer.amount',
    op: '>',
    value: { amount: '50000', currency: 'USD' },
  },
  verdict: 'require_approval',
  created_by: 'u',
  created_at: new Date('2026-04-10T00:00:00Z'),
  ...overrides,
});

const mkLimit = (overrides: Partial<HardLimit> = {}): HardLimit => ({
  id: 'hl-1',
  limit_type: 'min_cash_reserve_usd',
  name: 'Cash Floor',
  limit_value: '500000',
  limit_currency: 'USD',
  scope: {},
  ...overrides,
});

const mkVersion = (overrides: Partial<PolicyVersionSnapshot> = {}): PolicyVersionSnapshot => ({
  id: 'v-1',
  enterprise_id: 'ent-1',
  version_number: 1,
  status: 'draft',
  name: 'Test',
  rules: [],
  hard_limits: [],
  approval_chains: [],
  ...overrides,
});

describe('computeVersionDiff', () => {
  it('returns empty diff when versions are identical', () => {
    const v = mkVersion({ rules: [mkRule()] });
    const diff = computeVersionDiff(v, v);
    expect(diff.rules.added).toHaveLength(0);
    expect(diff.rules.removed).toHaveLength(0);
    expect(diff.rules.modified).toHaveLength(0);
  });

  it('detects added rules', () => {
    const before = mkVersion({ rules: [] });
    const after = mkVersion({ rules: [mkRule({ id: 'r-new' })] });
    const diff = computeVersionDiff(before, after);
    expect(diff.rules.added).toHaveLength(1);
    expect(diff.rules.added[0].id).toBe('r-new');
  });

  it('detects removed rules', () => {
    const before = mkVersion({ rules: [mkRule({ id: 'r-gone' })] });
    const after = mkVersion({ rules: [] });
    const diff = computeVersionDiff(before, after);
    expect(diff.rules.removed).toHaveLength(1);
    expect(diff.rules.removed[0].id).toBe('r-gone');
  });

  it('detects modified rules and lists changed fields', () => {
    const before = mkVersion({ rules: [mkRule({ id: 'r-1', priority: 100, name: 'Old' })] });
    const after = mkVersion({ rules: [mkRule({ id: 'r-1', priority: 200, name: 'New' })] });
    const diff = computeVersionDiff(before, after);
    expect(diff.rules.modified).toHaveLength(1);
    expect(diff.rules.modified[0].changed_fields).toEqual(
      expect.arrayContaining(['priority', 'name']),
    );
  });

  it('detects added/removed/modified hard limits', () => {
    const before = mkVersion({
      hard_limits: [mkLimit({ id: 'hl-keep', limit_value: '500000' }), mkLimit({ id: 'hl-gone' })],
    });
    const after = mkVersion({
      hard_limits: [mkLimit({ id: 'hl-keep', limit_value: '600000' }), mkLimit({ id: 'hl-new' })],
    });
    const diff = computeVersionDiff(before, after);
    expect(diff.hard_limits.added.map((l) => l.id)).toEqual(['hl-new']);
    expect(diff.hard_limits.removed.map((l) => l.id)).toEqual(['hl-gone']);
    expect(diff.hard_limits.modified).toHaveLength(1);
    expect(diff.hard_limits.modified[0].changed_fields).toContain('limit_value');
  });

  it('detects added/removed/modified approval chains', () => {
    const chainBefore: ApprovalChain = {
      id: 'c-1',
      version_id: 'v-1',
      name: 'Chain A',
      slots: [{ slot_index: 0, minimum_role: 'treasury_manager' }],
      priority: 1,
      expiration_hours: 24,
      created_by: 'u',
      created_at: new Date('2026-04-10T00:00:00Z'),
    };
    const chainAfter: ApprovalChain = { ...chainBefore, expiration_hours: 48 };
    const diff = computeVersionDiff(
      mkVersion({ approval_chains: [chainBefore] }),
      mkVersion({ approval_chains: [chainAfter] }),
    );
    expect(diff.approval_chains.modified).toHaveLength(1);
    expect(diff.approval_chains.modified[0].changed_fields).toContain('expiration_hours');
  });

  it('records from_version_id and to_version_id', () => {
    const diff = computeVersionDiff(mkVersion({ id: 'v-a' }), mkVersion({ id: 'v-b' }));
    expect(diff.from_version_id).toBe('v-a');
    expect(diff.to_version_id).toBe('v-b');
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test -- src/lib/policy/authoring/diff
```

- [ ] **Step 3: Implement diff.ts**

Create `src/lib/policy/authoring/diff.ts`:

```typescript
// src/lib/policy/authoring/diff.ts

import { PolicyVersionSnapshot, PolicyRule, ApprovalChain } from '../types/policy-version';
import { HardLimit } from '../types/hard-limit';
import { VersionDiff } from './types';

/**
 * Compute a structured diff between two policy versions. Row matching
 * is by `id`. For matched rows, `modified` entries list which top-level
 * fields changed via a deep-equality comparison.
 *
 * Pure function — no DB access, no side effects.
 */
export function computeVersionDiff(
  before: PolicyVersionSnapshot,
  after: PolicyVersionSnapshot,
): VersionDiff {
  return {
    from_version_id: before.id,
    to_version_id: after.id,
    rules: diffCollection(before.rules, after.rules, RULE_COMPARE_FIELDS),
    hard_limits: diffCollection(before.hard_limits, after.hard_limits, HARD_LIMIT_COMPARE_FIELDS),
    approval_chains: diffCollection(
      before.approval_chains,
      after.approval_chains,
      CHAIN_COMPARE_FIELDS,
    ),
  };
}

const RULE_COMPARE_FIELDS: (keyof PolicyRule)[] = [
  'rule_type',
  'name',
  'rationale',
  'priority',
  'verdict',
  'verdict_chain_id',
  'condition',
];

const HARD_LIMIT_COMPARE_FIELDS: (keyof HardLimit)[] = [
  'limit_type',
  'name',
  'limit_value',
  'limit_currency',
  'scope',
];

const CHAIN_COMPARE_FIELDS: (keyof ApprovalChain)[] = [
  'name',
  'slots',
  'trigger_condition',
  'priority',
  'expiration_hours',
];

function diffCollection<T extends { id: string }>(
  before: T[],
  after: T[],
  compareFields: (keyof T)[],
): { added: T[]; removed: T[]; modified: Array<{ before: T; after: T; changed_fields: string[] }> } {
  const beforeById = new Map(before.map((r) => [r.id, r]));
  const afterById = new Map(after.map((r) => [r.id, r]));

  const added: T[] = [];
  const removed: T[] = [];
  const modified: Array<{ before: T; after: T; changed_fields: string[] }> = [];

  for (const [id, afterItem] of afterById) {
    if (!beforeById.has(id)) {
      added.push(afterItem);
      continue;
    }
    const beforeItem = beforeById.get(id)!;
    const changed: string[] = [];
    for (const field of compareFields) {
      if (!deepEqual(beforeItem[field], afterItem[field])) {
        changed.push(field as string);
      }
    }
    if (changed.length > 0) {
      modified.push({ before: beforeItem, after: afterItem, changed_fields: changed });
    }
  }

  for (const [id, beforeItem] of beforeById) {
    if (!afterById.has(id)) {
      removed.push(beforeItem);
    }
  }

  return { added, removed, modified };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  // Use JSON stringify for structural comparison. Sufficient for phase-1
  // since all compared values are plain JSON — no Dates, no functions,
  // no Symbols. If this assumption ever breaks, switch to a proper
  // deep-equal library.
  return JSON.stringify(a) === JSON.stringify(b);
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- src/lib/policy/authoring/diff
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/authoring/diff.ts src/lib/policy/authoring/diff.test.ts
git commit -m "$(cat <<'EOF'
feat(policy-authoring): add version diff computation

Pure computeVersionDiff(before, after) produces a VersionDiff with
added/removed/modified entries for rules, hard_limits, and
approval_chains. Row matching is by id; modified entries list which
top-level fields changed via JSON deep-equality. Used by the
GET /api/policy/versions/[id]/diff/[otherId] endpoint and by the
Plan 3 UI's diff preview before activation.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Chain satisfiability check

**Files:**
- Create: `src/lib/policy/authoring/satisfiability.ts`
- Create: `src/lib/policy/authoring/satisfiability.test.ts`

Checks whether an approval chain's slot requirements can be filled by the current enterprise user base. A chain is unsatisfiable when, for any slot, no user in the enterprise has the minimum role required.

- [ ] **Step 1: Write failing tests**

Create `src/lib/policy/authoring/satisfiability.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { checkChainSatisfiability } from './satisfiability';
import type { ApprovalChain } from '../types/policy-version';
import type { UserRole } from '@/types/database';

const mkChain = (slots: ApprovalChain['slots']): ApprovalChain => ({
  id: 'c-1',
  version_id: 'v-1',
  name: 'Test chain',
  slots,
  priority: 1,
  expiration_hours: 48,
  created_by: 'u',
  created_at: new Date(),
});

const mkUserBase = (
  entries: Array<{ user_id: string; role: UserRole }>,
): Array<{ user_id: string; role: UserRole }> => entries;

describe('checkChainSatisfiability', () => {
  it('is satisfiable when every slot has at least one eligible user', () => {
    const chain = mkChain([
      { slot_index: 0, minimum_role: 'treasury_manager' },
      { slot_index: 1, minimum_role: 'executive' as unknown as 'treasury_manager' },
    ]);
    const users = mkUserBase([
      { user_id: 'u-1', role: 'treasury_manager' },
      { user_id: 'u-2', role: 'treasury_manager' }, // Plan 2b will add executive role
    ]);
    const result = checkChainSatisfiability(chain, users);
    // For phase 1, the spec's approver_role union has {accountant, treasury_manager, approver, executive}
    // but the existing user_profiles.role only has {auditor, accountant, treasury_manager}.
    // The executive slot is unsatisfiable in phase 1 — flag it.
    expect(result.satisfiable).toBe(false);
  });

  it('is satisfiable when all slots only need treasury_manager and users have that role', () => {
    const chain = mkChain([{ slot_index: 0, minimum_role: 'treasury_manager' }]);
    const users = mkUserBase([{ user_id: 'u-1', role: 'treasury_manager' }]);
    const result = checkChainSatisfiability(chain, users);
    expect(result.satisfiable).toBe(true);
    expect(result.unsatisfied_slots).toBeUndefined();
  });

  it('is unsatisfiable when no user has the minimum role', () => {
    const chain = mkChain([{ slot_index: 0, minimum_role: 'treasury_manager' }]);
    const users = mkUserBase([{ user_id: 'u-1', role: 'auditor' }]);
    const result = checkChainSatisfiability(chain, users);
    expect(result.satisfiable).toBe(false);
    expect(result.unsatisfied_slots).toHaveLength(1);
    expect(result.unsatisfied_slots?.[0].slot_index).toBe(0);
    expect(result.unsatisfied_slots?.[0].available_count).toBe(0);
  });

  it('requires enough distinct users when multiple slots need the same role', () => {
    const chain = mkChain([
      { slot_index: 0, minimum_role: 'treasury_manager' },
      { slot_index: 1, minimum_role: 'treasury_manager' },
    ]);
    // Only one treasury_manager → can't fill both slots
    const users = mkUserBase([{ user_id: 'u-1', role: 'treasury_manager' }]);
    const result = checkChainSatisfiability(chain, users);
    expect(result.satisfiable).toBe(false);
    expect(result.unsatisfied_slots?.[0].required_count).toBe(2);
    expect(result.unsatisfied_slots?.[0].available_count).toBe(1);
  });

  it('allows higher-role users to satisfy lower-role slots', () => {
    const chain = mkChain([
      { slot_index: 0, minimum_role: 'accountant' },
      { slot_index: 1, minimum_role: 'auditor' },
    ]);
    const users = mkUserBase([
      { user_id: 'u-1', role: 'treasury_manager' },
      { user_id: 'u-2', role: 'treasury_manager' },
    ]);
    const result = checkChainSatisfiability(chain, users);
    expect(result.satisfiable).toBe(true);
  });

  it('empty slots array is unsatisfiable (schema should reject but defense in depth)', () => {
    const chain = mkChain([]);
    const users = mkUserBase([{ user_id: 'u-1', role: 'treasury_manager' }]);
    const result = checkChainSatisfiability(chain, users);
    expect(result.satisfiable).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test -- src/lib/policy/authoring/satisfiability
```

- [ ] **Step 3: Implement satisfiability.ts**

Create `src/lib/policy/authoring/satisfiability.ts`:

```typescript
// src/lib/policy/authoring/satisfiability.ts

import { ApprovalChain } from '../types/policy-version';
import { UserRole } from '@/types/database';

/**
 * A chain is satisfiable when we can greedily assign distinct users
 * to every slot such that each user's role is at least the slot's
 * minimum_role. In phase 1, the existing user_profiles.role union is
 * {auditor, accountant, treasury_manager}. The spec's approver_role
 * union adds {approver, executive} but those are deferred to Plan 2b's
 * approval workflow service — until then, any slot with minimum_role
 * above treasury_manager is unsatisfiable by definition.
 */

const ROLE_RANK: Record<string, number> = {
  auditor: 0,
  accountant: 1,
  treasury_manager: 2,
  approver: 3, // Plan 2b
  executive: 4, // Plan 2b
};

export interface SatisfiabilityUserRow {
  user_id: string;
  role: UserRole;
}

export interface ChainSatisfiabilityResult {
  chain_id: string;
  chain_name: string;
  satisfiable: boolean;
  unsatisfied_slots?: Array<{
    slot_index: number;
    minimum_role: string;
    required_count: number;
    available_count: number;
  }>;
}

export function checkChainSatisfiability(
  chain: ApprovalChain,
  users: SatisfiabilityUserRow[],
): ChainSatisfiabilityResult {
  if (chain.slots.length === 0) {
    return {
      chain_id: chain.id,
      chain_name: chain.name,
      satisfiable: false,
      unsatisfied_slots: [],
    };
  }

  // Group slots by minimum_role and count how many we need at each level.
  const demand = new Map<string, number>();
  for (const slot of chain.slots) {
    demand.set(slot.minimum_role, (demand.get(slot.minimum_role) ?? 0) + 1);
  }

  // Count users at each role rank. A user at rank N can fill slots at rank ≤ N.
  const supplyByRank = new Map<number, number>();
  for (const user of users) {
    const rank = ROLE_RANK[user.role] ?? -1;
    for (let r = 0; r <= rank; r++) {
      supplyByRank.set(r, (supplyByRank.get(r) ?? 0) + 1);
    }
  }

  // Greedy assignment: for each slot (in descending minimum_role order,
  // hardest first), check that the supply of users >= that rank is
  // at least the cumulative demand at that rank or higher.
  const unsatisfied: ChainSatisfiabilityResult['unsatisfied_slots'] = [];
  for (const slot of chain.slots) {
    const requiredRank = ROLE_RANK[slot.minimum_role];
    if (requiredRank === undefined) {
      unsatisfied.push({
        slot_index: slot.slot_index,
        minimum_role: slot.minimum_role,
        required_count: 1,
        available_count: 0,
      });
      continue;
    }
    // Count users with exact-or-higher role across the whole user base
    let available = 0;
    for (const user of users) {
      if ((ROLE_RANK[user.role] ?? -1) >= requiredRank) available++;
    }
    const sameSlotCount = chain.slots.filter((s) => s.minimum_role === slot.minimum_role).length;
    if (available < sameSlotCount) {
      unsatisfied.push({
        slot_index: slot.slot_index,
        minimum_role: slot.minimum_role,
        required_count: sameSlotCount,
        available_count: available,
      });
    }
  }

  const deduplicatedUnsatisfied = Array.from(
    new Map(unsatisfied.map((u) => [`${u.slot_index}:${u.minimum_role}`, u])).values(),
  );

  return {
    chain_id: chain.id,
    chain_name: chain.name,
    satisfiable: deduplicatedUnsatisfied.length === 0,
    unsatisfied_slots:
      deduplicatedUnsatisfied.length === 0 ? undefined : deduplicatedUnsatisfied,
  };
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- src/lib/policy/authoring/satisfiability
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/authoring/satisfiability.ts src/lib/policy/authoring/satisfiability.test.ts
git commit -m "$(cat <<'EOF'
feat(policy-authoring): add chain satisfiability check

Pure function checkChainSatisfiability(chain, users) returns a
structured result indicating whether the chain's slot requirements
can be filled by the current user base. A chain is unsatisfiable
when some slot's minimum_role has no eligible users, or when the
chain demands more distinct users at a given role tier than the
enterprise has.

PHASE-1 NOTE: the spec's ApproverRole union includes 'approver' and
'executive' tiers, but the existing user_profiles.role enum only
has {auditor, accountant, treasury_manager}. Chains requiring
higher roles are unsatisfiable by definition until Plan 2b extends
the role enum.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: PolicyAuthoringService — skeleton + read operations

**Files:**
- Create: `src/lib/policy/authoring/service.ts` (initial version)
- Create: `src/lib/policy/authoring/service.test.ts` (initial test file)

Creates the service class and implements the read-only operations: `getActiveVersion`, `getVersionById`, `listVersions`. These don't need permissions beyond `canViewActivePolicy` and don't require transactions.

- [ ] **Step 1: Write failing tests**

Create `src/lib/policy/authoring/service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolicyAuthoringService } from './service';
import type { AuthoringActor } from './types';

function mkActor(overrides: Partial<AuthoringActor> = {}): AuthoringActor {
  return {
    user_id: 'user-1',
    role: 'treasury_manager',
    enterprise_id: 'ent-1',
    ...overrides,
  };
}

/**
 * Minimal Supabase mock that routes .from(table) calls to per-table
 * fixtures. Tests set up fixtures per-scenario via mockSupabase().
 */
function mockSupabase(fixtures: {
  policy_policies?: Array<Record<string, unknown>>;
  policy_versions?: Array<Record<string, unknown>>;
  policy_rules?: Array<Record<string, unknown>>;
  policy_hard_limits?: Array<Record<string, unknown>>;
  policy_approval_chains?: Array<Record<string, unknown>>;
  user_profiles?: Array<Record<string, unknown>>;
}) {
  const data: Record<string, Array<Record<string, unknown>>> = {
    policy_policies: fixtures.policy_policies ?? [],
    policy_versions: fixtures.policy_versions ?? [],
    policy_rules: fixtures.policy_rules ?? [],
    policy_hard_limits: fixtures.policy_hard_limits ?? [],
    policy_approval_chains: fixtures.policy_approval_chains ?? [],
    user_profiles: fixtures.user_profiles ?? [],
  };

  function queryBuilder(table: string) {
    let rows = [...(data[table] ?? [])];
    const builder: Record<string, unknown> = {
      select: vi.fn().mockImplementation(() => builder),
      eq: vi.fn().mockImplementation((col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      }),
      in: vi.fn().mockImplementation((col: string, vals: unknown[]) => {
        rows = rows.filter((r) => vals.includes(r[col]));
        return builder;
      }),
      order: vi.fn().mockImplementation(() => builder),
      limit: vi.fn().mockImplementation(() => builder),
      single: vi.fn().mockImplementation(() => Promise.resolve({ data: rows[0] ?? null, error: null })),
      maybeSingle: vi
        .fn()
        .mockImplementation(() => Promise.resolve({ data: rows[0] ?? null, error: null })),
      then: (resolve: (result: { data: unknown; error: unknown }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return builder;
  }

  return {
    from: vi.fn().mockImplementation(queryBuilder),
  };
}

describe('PolicyAuthoringService.getActiveVersion', () => {
  it('returns the active version hydrated with rules/limits/chains', async () => {
    const supabase = mockSupabase({
      policy_policies: [
        {
          id: 'p-1',
          enterprise_id: 'ent-1',
          name: 'Standard',
          active_version_id: 'v-active',
        },
      ],
      policy_versions: [
        {
          id: 'v-active',
          enterprise_id: 'ent-1',
          version_number: 3,
          status: 'active',
          name: 'Standard',
          created_by: 'user-9',
          created_at: new Date().toISOString(),
          activated_at: new Date().toISOString(),
          activated_by: 'user-9',
        },
      ],
      policy_rules: [
        {
          id: 'r-1',
          version_id: 'v-active',
          rule_type: 'approval_threshold',
          name: 'Approval > 50k',
          rationale: '',
          priority: 100,
          condition: {
            kind: 'amount_compare',
            attr: 'transfer.amount',
            op: '>',
            value: { amount: '50000', currency: 'USD' },
          },
          verdict: 'require_approval',
          verdict_chain_id: null,
          created_by: 'user-9',
          created_at: new Date().toISOString(),
        },
      ],
      policy_hard_limits: [],
      policy_approval_chains: [],
    });

    const svc = new PolicyAuthoringService(supabase as never);
    const version = await svc.getActiveVersion(mkActor());

    expect(version?.id).toBe('v-active');
    expect(version?.status).toBe('active');
    expect(version?.rules).toHaveLength(1);
    expect(version?.rules[0].id).toBe('r-1');
  });

  it('returns null when the enterprise has no active version yet', async () => {
    const supabase = mockSupabase({
      policy_policies: [
        { id: 'p-1', enterprise_id: 'ent-1', name: 'Standard', active_version_id: null },
      ],
    });
    const svc = new PolicyAuthoringService(supabase as never);
    const version = await svc.getActiveVersion(mkActor());
    expect(version).toBeNull();
  });

  it('returns null when the enterprise has no policy row at all', async () => {
    const supabase = mockSupabase({});
    const svc = new PolicyAuthoringService(supabase as never);
    const version = await svc.getActiveVersion(mkActor());
    expect(version).toBeNull();
  });
});

describe('PolicyAuthoringService.getVersionById', () => {
  it('returns a full version including rules and limits when the version exists and belongs to the actor enterprise', async () => {
    const supabase = mockSupabase({
      policy_versions: [
        {
          id: 'v-1',
          enterprise_id: 'ent-1',
          version_number: 1,
          status: 'draft',
          name: 'Draft',
          created_by: 'user-1',
          created_at: new Date().toISOString(),
        },
      ],
      policy_rules: [
        {
          id: 'r-1',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Test',
          rationale: '',
          priority: 1,
          condition: {
            kind: 'amount_compare',
            attr: 'transfer.amount',
            op: '>',
            value: { amount: '1', currency: 'USD' },
          },
          verdict: 'require_approval',
          verdict_chain_id: null,
          created_by: 'u',
          created_at: new Date().toISOString(),
        },
      ],
      policy_hard_limits: [],
      policy_approval_chains: [],
    });
    const svc = new PolicyAuthoringService(supabase as never);
    const version = await svc.getVersionById(mkActor(), 'v-1');
    expect(version.id).toBe('v-1');
    expect(version.rules).toHaveLength(1);
  });

  it('throws AuthoringError when the version belongs to a different enterprise', async () => {
    const supabase = mockSupabase({
      policy_versions: [
        {
          id: 'v-other',
          enterprise_id: 'ent-other',
          version_number: 1,
          status: 'active',
          name: 'Other',
          created_by: 'u',
          created_at: new Date().toISOString(),
        },
      ],
    });
    const svc = new PolicyAuthoringService(supabase as never);
    await expect(svc.getVersionById(mkActor(), 'v-other')).rejects.toThrow();
  });
});

describe('PolicyAuthoringService.listVersions', () => {
  it('returns all versions scoped to the actor enterprise', async () => {
    const supabase = mockSupabase({
      policy_versions: [
        {
          id: 'v-1',
          enterprise_id: 'ent-1',
          version_number: 1,
          status: 'active',
          name: 'v1',
          created_by: 'u',
          created_at: new Date().toISOString(),
        },
        {
          id: 'v-2',
          enterprise_id: 'ent-1',
          version_number: 2,
          status: 'draft',
          name: 'v2',
          created_by: 'u',
          created_at: new Date().toISOString(),
        },
        {
          id: 'v-other',
          enterprise_id: 'ent-other',
          version_number: 1,
          status: 'active',
          name: 'other',
          created_by: 'u',
          created_at: new Date().toISOString(),
        },
      ],
    });
    const svc = new PolicyAuthoringService(supabase as never);
    const versions = await svc.listVersions(mkActor());
    expect(versions.map((v) => v.id)).toEqual(['v-1', 'v-2']);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test -- src/lib/policy/authoring/service
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement service.ts skeleton + read methods**

Create `src/lib/policy/authoring/service.ts`:

```typescript
// src/lib/policy/authoring/service.ts

import { PolicyVersionSnapshot, PolicyRule, ApprovalChain } from '../types/policy-version';
import { HardLimit } from '../types/hard-limit';
import { Condition } from '../types/ir';
import { AuthoringError } from './errors';
import { REASON_CODES } from '../errors/reason-codes';
import { AuthoringActor } from './types';

type SupabaseLike = {
  from: (table: string) => unknown;
};

/**
 * PolicyAuthoringService owns every authoring-flow mutation against the
 * policy_* tables. Route handlers call it with an AuthoringActor (the
 * signed-in user's id, role, and enterprise). The service enforces
 * per-enterprise scoping at every query and runs the save-time
 * validation cascade before any write.
 *
 * DESIGN:
 * - Every write goes through a method here — routes never touch
 *   Supabase directly for policy_* tables
 * - Read methods are low-privilege (any auditor+) and pure queries
 * - Write methods require treasury_manager+ (rules/chains) or
 *   is_policy_admin (hard limits, activation)
 * - All throws are AuthoringError instances with structured reason_code
 * - Scopes every row lookup by enterprise_id for defense-in-depth on
 *   top of RLS
 */
export class PolicyAuthoringService {
  constructor(private readonly supabase: SupabaseLike) {}

  /**
   * Return the active PolicyVersionSnapshot for the actor's enterprise,
   * or null if no policy has been activated yet.
   */
  async getActiveVersion(actor: AuthoringActor): Promise<PolicyVersionSnapshot | null> {
    const policyRow = await this.fetchPolicyRowForEnterprise(actor.enterprise_id);
    if (!policyRow || !policyRow.active_version_id) {
      return null;
    }
    return this.loadVersionWithChildren(actor.enterprise_id, policyRow.active_version_id);
  }

  /**
   * Return a specific version by id. Throws version_not_draft-style
   * error if the version doesn't belong to the actor's enterprise.
   */
  async getVersionById(actor: AuthoringActor, versionId: string): Promise<PolicyVersionSnapshot> {
    const version = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!version) {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: `Policy version ${versionId} not found in this enterprise.`,
        user_action: 'Check the version id. It may belong to a different enterprise.',
        details: { version_id: versionId, enterprise_id: actor.enterprise_id },
      });
    }
    return version;
  }

  /**
   * List all versions (draft + active + superseded) for the actor's
   * enterprise, ordered by version_number descending. Each version
   * returns without its rules/limits/chains hydrated — call
   * getVersionById for a full snapshot.
   */
  async listVersions(actor: AuthoringActor): Promise<PolicyVersionSnapshot[]> {
    type VersionRow = {
      id: string;
      enterprise_id: string;
      version_number: number;
      status: 'draft' | 'active' | 'superseded';
      name: string;
      created_by: string;
      created_at: string;
      activated_at?: string | null;
      activated_by?: string | null;
    };
    const { data, error } = (await (
      this.supabase.from('policy_versions') as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            order: (col: string, opts: { ascending: boolean }) => Promise<{ data: VersionRow[] | null; error: unknown }>;
          };
        };
      }
    )
      .select('*')
      .eq('enterprise_id', actor.enterprise_id)
      .order('version_number', { ascending: false })) ?? { data: null, error: null };

    if (error || !data) return [];

    return data.map((row) => ({
      id: row.id,
      enterprise_id: row.enterprise_id,
      version_number: row.version_number,
      status: row.status,
      name: row.name,
      rules: [],
      hard_limits: [],
      approval_chains: [],
      activated_at: row.activated_at ? new Date(row.activated_at) : undefined,
      activated_by: row.activated_by ?? undefined,
    }));
  }

  // ─── Private helpers ───────────────────────────────────────

  private async fetchPolicyRowForEnterprise(
    enterpriseId: string,
  ): Promise<{ id: string; active_version_id: string | null } | null> {
    const builder = this.supabase.from('policy_policies') as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{
            data: { id: string; active_version_id: string | null } | null;
            error: unknown;
          }>;
        };
      };
    };
    const { data } = await builder.select('*').eq('enterprise_id', enterpriseId).maybeSingle();
    return data ?? null;
  }

  private async loadVersionWithChildren(
    enterpriseId: string,
    versionId: string,
  ): Promise<PolicyVersionSnapshot | null> {
    const versionBuilder = this.supabase.from('policy_versions') as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
          };
        };
      };
    };
    const { data: versionRow } = await versionBuilder
      .select('*')
      .eq('id', versionId)
      .eq('enterprise_id', enterpriseId)
      .maybeSingle();
    if (!versionRow) return null;

    const rules = await this.fetchChildren<PolicyRule>('policy_rules', versionId);
    const hardLimits = await this.fetchChildren<HardLimit>('policy_hard_limits', versionId);
    const chains = await this.fetchChildren<ApprovalChain>('policy_approval_chains', versionId);

    return {
      id: versionRow.id as string,
      enterprise_id: versionRow.enterprise_id as string,
      version_number: versionRow.version_number as number,
      status: versionRow.status as 'draft' | 'active' | 'superseded',
      name: versionRow.name as string,
      rules,
      hard_limits: hardLimits,
      approval_chains: chains,
      activated_at: versionRow.activated_at ? new Date(versionRow.activated_at as string) : undefined,
      activated_by: (versionRow.activated_by as string) ?? undefined,
    };
  }

  private async fetchChildren<T>(table: string, versionId: string): Promise<T[]> {
    const builder = this.supabase.from(table) as {
      select: (cols: string) => {
        eq: (col: string, val: string) => Promise<{ data: T[] | null; error: unknown }>;
      };
    };
    const { data } = await builder.select('*').eq('version_id', versionId);
    return data ?? [];
  }
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- src/lib/policy/authoring/service
```

Expected: the 5 tests in this task pass (other describe blocks added in later tasks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/authoring/service.ts src/lib/policy/authoring/service.test.ts
git commit -m "$(cat <<'EOF'
feat(policy-authoring): service skeleton + read methods

PolicyAuthoringService owns every policy_* mutation the authoring
API performs. Route handlers call it with an AuthoringActor carrying
the signed-in user's id, role, and enterprise. Initial commit adds
the class skeleton plus three read-only methods:

- getActiveVersion — hydrated active policy or null
- getVersionById — scoped to actor's enterprise, throws if missing
- listVersions — all versions, shallow (no rules/limits/chains
  hydrated); call getVersionById for full detail

Every query is explicitly enterprise-scoped on top of RLS as
defense in depth. Subsequent tasks add write methods.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Service — draft lifecycle (create, clone, delete)

**Files:**
- Modify: `src/lib/policy/authoring/service.ts` (add methods)
- Modify: `src/lib/policy/authoring/service.test.ts` (add tests)

Adds `createDraft`, `cloneVersion`, and `deleteDraft` to the service. `createDraft` starts from an optional source version (inheriting rules/limits/chains) or creates an empty draft. `cloneVersion` is a convenience wrapper. `deleteDraft` requires the draft status and is gated to the draft's creator or a policy admin.

- [ ] **Step 1: Add tests to service.test.ts**

Append to `src/lib/policy/authoring/service.test.ts`:

```typescript
describe('PolicyAuthoringService.createDraft', () => {
  it('creates an empty draft when no source version is provided', async () => {
    const insertedRows: Array<Record<string, unknown>> = [];
    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'policy_versions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [{ version_number: 2 }],
                    error: null,
                  }),
                }),
              }),
            }),
            insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
              insertedRows.push({ table, ...row });
              return {
                select: vi.fn().mockReturnValue({
                  single: vi
                    .fn()
                    .mockResolvedValue({ data: { ...row, id: 'v-new' }, error: null }),
                }),
              };
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          }),
        };
      }),
    };

    const svc = new PolicyAuthoringService(supabase as never);
    const draft = await svc.createDraft(
      { user_id: 'user-1', role: 'treasury_manager', enterprise_id: 'ent-1' },
      { name: 'My draft' },
    );

    expect(draft.status).toBe('draft');
    expect(draft.version_number).toBe(3); // 2 + 1
    expect(draft.rules).toHaveLength(0);
  });

  it('throws when the actor role is below treasury_manager', async () => {
    const svc = new PolicyAuthoringService({} as never);
    await expect(
      svc.createDraft(
        { user_id: 'u-aud', role: 'auditor', enterprise_id: 'ent-1' },
        { name: 'My draft' },
      ),
    ).rejects.toMatchObject({ reason_code: 'requires_policy_admin' });
  });
});

describe('PolicyAuthoringService.deleteDraft', () => {
  it('deletes a draft when the actor is the creator', async () => {
    const deletedIds: string[] = [];
    const supabase = {
      from: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data:
                  table === 'policy_versions'
                    ? { id: 'v-1', enterprise_id: 'ent-1', status: 'draft', created_by: 'user-1' }
                    : null,
                error: null,
              }),
            }),
            maybeSingle: vi.fn().mockResolvedValue({
              data:
                table === 'policy_versions'
                  ? { id: 'v-1', enterprise_id: 'ent-1', status: 'draft', created_by: 'user-1' }
                  : null,
              error: null,
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((col: string, val: string) => {
            if (col === 'id') deletedIds.push(val);
            return Promise.resolve({ data: null, error: null });
          }),
        }),
      })),
    };
    const svc = new PolicyAuthoringService(supabase as never);
    await svc.deleteDraft(
      { user_id: 'user-1', role: 'treasury_manager', enterprise_id: 'ent-1' },
      'v-1',
    );
    expect(deletedIds).toContain('v-1');
  });

  it('throws version_not_draft when attempting to delete an active version', async () => {
    const supabase = {
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'v-1', enterprise_id: 'ent-1', status: 'active', created_by: 'u' },
                error: null,
              }),
            }),
          }),
        }),
      })),
    };
    const svc = new PolicyAuthoringService(supabase as never);
    await expect(
      svc.deleteDraft(
        { user_id: 'user-1', role: 'treasury_manager', enterprise_id: 'ent-1' },
        'v-1',
      ),
    ).rejects.toMatchObject({ reason_code: 'version_not_draft' });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- src/lib/policy/authoring/service
```

- [ ] **Step 3: Add methods to service.ts**

Edit `src/lib/policy/authoring/service.ts` to add imports and methods. Add these imports at the top:

```typescript
import { CreateDraftRequest } from './types';
import { canCreateDraft } from './permissions';
```

Add these methods inside the `PolicyAuthoringService` class (after `listVersions`, before the private helpers):

```typescript
  /**
   * Create a new draft version. If `source_version_id` is provided, the
   * new draft inherits all rules/limits/chains from it (deep copy with
   * new ids). Otherwise starts empty. Requires treasury_manager+.
   */
  async createDraft(
    actor: AuthoringActor,
    req: CreateDraftRequest,
  ): Promise<PolicyVersionSnapshot> {
    if (!canCreateDraft(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Creating a policy draft requires treasury_manager role or higher.',
        user_action: 'Ask a treasury manager or admin to create the draft.',
        details: { actor_role: actor.role },
      });
    }

    const nextVersionNumber = await this.fetchNextVersionNumber(actor.enterprise_id);

    const versionBuilder = this.supabase.from('policy_versions') as {
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
        };
      };
    };
    const { data: newVersionRow, error } = await versionBuilder
      .insert({
        enterprise_id: actor.enterprise_id,
        version_number: nextVersionNumber,
        status: 'draft',
        name: req.name,
        created_by: actor.user_id,
      })
      .select('*')
      .single();

    if (error || !newVersionRow) {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: `Failed to create draft: ${error ? String(error) : 'no row returned'}`,
        user_action: 'Retry. If the issue persists, contact support.',
        details: { enterprise_id: actor.enterprise_id },
      });
    }

    const newVersionId = newVersionRow.id as string;

    // If a source version was provided, clone its children into the new draft
    if (req.source_version_id) {
      await this.copyChildrenIntoVersion(
        actor.enterprise_id,
        req.source_version_id,
        newVersionId,
      );
    }

    return (await this.loadVersionWithChildren(actor.enterprise_id, newVersionId))!;
  }

  /**
   * Convenience wrapper: clone an existing version into a new draft.
   * Equivalent to createDraft with source_version_id set.
   */
  async cloneVersion(
    actor: AuthoringActor,
    sourceVersionId: string,
    newName?: string,
  ): Promise<PolicyVersionSnapshot> {
    // Verify the source exists and belongs to this enterprise first
    const source = await this.getVersionById(actor, sourceVersionId);
    return this.createDraft(actor, {
      name: newName ?? `${source.name} (clone)`,
      source_version_id: sourceVersionId,
    });
  }

  /**
   * Delete a draft version. Requires treasury_manager+ AND the actor
   * must be either the draft's creator or a policy admin. Only draft
   * versions are deletable — active/superseded rows are append-only.
   */
  async deleteDraft(actor: AuthoringActor, versionId: string): Promise<void> {
    if (!canCreateDraft(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Deleting a policy draft requires treasury_manager role or higher.',
        user_action: 'Ask a treasury manager or admin to delete the draft.',
        details: { actor_role: actor.role },
      });
    }

    const builder = this.supabase.from('policy_versions') as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{
              data: { id: string; status: string; created_by: string } | null;
              error: unknown;
            }>;
          };
        };
      };
    };
    const { data: row } = await builder
      .select('id, status, created_by')
      .eq('id', versionId)
      .eq('enterprise_id', actor.enterprise_id)
      .maybeSingle();

    if (!row) {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: `Version ${versionId} not found in this enterprise.`,
        user_action: 'Check the version id.',
        details: { version_id: versionId },
      });
    }

    if (row.status !== 'draft') {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: `Cannot delete version ${versionId} — only drafts are deletable (this version is ${row.status}).`,
        user_action: 'Clone the version to create a new draft instead of deleting it.',
        details: { version_id: versionId, status: row.status },
      });
    }

    // Creator or policy admin can delete
    if (row.created_by !== actor.user_id) {
      // Not the creator — must be a policy admin (or app admin)
      // Note: permission check uses a live DB lookup. Service callers
      // that pre-verified can pass actor.role='treasury_manager' and
      // still hit this path if they're not the creator.
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable:
          'Only the draft creator or a policy admin can delete this draft.',
        user_action: 'Ask the creator or a policy admin to delete it.',
        details: { version_id: versionId, created_by: row.created_by, actor: actor.user_id },
      });
    }

    const deleteBuilder = this.supabase.from('policy_versions') as {
      delete: () => {
        eq: (col: string, val: string) => Promise<{ data: unknown; error: unknown }>;
      };
    };
    const { error: deleteError } = await deleteBuilder.delete().eq('id', versionId);
    if (deleteError) {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: `Failed to delete draft: ${String(deleteError)}`,
        user_action: 'Retry. If the issue persists, contact support.',
        details: { version_id: versionId },
      });
    }
  }
```

Also add these private helpers at the bottom of the class:

```typescript
  private async fetchNextVersionNumber(enterpriseId: string): Promise<number> {
    const builder = this.supabase.from('policy_versions') as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          order: (col: string, opts: { ascending: boolean }) => {
            limit: (n: number) => Promise<{ data: Array<{ version_number: number }> | null; error: unknown }>;
          };
        };
      };
    };
    const { data } = await builder
      .select('version_number')
      .eq('enterprise_id', enterpriseId)
      .order('version_number', { ascending: false })
      .limit(1);
    if (!data || data.length === 0) return 1;
    return data[0].version_number + 1;
  }

  private async copyChildrenIntoVersion(
    enterpriseId: string,
    sourceVersionId: string,
    targetVersionId: string,
  ): Promise<void> {
    const source = await this.loadVersionWithChildren(enterpriseId, sourceVersionId);
    if (!source) return;

    // Build id remapping: every child row gets a new id in the target version.
    // We preserve chain refs by remapping chain ids first, then rewriting rule
    // verdict_chain_id references to the new chain ids.
    const chainIdMap = new Map<string, string>();
    for (const chain of source.approval_chains) {
      const newId = crypto.randomUUID();
      chainIdMap.set(chain.id, newId);
      await (this.supabase.from('policy_approval_chains') as {
        insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
      }).insert({
        id: newId,
        version_id: targetVersionId,
        name: chain.name,
        slots: chain.slots,
        trigger_condition: chain.trigger_condition ?? null,
        priority: chain.priority,
        expiration_hours: chain.expiration_hours,
        created_by: chain.created_by,
      });
    }

    for (const rule of source.rules) {
      const remappedChainId = rule.verdict_chain_id
        ? chainIdMap.get(rule.verdict_chain_id) ?? rule.verdict_chain_id
        : null;
      await (this.supabase.from('policy_rules') as {
        insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
      }).insert({
        id: crypto.randomUUID(),
        version_id: targetVersionId,
        rule_type: rule.rule_type,
        name: rule.name,
        rationale: rule.rationale,
        condition: rule.condition,
        verdict: rule.verdict,
        verdict_chain_id: remappedChainId,
        priority: rule.priority,
        created_by: rule.created_by,
      });
    }

    for (const limit of source.hard_limits) {
      await (this.supabase.from('policy_hard_limits') as {
        insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
      }).insert({
        id: crypto.randomUUID(),
        version_id: targetVersionId,
        limit_type: limit.limit_type,
        name: limit.name,
        limit_value: limit.limit_value,
        limit_currency: limit.limit_currency ?? null,
        scope: limit.scope,
        created_by: 'system',
      });
    }
  }
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- src/lib/policy/authoring/service
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/authoring/service.ts src/lib/policy/authoring/service.test.ts
git commit -m "$(cat <<'EOF'
feat(policy-authoring): service draft lifecycle methods

createDraft: new draft with sequential version_number, optionally
  inheriting children from source_version_id (chains cloned first,
  then rules with remapped verdict_chain_id references so the new
  draft is self-contained).
cloneVersion: convenience wrapper for createDraft + source.
deleteDraft: only deletable by creator or policy admin, only valid
  on drafts (active/superseded are append-only).

All writes scoped by enterprise_id as defense-in-depth on top of RLS.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Service — rule CRUD

**Files:**
- Modify: `src/lib/policy/authoring/service.ts`
- Modify: `src/lib/policy/authoring/service.test.ts`

Adds `upsertRule` and `deleteRule`. Every write requires the parent version be in draft status, runs per-row validation via `validateRuleInput`, and runs whole-version validation via `validateVersionCoherent` to catch priority collisions and chain-reference integrity.

- [ ] **Step 1: Add tests to service.test.ts**

```typescript
describe('PolicyAuthoringService.upsertRule', () => {
  it('creates a new rule in a draft version', async () => {
    // ... standard mock setup pattern as other tests ...
    // Test: service.upsertRule(actor, 'v-1', {rule_type, name, rationale, condition, verdict, priority})
    // Assert: returns the new rule with a generated id, priority, and timestamps
  });

  it('throws version_not_draft when the parent version is not in draft status', async () => {
    // Test: parent version has status='active'
    // Assert: AuthoringError with reason_code=version_not_draft
  });

  it('updates an existing rule when id is provided', async () => {
    // Test: upsertRule with id='r-existing', changes priority
    // Assert: the row is updated in place with new values
  });

  it('throws rule_priority_collision when the new priority conflicts with another rule in the same version', async () => {
    // Test: draft already has a rule with priority 100; upsert another with priority 100
    // Assert: AuthoringError with reason_code=rule_priority_collision
  });

  it('runs validateRuleInput (rejects USD rule on rate-less asset)', async () => {
    // Test: upsert rule with condition scoping a non-stablecoin asset + currency=USD
    // Assert: AuthoringError with reason_code=usd_rule_on_rateless_asset
  });
});

describe('PolicyAuthoringService.deleteRule', () => {
  it('deletes a rule from a draft version', async () => {
    // Test: service.deleteRule(actor, 'v-1', 'r-1')
    // Assert: delete call dispatched for the matching row
  });

  it('throws version_not_draft when the parent version is active', async () => {
    // Test: parent version status='active'
    // Assert: AuthoringError with reason_code=version_not_draft
  });
});
```

**Note to implementer:** this task description uses skeleton tests with comments — expand each `it` block into a full test using the `mockSupabase` helper from Task 7 and the same `mkActor` pattern. Each test needs:
- Set up fixture data in `mockSupabase({ policy_versions: [...], policy_rules: [...] })`
- Capture mock writes via `vi.fn().mockImplementation(...)` that pushes into an outer array
- Call the service method
- Assert on the captured writes

See `src/lib/policy/authoring/validation.test.ts` for the exact fixture patterns for valid/invalid rules.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- src/lib/policy/authoring/service
```

- [ ] **Step 3: Add methods to service.ts**

Add imports:

```typescript
import { UpsertRuleRequest } from './types';
import { canEditDraftRules } from './permissions';
import { validateRuleInput, validateVersionCoherent } from './validation';
```

Add methods inside the class:

```typescript
  /**
   * Create or update a rule in a draft version. The parent version must
   * be in draft status. Runs per-row validation first, then writes,
   * then re-runs whole-version validation as a belt-and-suspenders
   * check for priority collisions and chain-reference integrity.
   */
  async upsertRule(
    actor: AuthoringActor,
    versionId: string,
    req: UpsertRuleRequest,
  ): Promise<PolicyRule> {
    if (!canEditDraftRules(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Editing rules requires treasury_manager role or higher.',
        user_action: 'Ask a treasury manager or admin to edit rules.',
        details: { actor_role: actor.role },
      });
    }

    const version = await this.requireDraftVersion(actor, versionId);

    // Per-row validation (schema + IR + currency consistency)
    validateRuleInput(req, { requireChainForApproval: true });

    const ruleId = req.id ?? crypto.randomUUID();

    if (req.id) {
      // Update path
      const updateBuilder = this.supabase.from('policy_rules') as {
        update: (patch: Record<string, unknown>) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => Promise<{ error: unknown }>;
          };
        };
      };
      const { error } = await updateBuilder
        .update({
          rule_type: req.rule_type,
          name: req.name,
          rationale: req.rationale,
          condition: req.condition,
          verdict: req.verdict,
          verdict_chain_id: req.verdict_chain_id ?? null,
          priority: req.priority,
        })
        .eq('id', ruleId)
        .eq('version_id', versionId);
      if (error) {
        throw new AuthoringError({
          reason_code: REASON_CODES.version_not_draft,
          human_readable: `Failed to update rule: ${String(error)}`,
          user_action: 'Retry; if the problem persists, contact support.',
          details: { rule_id: ruleId, version_id: versionId },
        });
      }
    } else {
      // Insert path
      const insertBuilder = this.supabase.from('policy_rules') as {
        insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
      };
      const { error } = await insertBuilder.insert({
        id: ruleId,
        version_id: versionId,
        rule_type: req.rule_type,
        name: req.name,
        rationale: req.rationale,
        condition: req.condition,
        verdict: req.verdict,
        verdict_chain_id: req.verdict_chain_id ?? null,
        priority: req.priority,
        created_by: actor.user_id,
      });
      if (error) {
        throw new AuthoringError({
          reason_code: REASON_CODES.version_not_draft,
          human_readable: `Failed to insert rule: ${String(error)}`,
          user_action: 'Retry; if the problem persists, contact support.',
          details: { version_id: versionId },
        });
      }
    }

    // Reload the version and run whole-version validation (belt + suspenders)
    const reloaded = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!reloaded) {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: 'Version disappeared after upsert (concurrent delete?)',
        user_action: 'Retry.',
        details: { version_id: versionId },
      });
    }
    validateVersionCoherent(reloaded);

    const newRule = reloaded.rules.find((r) => r.id === ruleId);
    if (!newRule) {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: 'Rule not found after upsert.',
        user_action: 'Retry.',
        details: { rule_id: ruleId, version_id: versionId },
      });
    }
    return newRule;
  }

  async deleteRule(actor: AuthoringActor, versionId: string, ruleId: string): Promise<void> {
    if (!canEditDraftRules(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Deleting rules requires treasury_manager role or higher.',
        user_action: 'Ask a treasury manager or admin.',
        details: { actor_role: actor.role },
      });
    }
    await this.requireDraftVersion(actor, versionId);
    const builder = this.supabase.from('policy_rules') as {
      delete: () => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => Promise<{ error: unknown }>;
        };
      };
    };
    const { error } = await builder.delete().eq('id', ruleId).eq('version_id', versionId);
    if (error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: `Failed to delete rule: ${String(error)}`,
        user_action: 'Retry.',
        details: { rule_id: ruleId, version_id: versionId },
      });
    }
  }
```

Add this private helper at the bottom of the class:

```typescript
  private async requireDraftVersion(
    actor: AuthoringActor,
    versionId: string,
  ): Promise<PolicyVersionSnapshot> {
    const version = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!version) {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: `Policy version ${versionId} not found in this enterprise.`,
        user_action: 'Check the version id.',
        details: { version_id: versionId },
      });
    }
    if (version.status !== 'draft') {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: `Cannot edit version ${versionId} — only drafts are editable (status=${version.status}).`,
        user_action: 'Clone the version to create a new draft.',
        details: { version_id: versionId, status: version.status },
      });
    }
    return version;
  }
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- src/lib/policy/authoring/service
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/authoring/service.ts src/lib/policy/authoring/service.test.ts
git commit -m "$(cat <<'EOF'
feat(policy-authoring): service rule CRUD methods

upsertRule and deleteRule. Both require treasury_manager+ role and
that the parent version be in draft status (active/superseded are
append-only per the migration trigger). upsertRule runs per-row
validation first (validateRuleInput), writes, then reloads and runs
whole-version validation (validateVersionCoherent) as belt-and-
suspenders for priority collisions and chain-reference integrity.

Extracted requireDraftVersion() private helper since every write
method below will need the same draft-status check.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Service — hard limit CRUD (is_policy_admin gated)

**Files:**
- Modify: `src/lib/policy/authoring/service.ts`
- Modify: `src/lib/policy/authoring/service.test.ts`

Adds `upsertHardLimit` and `deleteHardLimit`. Both gate on `requirePolicyAdmin` (live DB check) — treasury_manager is NOT sufficient. Validation via `validateHardLimitInput` + `validateVersionCoherent`.

- [ ] **Step 1: Add tests**

Add test skeletons to `service.test.ts`:

```typescript
describe('PolicyAuthoringService.upsertHardLimit', () => {
  it('creates a hard limit when the actor has is_policy_admin=true', async () => {
    // mockSupabase with user_profiles[{id: 'user-1', is_policy_admin: true}]
    // + a draft version, then call upsertHardLimit
    // Assert: insert into policy_hard_limits
  });

  it('creates a hard limit via is_app_admin elevation (source=vantor_staff)', async () => {
    // mockSupabase with user_profiles[{id: 'user-staff', is_app_admin: true, is_policy_admin: false}]
    // Assert: insert succeeds
  });

  it('throws requires_policy_admin when the actor has neither flag', async () => {
    // mockSupabase with user_profiles[{is_policy_admin: false, is_app_admin: false}]
    // Assert: AuthoringError reason_code=requires_policy_admin
  });

  it('throws hard_limit_value_out_of_range for a negative limit_value', async () => {
    // is_policy_admin=true setup
    // upsertHardLimit({limit_value: '-1000', ...})
    // Assert: AuthoringError reason_code=hard_limit_value_out_of_range
  });

  it('throws version_not_draft when the parent version is active', async () => {
    // is_policy_admin=true + active version
    // Assert: AuthoringError reason_code=version_not_draft
  });
});

describe('PolicyAuthoringService.deleteHardLimit', () => {
  it('deletes a hard limit when actor is policy admin and version is draft', async () => {
    // Assert: delete call dispatched
  });

  it('throws requires_policy_admin when actor is treasury_manager only', async () => {
    // Assert: AuthoringError reason_code=requires_policy_admin
  });
});
```

Expand these into full tests using the same `mockSupabase` pattern. Each test should include a `user_profiles` fixture with the appropriate `is_policy_admin`/`is_app_admin` flags.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- src/lib/policy/authoring/service
```

- [ ] **Step 3: Add methods to service.ts**

Add imports:

```typescript
import { UpsertHardLimitRequest } from './types';
import { requirePolicyAdmin } from './permissions';
import { validateHardLimitInput } from './validation';
```

Add methods inside the class:

```typescript
  /**
   * Create or update a hard limit in a draft version. Requires
   * is_policy_admin=true (or is_app_admin). Every write is audit-logged
   * with source='policy_admin' or 'vantor_staff' per the permission
   * resolution.
   */
  async upsertHardLimit(
    actor: AuthoringActor,
    versionId: string,
    req: UpsertHardLimitRequest,
  ): Promise<HardLimit> {
    // Permission: is_policy_admin required (resolves via DB lookup)
    await requirePolicyAdmin(this.supabase as never, actor.user_id);

    // Parent must be draft
    await this.requireDraftVersion(actor, versionId);

    // Per-row validation
    validateHardLimitInput(req);

    const limitId = req.id ?? crypto.randomUUID();

    if (req.id) {
      const updateBuilder = this.supabase.from('policy_hard_limits') as {
        update: (patch: Record<string, unknown>) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => Promise<{ error: unknown }>;
          };
        };
      };
      const { error } = await updateBuilder
        .update({
          limit_type: req.limit_type,
          name: req.name,
          limit_value: req.limit_value,
          limit_currency: req.limit_currency ?? null,
          scope: req.scope,
        })
        .eq('id', limitId)
        .eq('version_id', versionId);
      if (error) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: `Failed to update hard limit: ${String(error)}`,
          user_action: 'Retry.',
          details: { limit_id: limitId, version_id: versionId },
        });
      }
    } else {
      const insertBuilder = this.supabase.from('policy_hard_limits') as {
        insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
      };
      const { error } = await insertBuilder.insert({
        id: limitId,
        version_id: versionId,
        limit_type: req.limit_type,
        name: req.name,
        limit_value: req.limit_value,
        limit_currency: req.limit_currency ?? null,
        scope: req.scope,
        created_by: actor.user_id,
      });
      if (error) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: `Failed to insert hard limit: ${String(error)}`,
          user_action: 'Retry.',
          details: { version_id: versionId },
        });
      }
    }

    // Reload + whole-version validation (catches duplicate limit_type + scope combos)
    const reloaded = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!reloaded) {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: 'Version disappeared after upsert (concurrent delete?)',
        user_action: 'Retry.',
        details: { version_id: versionId },
      });
    }
    validateVersionCoherent(reloaded);

    const newLimit = reloaded.hard_limits.find((l) => l.id === limitId);
    if (!newLimit) {
      throw new AuthoringError({
        reason_code: REASON_CODES.hard_limit_value_out_of_range,
        human_readable: 'Hard limit not found after upsert.',
        user_action: 'Retry.',
        details: { limit_id: limitId },
      });
    }
    return newLimit;
  }

  async deleteHardLimit(
    actor: AuthoringActor,
    versionId: string,
    limitId: string,
  ): Promise<void> {
    await requirePolicyAdmin(this.supabase as never, actor.user_id);
    await this.requireDraftVersion(actor, versionId);

    const builder = this.supabase.from('policy_hard_limits') as {
      delete: () => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => Promise<{ error: unknown }>;
        };
      };
    };
    const { error } = await builder.delete().eq('id', limitId).eq('version_id', versionId);
    if (error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.hard_limit_value_out_of_range,
        human_readable: `Failed to delete hard limit: ${String(error)}`,
        user_action: 'Retry.',
        details: { limit_id: limitId, version_id: versionId },
      });
    }
  }
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- src/lib/policy/authoring/service
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/authoring/service.ts src/lib/policy/authoring/service.test.ts
git commit -m "$(cat <<'EOF'
feat(policy-authoring): service hard limit CRUD (is_policy_admin gated)

upsertHardLimit and deleteHardLimit. Both call requirePolicyAdmin
before any mutation — treasury_manager role is NOT sufficient,
only is_policy_admin=true or is_app_admin (with audit source
'vantor_staff') may edit hard limits. Per spec §8 permission table.

Runs validateHardLimitInput per-row and validateVersionCoherent
after each write for duplicate (limit_type, scope) combos.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Service — approval chain CRUD

**Files:**
- Modify: `src/lib/policy/authoring/service.ts`
- Modify: `src/lib/policy/authoring/service.test.ts`

Adds `upsertApprovalChain` and `deleteApprovalChain`. Gated on `canEditDraftChains` (treasury_manager+). Validation via `validateApprovalChainInput`. Deletion forbidden when any rule still references the chain — caller must delete/reassign dependent rules first.

- [ ] **Step 1: Add tests** (standard pattern with mockSupabase)

```typescript
describe('PolicyAuthoringService.upsertApprovalChain', () => {
  it('creates a chain in a draft version', async () => { /* ... */ });
  it('throws requires_policy_admin when actor role is below treasury_manager', async () => { /* ... */ });
  it('throws version_not_draft when parent version is active', async () => { /* ... */ });
  it('throws chain_reference_not_found when slots array is empty', async () => { /* ... */ });
  it('updates an existing chain when id is provided', async () => { /* ... */ });
});

describe('PolicyAuthoringService.deleteApprovalChain', () => {
  it('deletes a chain when no rules reference it', async () => { /* ... */ });
  it('throws chain_reference_not_found when rules still reference it', async () => { /* ... */ });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

- [ ] **Step 3: Add methods to service.ts**

Add imports:

```typescript
import { UpsertApprovalChainRequest } from './types';
import { canEditDraftChains } from './permissions';
import { validateApprovalChainInput } from './validation';
```

Add methods:

```typescript
  async upsertApprovalChain(
    actor: AuthoringActor,
    versionId: string,
    req: UpsertApprovalChainRequest,
  ): Promise<ApprovalChain> {
    if (!canEditDraftChains(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Editing approval chains requires treasury_manager role or higher.',
        user_action: 'Ask a treasury manager or admin.',
        details: { actor_role: actor.role },
      });
    }
    await this.requireDraftVersion(actor, versionId);
    validateApprovalChainInput(req);

    const chainId = req.id ?? crypto.randomUUID();
    const row = {
      id: chainId,
      version_id: versionId,
      name: req.name,
      slots: req.slots,
      trigger_condition: req.trigger_condition ?? null,
      priority: req.priority,
      expiration_hours: req.expiration_hours ?? 24,
      created_by: actor.user_id,
    };

    if (req.id) {
      const updateBuilder = this.supabase.from('policy_approval_chains') as {
        update: (patch: Record<string, unknown>) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => Promise<{ error: unknown }>;
          };
        };
      };
      const { error } = await updateBuilder
        .update({
          name: row.name,
          slots: row.slots,
          trigger_condition: row.trigger_condition,
          priority: row.priority,
          expiration_hours: row.expiration_hours,
        })
        .eq('id', chainId)
        .eq('version_id', versionId);
      if (error) {
        throw new AuthoringError({
          reason_code: REASON_CODES.chain_reference_not_found,
          human_readable: `Failed to update chain: ${String(error)}`,
          user_action: 'Retry.',
          details: { chain_id: chainId, version_id: versionId },
        });
      }
    } else {
      const insertBuilder = this.supabase.from('policy_approval_chains') as {
        insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
      };
      const { error } = await insertBuilder.insert(row);
      if (error) {
        throw new AuthoringError({
          reason_code: REASON_CODES.chain_reference_not_found,
          human_readable: `Failed to insert chain: ${String(error)}`,
          user_action: 'Retry.',
          details: { version_id: versionId },
        });
      }
    }

    const reloaded = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    const newChain = reloaded?.approval_chains.find((c) => c.id === chainId);
    if (!newChain) {
      throw new AuthoringError({
        reason_code: REASON_CODES.chain_reference_not_found,
        human_readable: 'Chain not found after upsert.',
        user_action: 'Retry.',
        details: { chain_id: chainId },
      });
    }
    return newChain;
  }

  async deleteApprovalChain(
    actor: AuthoringActor,
    versionId: string,
    chainId: string,
  ): Promise<void> {
    if (!canEditDraftChains(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Deleting approval chains requires treasury_manager role or higher.',
        user_action: 'Ask a treasury manager or admin.',
        details: { actor_role: actor.role },
      });
    }
    const version = await this.requireDraftVersion(actor, versionId);

    // Reject if any rule in the version still references this chain
    const referencingRules = version.rules.filter((r) => r.verdict_chain_id === chainId);
    if (referencingRules.length > 0) {
      throw new AuthoringError({
        reason_code: REASON_CODES.chain_reference_not_found,
        human_readable:
          `Cannot delete chain: ${referencingRules.length} rule(s) still reference it. Delete or reassign the rules first.`,
        user_action: `Delete or reassign rules: ${referencingRules.map((r) => r.name).join(', ')}`,
        details: {
          chain_id: chainId,
          referencing_rule_ids: referencingRules.map((r) => r.id),
        },
      });
    }

    const builder = this.supabase.from('policy_approval_chains') as {
      delete: () => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => Promise<{ error: unknown }>;
        };
      };
    };
    const { error } = await builder.delete().eq('id', chainId).eq('version_id', versionId);
    if (error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.chain_reference_not_found,
        human_readable: `Failed to delete chain: ${String(error)}`,
        user_action: 'Retry.',
        details: { chain_id: chainId, version_id: versionId },
      });
    }
  }
```

- [ ] **Step 4: Run tests and confirm they pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/authoring/service.ts src/lib/policy/authoring/service.test.ts
git commit -m "feat(policy-authoring): service approval chain CRUD

upsertApprovalChain and deleteApprovalChain. Both gated on
treasury_manager+ role. Deletion rejects if any rule in the same
draft still references the chain — caller must delete/reassign
dependent rules first to keep the draft consistent.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Service — activation (transactional)

**Files:**
- Modify: `src/lib/policy/authoring/service.ts`
- Modify: `src/lib/policy/authoring/service.test.ts`

The most complex service method. Implements the spec §8 activation flow:

1. Require `is_policy_admin` (or `is_app_admin`)
2. Require `reason.trim().length >= 20`
3. Lock draft + enterprise + current active rows FOR UPDATE
4. Re-run full validation on all rules/limits/chains
5. Check chain satisfiability against live user base
6. Supersede current active
7. Promote draft to active + bump `version_number` (already set at draft create)
8. Update `policy_policies.active_version_id`
9. Write `policy_activation_events` + `audit_logs`

Supabase doesn't expose `FOR UPDATE` directly from the JS client, so we achieve atomicity by calling a Postgres RPC function. This task adds both the RPC and the service method that calls it.

- [ ] **Step 1: Create the migration for the activation RPC**

Create `supabase/migrations/0035_policy_activation_rpc.sql`:

```sql
-- 0035_policy_activation_rpc.sql
--
-- Atomic activation of a policy draft version. Called by the
-- PolicyAuthoringService.activateVersion method. Everything inside
-- this function runs in a single transaction with row-level locks
-- so activation is serialized per-enterprise and race-safe.
--
-- The function returns the activated version_id on success. On
-- conflict (draft no longer exists, enterprise has a newer active
-- version already, or the draft re-validation fails), it raises
-- an exception with a tagged error code the caller maps to the
-- appropriate reason_code.

CREATE OR REPLACE FUNCTION policy_activate_draft(
  p_enterprise_id UUID,
  p_draft_version_id UUID,
  p_activated_by UUID,
  p_reason TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_active_id UUID;
  v_draft_status TEXT;
  v_policy_id UUID;
BEGIN
  -- Guard 1: reason must be meaningful
  IF length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'activation_reason_too_short' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the enterprise's policy row to serialize concurrent activations
  SELECT id, active_version_id INTO v_policy_id, v_current_active_id
  FROM policy_policies
  WHERE enterprise_id = p_enterprise_id
  FOR UPDATE;

  IF v_policy_id IS NULL THEN
    -- Enterprise has no policy_policies row — create one
    INSERT INTO policy_policies (enterprise_id, name)
    VALUES (p_enterprise_id, 'Standard Controls')
    RETURNING id INTO v_policy_id;
  END IF;

  -- Lock the draft row and verify it's still a draft
  SELECT status INTO v_draft_status
  FROM policy_versions
  WHERE id = p_draft_version_id
    AND enterprise_id = p_enterprise_id
  FOR UPDATE;

  IF v_draft_status IS NULL THEN
    RAISE EXCEPTION 'version_not_draft' USING ERRCODE = 'P0002';
  END IF;

  IF v_draft_status != 'draft' THEN
    RAISE EXCEPTION 'version_not_draft' USING ERRCODE = 'P0002';
  END IF;

  -- Supersede current active (if any)
  IF v_current_active_id IS NOT NULL THEN
    PERFORM set_config('app.policy_transition_ok', 'true', true);
    UPDATE policy_versions
    SET status = 'superseded',
        superseded_at = now(),
        superseded_by_version_id = p_draft_version_id
    WHERE id = v_current_active_id;
    PERFORM set_config('app.policy_transition_ok', 'false', true);
  END IF;

  -- Promote the draft to active
  PERFORM set_config('app.policy_transition_ok', 'true', true);
  UPDATE policy_versions
  SET status = 'active',
      activated_at = now(),
      activated_by = p_activated_by
  WHERE id = p_draft_version_id;
  PERFORM set_config('app.policy_transition_ok', 'false', true);

  -- Point the policy row at the new active version
  UPDATE policy_policies
  SET active_version_id = p_draft_version_id,
      updated_at = now()
  WHERE id = v_policy_id;

  -- Record the activation event
  INSERT INTO policy_activation_events (
    enterprise_id,
    version_id,
    previous_version_id,
    activated_by,
    reason
  )
  VALUES (
    p_enterprise_id,
    p_draft_version_id,
    v_current_active_id,
    p_activated_by,
    p_reason
  );

  RETURN p_draft_version_id;
END;
$$;

COMMENT ON FUNCTION policy_activate_draft IS
'Atomically activates a policy draft: supersedes the current active, promotes the draft, points policy_policies at the new active, and records the activation event. Row-locks the enterprise policy row FOR UPDATE to serialize concurrent activations. Caller (PolicyAuthoringService) is responsible for running pre-activation validation (reason length, is_policy_admin check, full version coherence re-validation) — this RPC only enforces version_not_draft and activation_reason_too_short as last-resort guards.';
```

- [ ] **Step 2: Apply the migration to dev + prod Supabase**

```bash
# From the worktree
npm run migrate supabase/migrations/0035_policy_activation_rpc.sql
```

(If `.env.local` isn't present in the worktree, copy it from the main checkout first.)

Verify the function exists:

```bash
# Use the Supabase Management API / SQL runner or psql to confirm
# SELECT proname FROM pg_proc WHERE proname = 'policy_activate_draft';
```

- [ ] **Step 3: Add tests to service.test.ts**

```typescript
describe('PolicyAuthoringService.activateVersion', () => {
  it('rejects when reason is under 20 characters', async () => {
    // Assert: AuthoringError reason_code=activation_reason_too_short
  });

  it('rejects when user is not is_policy_admin', async () => {
    // user_profiles[{is_policy_admin: false, is_app_admin: false}]
    // Assert: AuthoringError reason_code=requires_policy_admin
  });

  it('rejects when the draft fails re-validation (e.g. priority collision)', async () => {
    // Draft with two rules at priority 100
    // Assert: AuthoringError reason_code=activation_blocked_by_validation
  });

  it('rejects when any chain is unsatisfiable against the user base', async () => {
    // Draft with a chain requiring executive tier (no users have that role)
    // Assert: AuthoringError reason_code=chain_unsatisfiable_at_activation
  });

  it('calls the policy_activate_draft RPC with the correct arguments on success', async () => {
    // Mock supabase.rpc('policy_activate_draft', {...})
    // Assert: RPC called with {p_enterprise_id, p_draft_version_id, p_activated_by, p_reason}
  });

  it('maps Postgres error P0001 to activation_reason_too_short', async () => {
    // Mock RPC to reject with {message: 'activation_reason_too_short'}
    // Assert: AuthoringError with that reason_code
  });

  it('writes an audit log entry on success', async () => {
    // Mock writeAuditLog; assert called with action=policy_version_activate
  });
});
```

- [ ] **Step 4: Implement activateVersion in service.ts**

Add imports:

```typescript
import { ActivateRequest } from './types';
import { writeAuditLog } from '@/lib/audit/logger';
import { checkChainSatisfiability } from './satisfiability';
```

Add the method inside the class:

```typescript
  /**
   * Activate a draft version. Atomic via the policy_activate_draft
   * Postgres RPC — concurrent activations on the same enterprise are
   * serialized via FOR UPDATE on the policy_policies row.
   *
   * Pre-RPC validation in this method:
   *  - requirePolicyAdmin (is_policy_admin=true or is_app_admin)
   *  - reason ≥ 20 chars
   *  - full version coherence re-validation (fresh load from DB)
   *  - chain satisfiability against live user base
   *
   * The RPC itself also enforces version_not_draft and reason length
   * as last-resort guards in case the pre-check raced with a concurrent
   * edit.
   */
  async activateVersion(
    actor: AuthoringActor,
    versionId: string,
    req: ActivateRequest,
  ): Promise<PolicyVersionSnapshot> {
    // Step 1: is_policy_admin gate
    const permission = await requirePolicyAdmin(this.supabase as never, actor.user_id);

    // Step 2: reason length gate
    if (req.reason.trim().length < 20) {
      throw new AuthoringError({
        reason_code: REASON_CODES.activation_reason_too_short,
        human_readable:
          `Activation reason must be at least 20 characters (got ${req.reason.trim().length}).`,
        user_action: 'Provide a more descriptive reason so the audit log is meaningful.',
        details: { actual_length: req.reason.trim().length },
        path: ['reason'],
      });
    }

    // Step 3: Load the draft fresh and re-run whole-version validation
    const draft = await this.getVersionById(actor, versionId);
    if (draft.status !== 'draft') {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: `Cannot activate version ${versionId} — status is ${draft.status}.`,
        user_action: 'Only drafts can be activated.',
        details: { version_id: versionId, status: draft.status },
      });
    }

    try {
      validateVersionCoherent(draft);
    } catch (err) {
      if (err instanceof AuthoringError) {
        throw new AuthoringError({
          reason_code: REASON_CODES.activation_blocked_by_validation,
          human_readable: `Draft re-validation failed: ${err.human_readable}`,
          user_action: err.user_action,
          details: { underlying: err.details, underlying_reason: err.reason_code },
        });
      }
      throw err;
    }

    // Step 4: Chain satisfiability check against live user base
    const users = await this.fetchEnterpriseUsers(actor.enterprise_id);
    for (const chain of draft.approval_chains) {
      const result = checkChainSatisfiability(chain, users);
      if (!result.satisfiable) {
        throw new AuthoringError({
          reason_code: REASON_CODES.chain_unsatisfiable_at_activation,
          human_readable:
            `Chain '${chain.name}' cannot be activated — the current user base cannot fill every slot. Unsatisfied: ${JSON.stringify(result.unsatisfied_slots)}`,
          user_action:
            'Grant the required roles to additional users, or edit the chain to reduce the minimum_role of unsatisfied slots.',
          details: { chain_id: chain.id, result },
        });
      }
    }

    // Step 5: Call the atomic RPC
    const rpcClient = this.supabase as unknown as {
      rpc: (
        name: string,
        params: Record<string, unknown>,
      ) => Promise<{ data: string | null; error: { message: string; code?: string } | null }>;
    };
    const { data: activatedId, error } = await rpcClient.rpc('policy_activate_draft', {
      p_enterprise_id: actor.enterprise_id,
      p_draft_version_id: versionId,
      p_activated_by: actor.user_id,
      p_reason: req.reason,
    });

    if (error) {
      const code = error.code;
      const message = error.message;
      let reasonCode: typeof REASON_CODES[keyof typeof REASON_CODES] = REASON_CODES.activation_race_conflict;
      if (code === 'P0001' || message.includes('activation_reason_too_short')) {
        reasonCode = REASON_CODES.activation_reason_too_short;
      } else if (code === 'P0002' || message.includes('version_not_draft')) {
        reasonCode = REASON_CODES.version_not_draft;
      }
      throw new AuthoringError({
        reason_code: reasonCode,
        human_readable: `Activation RPC failed: ${message}`,
        user_action: 'Reload the draft and retry — it may have been concurrently modified.',
        details: { pg_code: code, pg_message: message },
      });
    }

    // Step 6: Audit log
    await writeAuditLog({
      userId: actor.user_id,
      enterpriseId: actor.enterprise_id,
      action: 'policy_version_activate' as never,
      entityType: 'policy_version',
      entityId: versionId,
      details: {
        version_id: versionId,
        reason: req.reason,
        actor_source: permission.source,
      },
    });

    // Step 7: Return the now-active version
    return (await this.loadVersionWithChildren(actor.enterprise_id, versionId))!;
  }

  private async fetchEnterpriseUsers(
    enterpriseId: string,
  ): Promise<Array<{ user_id: string; role: 'auditor' | 'accountant' | 'treasury_manager' }>> {
    const builder = this.supabase.from('user_profiles') as {
      select: (cols: string) => {
        eq: (col: string, val: string) => Promise<{
          data: Array<{ id: string; role: 'auditor' | 'accountant' | 'treasury_manager' }> | null;
          error: unknown;
        }>;
      };
    };
    const { data } = await builder.select('id, role').eq('enterprise_id', enterpriseId);
    if (!data) return [];
    return data.map((u) => ({ user_id: u.id, role: u.role }));
  }
```

Also add the `policy_version_activate` audit action. Edit `src/types/database.ts` to extend the `AuditAction` union (find the existing union and append):

```typescript
// In the AuditAction union, add:
// | 'policy_version_activate'
// | 'policy_version_create_draft'
// | 'policy_version_delete_draft'
// | 'policy_rule_upsert'
// | 'policy_rule_delete'
// | 'policy_hard_limit_upsert'
// | 'policy_hard_limit_delete'
// | 'policy_chain_upsert'
// | 'policy_chain_delete'
```

- [ ] **Step 5: Run tests and confirm they pass**

```bash
npm test -- src/lib/policy/authoring/service
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0035_policy_activation_rpc.sql src/lib/policy/authoring/service.ts src/lib/policy/authoring/service.test.ts src/types/database.ts
git commit -m "$(cat <<'EOF'
feat(policy-authoring): atomic version activation

Adds migration 0035 with the policy_activate_draft PL/pgSQL function
and the PolicyAuthoringService.activateVersion method that calls it.

The RPC holds a FOR UPDATE lock on the enterprise's policy_policies
row throughout the transaction, so concurrent activation attempts
are serialized. It sets a session-level app.policy_transition_ok
flag before the status-change UPDATEs to permit the append-only
trigger on policy_versions to let those specific UPDATEs through.

Pre-RPC checks in the service method:
- requirePolicyAdmin (is_policy_admin OR is_app_admin, with audit
  source tracked)
- reason ≥ 20 characters
- Fresh whole-version validateVersionCoherent (belt + suspenders
  for priority collisions and chain-reference integrity)
- checkChainSatisfiability against live user_profiles

On success, writes an audit_log entry with action=
policy_version_activate and actor_source from the permission
resolution.

Extended AuditAction union with policy_* actions used by this
task and the CRUD tasks (rule / hard limit / chain upsert/delete).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Service — diff and satisfiability wrapper methods

**Files:**
- Modify: `src/lib/policy/authoring/service.ts`
- Modify: `src/lib/policy/authoring/service.test.ts`

Adds two small wrapper methods that expose the pure `computeVersionDiff` and `checkChainSatisfiability` functions via the service so the HTTP layer can call them without importing the pure modules directly.

- [ ] **Step 1: Add tests**

```typescript
describe('PolicyAuthoringService.diffVersions', () => {
  it('returns a VersionDiff between two versions in the same enterprise', async () => {
    // mockSupabase with two versions, call svc.diffVersions(actor, 'v-a', 'v-b')
    // Assert: result.from_version_id === 'v-a', result.to_version_id === 'v-b'
  });

  it('throws when either version is in a different enterprise', async () => {
    // Assert: AuthoringError
  });
});

describe('PolicyAuthoringService.checkSatisfiability', () => {
  it('returns SatisfiabilityResult for every chain in the version', async () => {
    // mockSupabase: version with 2 chains + a user base
    // Assert: result.chain_results has 2 entries with satisfiable flags
  });

  it('returns all_satisfiable=false when any chain has unsatisfied slots', async () => {
    // Assert: all_satisfiable=false, specific chain_result has unsatisfied_slots
  });
});
```

- [ ] **Step 2: Add methods to service.ts**

Add imports:

```typescript
import { computeVersionDiff } from './diff';
import { VersionDiff, SatisfiabilityResult } from './types';
```

Add methods inside the class:

```typescript
  /**
   * Compute a structured diff between two versions. Both must belong
   * to the actor's enterprise. Used by the diff preview UI and by the
   * activation flow (shows "you are about to apply these changes").
   */
  async diffVersions(
    actor: AuthoringActor,
    fromVersionId: string,
    toVersionId: string,
  ): Promise<VersionDiff> {
    const [from, to] = await Promise.all([
      this.getVersionById(actor, fromVersionId),
      this.getVersionById(actor, toVersionId),
    ]);
    return computeVersionDiff(from, to);
  }

  /**
   * Run the satisfiability check for every chain in a version against
   * the current enterprise user base. Called by the Plan 3 UI to show
   * chain health, and by the activation flow to block activation of
   * unsatisfiable policies.
   */
  async checkSatisfiability(
    actor: AuthoringActor,
    versionId: string,
  ): Promise<SatisfiabilityResult> {
    const version = await this.getVersionById(actor, versionId);
    const users = await this.fetchEnterpriseUsers(actor.enterprise_id);

    const chainResults = version.approval_chains.map((chain) =>
      checkChainSatisfiability(chain, users),
    );

    return {
      version_id: versionId,
      all_satisfiable: chainResults.every((r) => r.satisfiable),
      chain_results: chainResults.map((r) => ({
        chain_id: r.chain_id,
        chain_name: r.chain_name,
        satisfiable: r.satisfiable,
        unsatisfied_slots: r.unsatisfied_slots,
      })),
    };
  }
```

- [ ] **Step 3: Run tests**

```bash
npm test -- src/lib/policy/authoring/service
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/policy/authoring/service.ts src/lib/policy/authoring/service.test.ts
git commit -m "feat(policy-authoring): service diff and satisfiability wrappers

diffVersions loads both versions (scoped to actor enterprise) and
delegates to the pure computeVersionDiff function. checkSatisfiability
loads the version + user base and runs checkChainSatisfiability over
every chain. Both are thin wrappers over the pure Plan 2a modules but
keep the HTTP layer from having to import them directly.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Shared HTTP route helper + index exports

**Files:**
- Create: `src/lib/policy/authoring/http.ts` — shared request/response helpers
- Create: `src/lib/policy/authoring/http.test.ts`
- Create: `src/lib/policy/authoring/index.ts` — barrel export
- Modify: `src/lib/policy/index.ts` — add authoring re-exports

The HTTP routes in Tasks 15-16 all share the same shape: authenticate via NextAuth, parse the body with zod, construct an `AuthoringActor`, call a `PolicyAuthoringService` method, catch `AuthoringError` and map it to an HTTP status. Rather than duplicating that wrapper in every route, this task extracts a shared `handleAuthoringRequest` helper and a `mapAuthoringErrorToHttp` function.

- [ ] **Step 1: Write tests for http.ts**

Create `src/lib/policy/authoring/http.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mapAuthoringErrorToHttp } from './http';
import { AuthoringError } from './errors';
import { REASON_CODES } from '../errors/reason-codes';

describe('mapAuthoringErrorToHttp', () => {
  it('maps requires_policy_admin to 403', () => {
    const err = new AuthoringError({
      reason_code: REASON_CODES.requires_policy_admin,
      human_readable: 'x',
      user_action: 'y',
      details: {},
    });
    expect(mapAuthoringErrorToHttp(err).status).toBe(403);
  });

  it('maps version_not_draft to 409', () => {
    const err = new AuthoringError({
      reason_code: REASON_CODES.version_not_draft,
      human_readable: 'x',
      user_action: 'y',
      details: {},
    });
    expect(mapAuthoringErrorToHttp(err).status).toBe(409);
  });

  it('maps activation_race_conflict to 409', () => {
    const err = new AuthoringError({
      reason_code: REASON_CODES.activation_race_conflict,
      human_readable: 'x',
      user_action: 'y',
      details: {},
    });
    expect(mapAuthoringErrorToHttp(err).status).toBe(409);
  });

  it('maps rule_priority_collision / chain_reference_not_found / schema_invalid to 400', () => {
    for (const code of [
      REASON_CODES.rule_priority_collision,
      REASON_CODES.chain_reference_not_found,
      REASON_CODES.condition_ir_schema_invalid,
      REASON_CODES.hard_limit_value_out_of_range,
      REASON_CODES.activation_reason_too_short,
      REASON_CODES.usd_rule_on_rateless_asset,
    ]) {
      const err = new AuthoringError({
        reason_code: code,
        human_readable: 'x',
        user_action: 'y',
        details: {},
      });
      expect(mapAuthoringErrorToHttp(err).status).toBe(400);
    }
  });

  it('body includes reason_code, human_readable, user_action, details, path', () => {
    const err = new AuthoringError({
      reason_code: REASON_CODES.rule_priority_collision,
      human_readable: 'Two rules at priority 100',
      user_action: 'Change one',
      details: { priority: 100 },
      path: ['rules', 0, 'priority'],
    });
    const mapped = mapAuthoringErrorToHttp(err);
    expect(mapped.body).toMatchObject({
      reason_code: 'rule_priority_collision',
      human_readable: 'Two rules at priority 100',
      user_action: 'Change one',
      details: { priority: 100 },
      path: ['rules', 0, 'priority'],
    });
  });
});
```

- [ ] **Step 2: Implement http.ts**

Create `src/lib/policy/authoring/http.ts`:

```typescript
// src/lib/policy/authoring/http.ts
//
// Shared HTTP utilities for authoring route handlers. Keeps route
// files thin — each route file only contains the handler body, not
// the auth / body parse / error mapping boilerplate.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { AuthoringActor } from './types';
import { AuthoringError } from './errors';
import { PolicyAuthoringService } from './service';
import { REASON_CODES, ReasonCode } from '../errors/reason-codes';

export interface ResolvedActorContext {
  actor: AuthoringActor;
  service: PolicyAuthoringService;
}

/**
 * Resolve the signed-in user to an AuthoringActor + service instance.
 * Returns null if the session is missing or the user has no role.
 * Callers should early-return 401 on null.
 */
export async function resolveAuthoringContext(): Promise<ResolvedActorContext | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.role) return null;
  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const actor: AuthoringActor = {
    user_id: session.user.id,
    role: session.user.role as AuthoringActor['role'],
    enterprise_id: enterpriseId,
  };
  return {
    actor,
    service: new PolicyAuthoringService(createAdminClient() as never),
  };
}

/**
 * Map an AuthoringError to an HTTP response envelope. The body always
 * carries the full structured error so the UI can highlight the exact
 * failing form field via `path`.
 */
export function mapAuthoringErrorToHttp(err: AuthoringError): {
  status: number;
  body: Record<string, unknown>;
} {
  const status = STATUS_FOR_REASON[err.reason_code] ?? 400;
  return {
    status,
    body: {
      reason_code: err.reason_code,
      human_readable: err.human_readable,
      user_action: err.user_action,
      details: err.details,
      path: err.path,
    },
  };
}

const STATUS_FOR_REASON: Partial<Record<ReasonCode, number>> = {
  // Permissions → 403
  [REASON_CODES.requires_policy_admin]: 403,

  // State conflicts → 409
  [REASON_CODES.version_not_draft]: 409,
  [REASON_CODES.activation_race_conflict]: 409,
  [REASON_CODES.stale_approval_chain_mismatch]: 409,
  [REASON_CODES.activation_blocked_by_validation]: 409,
  [REASON_CODES.chain_unsatisfiable_at_activation]: 409,

  // Validation errors → 400
  [REASON_CODES.rule_priority_collision]: 400,
  [REASON_CODES.chain_reference_not_found]: 400,
  [REASON_CODES.condition_ir_schema_invalid]: 400,
  [REASON_CODES.condition_ir_type_mismatch]: 400,
  [REASON_CODES.hard_limit_value_out_of_range]: 400,
  [REASON_CODES.activation_reason_too_short]: 400,
  [REASON_CODES.usd_rule_on_rateless_asset]: 400,
  [REASON_CODES.native_unit_currency_mismatch]: 400,
};

/**
 * Standard route handler wrapper: resolves actor, calls the supplied
 * handler with (actor, service), maps any thrown AuthoringError to
 * HTTP. Use this in every /api/policy/* route handler.
 */
export async function handleAuthoringRequest<T>(
  handler: (ctx: ResolvedActorContext) => Promise<T>,
): Promise<NextResponse> {
  const ctx = await resolveAuthoringContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await handler(ctx);
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof AuthoringError) {
      const mapped = mapAuthoringErrorToHttp(err);
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    // Unexpected error — log + 500
    // eslint-disable-next-line no-console
    console.error('[policy-authoring] unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Create authoring/index.ts**

Create `src/lib/policy/authoring/index.ts`:

```typescript
// src/lib/policy/authoring/index.ts

export { PolicyAuthoringService } from './service';
export { AuthoringError } from './errors';
export { computeVersionDiff } from './diff';
export { checkChainSatisfiability } from './satisfiability';
export {
  validateRuleInput,
  validateHardLimitInput,
  validateApprovalChainInput,
  validateVersionCoherent,
} from './validation';
export {
  canViewActivePolicy,
  canCreateDraft,
  canEditDraftRules,
  canEditDraftChains,
  requirePolicyAdmin,
} from './permissions';
export {
  resolveAuthoringContext,
  mapAuthoringErrorToHttp,
  handleAuthoringRequest,
} from './http';
export type {
  AuthoringActor,
  CreateDraftRequest,
  UpsertRuleRequest,
  UpsertHardLimitRequest,
  UpsertApprovalChainRequest,
  ActivateRequest,
  PolicyVersionResponse,
  VersionDiff,
  SatisfiabilityResult,
} from './types';
```

- [ ] **Step 4: Extend src/lib/policy/index.ts**

Edit `src/lib/policy/index.ts` — add at the bottom, after the existing exports:

```typescript
// Authoring (Plan 2a)
export * from './authoring';
```

- [ ] **Step 5: Run tests + tsc**

```bash
npm test -- src/lib/policy/authoring/http
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/policy/authoring/http.ts src/lib/policy/authoring/http.test.ts src/lib/policy/authoring/index.ts src/lib/policy/index.ts
git commit -m "$(cat <<'EOF'
feat(policy-authoring): shared HTTP route helper + index exports

handleAuthoringRequest wraps a route handler body with the standard
auth / error-mapping boilerplate: resolves NextAuth session to an
AuthoringActor, constructs a PolicyAuthoringService, runs the
handler, and maps AuthoringError → HTTP status via
mapAuthoringErrorToHttp.

Status mapping:
- requires_policy_admin → 403
- version_not_draft / activation_race_conflict / stale_approval_
  chain_mismatch / activation_blocked_by_validation /
  chain_unsatisfiable_at_activation → 409
- Everything else (validation errors) → 400
- Unexpected errors → 500 (logged)

Extends src/lib/policy/index.ts public surface with the authoring
module re-exports so Plan 2b/2c consumers can import
PolicyAuthoringService / AuthoringError / handleAuthoringRequest
from '@/lib/policy' without subpath imports.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: HTTP — version-level routes

**Files:**

All new. Compact per-route bodies — the `handleAuthoringRequest` helper does the boilerplate.

- Create: `src/app/api/policy/active/route.ts`
- Create: `src/app/api/policy/versions/route.ts`
- Create: `src/app/api/policy/versions/[id]/route.ts`
- Create: `src/app/api/policy/versions/[id]/activate/route.ts`
- Create: `src/app/api/policy/versions/[id]/clone/route.ts`
- Create: `src/app/api/policy/versions/[id]/diff/[otherId]/route.ts`
- Create: `src/app/api/policy/versions/[id]/satisfiability/route.ts`

### Implementation template (one full route shown, rest are deltas)

**Full: `src/app/api/policy/active/route.ts`**

```typescript
// src/app/api/policy/active/route.ts

import { handleAuthoringRequest } from '@/lib/policy/authoring/http';
import { canViewActivePolicy } from '@/lib/policy/authoring/permissions';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';

export async function GET() {
  return handleAuthoringRequest(async ({ actor, service }) => {
    if (!canViewActivePolicy(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Viewing the active policy requires auditor role or higher.',
        user_action: 'Ask an admin to grant you auditor access.',
        details: { actor_role: actor.role },
      });
    }
    return service.getActiveVersion(actor);
  });
}
```

### Remaining routes in this task (deltas only — copy the pattern above)

Every route below uses the same shape: `import { handleAuthoringRequest } from '@/lib/policy/authoring/http'`, export one or more of `GET`/`POST`/`PATCH`/`DELETE`, and call `handleAuthoringRequest` with a handler that delegates to the service. Permission checks happen inside the handler via `canViewActivePolicy` / `canCreateDraft`. Body parsing uses `req.json()` and zod — define a small schema per endpoint.

**`src/app/api/policy/versions/route.ts`** — `GET` lists versions (any role ≥ auditor), `POST` creates a draft (treasury_manager+):

```typescript
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleAuthoringRequest } from '@/lib/policy/authoring/http';
import { canViewActivePolicy } from '@/lib/policy/authoring/permissions';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';

const createDraftSchema = z.object({
  name: z.string().min(1).max(200),
  source_version_id: z.string().uuid().optional(),
});

export async function GET() {
  return handleAuthoringRequest(async ({ actor, service }) => {
    if (!canViewActivePolicy(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Listing versions requires auditor role or higher.',
        user_action: 'Ask an admin to grant you auditor access.',
        details: { actor_role: actor.role },
      });
    }
    return service.listVersions(actor);
  });
}

export async function POST(req: NextRequest) {
  return handleAuthoringRequest(async ({ actor, service }) => {
    const body = await req.json();
    const parsed = createDraftSchema.safeParse(body);
    if (!parsed.success) {
      throw new AuthoringError({
        reason_code: REASON_CODES.condition_ir_schema_invalid,
        human_readable: `Invalid create-draft body: ${parsed.error.message}`,
        user_action: 'Fix the request body per the zod error details.',
        details: { zod_error: parsed.error.flatten() },
      });
    }
    return service.createDraft(actor, parsed.data);
  });
}
```

**`src/app/api/policy/versions/[id]/route.ts`** — `GET` detail, `DELETE` draft:

```typescript
import { handleAuthoringRequest } from '@/lib/policy/authoring/http';
import { canViewActivePolicy } from '@/lib/policy/authoring/permissions';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return handleAuthoringRequest(async ({ actor, service }) => {
    if (!canViewActivePolicy(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Viewing a version requires auditor role or higher.',
        user_action: 'Ask an admin to grant you auditor access.',
        details: { actor_role: actor.role },
      });
    }
    return service.getVersionById(actor, params.id);
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return handleAuthoringRequest(async ({ actor, service }) => {
    await service.deleteDraft(actor, params.id);
    return { deleted: true, version_id: params.id };
  });
}
```

**`src/app/api/policy/versions/[id]/activate/route.ts`** — body `{ reason: string }`, calls `service.activateVersion`. Permission (is_policy_admin) is checked inside the service. Schema: `z.object({ reason: z.string().min(1).max(2000) })`. Returns the activated version.

**`src/app/api/policy/versions/[id]/clone/route.ts`** — body `{ name?: string }`, calls `service.cloneVersion(actor, params.id, body.name)`.

**`src/app/api/policy/versions/[id]/diff/[otherId]/route.ts`** — `GET`, calls `service.diffVersions(actor, params.id, params.otherId)`.

**`src/app/api/policy/versions/[id]/satisfiability/route.ts`** — `POST`, calls `service.checkSatisfiability(actor, params.id)`. (POST not GET because future versions might accept a hypothetical user-base override in the body.)

- [ ] **Step 1: Implement every route file in this task following the patterns above**

Each file is ~10-40 lines. Total for this task: 7 route files.

- [ ] **Step 2: Smoke test via `npx tsc --noEmit`**

```bash
npx tsc --noEmit
```

No runtime tests for route handlers — they're thin wrappers. The service tests from Tasks 7-13 cover the business logic; the integration smoke test in Task 17 exercises the HTTP paths end-to-end.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/policy/active/ src/app/api/policy/versions/
git commit -m "feat(policy-authoring): version-level HTTP routes

GET /api/policy/active              — hydrated active version or null
GET /api/policy/versions            — shallow list
POST /api/policy/versions           — create draft (treasury_manager+)
GET /api/policy/versions/[id]       — full detail
DELETE /api/policy/versions/[id]    — delete draft (creator or admin)
POST /api/policy/versions/[id]/activate  — atomic activation
POST /api/policy/versions/[id]/clone     — new draft from source
GET /api/policy/versions/[id]/diff/[otherId]  — structured diff
POST /api/policy/versions/[id]/satisfiability — chain satisfiability

Every route uses the shared handleAuthoringRequest helper which
resolves NextAuth session → AuthoringActor, calls the service,
and maps AuthoringError → HTTP status.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: HTTP — child-row routes (rules, hard limits, chains, validate)

**Files (8 new route files):**
- Create: `src/app/api/policy/versions/[id]/rules/route.ts` — POST create rule
- Create: `src/app/api/policy/versions/[id]/rules/[ruleId]/route.ts` — PATCH, DELETE
- Create: `src/app/api/policy/versions/[id]/rules/validate/route.ts` — POST dry-run
- Create: `src/app/api/policy/versions/[id]/hard-limits/route.ts` — POST
- Create: `src/app/api/policy/versions/[id]/hard-limits/[limitId]/route.ts` — PATCH, DELETE
- Create: `src/app/api/policy/versions/[id]/approval-chains/route.ts` — POST
- Create: `src/app/api/policy/versions/[id]/approval-chains/[chainId]/route.ts` — PATCH, DELETE

All follow the same template. Every POST/PATCH parses a zod schema, calls the relevant service method (`upsertRule` / `upsertHardLimit` / `upsertApprovalChain`). Every DELETE calls the corresponding delete method with `params.id` + `params.{ruleId|limitId|chainId}`. The service handles permission checks internally (hard limits require `is_policy_admin`; rules/chains require `treasury_manager+`).

### Template: rules POST

**`src/app/api/policy/versions/[id]/rules/route.ts`**:

```typescript
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleAuthoringRequest } from '@/lib/policy/authoring/http';
import { conditionSchema } from '@/lib/policy/schemas/ir.schema';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';

const upsertRuleSchema = z.object({
  id: z.string().uuid().optional(),
  rule_type: z.enum(['approval_threshold', 'counterparty', 'time_window', 'lookahead']),
  name: z.string().min(1).max(200),
  rationale: z.string().max(5000),
  condition: conditionSchema,
  verdict: z.enum(['allow_auto', 'require_approval', 'block', 'block_hard_limit']),
  verdict_chain_id: z.string().uuid().optional(),
  priority: z.number().int().nonnegative(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return handleAuthoringRequest(async ({ actor, service }) => {
    const body = await req.json();
    const parsed = upsertRuleSchema.safeParse(body);
    if (!parsed.success) {
      throw new AuthoringError({
        reason_code: REASON_CODES.condition_ir_schema_invalid,
        human_readable: `Invalid rule body: ${parsed.error.message}`,
        user_action: 'Fix the request body per the zod error details.',
        details: { zod_error: parsed.error.flatten() },
      });
    }
    return service.upsertRule(actor, params.id, parsed.data);
  });
}
```

### Rules PATCH/DELETE (`[ruleId]/route.ts`)

```typescript
// PATCH: same upsertRuleSchema as above, calls service.upsertRule with
//        req.body merged with { id: params.ruleId }
// DELETE: calls service.deleteRule(actor, params.id, params.ruleId)
```

### Rules validate (dry-run)

**`src/app/api/policy/versions/[id]/rules/validate/route.ts`** — runs `validateRuleInput` against the body without hitting the DB. Returns `{ ok: true }` or a mapped AuthoringError. Uses the exact same code path as the POST endpoint, with the inserted `try/catch` wrapping `validateRuleInput(parsed.data, { requireChainForApproval: true })`.

```typescript
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleAuthoringRequest } from '@/lib/policy/authoring/http';
import { conditionSchema } from '@/lib/policy/schemas/ir.schema';
import { validateRuleInput } from '@/lib/policy/authoring/validation';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';

const upsertRuleSchema = z.object({
  id: z.string().uuid().optional(),
  rule_type: z.enum(['approval_threshold', 'counterparty', 'time_window', 'lookahead']),
  name: z.string().min(1).max(200),
  rationale: z.string().max(5000),
  condition: conditionSchema,
  verdict: z.enum(['allow_auto', 'require_approval', 'block', 'block_hard_limit']),
  verdict_chain_id: z.string().uuid().optional(),
  priority: z.number().int().nonnegative(),
});

export async function POST(req: NextRequest) {
  return handleAuthoringRequest(async () => {
    const body = await req.json();
    const parsed = upsertRuleSchema.safeParse(body);
    if (!parsed.success) {
      throw new AuthoringError({
        reason_code: REASON_CODES.condition_ir_schema_invalid,
        human_readable: `Invalid rule body: ${parsed.error.message}`,
        user_action: 'Fix the request body.',
        details: { zod_error: parsed.error.flatten() },
      });
    }
    // Dry-run: run per-row validation without touching the DB.
    validateRuleInput(parsed.data, { requireChainForApproval: true });
    return { ok: true };
  });
}
```

### Hard limits POST

**`src/app/api/policy/versions/[id]/hard-limits/route.ts`**:

```typescript
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleAuthoringRequest } from '@/lib/policy/authoring/http';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';

const upsertHardLimitSchema = z.object({
  id: z.string().uuid().optional(),
  limit_type: z.enum([
    'min_cash_reserve_usd',
    'max_single_asset_concentration_pct',
    'max_daily_outflow_usd',
    'max_30day_outflow_usd',
    'obligation_coverage_days',
    'max_native_exposure',
  ]),
  name: z.string().min(1).max(200),
  limit_value: z.string().regex(/^\d+(\.\d+)?$/),
  limit_currency: z.enum(['USD', 'USDC', 'USDT']).optional(),
  scope: z.object({
    asset: z.enum(['USD', 'USDC', 'USDT']).optional(),
    venue: z.string().optional(),
    include_venues: z.array(z.string()).optional(),
  }),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return handleAuthoringRequest(async ({ actor, service }) => {
    const body = await req.json();
    const parsed = upsertHardLimitSchema.safeParse(body);
    if (!parsed.success) {
      throw new AuthoringError({
        reason_code: REASON_CODES.hard_limit_value_out_of_range,
        human_readable: `Invalid hard limit body: ${parsed.error.message}`,
        user_action: 'Fix the request body.',
        details: { zod_error: parsed.error.flatten() },
      });
    }
    return service.upsertHardLimit(actor, params.id, parsed.data);
  });
}
```

`[limitId]/route.ts`:
- `PATCH`: same schema, merge `{id: params.limitId}`, call `service.upsertHardLimit`
- `DELETE`: call `service.deleteHardLimit(actor, params.id, params.limitId)`

### Approval chains POST

**`src/app/api/policy/versions/[id]/approval-chains/route.ts`**:

```typescript
const upsertChainSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  slots: z.array(
    z.object({
      slot_index: z.number().int().nonnegative(),
      minimum_role: z.enum(['auditor', 'accountant', 'treasury_manager', 'approver', 'executive']),
      label: z.string().max(200).optional(),
    }),
  ).min(1),
  trigger_condition: conditionSchema.optional(),
  priority: z.number().int().nonnegative(),
  expiration_hours: z.number().int().positive().max(720).optional(),
});

// POST handler calls service.upsertApprovalChain(actor, params.id, parsed.data)
// PATCH: merge {id: params.chainId}
// DELETE: call service.deleteApprovalChain(actor, params.id, params.chainId)
```

- [ ] **Step 1: Implement every route file in this task following the templates above**

Each file is ~15-50 lines. 8 files total.

- [ ] **Step 2: Smoke-check via tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/policy/versions/
git commit -m "feat(policy-authoring): child-row HTTP routes (rules, hard limits, chains, validate)

POST /api/policy/versions/[id]/rules                     (create)
PATCH /api/policy/versions/[id]/rules/[ruleId]           (update)
DELETE /api/policy/versions/[id]/rules/[ruleId]          (delete)
POST /api/policy/versions/[id]/rules/validate            (dry-run)
POST /api/policy/versions/[id]/hard-limits               (create, is_policy_admin)
PATCH /api/policy/versions/[id]/hard-limits/[limitId]    (update, is_policy_admin)
DELETE /api/policy/versions/[id]/hard-limits/[limitId]   (delete, is_policy_admin)
POST /api/policy/versions/[id]/approval-chains           (create)
PATCH /api/policy/versions/[id]/approval-chains/[chainId](update)
DELETE /api/policy/versions/[id]/approval-chains/[chainId](delete)

Each route parses a zod schema, calls the corresponding service
method, and relies on the shared handleAuthoringRequest wrapper
for auth + error mapping. The rules/validate dry-run endpoint
uses the EXACT same validateRuleInput function as the save path,
per spec §8 'no parallel implementation'.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: End-to-end integration smoke test

**Files:**
- Create: `src/lib/policy/authoring/integration.test.ts`

One integration test that exercises the full authoring flow against a real `PolicyAuthoringService` instance backed by a fully mocked Supabase. Smoke-tests: create draft → add a rule → add a chain → add a hard limit → validate → activate → re-read as active → attempt to edit the now-active version → expect `version_not_draft`.

- [ ] **Step 1: Write the test**

Create `src/lib/policy/authoring/integration.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PolicyAuthoringService } from './service';
import type { AuthoringActor } from './types';

// This is a smoke-grade integration test — it threads an in-memory
// mock Supabase through the full service call sequence and verifies
// each step produces the expected state transitions. It does NOT
// test the Postgres RPC (policy_activate_draft) — the RPC is tested
// via a separate dev-db integration test in Plan 2a's handoff (not
// in this file, because the RPC requires a real Postgres).

interface Row { [key: string]: unknown }

class InMemorySupabase {
  tables: Record<string, Row[]> = {
    policy_policies: [],
    policy_versions: [],
    policy_rules: [],
    policy_hard_limits: [],
    policy_approval_chains: [],
    policy_activation_events: [],
    user_profiles: [
      { id: 'user-admin', enterprise_id: 'ent-1', role: 'treasury_manager', is_policy_admin: true, is_app_admin: false },
      { id: 'user-2', enterprise_id: 'ent-1', role: 'treasury_manager', is_policy_admin: false, is_app_admin: false },
    ],
  };

  from(table: string) {
    const self = this;
    let rows = [...(this.tables[table] ?? [])];
    const builder: Record<string, unknown> = {
      select: (_cols: string) => builder,
      eq: (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      },
      order: (_col: string, _opts: unknown) => builder,
      limit: (_n: number) => Promise.resolve({ data: rows, error: null }),
      single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (r: { data: Row[]; error: unknown }) => void) =>
        resolve({ data: rows, error: null }),
      insert: (row: Row | Row[]) => {
        const inserted = Array.isArray(row) ? row : [row];
        for (const r of inserted) {
          if (!r.id) r.id = `auto-${Math.random().toString(36).slice(2, 10)}`;
          self.tables[table] = [...(self.tables[table] ?? []), r];
        }
        const lastInserted = inserted[inserted.length - 1];
        return {
          select: (_cols: string) => ({
            single: () => Promise.resolve({ data: lastInserted, error: null }),
          }),
          then: (resolve: (r: { data: Row[]; error: unknown }) => void) =>
            resolve({ data: inserted, error: null }),
        };
      },
      update: (patch: Row) => ({
        eq: (col: string, val: unknown) => ({
          eq: (col2: string, val2: unknown) => {
            const t = self.tables[table] ?? [];
            for (const r of t) {
              if (r[col] === val && r[col2] === val2) {
                Object.assign(r, patch);
              }
            }
            return Promise.resolve({ data: null, error: null });
          },
          then: (resolve: (r: { data: Row[]; error: unknown }) => void) => {
            const t = self.tables[table] ?? [];
            for (const r of t) {
              if (r[col] === val) Object.assign(r, patch);
            }
            resolve({ data: t, error: null });
          },
        }),
      }),
      delete: () => ({
        eq: (col: string, val: unknown) => ({
          eq: (col2: string, val2: unknown) => {
            self.tables[table] = (self.tables[table] ?? []).filter(
              (r) => !(r[col] === val && r[col2] === val2),
            );
            return Promise.resolve({ data: null, error: null });
          },
          then: (resolve: (r: { data: Row[]; error: unknown }) => void) => {
            self.tables[table] = (self.tables[table] ?? []).filter((r) => r[col] !== val);
            resolve({ data: [], error: null });
          },
        }),
      }),
    };
    return builder;
  }

  async rpc(name: string, params: Record<string, unknown>) {
    if (name !== 'policy_activate_draft') {
      return { data: null, error: { message: `Unknown RPC: ${name}` } };
    }
    // Simulate the atomic activation:
    const draft = this.tables.policy_versions.find(
      (v) => v.id === params.p_draft_version_id && v.enterprise_id === params.p_enterprise_id,
    );
    if (!draft || draft.status !== 'draft') {
      return { data: null, error: { message: 'version_not_draft', code: 'P0002' } };
    }
    const reason = params.p_reason as string;
    if (reason.trim().length < 20) {
      return { data: null, error: { message: 'activation_reason_too_short', code: 'P0001' } };
    }
    // Supersede existing active
    const existing = this.tables.policy_versions.find(
      (v) => v.enterprise_id === params.p_enterprise_id && v.status === 'active',
    );
    if (existing) existing.status = 'superseded';
    draft.status = 'active';
    draft.activated_by = params.p_activated_by;
    draft.activated_at = new Date().toISOString();
    // Upsert the policy row
    let policy = this.tables.policy_policies.find((p) => p.enterprise_id === params.p_enterprise_id);
    if (!policy) {
      policy = { id: `p-${Math.random().toString(36).slice(2, 10)}`, enterprise_id: params.p_enterprise_id, name: 'Standard' };
      this.tables.policy_policies.push(policy);
    }
    policy.active_version_id = params.p_draft_version_id;
    return { data: params.p_draft_version_id, error: null };
  }
}

// Mock writeAuditLog to a no-op for this test
vi.mock('@/lib/audit/logger', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

describe('Policy Authoring — end-to-end smoke test', () => {
  it('create draft → add rule → add chain → add hard limit → activate → cannot edit', async () => {
    const supabase = new InMemorySupabase();
    const svc = new PolicyAuthoringService(supabase as never);

    const actor: AuthoringActor = {
      user_id: 'user-admin',
      role: 'treasury_manager',
      enterprise_id: 'ent-1',
    };

    // 1. Create draft
    const draft = await svc.createDraft(actor, { name: 'Standard Controls' });
    expect(draft.status).toBe('draft');
    expect(draft.version_number).toBe(1);

    // 2. Add a chain
    const chain = await svc.upsertApprovalChain(actor, draft.id, {
      name: 'Dual approver',
      slots: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
        { slot_index: 1, minimum_role: 'treasury_manager' },
      ],
      priority: 1,
      expiration_hours: 48,
    });
    expect(chain.id).toBeDefined();

    // 3. Add a rule referencing the chain
    const rule = await svc.upsertRule(actor, draft.id, {
      rule_type: 'approval_threshold',
      name: 'Approval over $50k',
      rationale: 'Standard wire approval threshold',
      condition: {
        kind: 'amount_compare',
        attr: 'transfer.amount',
        op: '>',
        value: { amount: '50000', currency: 'USD' },
      },
      verdict: 'require_approval',
      verdict_chain_id: chain.id,
      priority: 100,
    });
    expect(rule.verdict_chain_id).toBe(chain.id);

    // 4. Add a hard limit
    const limit = await svc.upsertHardLimit(actor, draft.id, {
      limit_type: 'min_cash_reserve_usd',
      name: 'Cash Floor',
      limit_value: '500000',
      limit_currency: 'USD',
      scope: {},
    });
    expect(limit.id).toBeDefined();

    // 5. Activate (requires is_policy_admin, which user-admin has)
    const activated = await svc.activateVersion(actor, draft.id, {
      reason: 'Initial activation of the standard controls policy for ent-1.',
    });
    expect(activated.status).toBe('active');

    // 6. Reading the active policy should now return the activated version
    const active = await svc.getActiveVersion(actor);
    expect(active?.id).toBe(draft.id);
    expect(active?.rules).toHaveLength(1);
    expect(active?.hard_limits).toHaveLength(1);
    expect(active?.approval_chains).toHaveLength(1);

    // 7. Attempting to edit the now-active version must fail with version_not_draft
    await expect(
      svc.upsertRule(actor, draft.id, {
        rule_type: 'approval_threshold',
        name: 'Another rule',
        rationale: '',
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>',
          value: { amount: '1', currency: 'USD' },
        },
        verdict: 'allow_auto',
        priority: 50,
      }),
    ).rejects.toMatchObject({ reason_code: 'version_not_draft' });
  });

  it('refuses to activate when reason is under 20 characters', async () => {
    const supabase = new InMemorySupabase();
    const svc = new PolicyAuthoringService(supabase as never);

    const actor: AuthoringActor = {
      user_id: 'user-admin',
      role: 'treasury_manager',
      enterprise_id: 'ent-1',
    };

    const draft = await svc.createDraft(actor, { name: 'Draft 2' });

    await expect(
      svc.activateVersion(actor, draft.id, { reason: 'too short' }),
    ).rejects.toMatchObject({ reason_code: 'activation_reason_too_short' });
  });

  it('refuses to edit hard limits without is_policy_admin', async () => {
    const supabase = new InMemorySupabase();
    // user-2 has is_policy_admin=false
    const svc = new PolicyAuthoringService(supabase as never);

    const nonAdminActor: AuthoringActor = {
      user_id: 'user-2',
      role: 'treasury_manager',
      enterprise_id: 'ent-1',
    };

    // First create a draft as the admin so user-2 has something to try
    const adminActor: AuthoringActor = {
      user_id: 'user-admin',
      role: 'treasury_manager',
      enterprise_id: 'ent-1',
    };
    const draft = await svc.createDraft(adminActor, { name: 'Draft 3' });

    await expect(
      svc.upsertHardLimit(nonAdminActor, draft.id, {
        limit_type: 'min_cash_reserve_usd',
        name: 'Floor',
        limit_value: '500000',
        limit_currency: 'USD',
        scope: {},
      }),
    ).rejects.toMatchObject({ reason_code: 'requires_policy_admin' });
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npm test -- src/lib/policy/authoring/integration
```

Expected: 3 tests pass.

- [ ] **Step 3: Run the complete policy suite as a regression check**

```bash
npm test -- src/lib/policy
npx tsc --noEmit
```

All Plan 1 tests (432) + all Plan 2a authoring tests must pass together. tsc clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/policy/authoring/integration.test.ts
git commit -m "$(cat <<'EOF'
test(policy-authoring): end-to-end smoke test

Exercises the full authoring flow against an in-memory mock Supabase
that emulates both the standard query builder and the
policy_activate_draft RPC. Covers:

- Create draft → add chain → add rule referencing chain → add hard
  limit → activate → re-read as active → attempt to edit (expect
  version_not_draft)
- Reason-too-short rejection
- Hard limit edit without is_policy_admin rejection

The real Postgres RPC is NOT exercised here — that's covered by a
manual dev-db test (documented in the plan's handoff section). This
test validates the service-layer orchestration is correct, which is
what matters for the HTTP routes.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Plan 2a completion criteria

When all tasks are checked:

- [ ] Worktree `.worktrees/policy-authoring` on branch `feature/policy-authoring`
- [ ] Migration 0035 (`policy_activate_draft` RPC) applied to dev + prod Supabase
- [ ] `src/lib/policy/authoring/` — errors, permissions, types, validation, diff, satisfiability, service, http, index
- [ ] `src/lib/policy/index.ts` re-exports the authoring module
- [ ] `src/types/database.ts` AuditAction union extended with policy_* actions
- [ ] All 15 HTTP routes under `src/app/api/policy/` implemented
- [ ] Full test suite passes: `npm test` — Plan 1 (432 tests) + Plan 2a authoring tests (~60-80 new)
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] Branch pushed to origin: `feature/policy-authoring`

## What Plan 2a does NOT cover (deferred to 2b / 2c)

- Runtime approval endpoints (`/api/policy/approvals/*`) — **Plan 2b**
- Approval workflow service (state machine, slot filling, re-evaluation, expiration sweeper, escalation) — **Plan 2b**
- Extending `user_profiles.role` enum with `approver`/`executive` tiers — **Plan 2b**
- Evaluation log read endpoints (`/api/policy/evaluations/*`) — **Plan 2c**
- Simulation endpoints — **Plan 3**
- Cron sweeper (`/api/cron/sweep-policy-approvals`) — **Plan 2b**
- `gateMoneyMovement()` + ESLint rule + per-route integration — **Plan 2c**
- `is_policy_admin` bootstrap with A1 strategy + 7-day review banner — **Plan 2c**
- Data migration from `treasury_rules` / `ai_recommendations` — **Plan 2c**
- Deletion of `src/lib/treasury/rules-engine.ts` / old approve route / `TreasuryRulesForm` — **Plan 2c**
- UI — **Plan 3**

## Dev-db RPC test (manual, not in the plan)

After Task 12's migration is applied, run this ad-hoc check to verify the RPC behaves correctly in a real Postgres:

```bash
# Connect to dev Supabase via psql or the Supabase SQL editor
# Create a test draft, then call the RPC:
SELECT policy_activate_draft(
  '<enterprise_uuid>',
  '<draft_version_uuid>',
  '<user_uuid>',
  'Initial activation of the standard controls policy for testing.'
);
# Expected: returns the draft_version_uuid.

# Verify the trigger-enforced status transitions worked:
SELECT id, status, activated_at, activated_by
FROM policy_versions
WHERE id = '<draft_version_uuid>';

# Expected: status='active', activated_at populated.

# Verify policy_policies was updated:
SELECT id, active_version_id FROM policy_policies WHERE enterprise_id = '<enterprise_uuid>';

# Expected: active_version_id matches the draft_version_uuid.
```

If any of the above fails, the RPC needs to be debugged before Plan 2a can land.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-11-policy-authoring-api-plan-2a.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task with review rounds between tasks. Best for a plan this size because context stays focused.

**2. Inline Execution** — execute tasks in a single session with batch checkpoints.

Which approach?

