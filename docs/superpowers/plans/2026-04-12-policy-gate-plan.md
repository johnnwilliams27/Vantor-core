# Policy Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the policy engine into `POST /api/transfers` as the reference callsite. Build a thin `PolicyGateService` that takes a `ProposedMovement` + actor, runs `evaluate()`, and either passes the movement through, creates an `ApprovalRequest`, or throws a typed `GateError`. Also add lazy materialization of approval outcomes onto the `transfers.status` column.

**Architecture:** Two-layer split matching the existing policy module. `PolicyGateService` class owns business logic with constructor DI for `evaluate` and `approvalService`. The Next.js route composes the service with the real engine + approval service and handles HTTP-shaped responses. Lazy status flip lives in the route handlers for `/confirm` and `GET /api/transfers/[id]` so no webhook/trigger is needed.

**Tech Stack:** Next.js 14 App Router, Supabase (admin client), Vitest, TypeScript strict, Zod for schema validation. Reuses Plan 1's `EvaluationEngine` + `EvaluationContextLoader` and Plan 2b's `ApprovalWorkflowService`.

**Worktree discipline:** Work in `.worktrees/policy-gate` on branch `feature/policy-gate`. Verify pwd and branch before any git op. **This worktree already exists** (created during brainstorming). Do NOT re-create it.

**Spec:** `docs/superpowers/specs/2026-04-12-policy-gate-design.md`

---

## Task 0: Verify worktree and baseline

**Files:** none created

- [ ] From the main checkout, verify the worktree already exists:

```bash
cd /c/Users/John/crypto-treasury
git worktree list | grep policy-gate
```

Expected: one line like `...worktrees/policy-gate  <hash> [feature/policy-gate]`

- [ ] Move into the worktree:

```bash
cd /c/Users/John/crypto-treasury/.worktrees/policy-gate
pwd  # should end with .worktrees/policy-gate
git branch --show-current  # should be feature/policy-gate
```

- [ ] Install deps if node_modules is empty:

```bash
ls node_modules >/dev/null 2>&1 || npm install
```

Note: `npm install` on Windows in this repo takes several minutes. Background it if needed.

- [ ] Verify baseline policy tests pass:

```bash
npx vitest run src/lib/policy/ --reporter=dot
```

Expected: all tests pass (should be ~640+ after recent merges).

- [ ] Create the empty module directory:

```bash
mkdir -p src/lib/policy/gate
```

- [ ] **No commit** — setup only.

---

## Task 1: Add gate-specific reason codes

**Files:**
- Modify: `src/lib/policy/errors/reason-codes.ts` — add 4 new codes

Existing codes already present: `canonicalization_failed`, `hard_limit_breached`, `gate_internal_error`.

### 1a. Add the 4 new reason codes

Open `src/lib/policy/errors/reason-codes.ts`. Find the `REASON_CODES` const. Add these entries before the closing `} as const;`:

```typescript
  policy_blocked:                    'policy_blocked',
  policy_engine_unavailable:         'policy_engine_unavailable',
  approval_creation_failed:          'approval_creation_failed',
  enterprise_mismatch:               'enterprise_mismatch',
```

- [ ] Apply the edit.
- [ ] Run: `npx tsc --noEmit 2>&1 | grep "reason-codes" || echo "clean"`
- [ ] Expected: `clean` (no type errors in the file).
- [ ] Commit: `feat(policy): add gate-layer reason codes`

```bash
git add src/lib/policy/errors/reason-codes.ts
git commit -m "feat(policy): add gate-layer reason codes (policy_blocked, policy_engine_unavailable, approval_creation_failed, enterprise_mismatch)"
```

---

## Task 2: GateError class

**Files:**
- Create: `src/lib/policy/gate/errors.ts`
- Create: `src/lib/policy/gate/errors.test.ts`

**Tests:** 3

### 2a. Create `src/lib/policy/gate/errors.ts`

```typescript
// src/lib/policy/gate/errors.ts

import { PolicyError, PolicyErrorInit, PolicyErrorEnvelope } from '../errors/classes';

export interface GateErrorInit extends Omit<PolicyErrorInit, 'module'> {}

/**
 * Structured error for the policy gate layer.
 * Same pattern as ApprovalError: extends PolicyError with module='gate'.
 */
export class GateError extends PolicyError {
  constructor(init: GateErrorInit) {
    super({ ...init, module: 'gate' });
    this.name = 'GateError';
  }

  toJSON(): PolicyErrorEnvelope {
    return super.toJSON();
  }
}
```

### 2b. Create `src/lib/policy/gate/errors.test.ts`

```typescript
// src/lib/policy/gate/errors.test.ts

import { describe, it, expect } from 'vitest';
import { GateError } from './errors';
import { PolicyError } from '../errors/classes';
import { REASON_CODES } from '../errors/reason-codes';

describe('GateError', () => {
  it('extends PolicyError with module=gate', () => {
    const err = new GateError({
      reason_code: REASON_CODES.policy_blocked,
      human_readable: 'Transfer blocked by policy rule "No transfers above $100k"',
      user_action: 'Request a treasurer override or reduce the transfer amount.',
    });

    expect(err).toBeInstanceOf(PolicyError);
    expect(err).toBeInstanceOf(GateError);
    expect(err.name).toBe('GateError');
    expect(err.module).toBe('gate');
    expect(err.reason_code).toBe('policy_blocked');
  });

  it('serializes to envelope with details and cause', () => {
    const cause = new Error('engine DB timeout');
    const err = new GateError({
      reason_code: REASON_CODES.policy_engine_unavailable,
      human_readable: 'Policy engine unavailable.',
      user_action: 'Retry in a few seconds.',
      details: { enterprise_id: 'ent-1' },
      cause,
    });

    const json = err.toJSON();
    expect(json.reason_code).toBe('policy_engine_unavailable');
    expect(json.module).toBe('gate');
    expect(json.details).toEqual({ enterprise_id: 'ent-1' });
    expect(json.cause).toEqual({ name: 'Error', message: 'engine DB timeout' });
  });

  it('message follows [reason_code] human_readable format', () => {
    const err = new GateError({
      reason_code: REASON_CODES.hard_limit_breached,
      human_readable: 'Daily outflow limit reached.',
      user_action: 'Wait until tomorrow.',
    });

    expect(err.message).toBe('[hard_limit_breached] Daily outflow limit reached.');
  });
});
```

- [ ] Write both files.
- [ ] Run: `npx vitest run src/lib/policy/gate/errors.test.ts`
- [ ] Expected: 3 tests pass.
- [ ] Commit:

```bash
git add src/lib/policy/gate/errors.ts src/lib/policy/gate/errors.test.ts
git commit -m "feat(policy): add GateError class for policy gate module"
```

---

## Task 3: Movement mapper (transfer body → ProposedMovement)

**Files:**
- Create: `src/lib/policy/gate/movement-mapper.ts`
- Create: `src/lib/policy/gate/movement-mapper.test.ts`

**Tests:** 5

### 3a. Create `src/lib/policy/gate/movement-mapper.ts`

```typescript
// src/lib/policy/gate/movement-mapper.ts

import { randomUUID } from 'crypto';
import type { ProposedMovement, MovementEndpoint, Initiator } from '../types/movement';
import type { AssetCode, VenueId } from '../types/assets';

/**
 * Input shape accepted by `mapTransferToMovement`. Mirrors the zod-validated
 * body of POST /api/transfers. Chain and token are narrowed to the same
 * enum values as the route-level schema.
 */
export interface TransferMovementInput {
  fromWalletId: string;
  toAddress: string;
  chain: 'ethereum' | 'solana';
  token: 'USDC' | 'USDT';
  amount: string;
  memo?: string;
  counterpartyId?: string;
}

export interface MapperContext {
  userId: string;
  enterpriseId: string;
  fromAddress: string; // resolved from the wallet lookup
}

/**
 * Pure mapper: transfer request body + context → ProposedMovement.
 * Generates a fresh UUID as the movement.id, which will also serve as
 * transfers.id (PK) and policy_approval_requests.movement_id.
 */
export function mapTransferToMovement(
  input: TransferMovementInput,
  ctx: MapperContext,
): ProposedMovement {
  const id = randomUUID();

  const source: MovementEndpoint = {
    venue: input.chain as VenueId,
    asset: input.token as AssetCode,
    address: ctx.fromAddress,
  };

  const destination: MovementEndpoint = {
    venue: input.chain as VenueId,
    asset: input.token as AssetCode,
    address: input.toAddress,
  };

  const initiator: Initiator = {
    type: 'human',
    user_id: ctx.userId,
  };

  return {
    id,
    kind: 'crypto_transfer',
    source,
    destination,
    amount: {
      amount: input.amount,
      asset: input.token as AssetCode,
    },
    initiator,
    requested_at: new Date().toISOString(),
    ...(input.memo ? { metadata: { memo: input.memo } } : {}),
    ...(input.counterpartyId
      ? { counterparty: { id: input.counterpartyId, kind: 'internal' as const } }
      : {}),
  };
}
```

### 3b. Create `src/lib/policy/gate/movement-mapper.test.ts`

```typescript
// src/lib/policy/gate/movement-mapper.test.ts

import { describe, it, expect } from 'vitest';
import { mapTransferToMovement, type TransferMovementInput, type MapperContext } from './movement-mapper';

const INPUT: TransferMovementInput = {
  fromWalletId: 'wallet-1',
  toAddress: '0xabc123',
  chain: 'ethereum',
  token: 'USDC',
  amount: '5000',
};

const CTX: MapperContext = {
  userId: 'user-1',
  enterpriseId: 'ent-1',
  fromAddress: '0xdef456',
};

describe('mapTransferToMovement', () => {
  it('maps a minimal transfer to a well-formed ProposedMovement', () => {
    const movement = mapTransferToMovement(INPUT, CTX);

    expect(movement.kind).toBe('crypto_transfer');
    expect(movement.source.venue).toBe('ethereum');
    expect(movement.source.asset).toBe('USDC');
    expect(movement.source.address).toBe('0xdef456');
    expect(movement.destination.venue).toBe('ethereum');
    expect(movement.destination.asset).toBe('USDC');
    expect(movement.destination.address).toBe('0xabc123');
    expect(movement.amount).toEqual({ amount: '5000', asset: 'USDC' });
    expect(movement.initiator).toEqual({ type: 'human', user_id: 'user-1' });
    expect(movement.requested_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('generates a fresh UUID for movement.id on each call', () => {
    const m1 = mapTransferToMovement(INPUT, CTX);
    const m2 = mapTransferToMovement(INPUT, CTX);

    expect(m1.id).not.toBe(m2.id);
    expect(m1.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('attaches memo into metadata when present', () => {
    const movement = mapTransferToMovement({ ...INPUT, memo: 'Q2 vendor payment' }, CTX);
    expect(movement.metadata).toEqual({ memo: 'Q2 vendor payment' });
  });

  it('omits metadata when memo is not provided', () => {
    const movement = mapTransferToMovement(INPUT, CTX);
    expect(movement.metadata).toBeUndefined();
  });

  it('attaches counterparty when counterpartyId is provided', () => {
    const movement = mapTransferToMovement({ ...INPUT, counterpartyId: 'cp-1' }, CTX);
    expect(movement.counterparty).toEqual({ id: 'cp-1', kind: 'internal' });
  });
});
```

- [ ] Write both files.
- [ ] Run: `npx vitest run src/lib/policy/gate/movement-mapper.test.ts`
- [ ] Expected: 5 tests pass.
- [ ] Commit:

```bash
git add src/lib/policy/gate/movement-mapper.ts src/lib/policy/gate/movement-mapper.test.ts
git commit -m "feat(policy): add transfer body → ProposedMovement mapper for gate"
```

---

## Task 4: PolicyGateService — TIER 1, adversarial review

> **TIER 1 — dispatch adversarial reviewer after implementation.**

**Files:**
- Create: `src/lib/policy/gate/gate.ts`
- Create: `src/lib/policy/gate/gate.test.ts`

**Tests:** 12

### 4a. Create `src/lib/policy/gate/gate.ts`

```typescript
// src/lib/policy/gate/gate.ts

import { REASON_CODES } from '../errors/reason-codes';
import { GateError } from './errors';
import type { ProposedMovement } from '../types/movement';
import type { EvaluationResult } from '../types/verdict';
import type { UserRole } from '@/types/database';
import type {
  ApprovalRequest,
  ApprovalWorkflowService,
  EvaluateFn,
} from '../approvals';

// ─── Public types ──────────────────────────────────────────────────────

export type GateActor = {
  user_id: string;
  role: UserRole;
  enterprise_id: string;
};

export type GateResult =
  | { verdict: 'allow_auto'; evaluation: EvaluationResult }
  | {
      verdict: 'require_approval';
      approval_request: ApprovalRequest;
      evaluation: EvaluationResult;
    };

export interface PolicyGateServiceOptions {
  evaluate: EvaluateFn;
  approvalService: ApprovalWorkflowService;
}

// ─── Supabase-like minimal shape (same pattern as ApprovalWorkflowService) ──

export type SupabaseLike = {
  from: (table: string) => unknown;
};

// ─── Service ───────────────────────────────────────────────────────────

/**
 * Gate a proposed money movement through the policy engine.
 *
 * - `allow_auto` → return `{ verdict: 'allow_auto', evaluation }`
 * - `require_approval` → create an ApprovalRequest and return it
 * - `block` / `block_hard_limit` → throw GateError (never returned)
 * - engine/approval errors → throw GateError with specific reason_code
 */
export class PolicyGateService {
  // Reserved for future direct DB access (none used today — kept for
  // API symmetry with ApprovalWorkflowService and future extensions).
  private readonly supabase: SupabaseLike;
  private readonly evaluateFn: EvaluateFn;
  private readonly approvalService: ApprovalWorkflowService;

  constructor(supabase: SupabaseLike, options: PolicyGateServiceOptions) {
    this.supabase = supabase;
    this.evaluateFn = options.evaluate;
    this.approvalService = options.approvalService;
  }

  async gate(movement: ProposedMovement, actor: GateActor): Promise<GateResult> {
    // 1. Defense-in-depth: enterprise isolation. Route already filters
    //    by session enterprise, but bugs in the mapper or manual calls
    //    could lead to a mismatched movement.
    const movementEnterpriseId = this.readEnterpriseId(movement);
    if (movementEnterpriseId && movementEnterpriseId !== actor.enterprise_id) {
      throw new GateError({
        reason_code: REASON_CODES.enterprise_mismatch,
        human_readable: 'Movement enterprise does not match actor enterprise.',
        user_action: 'Contact support — this should not happen.',
        details: {
          movement_enterprise_id: movementEnterpriseId,
          actor_enterprise_id: actor.enterprise_id,
        },
      });
    }

    // 2. Run the engine. Wrap in try/catch to classify failures.
    let evaluation: EvaluationResult;
    try {
      evaluation = await this.evaluateFn(movement, actor.enterprise_id);
    } catch (err) {
      // Distinguish canonicalization-class failures from "engine is down".
      // Canonicalization errors are PolicyErrors thrown by the engine with
      // reason_code='canonicalization_failed'. Anything else is treated as
      // engine unavailability (503 upstream).
      if (this.isCanonicalizationError(err)) {
        throw new GateError({
          reason_code: REASON_CODES.canonicalization_failed,
          human_readable: 'Policy engine could not canonicalize the movement.',
          user_action: 'Check that the asset and rate feed are available.',
          details: { movement_id: movement.id },
          cause: err,
        });
      }
      throw new GateError({
        reason_code: REASON_CODES.policy_engine_unavailable,
        human_readable: 'Policy engine is temporarily unavailable.',
        user_action: 'Retry the transfer in a few seconds.',
        details: { movement_id: movement.id },
        cause: err,
      });
    }

    // 3. Dispatch on verdict.
    switch (evaluation.verdict) {
      case 'allow_auto':
        return { verdict: 'allow_auto', evaluation };

      case 'block':
        throw new GateError({
          reason_code: REASON_CODES.policy_blocked,
          human_readable: 'Transfer blocked by policy.',
          user_action:
            'Review the triggered rules or request a treasurer override.',
          details: {
            movement_id: movement.id,
            reason_codes: evaluation.reason_codes ?? [],
            trace: evaluation.trace,
          },
        });

      case 'block_hard_limit':
        throw new GateError({
          reason_code: REASON_CODES.hard_limit_breached,
          human_readable: 'Transfer would breach a hard limit.',
          user_action:
            'Wait until the limit window resets or request a manual override.',
          details: {
            movement_id: movement.id,
            reason_codes: evaluation.reason_codes ?? [],
            trace: evaluation.trace,
          },
        });

      case 'require_approval':
        return this.createApproval(movement, actor, evaluation);

      default: {
        // Exhaustiveness check for future verdicts.
        const _exhaustive: never = evaluation.verdict;
        throw new GateError({
          reason_code: REASON_CODES.gate_internal_error,
          human_readable: `Unhandled verdict: ${String(_exhaustive)}`,
          user_action: 'Contact support.',
          details: { movement_id: movement.id },
        });
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private async createApproval(
    movement: ProposedMovement,
    actor: GateActor,
    evaluation: EvaluationResult,
  ): Promise<GateResult> {
    if (!evaluation.required_chain) {
      throw new GateError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable:
          'Policy returned require_approval but no approval chain was resolved.',
        user_action: 'Contact support — this is a policy configuration bug.',
        details: { movement_id: movement.id },
      });
    }

    try {
      const approval_request = await this.approvalService.createApprovalRequest({
        enterprise_id: actor.enterprise_id,
        version_id: this.readVersionId(evaluation),
        movement_id: movement.id,
        proposed_movement: movement,
        chain: evaluation.required_chain,
        triggered_rule_ids: this.readTriggeredRuleIds(evaluation),
        created_by: actor.user_id,
      });

      return { verdict: 'require_approval', approval_request, evaluation };
    } catch (err) {
      throw new GateError({
        reason_code: REASON_CODES.approval_creation_failed,
        human_readable: 'Could not create approval request.',
        user_action: 'Retry the transfer.',
        details: { movement_id: movement.id },
        cause: err,
      });
    }
  }

  /**
   * Best-effort extractor for `enterprise_id` from a ProposedMovement.
   * The type does not require it, but callsites typically include it in
   * metadata. Returns undefined if not present (skips the isolation check).
   */
  private readEnterpriseId(movement: ProposedMovement): string | undefined {
    const md = movement.metadata as Record<string, unknown> | undefined;
    const val = md?.enterprise_id;
    return typeof val === 'string' ? val : undefined;
  }

  /**
   * Extract the policy version id from the evaluation trace. The trace
   * shape is defined by Plan 1's EvaluationContext. Falls back to
   * 'unknown' for defensive completeness.
   */
  private readVersionId(evaluation: EvaluationResult): string {
    const trace = evaluation.trace as Record<string, unknown> | undefined;
    const versionId = trace?.policy_version_id;
    return typeof versionId === 'string' ? versionId : 'unknown';
  }

  /**
   * Extract the triggered rule ids from the evaluation trace.
   */
  private readTriggeredRuleIds(evaluation: EvaluationResult): string[] {
    const trace = evaluation.trace as Record<string, unknown> | undefined;
    const ids = trace?.triggered_rule_ids;
    return Array.isArray(ids) ? (ids as string[]) : [];
  }

  private isCanonicalizationError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const reasonCode = (err as { reason_code?: unknown }).reason_code;
    return reasonCode === REASON_CODES.canonicalization_failed;
  }
}
```

### 4b. Create `src/lib/policy/gate/gate.test.ts`

```typescript
// src/lib/policy/gate/gate.test.ts

import { describe, it, expect, vi } from 'vitest';
import { PolicyGateService, type GateActor } from './gate';
import { GateError } from './errors';
import { REASON_CODES } from '../errors/reason-codes';
import type { ProposedMovement } from '../types/movement';
import type { EvaluationResult, ResolvedApprovalChain } from '../types/verdict';
import type { ApprovalRequest, ApprovalWorkflowService } from '../approvals';

// ─── Fixtures ──────────────────────────────────────────────────────────

const MOVEMENT: ProposedMovement = {
  id: 'mov-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'ethereum', asset: 'USDC', address: '0xabc' },
  amount: { amount: '10000', asset: 'USDC' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: '2026-04-12T00:00:00Z',
};

const ACTOR: GateActor = {
  user_id: 'user-1',
  role: 'treasury_manager',
  enterprise_id: 'ent-1',
};

const CHAIN: ResolvedApprovalChain = {
  chain_id: 'chain-1',
  chain_name: 'Dual Approval',
  slots: [
    { slot_index: 0, minimum_role: 'treasury_manager' },
    { slot_index: 1, minimum_role: 'treasury_manager' },
  ],
  expiration_hours: 24,
};

const APPROVAL_REQUEST: ApprovalRequest = {
  id: 'req-1',
  enterprise_id: 'ent-1',
  version_id: 'ver-1',
  movement_id: 'mov-1',
  proposed_movement: MOVEMENT,
  triggered_rule_ids: ['rule-1'],
  chain_id: 'chain-1',
  slot_assignments: [
    { slot_index: 0, minimum_role: 'treasury_manager' },
    { slot_index: 1, minimum_role: 'treasury_manager' },
  ],
  status: 'pending',
  expires_at: '2026-04-13T00:00:00Z',
  created_by: 'user-1',
  created_at: '2026-04-12T00:00:00Z',
  version: 0,
};

const SUPABASE: any = { from: () => ({}) };

function mockApprovalService(overrides?: Partial<ApprovalWorkflowService>): ApprovalWorkflowService {
  return {
    createApprovalRequest: vi.fn().mockResolvedValue(APPROVAL_REQUEST),
    ...overrides,
  } as unknown as ApprovalWorkflowService;
}

function makeTrace(overrides?: Record<string, unknown>) {
  return {
    policy_version_id: 'ver-1',
    triggered_rule_ids: ['rule-1'],
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('PolicyGateService', () => {
  it('returns { verdict: "allow_auto", evaluation } on allow_auto', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'allow_auto',
      trace: makeTrace(),
      reason_codes: [],
    } as EvaluationResult);

    const approvalService = mockApprovalService();
    const gate = new PolicyGateService(SUPABASE, { evaluate, approvalService });

    const result = await gate.gate(MOVEMENT, ACTOR);

    expect(result.verdict).toBe('allow_auto');
    expect(approvalService.createApprovalRequest).not.toHaveBeenCalled();
    if (result.verdict === 'allow_auto') {
      expect(result.evaluation.verdict).toBe('allow_auto');
    }
  });

  it('creates an approval request on require_approval', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'require_approval',
      trace: makeTrace(),
      reason_codes: [],
      required_chain: CHAIN,
    } as EvaluationResult);

    const approvalService = mockApprovalService();
    const gate = new PolicyGateService(SUPABASE, { evaluate, approvalService });

    const result = await gate.gate(MOVEMENT, ACTOR);

    expect(result.verdict).toBe('require_approval');
    if (result.verdict === 'require_approval') {
      expect(result.approval_request).toEqual(APPROVAL_REQUEST);
    }
    expect(approvalService.createApprovalRequest).toHaveBeenCalledTimes(1);
    expect(approvalService.createApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enterprise_id: 'ent-1',
        movement_id: 'mov-1',
        chain: CHAIN,
        triggered_rule_ids: ['rule-1'],
        created_by: 'user-1',
      }),
    );
  });

  it('throws policy_blocked on verdict=block', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'block',
      trace: makeTrace(),
      reason_codes: ['sanctioned_counterparty'],
    } as EvaluationResult);

    const gate = new PolicyGateService(SUPABASE, {
      evaluate,
      approvalService: mockApprovalService(),
    });

    await expect(gate.gate(MOVEMENT, ACTOR)).rejects.toThrow(GateError);

    try {
      await gate.gate(MOVEMENT, ACTOR);
    } catch (err) {
      expect((err as GateError).reason_code).toBe('policy_blocked');
      expect((err as GateError).details.reason_codes).toEqual(['sanctioned_counterparty']);
    }
  });

  it('throws hard_limit_breached on verdict=block_hard_limit', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'block_hard_limit',
      trace: makeTrace(),
      reason_codes: ['max_daily_outflow_usd'],
    } as EvaluationResult);

    const gate = new PolicyGateService(SUPABASE, {
      evaluate,
      approvalService: mockApprovalService(),
    });

    try {
      await gate.gate(MOVEMENT, ACTOR);
      throw new Error('expected gate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).reason_code).toBe('hard_limit_breached');
    }
  });

  it('throws policy_engine_unavailable when evaluate rejects with a generic error', async () => {
    const evaluate = vi.fn().mockRejectedValue(new Error('DB timeout'));

    const gate = new PolicyGateService(SUPABASE, {
      evaluate,
      approvalService: mockApprovalService(),
    });

    try {
      await gate.gate(MOVEMENT, ACTOR);
      throw new Error('expected gate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).reason_code).toBe('policy_engine_unavailable');
    }
  });

  it('throws canonicalization_failed when evaluate rejects with that reason code', async () => {
    const evaluate = vi.fn().mockRejectedValue({
      reason_code: REASON_CODES.canonicalization_failed,
      message: 'stale rate',
    });

    const gate = new PolicyGateService(SUPABASE, {
      evaluate,
      approvalService: mockApprovalService(),
    });

    try {
      await gate.gate(MOVEMENT, ACTOR);
      throw new Error('expected gate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).reason_code).toBe('canonicalization_failed');
    }
  });

  it('throws approval_creation_failed when createApprovalRequest rejects', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'require_approval',
      trace: makeTrace(),
      reason_codes: [],
      required_chain: CHAIN,
    } as EvaluationResult);

    const approvalService = {
      createApprovalRequest: vi.fn().mockRejectedValue(new Error('DB down')),
    } as unknown as ApprovalWorkflowService;

    const gate = new PolicyGateService(SUPABASE, { evaluate, approvalService });

    try {
      await gate.gate(MOVEMENT, ACTOR);
      throw new Error('expected gate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).reason_code).toBe('approval_creation_failed');
    }
  });

  it('throws gate_internal_error when require_approval has no required_chain', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'require_approval',
      trace: makeTrace(),
      reason_codes: [],
      // required_chain is missing — policy bug
    } as EvaluationResult);

    const gate = new PolicyGateService(SUPABASE, {
      evaluate,
      approvalService: mockApprovalService(),
    });

    try {
      await gate.gate(MOVEMENT, ACTOR);
      throw new Error('expected gate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).reason_code).toBe('gate_internal_error');
    }
  });

  it('throws enterprise_mismatch when movement metadata enterprise differs from actor', async () => {
    const movementWithMismatch: ProposedMovement = {
      ...MOVEMENT,
      metadata: { enterprise_id: 'ent-OTHER' },
    };

    const evaluate = vi.fn();
    const gate = new PolicyGateService(SUPABASE, {
      evaluate,
      approvalService: mockApprovalService(),
    });

    try {
      await gate.gate(movementWithMismatch, ACTOR);
      throw new Error('expected gate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).reason_code).toBe('enterprise_mismatch');
    }
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('AI-initiator floor regression: verdict=require_approval + agent initiator is handled normally', async () => {
    // Engine is responsible for applying the floor. Gate should simply
    // route the verdict. We test that agent initiators don't get special
    // treatment inside the gate (no shortcut, no extra assertion).
    const agentMovement: ProposedMovement = {
      ...MOVEMENT,
      initiator: { type: 'agent', agent_id: 'forecaster-1' } as any,
    };

    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'require_approval',
      trace: makeTrace(),
      reason_codes: [],
      required_chain: CHAIN,
    } as EvaluationResult);

    const approvalService = mockApprovalService();
    const gate = new PolicyGateService(SUPABASE, { evaluate, approvalService });

    const result = await gate.gate(agentMovement, ACTOR);

    expect(result.verdict).toBe('require_approval');
    expect(approvalService.createApprovalRequest).toHaveBeenCalled();
  });

  it('no policy version (allow_auto) is handled as a no-op pass-through', async () => {
    // When an enterprise has no policy_version set up, the engine returns
    // allow_auto. This covers the "policy is opt-in" case.
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'allow_auto',
      trace: makeTrace({ policy_version_id: null }),
      reason_codes: [],
    } as EvaluationResult);

    const approvalService = mockApprovalService();
    const gate = new PolicyGateService(SUPABASE, { evaluate, approvalService });

    const result = await gate.gate(MOVEMENT, ACTOR);

    expect(result.verdict).toBe('allow_auto');
    expect(approvalService.createApprovalRequest).not.toHaveBeenCalled();
  });

  it('returned approval_request.movement_id equals movement.id (identity preserved)', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'require_approval',
      trace: makeTrace(),
      reason_codes: [],
      required_chain: CHAIN,
    } as EvaluationResult);

    const approvalService = mockApprovalService();
    const gate = new PolicyGateService(SUPABASE, { evaluate, approvalService });

    const result = await gate.gate(MOVEMENT, ACTOR);

    expect(result.verdict).toBe('require_approval');
    if (result.verdict === 'require_approval') {
      expect(result.approval_request.movement_id).toBe('mov-1');
    }
  });
});
```

- [ ] Write both files.
- [ ] Run: `npx vitest run src/lib/policy/gate/gate.test.ts`
- [ ] Expected: 12 tests pass.
- [ ] Commit:

```bash
git add src/lib/policy/gate/gate.ts src/lib/policy/gate/gate.test.ts
git commit -m "feat(policy): add PolicyGateService with verdict dispatch and error taxonomy"
```

---

## Task 5: HTTP error mapping for GateError

**Files:**
- Create: `src/lib/policy/gate/http.ts`
- Create: `src/lib/policy/gate/http.test.ts`

**Tests:** 7

### 5a. Create `src/lib/policy/gate/http.ts`

```typescript
// src/lib/policy/gate/http.ts
//
// HTTP-layer helpers: map GateError to { status, body }.

import { GateError } from './errors';
import type { ReasonCode } from '../errors/reason-codes';

export interface GateErrorBody {
  reason_code: ReasonCode;
  human_readable: string;
  user_action: string;
  details: Record<string, unknown>;
}

// Status code mapping table:
//
// | Reason Code                    | HTTP |
// |--------------------------------|------|
// | policy_blocked                 | 403  |
// | hard_limit_breached            | 403  |
// | enterprise_mismatch            | 403  |
// | canonicalization_failed        | 400  |
// | policy_engine_unavailable      | 503  |
// | approval_creation_failed       | 500  |
// | gate_internal_error            | 500  |
// | everything else                | 400  |

const STATUS_403: ReadonlySet<ReasonCode> = new Set([
  'policy_blocked',
  'hard_limit_breached',
  'enterprise_mismatch',
] as ReasonCode[]);

const STATUS_503: ReadonlySet<ReasonCode> = new Set([
  'policy_engine_unavailable',
] as ReasonCode[]);

const STATUS_500: ReadonlySet<ReasonCode> = new Set([
  'approval_creation_failed',
  'gate_internal_error',
] as ReasonCode[]);

/**
 * Map a GateError to an HTTP status code and structured response body.
 */
export function mapGateErrorToHttp(err: GateError): {
  status: number;
  body: GateErrorBody;
} {
  let status = 400;
  if (STATUS_403.has(err.reason_code)) {
    status = 403;
  } else if (STATUS_503.has(err.reason_code)) {
    status = 503;
  } else if (STATUS_500.has(err.reason_code)) {
    status = 500;
  }

  return {
    status,
    body: {
      reason_code: err.reason_code,
      human_readable: err.human_readable,
      user_action: err.user_action,
      details: err.details,
    },
  };
}
```

### 5b. Create `src/lib/policy/gate/http.test.ts`

```typescript
// src/lib/policy/gate/http.test.ts

import { describe, it, expect } from 'vitest';
import { mapGateErrorToHttp } from './http';
import { GateError } from './errors';

function makeError(reasonCode: string): GateError {
  return new GateError({
    reason_code: reasonCode as any,
    human_readable: `Error: ${reasonCode}`,
    user_action: 'Fix it.',
    details: { test: true },
  });
}

describe('mapGateErrorToHttp', () => {
  it('maps policy_blocked to 403', () => {
    expect(mapGateErrorToHttp(makeError('policy_blocked')).status).toBe(403);
  });

  it('maps hard_limit_breached to 403', () => {
    expect(mapGateErrorToHttp(makeError('hard_limit_breached')).status).toBe(403);
  });

  it('maps enterprise_mismatch to 403', () => {
    expect(mapGateErrorToHttp(makeError('enterprise_mismatch')).status).toBe(403);
  });

  it('maps policy_engine_unavailable to 503', () => {
    expect(mapGateErrorToHttp(makeError('policy_engine_unavailable')).status).toBe(503);
  });

  it('maps approval_creation_failed to 500', () => {
    expect(mapGateErrorToHttp(makeError('approval_creation_failed')).status).toBe(500);
  });

  it('maps canonicalization_failed to 400', () => {
    expect(mapGateErrorToHttp(makeError('canonicalization_failed')).status).toBe(400);
  });

  it('includes structured body fields', () => {
    const err = makeError('policy_blocked');
    const { body } = mapGateErrorToHttp(err);

    expect(body.reason_code).toBe('policy_blocked');
    expect(body.human_readable).toBe('Error: policy_blocked');
    expect(body.user_action).toBe('Fix it.');
    expect(body.details).toEqual({ test: true });
  });
});
```

- [ ] Write both files.
- [ ] Run: `npx vitest run src/lib/policy/gate/http.test.ts`
- [ ] Expected: 7 tests pass.
- [ ] Commit:

```bash
git add src/lib/policy/gate/http.ts src/lib/policy/gate/http.test.ts
git commit -m "feat(policy): add HTTP error mapping for GateError"
```

---

## Task 6: Barrel exports

**Files:**
- Create: `src/lib/policy/gate/index.ts`
- Modify: `src/lib/policy/index.ts` — append one export

### 6a. Create `src/lib/policy/gate/index.ts`

```typescript
// src/lib/policy/gate/index.ts
//
// Barrel export for the policy gate module.

export { GateError } from './errors';
export type { GateErrorInit } from './errors';

export { PolicyGateService } from './gate';
export type {
  GateActor,
  GateResult,
  PolicyGateServiceOptions,
  SupabaseLike,
} from './gate';

export { mapTransferToMovement } from './movement-mapper';
export type { TransferMovementInput, MapperContext } from './movement-mapper';

export { mapGateErrorToHttp } from './http';
export type { GateErrorBody } from './http';
```

### 6b. Modify `src/lib/policy/index.ts`

Append one line at the end:

```typescript
export * from './gate';
```

- [ ] Write the barrel file.
- [ ] Add the export line to the policy index.
- [ ] Run: `npx vitest run src/lib/policy/gate/ --reporter=dot`
- [ ] Expected: all 27 tests in the gate module pass (3 errors + 5 mapper + 12 gate + 7 http).
- [ ] Commit:

```bash
git add src/lib/policy/gate/index.ts src/lib/policy/index.ts
git commit -m "feat(policy): add barrel exports for policy gate module"
```

---

## Task 7: Migration — add awaiting_approval status + denial_reason column

**Files:**
- Create: `supabase/migrations/NNNN_transfers_awaiting_approval.sql` (where NNNN is the next migration number)

### 7a. Determine the next migration number

```bash
ls supabase/migrations/ | sort | tail -3
```

Take the largest numeric prefix, add 1, and use that for NNNN. Example: if the latest is `0048_customer_insight_settings.sql`, the new file is `0049_transfers_awaiting_approval.sql`.

### 7b. Create the migration file

Create `supabase/migrations/NNNN_transfers_awaiting_approval.sql`:

```sql
-- Add awaiting_approval status + denial_reason to transfers table.
-- Enables the policy gate to mark transfers as pending policy review
-- between body-parse and client-sign, and to capture denial context
-- for audit.
--
-- Defensive approach: at POST time the row is inserted with
-- status='awaiting_approval', then flipped to 'pending' if the gate
-- returns allow_auto. Ensures no signable row exists before the gate
-- ran.

-- Drop and recreate the CHECK constraint to include the new status.
ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_status_check;
ALTER TABLE transfers ADD CONSTRAINT transfers_status_check
  CHECK (status IN (
    'pending',
    'processing',
    'completed',
    'failed',
    'cancelled',
    'awaiting_approval',
    'denied'
  ));

-- Column for capturing why a transfer was denied. Populated on:
--   - Gate throw: set to the reason_code (policy_blocked, hard_limit_breached, etc.)
--   - Approval denial: set to denial_reason (manual, stale_reeval, expired)
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS denial_reason TEXT;

-- Index for UI queries that filter by status (e.g., "my pending approvals").
CREATE INDEX IF NOT EXISTS transfers_status_idx ON transfers (status);

-- Reasonable cap on denial_reason length to prevent misuse.
ALTER TABLE transfers ADD CONSTRAINT transfers_denial_reason_length_check
  CHECK (denial_reason IS NULL OR LENGTH(denial_reason) <= 200);
```

### 7c. Apply to dev Supabase

```bash
npx tsx scripts/migrate.ts supabase/migrations/NNNN_transfers_awaiting_approval.sql
```

Verify the output shows a successful apply. Do NOT apply to prod yet — that happens after merge.

### 7d. Verify on dev

```bash
npx tsx -e "
import { createAdminClient } from './src/lib/supabase/admin';
const s = createAdminClient();
const { data } = await s.rpc('pg_typeof', { input: null }).select();
console.log('ok');
"
```

- [ ] Apply migration to dev.
- [ ] Verify no error in migration output.
- [ ] Commit:

```bash
git add supabase/migrations/NNNN_transfers_awaiting_approval.sql
git commit -m "feat(db): add awaiting_approval status + denial_reason column to transfers"
```

---

## Task 8: Integrate gate into `POST /api/transfers` — TIER 1, adversarial review

> **TIER 1 — dispatch adversarial reviewer after implementation.**

**Files:**
- Modify: `src/app/api/transfers/route.ts` (POST handler)

This task integrates the gate into the existing route. It does NOT add integration tests yet — those are in Task 11.

### 8a. Read the current state of the route

Open `src/app/api/transfers/route.ts`. Note these landmarks in the POST handler:
- After the `counterpartyId` eligibility check (~line 130)
- Before `// Create pending transfer record — the client will drive on-chain execution` comment (~line 144)
- Existing insert uses `status: 'pending'`
- The `writeAuditLog` call near the end

### 8b. Add imports at the top of the route file

Add these imports near the existing imports (alphabetize if other Policy imports already exist):

```typescript
import { PolicyGateService, mapTransferToMovement, GateError, mapGateErrorToHttp, type GateActor } from '@/lib/policy/gate';
import { ApprovalWorkflowService } from '@/lib/policy/approvals';
import { EvaluationEngine, EvaluationContextLoader } from '@/lib/policy';
import type { ProposedMovement } from '@/lib/policy/types/movement';
// If other policy-engine infra is needed (rate provider, forecast factory, etc.),
// import the concrete implementations here. For v1 we reuse whatever production
// wiring already exists; if none exists for the gate, the minimal setup is:
//   - `CoingeckoPolicyRateProvider` for rates
//   - `AggregationDetector` with sql-query implementation
//   - `StubForecastQueryFactory` (Plan 1 stub until forecast Q lands)
//   - supabase admin for fetchPolicyVersion / fetchBalances / etc.
```

### 8c. Build the evaluate wrapper and gate service near the top of the POST handler

Insert after the session/role/tier checks and body parsing, BUT BEFORE the sanctions screening (so the gate can be constructed once and reused):

```typescript
  // Build the policy gate with DI.
  // The evaluate wrapper loads a fresh EvaluationContext per request and
  // runs the engine. In tests this wrapper is mocked.
  const gateService = buildPolicyGateService(supabase);
```

Add a helper function at the module scope of `route.ts`, after the imports and before the handlers:

```typescript
/**
 * Builds a production PolicyGateService wired to the real EvaluationEngine,
 * EvaluationContextLoader, and ApprovalWorkflowService. All three share the
 * admin supabase client.
 *
 * The evaluate wrapper encapsulates the per-request context load + engine
 * call; callers see a simple (movement, enterpriseId) → Promise<Result>
 * signature matching ApprovalWorkflowService's EvaluateFn contract.
 */
function buildPolicyGateService(supabase: ReturnType<typeof createAdminClient>): PolicyGateService {
  const engine = new EvaluationEngine();
  // NOTE: EvaluationContextLoader requires deps from Plan 1 infra.
  // If a shared builder for production deps already exists, use it.
  // Otherwise inline the minimum viable deps here — see Plan 1 docs.
  const loader = buildEvaluationContextLoader(supabase);
  const approvalService = new ApprovalWorkflowService(supabase as any);

  const evaluate = async (
    movement: ProposedMovement,
    enterpriseId: string,
  ) => {
    const ctx = await loader.load(movement, enterpriseId);
    return engine.evaluate(movement, ctx);
  };

  return new PolicyGateService(supabase as any, { evaluate, approvalService });
}

/**
 * Minimal EvaluationContextLoader for gate integration.
 * Uses existing Plan 1 production implementations. If any dep is not
 * yet wired for production, substitute the Plan 1 stub and file a
 * follow-up to swap it in.
 */
function buildEvaluationContextLoader(
  supabase: ReturnType<typeof createAdminClient>,
): EvaluationContextLoader {
  // PHASE-1 NOTE: This function inlines the dep wiring for the gate's
  // first callsite. If multiple callsites end up needing the same wiring
  // (yield, payments, ramps), extract to `src/lib/policy/wiring.ts` as
  // a follow-up.
  //
  // Concrete deps to inject here are defined in
  // `src/lib/policy/context-loader/loader.ts` as EvaluationContextLoaderDeps.
  // Implementers: look at that interface and the existing production
  // usage in `src/lib/insights/policy-gate.ts` or similar to know which
  // concrete classes to instantiate.
  //
  // Minimum viable for crypto_transfer:
  //   - rateProvider: new CoingeckoPolicyRateProvider()
  //   - aggregateDetector: new AggregationDetector(...)
  //   - forecastFactory: new StubForecastQueryFactory()
  //   - fetchPolicyVersion, fetchBalances, fetchCounterpartyHistory,
  //     fetchLatestScreening: closures over `supabase`
  //
  // If any of these concrete classes are missing in the repo (not all
  // Plan 1 infra may be wired for production), substitute a stub that
  // returns a no-op value for that dep so the gate can still run.
  throw new Error(
    'buildEvaluationContextLoader: production wiring is not yet implemented. ' +
    'Inline the Plan 1 infra deps here following the pattern in the loader interface.',
  );
}
```

**Important:** If the inline dep wiring for the loader is not yet viable in production (because Plan 1 didn't ship a concrete `CoingeckoPolicyRateProvider` hookup, or similar), **stop and ask the user** whether to:
- (a) Use the stub evaluate function that returns `allow_auto` (temporary no-op gate; logs a warning), or
- (b) Block this task pending a separate wiring plan.

Default recommendation if asked: **(a) with explicit audit-log warning on every call** so the gate is installed as a harmless no-op until real wiring lands.

### 8d. Replace the insert-and-return block with gate-aware flow

**Find** the existing block starting at `// Create pending transfer record` (search for the exact comment) and **replace** it with the gate-aware flow:

```typescript
  // ─── Policy gate + approval workflow integration ──────────────────

  // Build the movement (pure). transfer.id = movement.id so the approval
  // request can reference the transfer by its PK.
  const movement = mapTransferToMovement(
    {
      fromWalletId: parsed.data.fromWalletId,
      toAddress: parsed.data.toAddress,
      chain: parsed.data.chain,
      token: parsed.data.token,
      amount: parsed.data.amount,
      memo: parsed.data.memo,
      counterpartyId: parsed.data.counterpartyId,
    },
    {
      userId: session.user.id,
      enterpriseId: enterpriseId as string,
      fromAddress: wallet.address ?? '',
    },
  );

  // Defensive insert: status='awaiting_approval' first. Flipped to 'pending'
  // on allow_auto, or to 'denied' on gate throw. No signable row exists
  // until the gate confirms it should.
  const { data: transfer, error: pErr } = await supabase
    .from('transfers')
    .insert({
      id: movement.id,
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      direction: 'sent',
      from_wallet_id: parsed.data.fromWalletId,
      from_address: null,
      to_address: parsed.data.toAddress,
      chain: parsed.data.chain,
      token: parsed.data.token,
      amount: parsed.data.amount,
      memo: parsed.data.memo ?? null,
      invoice_id: parsed.data.invoiceId ?? null,
      erp_config_id: parsed.data.erpConfigId ?? null,
      counterparty_id: parsed.data.counterpartyId ?? null,
      scheduled_for: null,
      status: 'awaiting_approval',
    })
    .select()
    .single();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  // Run the gate.
  const actor: GateActor = {
    user_id: session.user.id,
    role: session.user.role as any,
    enterprise_id: enterpriseId as string,
  };

  let gateResult;
  try {
    gateResult = await gateService.gate(movement, actor);
  } catch (err) {
    // Rollback path: flip transfer to denied with the reason code.
    if (err instanceof GateError) {
      await supabase
        .from('transfers')
        .update({
          status: 'denied',
          denial_reason: err.reason_code,
        })
        .eq('id', transfer.id);

      await writeAuditLog({
        userId: session.user.id,
        action: 'transfer_create_blocked',
        entityType: 'transfer',
        entityId: transfer.id,
        details: {
          reason_code: err.reason_code,
          trace: (err.details as any)?.trace,
        },
      });

      const { status, body } = mapGateErrorToHttp(err);
      return NextResponse.json(body, { status });
    }
    // Unexpected — re-throw to the Next.js error boundary.
    throw err;
  }

  // Dispatch on verdict.
  if (gateResult.verdict === 'allow_auto') {
    await supabase
      .from('transfers')
      .update({ status: 'pending' })
      .eq('id', transfer.id);

    await writeAuditLog({
      userId: session.user.id,
      action: 'transfer_create',
      entityType: 'transfer',
      entityId: transfer.id,
      details: {
        chain: transfer.chain,
        token: transfer.token,
        amount: transfer.amount,
      },
    });

    return NextResponse.json({ data: { ...transfer, status: 'pending' } });
  }

  // require_approval — transfer stays in awaiting_approval; approval_request
  // was already created by the gate.
  await writeAuditLog({
    userId: session.user.id,
    action: 'transfer_create_requires_approval',
    entityType: 'transfer',
    entityId: transfer.id,
    details: {
      approval_request_id: gateResult.approval_request.id,
      chain_id: gateResult.approval_request.chain_id,
      chain_name: gateResult.evaluation.required_chain?.chain_name,
    },
  });

  return NextResponse.json(
    {
      data: { ...transfer, status: 'awaiting_approval' },
      approval_request: gateResult.approval_request,
    },
    { status: 202 },
  );
```

**Important:** Remove the OLD insert block that used `status: 'pending'`. Leave the existing writeAuditLog for `action: 'transfer_create'` only inside the `allow_auto` branch — the old standalone writeAuditLog call after the insert must be removed to avoid double-audit.

- [ ] Read the current route file first (`Read` tool) to understand the exact line numbers of landmarks.
- [ ] Apply the imports.
- [ ] Add the `buildPolicyGateService` + `buildEvaluationContextLoader` helpers at module scope.
- [ ] If `buildEvaluationContextLoader` can't be filled in because Plan 1 infra isn't wired for production, **stop and ask the user** — do NOT substitute a bogus implementation silently.
- [ ] Replace the insert-and-return block with the gate-aware flow.
- [ ] Remove any duplicate `writeAuditLog` call that would double-audit.
- [ ] Run: `npx tsc --noEmit 2>&1 | grep "transfers/route" || echo "clean"`
- [ ] Expected: `clean` (no type errors in this route).
- [ ] Commit:

```bash
git add src/app/api/transfers/route.ts
git commit -m "feat(policy): integrate policy gate into POST /api/transfers"
```

---

## Task 9: Lazy flip in `/confirm` + status check — TIER 1, adversarial review

> **TIER 1 — dispatch adversarial reviewer after implementation.**

**Files:**
- Modify: `src/app/api/transfers/confirm/route.ts`

The flip logic runs before any existing confirm logic. If the transfer is still `awaiting_approval`, check the associated approval request and materialize the outcome onto the transfer row.

### 9a. Read the current state

Open `src/app/api/transfers/confirm/route.ts`. Note where the transfer is loaded (likely by `id` with enterprise scope) and where the sign-proof check happens.

### 9b. Add the lazy-flip block

Insert immediately after `const transfer = ...` (the load) and before any existing sign-proof logic:

```typescript
  // ─── Lazy materialization of approval outcome onto transfer row ──
  // When an approval request was created for this transfer, the workflow
  // service wrote only to policy_approval_requests — not to transfers.
  // Reflect the outcome here so /confirm sees the current state.
  if (transfer.status === 'awaiting_approval') {
    const { data: approval } = await supabase
      .from('policy_approval_requests')
      .select('status, denial_reason')
      .eq('movement_id', transfer.id)
      .eq('enterprise_id', enterpriseId)
      .maybeSingle();

    if (approval?.status === 'executed') {
      await supabase
        .from('transfers')
        .update({ status: 'pending' })
        .eq('id', transfer.id);
      transfer.status = 'pending';
    } else if (approval?.status === 'denied' || approval?.status === 'cancelled') {
      const nextDenialReason = approval.denial_reason ?? approval.status;
      await supabase
        .from('transfers')
        .update({
          status: 'denied',
          denial_reason: nextDenialReason,
        })
        .eq('id', transfer.id);
      transfer.status = 'denied';
      transfer.denial_reason = nextDenialReason;
    }
    // else: approval still pending — transfer stays awaiting_approval below.
  }

  // Reject signing for any status other than 'pending'. Includes
  // awaiting_approval (still waiting), denied, cancelled, executed, etc.
  if (transfer.status !== 'pending') {
    return NextResponse.json(
      {
        error: 'Transfer is not ready for signing',
        status: transfer.status,
        ...(transfer.denial_reason ? { denial_reason: transfer.denial_reason } : {}),
      },
      { status: 409 },
    );
  }
```

**Important:**
- The `eq('enterprise_id', enterpriseId)` filter on the approval query is defense-in-depth. Plan 2b's ApprovalWorkflowService already scopes by enterprise on create, but a mismatched movement_id could theoretically return an approval from the wrong enterprise. Hold this line.
- The `transfer.denial_reason` mutation is a local in-memory mutation; the DB update is authoritative. The reject response pulls from the now-updated local copy.

- [ ] Read the current `/confirm` route.
- [ ] Insert the lazy-flip block at the right location.
- [ ] Ensure `enterpriseId` is resolvable in this scope — if the route uses a different variable name, rename in the block to match.
- [ ] Run: `npx tsc --noEmit 2>&1 | grep "confirm/route" || echo "clean"`
- [ ] Expected: `clean`.
- [ ] Commit:

```bash
git add src/app/api/transfers/confirm/route.ts
git commit -m "feat(policy): lazy-flip awaiting_approval on /api/transfers/confirm"
```

---

## Task 10: Lazy flip in `GET /api/transfers/[id]` — TIER 1, adversarial review

> **TIER 1 — dispatch adversarial reviewer after implementation.**

**Files:**
- Modify: `src/app/api/transfers/[id]/route.ts`

### 10a. Read the current state

Open `src/app/api/transfers/[id]/route.ts`. Locate the GET handler. Note where the transfer is loaded and how `enterpriseId` is accessed.

### 10b. Add the lazy-flip block

Insert the same flip block (from Task 9) immediately after the transfer row is loaded, but BEFORE it is returned in the response:

```typescript
  // ─── Lazy materialization of approval outcome ─────────────────────
  // Same pattern as /api/transfers/confirm. Ensures UI polling sees
  // the up-to-date status without a separate endpoint or webhook.
  if (transfer.status === 'awaiting_approval') {
    const { data: approval } = await supabase
      .from('policy_approval_requests')
      .select('status, denial_reason')
      .eq('movement_id', transfer.id)
      .eq('enterprise_id', enterpriseId)
      .maybeSingle();

    if (approval?.status === 'executed') {
      await supabase
        .from('transfers')
        .update({ status: 'pending' })
        .eq('id', transfer.id);
      transfer.status = 'pending';
    } else if (approval?.status === 'denied' || approval?.status === 'cancelled') {
      const nextDenialReason = approval.denial_reason ?? approval.status;
      await supabase
        .from('transfers')
        .update({
          status: 'denied',
          denial_reason: nextDenialReason,
        })
        .eq('id', transfer.id);
      transfer.status = 'denied';
      transfer.denial_reason = nextDenialReason;
    }
  }
```

**Note:** If the `[id]/route.ts` file does not currently exist, stop and ask the user whether to create it (or whether the GET-by-id endpoint lives somewhere else, e.g., the list endpoint filters by id).

- [ ] Read the current `/api/transfers/[id]/route.ts`.
- [ ] If the file doesn't exist or the GET handler lives elsewhere, stop and ask.
- [ ] Insert the lazy-flip block at the right location.
- [ ] Run: `npx tsc --noEmit 2>&1 | grep "transfers/\[id\]/route" || echo "clean"`
- [ ] Expected: `clean`.
- [ ] Commit:

```bash
git add src/app/api/transfers/[id]/route.ts
git commit -m "feat(policy): lazy-flip awaiting_approval on GET /api/transfers/[id]"
```

---

## Task 11: Route integration tests — TIER 1, adversarial review

> **TIER 1 — dispatch adversarial reviewer after implementation.**

**Files:**
- Create: `src/app/api/transfers/route.test.ts`

**Tests:** 6

Route-level integration tests are the final proof the end-to-end flow works. They mount the full route with a mock supabase and mock policy engine.

### 11a. Check for existing route test infra

```bash
ls src/app/api/transfers/*.test.ts 2>/dev/null || echo "none"
find src/app/api -name "*.test.ts" | head -5
```

If a similar test file exists (e.g., the repo uses `@/lib/test/route-runner` or similar), follow its patterns. Otherwise create a minimal self-contained runner.

### 11b. Create `src/app/api/transfers/route.test.ts`

**Context-sensitive:** the exact shape depends on how Next.js route handlers are invoked in tests in this repo. If a helper like `invokeRoute(POST, request)` exists, use it. Otherwise, adapt the test runner below. The key assertions are what matters.

```typescript
// src/app/api/transfers/route.test.ts
//
// Integration tests for POST /api/transfers + /confirm flow with the
// policy gate. Mocks supabase + policy engine; asserts on response
// status, body, and side effects.
//
// NOTE: If the repo has a canonical route-testing harness, replace the
// inline invocation with that. The test scenarios are what matters.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocked module stubs are set up per test via vi.mock below.

describe('POST /api/transfers integration with policy gate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 200 + transfer.status="pending" when gate returns allow_auto', async () => {
    // Arrange mocks:
    //   - supabase admin: insert transfer, return row; update transfer; audit log
    //   - evaluate(): { verdict: 'allow_auto', ... }
    //
    // Act: call POST /api/transfers with valid body, session injected
    //
    // Assert:
    //   - status 200
    //   - response.data.status === 'pending'
    //   - supabase.transfers.update was called once with { status: 'pending' }
    //   - approval_service.createApprovalRequest NOT called
    expect(true).toBe(true); // placeholder — replace with real assertions
  });

  it('returns 202 + approval_request in body when gate returns require_approval', async () => {
    // Similar arrange, but evaluate() returns require_approval + chain
    // Assert:
    //   - status 202
    //   - response.data.status === 'awaiting_approval'
    //   - response.approval_request.id is present
    //   - supabase.transfers.update NOT called with { status: 'pending' }
    //   - createApprovalRequest called once
    expect(true).toBe(true);
  });

  it('returns 403 + structured body when gate throws policy_blocked', async () => {
    // evaluate() returns verdict: 'block'
    // Assert:
    //   - status 403
    //   - body.reason_code === 'policy_blocked'
    //   - supabase.transfers.update was called with
    //     { status: 'denied', denial_reason: 'policy_blocked' }
    //   - audit log 'transfer_create_blocked' written
    expect(true).toBe(true);
  });

  it('returns 503 when gate throws policy_engine_unavailable', async () => {
    // evaluate() rejects with a generic error
    // Assert:
    //   - status 503
    //   - body.reason_code === 'policy_engine_unavailable'
    //   - transfer row is 'denied' with that reason_code
    expect(true).toBe(true);
  });

  it('/confirm returns 409 when transfer is awaiting_approval AND approval is still pending', async () => {
    // Setup: transfer row status='awaiting_approval'
    //   approval_request status='pending'
    // Assert:
    //   - /confirm returns 409
    //   - body.status === 'awaiting_approval'
    //   - transfer row unchanged
    expect(true).toBe(true);
  });

  it('/confirm flips to pending and allows signing when approval is executed', async () => {
    // Setup: transfer status='awaiting_approval'
    //   approval_request status='executed'
    // Assert:
    //   - transfer row updated to status='pending'
    //   - /confirm proceeds to the normal sign-proof flow (or reaches
    //     the next early-return condition — whichever indicates the
    //     status check passed)
    expect(true).toBe(true);
  });
});
```

**IMPORTANT for implementers:** the scaffolding above uses placeholder assertions because the exact way Next.js App Router handlers are tested varies by repo setup. Replace the placeholders with concrete assertions once you see how other route tests in this repo invoke handlers.

If NO other route tests exist in this repo, ask the user whether to:
- (a) Add a minimal test harness for this plan, or
- (b) Defer integration tests to a follow-up plan, keeping only unit tests in this plan.

Default recommendation if asked: **(a)** because the lazy-flip in two endpoints (confirm, GET) is a TIER 1 surface that deserves coverage.

- [ ] Check for existing route test patterns.
- [ ] Create `route.test.ts` following repo patterns.
- [ ] If no patterns exist, stop and ask user whether to add a harness or defer.
- [ ] Run: `npx vitest run src/app/api/transfers/route.test.ts`
- [ ] Expected: 6 tests pass (or the subset that maps to the harness's capabilities).
- [ ] Commit:

```bash
git add src/app/api/transfers/route.test.ts
git commit -m "test(policy): integration tests for gate + /confirm lazy flip"
```

---

## Task 12: Apply migration to prod + final verification

**Files:** none modified.

### 12a. After PR review merges feature/policy-gate to master

```bash
cd /c/Users/John/crypto-treasury
git checkout master
git pull
```

### 12b. Apply the migration to production Supabase

Swap the Supabase URL env variable to prod and run the same migrate script:

```bash
# Temporarily point at prod Supabase (see CLAUDE.md "Migrations" section)
NEXT_PUBLIC_SUPABASE_URL=<prod_url> npx tsx scripts/migrate.ts supabase/migrations/NNNN_transfers_awaiting_approval.sql
```

Verify the output shows a successful apply.

### 12c. Smoke test on production

After auto-deploy, open https://www.vantor.xyz and attempt a small crypto transfer as a treasury_manager. Confirm:
- If no policies are configured → transfer proceeds to `pending` as before (no behavior change).
- If a policy was deliberately configured to require approval → response is 202 with an `approval_request` in the body.

- [ ] Apply migration to prod.
- [ ] Smoke test the default path.
- [ ] No commit — this is verification only.

---

## Summary

| Task | Description | Tier | Tests |
|------|-------------|------|-------|
| 0 | Worktree + baseline verify | — | 0 |
| 1 | Add gate reason codes | 2 | 0 |
| 2 | GateError class | 2 | 3 |
| 3 | Movement mapper | 2 | 5 |
| 4 | PolicyGateService (core) | **1** | 12 |
| 5 | HTTP error mapping | 2 | 7 |
| 6 | Barrel exports | 2 | 0 |
| 7 | Migration: awaiting_approval + denial_reason | 2 | 0 |
| 8 | Integrate gate into POST /api/transfers | **1** | 0 |
| 9 | Lazy flip in /confirm | **1** | 0 |
| 10 | Lazy flip in GET /api/transfers/[id] | **1** | 0 |
| 11 | Route integration tests | **1** | 6 |
| 12 | Apply migration to prod + smoke test | — | 0 |
| **Total** | **13 tasks** | **5 Tier-1** | **~33 tests** |

## Open questions the executor may hit

1. **Plan 1 production wiring for `EvaluationContextLoader`** — if the concrete deps (`CoingeckoPolicyRateProvider`, `AggregationDetector`, etc.) aren't already wired for production use, the `buildEvaluationContextLoader` helper in Task 8 will need to be filled in with whatever production wiring exists. If none exists, ask the user whether to ship a no-op stub evaluate function.

2. **Route test harness** — if no existing pattern for testing Next.js App Router handlers exists in this repo, ask whether to add one.

3. **`GET /api/transfers/[id]`** — if the file doesn't exist, confirm whether GET-by-id is handled elsewhere.
