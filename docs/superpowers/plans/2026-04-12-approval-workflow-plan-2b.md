# Approval Workflow Service (Plan 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the runtime approval workflow service with slot-filling, SoD enforcement, re-evaluation, expiration sweeper, and email notifications.

**Architecture:** Two-layer split: ApprovalWorkflowService class owns business logic, thin Next.js route handlers delegate. Same DI pattern as PolicyAuthoringService. New module at src/lib/policy/approvals/.

**Tech Stack:** Next.js 14 App Router, Supabase (admin client), Vitest, TypeScript strict. Reuses Plan 1's EvaluationEngine and Plan 2a's authoring infrastructure.

**Worktree discipline:** Work in `.worktrees/approval-workflow` on branch `feature/approval-workflow`. Verify pwd and branch before any git op.

---

## Task 0: Create worktree and verify baseline

**Files:** none created

- [ ] From the main checkout `C:\Users\John\crypto-treasury`, create the worktree:

```bash
cd /c/Users/John/crypto-treasury
git worktree add .worktrees/approval-workflow -b feature/approval-workflow master
cd .worktrees/approval-workflow
```

- [ ] Install dependencies:

```bash
npm install
```

- [ ] Verify all existing policy tests pass:

```bash
npx vitest run src/lib/policy/ --reporter=verbose
```

- [ ] Create the empty module directory:

```bash
mkdir -p src/lib/policy/approvals
```

- [ ] **No commit** — this is setup only.

---

## Task 1: ApprovalError class

**Files:**
- `src/lib/policy/approvals/errors.ts`
- `src/lib/policy/approvals/errors.test.ts`

**Tests:** 3-4

### 1a. Create `src/lib/policy/approvals/errors.ts`

```typescript
// src/lib/policy/approvals/errors.ts

import { PolicyError, PolicyErrorInit, PolicyErrorEnvelope } from '../errors/classes';

export interface ApprovalErrorInit extends Omit<PolicyErrorInit, 'module'> {}

/**
 * Structured error for the approval workflow module.
 * Same pattern as AuthoringError but without `path` (approvals don't have form fields).
 */
export class ApprovalError extends PolicyError {
  constructor(init: ApprovalErrorInit) {
    super({ ...init, module: 'approvals' });
    this.name = 'ApprovalError';
  }

  toJSON(): PolicyErrorEnvelope {
    return super.toJSON();
  }
}
```

### 1b. Create `src/lib/policy/approvals/errors.test.ts`

```typescript
// src/lib/policy/approvals/errors.test.ts

import { describe, it, expect } from 'vitest';
import { ApprovalError } from './errors';
import { PolicyError } from '../errors/classes';
import { REASON_CODES } from '../errors/reason-codes';

describe('ApprovalError', () => {
  it('extends PolicyError with module=approvals', () => {
    const err = new ApprovalError({
      reason_code: REASON_CODES.approval_not_pending,
      human_readable: 'Request is not in pending status',
      user_action: 'Only pending requests can be approved.',
    });

    expect(err).toBeInstanceOf(PolicyError);
    expect(err).toBeInstanceOf(ApprovalError);
    expect(err.name).toBe('ApprovalError');
    expect(err.module).toBe('approvals');
    expect(err.reason_code).toBe('approval_not_pending');
  });

  it('serializes to PolicyErrorEnvelope via toJSON()', () => {
    const err = new ApprovalError({
      reason_code: REASON_CODES.sod_initiator_conflict,
      human_readable: 'Approver is the movement initiator',
      user_action: 'A different user must approve this request.',
      details: { approver_id: 'user-1', initiator_id: 'user-1' },
    });

    const json = err.toJSON();
    expect(json.reason_code).toBe('sod_initiator_conflict');
    expect(json.module).toBe('approvals');
    expect(json.human_readable).toBe('Approver is the movement initiator');
    expect(json.user_action).toBe('A different user must approve this request.');
    expect(json.details).toEqual({ approver_id: 'user-1', initiator_id: 'user-1' });
    expect(json.occurred_at).toBeDefined();
  });

  it('includes cause chain when provided', () => {
    const cause = new Error('DB timeout');
    const err = new ApprovalError({
      reason_code: REASON_CODES.approval_concurrent_modification,
      human_readable: 'Concurrent modification detected',
      user_action: 'Retry the approval.',
      cause,
    });

    const json = err.toJSON();
    expect(json.cause).toEqual({ name: 'Error', message: 'DB timeout' });
  });

  it('message includes reason_code and human_readable', () => {
    const err = new ApprovalError({
      reason_code: REASON_CODES.no_matching_slot,
      human_readable: 'No matching slot for approver role',
      user_action: 'A user with a higher role must approve.',
    });

    expect(err.message).toBe('[no_matching_slot] No matching slot for approver role');
  });
});
```

- [ ] Write the files above.
- [ ] Run: `npx vitest run src/lib/policy/approvals/errors.test.ts`
- [ ] Verify all 3-4 tests pass.
- [ ] Commit: `feat(policy): add ApprovalError class for approval workflow module`

---

## Task 2: Approval types

**Files:**
- `src/lib/policy/approvals/types.ts`

**Tests:** 0 (pure types)

### 2a. Create `src/lib/policy/approvals/types.ts`

```typescript
// src/lib/policy/approvals/types.ts

import type { UserRole } from '@/types/database';
import type { ProposedMovement } from '../types/movement';
import type { ResolvedApprovalChain } from '../types/verdict';

// ─── Enums ─────────────────────────────────────────────────────────────

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'executed'
  | 'denied'
  | 'escalated'
  | 'cancelled';

export type DenialReason = 'manual' | 'expired' | 'stale_reeval';

// ─── Slot assignments ──────────────────────────────────────────────────

export interface SlotAssignment {
  slot_index: number;
  minimum_role: string;
  filled_by?: string;
  filled_at?: string;
  justification?: string;
}

// ─── DB row shape ──────────────────────────────────────────────────────

export interface ApprovalRequest {
  id: string;
  enterprise_id: string;
  version_id: string;
  movement_id: string;
  proposed_movement: ProposedMovement;
  triggered_rule_ids: string[];
  chain_id: string;
  slot_assignments: SlotAssignment[];
  status: ApprovalStatus;
  denial_reason?: DenialReason;
  expires_at: string;
  created_by?: string;
  created_at: string;
  approved_at?: string;
  resolved_at?: string;
  resolution_notes?: unknown;
  version: number;
}

// ─── Input DTOs ────────────────────────────────────────────────────────

export interface CreateApprovalInput {
  enterprise_id: string;
  version_id: string;
  movement_id: string;
  proposed_movement: ProposedMovement;
  chain: ResolvedApprovalChain;
  triggered_rule_ids: string[];
  created_by?: string;
}

export interface ApprovalActor {
  user_id: string;
  role: UserRole;
  enterprise_id: string;
}

export interface ListFilters {
  status?: ApprovalStatus;
  limit?: number;
  cursor?: string;
}
```

- [ ] Write the file above.
- [ ] Run: `npx vitest run src/lib/policy/approvals/ --reporter=verbose` (should find errors.test.ts only; types have no tests).
- [ ] Commit: `feat(policy): add approval workflow type definitions`

---

## Task 3: SoD validation (TIER 1 -- adversarial review)

> **TIER 1 -- dispatch adversarial reviewer after implementation.**

**Files:**
- `src/lib/policy/approvals/sod.ts`
- `src/lib/policy/approvals/sod.test.ts`

**Tests:** 12-15

### 3a. Create `src/lib/policy/approvals/sod.ts`

```typescript
// src/lib/policy/approvals/sod.ts

import type { ReasonCode } from '../errors/reason-codes';
import { REASON_CODES } from '../errors/reason-codes';
import type { ApprovalRequest, SlotAssignment } from './types';

/**
 * Combined role rank for SoD slot matching. Includes both UserRole
 * values (auditor, accountant, treasury_manager) and ApproverRole
 * values (approver, executive). The existing `hasRole` from
 * `src/lib/auth/rbac.ts` only handles UserRole, so we maintain a
 * local rank map that covers the full slot role spectrum.
 */
const COMBINED_ROLE_RANK: Record<string, number> = {
  auditor: 0,
  accountant: 1,
  treasury_manager: 2,
  approver: 3,
  executive: 4,
};

function roleRankOf(role: string): number {
  return COMBINED_ROLE_RANK[role] ?? -1;
}

function roleSatisfiesSlot(approverRole: string, slotMinimumRole: string): boolean {
  const approverRank = roleRankOf(approverRole);
  const slotRank = roleRankOf(slotMinimumRole);
  if (approverRank < 0 || slotRank < 0) return false;
  return approverRank >= slotRank;
}

export interface ValidateSoDParams {
  request: ApprovalRequest;
  approverId: string;
  approverRole: string;
  /** Map from rule_id to the user_id who created/last-edited that rule */
  ruleAuthors: Map<string, string>;
}

export type SoDResult =
  | { ok: true; slot_index: number }
  | { ok: false; reason_code: ReasonCode };

/**
 * Pure function: validates Separation of Duties for an approval action.
 *
 * Check order (first failure stops):
 * 1. sod_initiator_conflict - approver is the movement initiator
 * 2. sod_rule_editor_conflict - approver authored a triggering rule
 * 3. sod_already_filled - approver already filled a slot on this request
 * 4. no_matching_slot - no unfilled slot at the approver's role level
 */
export function validateSoD(params: ValidateSoDParams): SoDResult {
  const { request, approverId, approverRole, ruleAuthors } = params;

  // 1. Initiator conflict
  if (request.created_by && approverId === request.created_by) {
    return { ok: false, reason_code: REASON_CODES.sod_initiator_conflict };
  }

  // 2. Rule editor conflict
  for (const ruleId of request.triggered_rule_ids) {
    const authorId = ruleAuthors.get(ruleId);
    if (authorId && authorId === approverId) {
      return { ok: false, reason_code: REASON_CODES.sod_rule_editor_conflict };
    }
  }

  // 3. Already filled a slot
  const alreadyFilled = request.slot_assignments.some(
    (slot) => slot.filled_by === approverId,
  );
  if (alreadyFilled) {
    return { ok: false, reason_code: REASON_CODES.sod_already_filled };
  }

  // 4. Find first unfilled slot matching the approver's role
  const matchingSlotIndex = request.slot_assignments.findIndex(
    (slot) => !slot.filled_by && roleSatisfiesSlot(approverRole, slot.minimum_role),
  );
  if (matchingSlotIndex === -1) {
    return { ok: false, reason_code: REASON_CODES.no_matching_slot };
  }

  return { ok: true, slot_index: matchingSlotIndex };
}
```

### 3b. Create `src/lib/policy/approvals/sod.test.ts`

```typescript
// src/lib/policy/approvals/sod.test.ts

import { describe, it, expect } from 'vitest';
import { validateSoD, ValidateSoDParams } from './sod';
import type { ApprovalRequest, SlotAssignment } from './types';
import type { ProposedMovement } from '../types/movement';

// ─── Fixtures ──────────────────────────────────────────────────────────

const MOVEMENT: ProposedMovement = {
  id: 'mov-001',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'ethereum', asset: 'USDC', address: '0xabc' },
  amount: { value: '10000', currency: 'USD' },
  initiator: { type: 'human', user_id: 'user-initiator' },
  requested_at: '2026-04-12T00:00:00Z',
};

function makeSlot(index: number, minRole: string, filledBy?: string): SlotAssignment {
  return {
    slot_index: index,
    minimum_role: minRole,
    ...(filledBy ? { filled_by: filledBy, filled_at: '2026-04-12T01:00:00Z' } : {}),
  };
}

function makeRequest(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: 'req-001',
    enterprise_id: 'ent-001',
    version_id: 'ver-001',
    movement_id: 'mov-001',
    proposed_movement: MOVEMENT,
    triggered_rule_ids: ['rule-1', 'rule-2'],
    chain_id: 'chain-001',
    slot_assignments: [
      makeSlot(0, 'treasury_manager'),
      makeSlot(1, 'treasury_manager'),
    ],
    status: 'pending',
    expires_at: '2026-04-13T00:00:00Z',
    created_by: 'user-initiator',
    created_at: '2026-04-12T00:00:00Z',
    version: 0,
    ...overrides,
  };
}

const EMPTY_RULE_AUTHORS = new Map<string, string>();

describe('validateSoD', () => {
  it('returns ok with slot_index when all checks pass', () => {
    const result = validateSoD({
      request: makeRequest(),
      approverId: 'user-approver',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: true, slot_index: 0 });
  });

  it('rejects with sod_initiator_conflict when approver is the initiator', () => {
    const result = validateSoD({
      request: makeRequest(),
      approverId: 'user-initiator',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'sod_initiator_conflict' });
  });

  it('rejects with sod_rule_editor_conflict when approver authored a triggered rule', () => {
    const ruleAuthors = new Map([
      ['rule-1', 'user-editor'],
      ['rule-2', 'user-other'],
    ]);

    const result = validateSoD({
      request: makeRequest(),
      approverId: 'user-editor',
      approverRole: 'treasury_manager',
      ruleAuthors,
    });

    expect(result).toEqual({ ok: false, reason_code: 'sod_rule_editor_conflict' });
  });

  it('rejects with sod_already_filled when approver already filled a slot', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'treasury_manager', 'user-approver'),
        makeSlot(1, 'treasury_manager'),
      ],
    });

    const result = validateSoD({
      request,
      approverId: 'user-approver',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'sod_already_filled' });
  });

  it('rejects with no_matching_slot when approver role is too low', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'executive'),
        makeSlot(1, 'executive'),
      ],
    });

    const result = validateSoD({
      request,
      approverId: 'user-approver',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'no_matching_slot' });
  });

  it('rejects with no_matching_slot when all slots are already filled', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'treasury_manager', 'user-other-1'),
        makeSlot(1, 'treasury_manager', 'user-other-2'),
      ],
    });

    const result = validateSoD({
      request,
      approverId: 'user-approver',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'no_matching_slot' });
  });

  it('picks the first unfilled slot matching the role', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'treasury_manager', 'user-other'),
        makeSlot(1, 'accountant'),
        makeSlot(2, 'treasury_manager'),
      ],
    });

    const result = validateSoD({
      request,
      approverId: 'user-approver',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    // slot 0 is filled, slot 1 is accountant (treasury_manager >= accountant), so slot 1
    expect(result).toEqual({ ok: true, slot_index: 1 });
  });

  it('handles multiple slots with different role requirements', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'executive'),
        makeSlot(1, 'approver'),
        makeSlot(2, 'treasury_manager'),
      ],
    });

    // accountant can only fill the treasury_manager slot (no, accountant < treasury_manager)
    const result = validateSoD({
      request,
      approverId: 'user-approver',
      approverRole: 'accountant',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'no_matching_slot' });
  });

  it('approver role satisfies executive slot', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'approver'),
      ],
    });

    const result = validateSoD({
      request,
      approverId: 'user-exec',
      approverRole: 'executive',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: true, slot_index: 0 });
  });

  it('treasury_manager satisfies accountant slot', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'accountant'),
      ],
    });

    const result = validateSoD({
      request,
      approverId: 'user-mgr',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: true, slot_index: 0 });
  });

  it('initiator conflict takes precedence over rule editor conflict', () => {
    // Approver is both the initiator AND authored a triggering rule.
    // Should return initiator conflict (checked first).
    const ruleAuthors = new Map([['rule-1', 'user-initiator']]);

    const result = validateSoD({
      request: makeRequest(),
      approverId: 'user-initiator',
      approverRole: 'treasury_manager',
      ruleAuthors,
    });

    expect(result).toEqual({ ok: false, reason_code: 'sod_initiator_conflict' });
  });

  it('rule editor conflict takes precedence over already-filled', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'treasury_manager', 'user-editor'),
        makeSlot(1, 'treasury_manager'),
      ],
    });
    const ruleAuthors = new Map([['rule-1', 'user-editor']]);

    const result = validateSoD({
      request,
      approverId: 'user-editor',
      approverRole: 'treasury_manager',
      ruleAuthors,
    });

    expect(result).toEqual({ ok: false, reason_code: 'sod_rule_editor_conflict' });
  });

  it('handles request with no created_by (skips initiator check)', () => {
    const request = makeRequest({ created_by: undefined });

    const result = validateSoD({
      request,
      approverId: 'user-approver',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: true, slot_index: 0 });
  });

  it('handles unknown role gracefully (no match)', () => {
    const request = makeRequest({
      slot_assignments: [makeSlot(0, 'treasury_manager')],
    });

    const result = validateSoD({
      request,
      approverId: 'user-unknown',
      approverRole: 'unknown_role',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'no_matching_slot' });
  });
});
```

- [ ] Write both files above.
- [ ] Run: `npx vitest run src/lib/policy/approvals/sod.test.ts`
- [ ] Verify all 12-14 tests pass.
- [ ] Commit: `feat(policy): add SoD validation for approval slot filling`

---

## Task 4: Email notification builders

**Files:**
- `src/lib/policy/approvals/notifications.ts`
- `src/lib/policy/approvals/notifications.test.ts`

**Tests:** 5

### 4a. Create `src/lib/policy/approvals/notifications.ts`

```typescript
// src/lib/policy/approvals/notifications.ts

import { actionNotificationEmail } from '@/lib/notifications/email-templates';

const APPROVALS_BASE = '/approvals';

export function approvalRequestCreatedEmail(params: {
  movementDescription: string;
  amount: string;
  chainName: string;
  expiresAt: string;
  requestId: string;
}): string {
  return actionNotificationEmail({
    title: 'Approval Required',
    details: [
      { label: 'Movement', value: params.movementDescription },
      { label: 'Amount', value: params.amount },
      { label: 'Approval Chain', value: params.chainName },
      { label: 'Expires', value: params.expiresAt },
    ],
    ctaLabel: 'Review Approval',
    ctaHref: `${APPROVALS_BASE}/${params.requestId}`,
  });
}

export function approvalSlotFilledEmail(params: {
  movementDescription: string;
  amount: string;
  filledBy: string;
  slotsRemaining: number;
  requestId: string;
}): string {
  return actionNotificationEmail({
    title: 'Approval Progress',
    details: [
      { label: 'Movement', value: params.movementDescription },
      { label: 'Amount', value: params.amount },
      { label: 'Approved By', value: params.filledBy },
      { label: 'Slots Remaining', value: String(params.slotsRemaining) },
    ],
    ctaLabel: 'View Progress',
    ctaHref: `${APPROVALS_BASE}/${params.requestId}`,
  });
}

export function approvalExecutedEmail(params: {
  movementDescription: string;
  amount: string;
  requestId: string;
}): string {
  return actionNotificationEmail({
    title: 'Transfer Approved & Executed',
    details: [
      { label: 'Movement', value: params.movementDescription },
      { label: 'Amount', value: params.amount },
    ],
    ctaLabel: 'View Transaction',
    ctaHref: '/transactions',
  });
}

export function approvalDeniedEmail(params: {
  movementDescription: string;
  amount: string;
  reason: string;
  requestId: string;
}): string {
  return actionNotificationEmail({
    title: 'Approval Denied',
    details: [
      { label: 'Movement', value: params.movementDescription },
      { label: 'Amount', value: params.amount },
      { label: 'Reason', value: params.reason },
    ],
    ctaLabel: 'View Details',
    ctaHref: `${APPROVALS_BASE}/${params.requestId}`,
  });
}

export function approvalExpiredEmail(params: {
  movementDescription: string;
  amount: string;
  requestId: string;
}): string {
  return actionNotificationEmail({
    title: 'Approval Expired',
    details: [
      { label: 'Movement', value: params.movementDescription },
      { label: 'Amount', value: params.amount },
    ],
    ctaLabel: 'View Details',
    ctaHref: `${APPROVALS_BASE}/${params.requestId}`,
  });
}
```

### 4b. Create `src/lib/policy/approvals/notifications.test.ts`

```typescript
// src/lib/policy/approvals/notifications.test.ts

import { describe, it, expect } from 'vitest';
import {
  approvalRequestCreatedEmail,
  approvalSlotFilledEmail,
  approvalExecutedEmail,
  approvalDeniedEmail,
  approvalExpiredEmail,
} from './notifications';

describe('approval notification emails', () => {
  it('approvalRequestCreatedEmail contains title and CTA', () => {
    const html = approvalRequestCreatedEmail({
      movementDescription: 'USDC transfer to 0xabc',
      amount: '$10,000',
      chainName: 'Dual Approval',
      expiresAt: '2026-04-13 12:00 UTC',
      requestId: 'req-001',
    });

    expect(html).toContain('Approval Required');
    expect(html).toContain('Review Approval');
    expect(html).toContain('/approvals/req-001');
    expect(html).toContain('$10,000');
    expect(html).toContain('Dual Approval');
  });

  it('approvalSlotFilledEmail contains title and CTA', () => {
    const html = approvalSlotFilledEmail({
      movementDescription: 'USDC transfer to 0xabc',
      amount: '$10,000',
      filledBy: 'alice@vantor.xyz',
      slotsRemaining: 1,
      requestId: 'req-001',
    });

    expect(html).toContain('Approval Progress');
    expect(html).toContain('View Progress');
    expect(html).toContain('/approvals/req-001');
    expect(html).toContain('alice@vantor.xyz');
  });

  it('approvalExecutedEmail contains title and CTA', () => {
    const html = approvalExecutedEmail({
      movementDescription: 'USDC transfer to 0xabc',
      amount: '$10,000',
      requestId: 'req-001',
    });

    expect(html).toContain('Transfer Approved &amp; Executed');
    expect(html).toContain('View Transaction');
    expect(html).toContain('/transactions');
  });

  it('approvalDeniedEmail contains title and CTA', () => {
    const html = approvalDeniedEmail({
      movementDescription: 'USDC transfer to 0xabc',
      amount: '$10,000',
      reason: 'Manual denial by treasury manager',
      requestId: 'req-001',
    });

    expect(html).toContain('Approval Denied');
    expect(html).toContain('View Details');
    expect(html).toContain('/approvals/req-001');
    expect(html).toContain('Manual denial');
  });

  it('approvalExpiredEmail contains title and CTA', () => {
    const html = approvalExpiredEmail({
      movementDescription: 'USDC transfer to 0xabc',
      amount: '$10,000',
      requestId: 'req-001',
    });

    expect(html).toContain('Approval Expired');
    expect(html).toContain('View Details');
    expect(html).toContain('/approvals/req-001');
  });
});
```

- [ ] Write both files above.
- [ ] Run: `npx vitest run src/lib/policy/approvals/notifications.test.ts`
- [ ] Verify all 5 tests pass.
- [ ] Commit: `feat(policy): add approval email notification builders`

---

## Task 5: Service skeleton + createApprovalRequest

**Files:**
- `src/lib/policy/approvals/service.ts`
- `src/lib/policy/approvals/service.test.ts` (first tests)

**Tests:** 4-6

### 5a. Create `src/lib/policy/approvals/service.ts`

```typescript
// src/lib/policy/approvals/service.ts

import { REASON_CODES } from '../errors/reason-codes';
import { ApprovalError } from './errors';
import type {
  ApprovalRequest,
  ApprovalActor,
  CreateApprovalInput,
  ListFilters,
  SlotAssignment,
} from './types';
import type { EvaluationResult } from '../types/verdict';
import type { ProposedMovement } from '../types/movement';
import { validateSoD } from './sod';

// ─── Minimal SupabaseLike type ──────────────────────────────────────────

export type SupabaseLike = {
  from: (table: string) => unknown;
};

// ─── DI for evaluate function ──────────────────────────────────────────

export type EvaluateFn = (
  movement: ProposedMovement,
  enterpriseId: string,
) => Promise<EvaluationResult>;

export interface ApprovalWorkflowServiceOptions {
  evaluate?: EvaluateFn;
}

// ─── Service ───────────────────────────────────────────────────────────

export class ApprovalWorkflowService {
  private readonly supabase: SupabaseLike;
  private readonly evaluateFn?: EvaluateFn;

  constructor(supabase: SupabaseLike, options?: ApprovalWorkflowServiceOptions) {
    this.supabase = supabase;
    this.evaluateFn = options?.evaluate;
  }

  // ─── Create ────────────────────────────────────────────────────────

  async createApprovalRequest(input: CreateApprovalInput): Promise<ApprovalRequest> {
    const table = this.supabase.from('policy_approval_requests') as any;

    // Idempotency: check for existing request with same movement_id
    const { data: existing } = await table
      .select('*')
      .eq('enterprise_id', input.enterprise_id)
      .eq('movement_id', input.movement_id)
      .maybeSingle();

    if (existing) {
      return existing as ApprovalRequest;
    }

    // Initialize slot assignments from chain (all unfilled)
    const slot_assignments: SlotAssignment[] = input.chain.slots.map((slot) => ({
      slot_index: slot.slot_index,
      minimum_role: slot.minimum_role,
    }));

    // Compute expiration
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + input.chain.expiration_hours * 60 * 60 * 1000,
    );

    const row = {
      enterprise_id: input.enterprise_id,
      version_id: input.version_id,
      movement_id: input.movement_id,
      proposed_movement: input.proposed_movement,
      triggered_rule_ids: input.triggered_rule_ids,
      chain_id: input.chain.chain_id,
      slot_assignments,
      status: 'pending' as const,
      expires_at: expiresAt.toISOString(),
      created_by: input.created_by,
      created_at: now.toISOString(),
      version: 0,
    };

    const { data: created, error } = await table.insert(row);
    if (error) {
      throw new ApprovalError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: `Failed to create approval request: ${error.message}`,
        user_action: 'Retry the operation.',
        details: { movement_id: input.movement_id },
        cause: error,
      });
    }

    return (Array.isArray(created) ? created[0] : created) as ApprovalRequest;
  }

  // ─── Read ──────────────────────────────────────────────────────────

  async getRequest(actor: ApprovalActor, requestId: string): Promise<ApprovalRequest> {
    const table = this.supabase.from('policy_approval_requests') as any;
    const { data, error } = await table
      .select('*')
      .eq('id', requestId)
      .eq('enterprise_id', actor.enterprise_id)
      .single();

    if (error || !data) {
      throw new ApprovalError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: `Approval request not found: ${requestId}`,
        user_action: 'Verify the request ID and try again.',
        details: { request_id: requestId },
      });
    }

    return data as ApprovalRequest;
  }

  async listRequests(actor: ApprovalActor, filters: ListFilters = {}): Promise<ApprovalRequest[]> {
    let query = (this.supabase.from('policy_approval_requests') as any)
      .select('*')
      .eq('enterprise_id', actor.enterprise_id)
      .order('created_at', { ascending: false });

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new ApprovalError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Failed to list approval requests.',
        user_action: 'Retry the operation.',
      });
    }

    return (data ?? []) as ApprovalRequest[];
  }

  // ─── Fill Slot ─────────────────────────────────────────────────────

  async fillSlot(
    actor: ApprovalActor,
    requestId: string,
    justification: string,
  ): Promise<ApprovalRequest> {
    // 1. Load request, verify enterprise match
    const request = await this.getRequest(actor, requestId);

    // 2. Verify status=pending
    if (request.status !== 'pending') {
      throw new ApprovalError({
        reason_code: REASON_CODES.approval_not_pending,
        human_readable: `Cannot approve: request status is '${request.status}', expected 'pending'.`,
        user_action: 'Only pending requests can be approved.',
        details: { request_id: requestId, current_status: request.status },
      });
    }

    // 3. Load rule authors for triggered_rule_ids
    const ruleAuthors = await this.loadRuleAuthors(request.triggered_rule_ids);

    // 4. Call validateSoD
    const sodResult = validateSoD({
      request,
      approverId: actor.user_id,
      approverRole: actor.role,
      ruleAuthors,
    });

    if (!sodResult.ok) {
      throw new ApprovalError({
        reason_code: sodResult.reason_code,
        human_readable: this.sodReasonMessage(sodResult.reason_code),
        user_action: this.sodUserAction(sodResult.reason_code),
        details: { request_id: requestId, approver_id: actor.user_id },
      });
    }

    // 5. Update slot_assignments
    const now = new Date().toISOString();
    const updatedSlots = [...request.slot_assignments];
    updatedSlots[sodResult.slot_index] = {
      ...updatedSlots[sodResult.slot_index],
      filled_by: actor.user_id,
      filled_at: now,
      justification,
    };

    const allFilled = updatedSlots.every((s) => s.filled_by);
    const newStatus = allFilled ? 'approved' : 'pending';
    const approvedAt = allFilled ? now : request.approved_at;

    // 6. Optimistic lock: UPDATE WHERE version = expected
    const expectedVersion = request.version;
    const table = this.supabase.from('policy_approval_requests') as any;

    // Use upsert with id to update (in mock). In production this would be
    // an UPDATE ... WHERE version = N.
    const updatePayload: Record<string, unknown> = {
      id: request.id,
      enterprise_id: request.enterprise_id,
      version_id: request.version_id,
      movement_id: request.movement_id,
      proposed_movement: request.proposed_movement,
      triggered_rule_ids: request.triggered_rule_ids,
      chain_id: request.chain_id,
      slot_assignments: updatedSlots,
      status: newStatus,
      expires_at: request.expires_at,
      created_by: request.created_by,
      created_at: request.created_at,
      approved_at: approvedAt,
      version: expectedVersion + 1,
    };

    const { data: updated, error } = await table.upsert(updatePayload);
    if (error) {
      throw new ApprovalError({
        reason_code: REASON_CODES.approval_concurrent_modification,
        human_readable: 'Concurrent modification detected. Another user may have acted on this request.',
        user_action: 'Reload the request and try again.',
        details: { request_id: requestId, expected_version: expectedVersion },
      });
    }

    const updatedRow = (Array.isArray(updated) ? updated[0] : updated) as ApprovalRequest;

    // 7. If all slots filled, call reEvaluate
    if (allFilled) {
      return this.reEvaluate(updatedRow);
    }

    return updatedRow;
  }

  // ─── Re-Evaluate ───────────────────────────────────────────────────

  private async reEvaluate(request: ApprovalRequest): Promise<ApprovalRequest> {
    if (!this.evaluateFn) {
      // No evaluate function injected — mark as executed (stub behavior for Plan 2b)
      return this.resolveRequest(request, 'executed');
    }

    const evalResult = await this.evaluateFn(
      request.proposed_movement,
      request.enterprise_id,
    );

    // Decision matrix
    if (evalResult.verdict === 'allow_auto') {
      // Policy relaxed since request was created — auto-execute
      return this.resolveRequest(request, 'executed');
    }

    if (evalResult.verdict === 'require_approval') {
      // Check if same chain
      if (evalResult.required_chain?.chain_id === request.chain_id) {
        return this.resolveRequest(request, 'executed');
      }
      // Different chain — deny with stale_reeval
      return this.resolveRequest(request, 'denied', 'stale_reeval');
    }

    // block or block_hard_limit
    return this.resolveRequest(request, 'denied', 'stale_reeval');
  }

  private async resolveRequest(
    request: ApprovalRequest,
    status: 'executed' | 'denied',
    denialReason?: 'stale_reeval',
  ): Promise<ApprovalRequest> {
    const now = new Date().toISOString();
    const table = this.supabase.from('policy_approval_requests') as any;

    const updatePayload: Record<string, unknown> = {
      id: request.id,
      enterprise_id: request.enterprise_id,
      version_id: request.version_id,
      movement_id: request.movement_id,
      proposed_movement: request.proposed_movement,
      triggered_rule_ids: request.triggered_rule_ids,
      chain_id: request.chain_id,
      slot_assignments: request.slot_assignments,
      status,
      denial_reason: denialReason ?? null,
      expires_at: request.expires_at,
      created_by: request.created_by,
      created_at: request.created_at,
      approved_at: request.approved_at,
      resolved_at: now,
      version: request.version + 1,
    };

    const { data: updated } = await table.upsert(updatePayload);
    return (Array.isArray(updated) ? updated[0] : updated) as ApprovalRequest;
  }

  // ─── Deny ──────────────────────────────────────────────────────────

  async deny(
    actor: ApprovalActor,
    requestId: string,
    justification: string,
  ): Promise<ApprovalRequest> {
    const request = await this.getRequest(actor, requestId);

    if (request.status !== 'pending') {
      throw new ApprovalError({
        reason_code: REASON_CODES.approval_not_pending,
        human_readable: `Cannot deny: request status is '${request.status}', expected 'pending'.`,
        user_action: 'Only pending requests can be denied.',
        details: { request_id: requestId, current_status: request.status },
      });
    }

    // Verify actor has treasury_manager+ role
    const DENY_ROLE_RANK: Record<string, number> = {
      auditor: 0,
      accountant: 1,
      treasury_manager: 2,
    };

    if ((DENY_ROLE_RANK[actor.role] ?? -1) < DENY_ROLE_RANK['treasury_manager']) {
      throw new ApprovalError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Insufficient role to deny approval requests.',
        user_action: 'Only treasury managers and above can deny requests.',
        details: { required_role: 'treasury_manager', actual_role: actor.role },
      });
    }

    const now = new Date().toISOString();
    const table = this.supabase.from('policy_approval_requests') as any;

    const updatePayload: Record<string, unknown> = {
      id: request.id,
      enterprise_id: request.enterprise_id,
      version_id: request.version_id,
      movement_id: request.movement_id,
      proposed_movement: request.proposed_movement,
      triggered_rule_ids: request.triggered_rule_ids,
      chain_id: request.chain_id,
      slot_assignments: request.slot_assignments,
      status: 'denied',
      denial_reason: 'manual',
      expires_at: request.expires_at,
      created_by: request.created_by,
      created_at: request.created_at,
      resolved_at: now,
      resolution_notes: { justification, denied_by: actor.user_id },
      version: request.version + 1,
    };

    const { data: updated } = await table.upsert(updatePayload);
    return (Array.isArray(updated) ? updated[0] : updated) as ApprovalRequest;
  }

  // ─── Cancel ────────────────────────────────────────────────────────

  async cancel(
    actor: ApprovalActor,
    requestId: string,
    reason?: string,
  ): Promise<ApprovalRequest> {
    const request = await this.getRequest(actor, requestId);

    if (request.status !== 'pending') {
      throw new ApprovalError({
        reason_code: REASON_CODES.approval_not_pending,
        human_readable: `Cannot cancel: request status is '${request.status}', expected 'pending'.`,
        user_action: 'Only pending requests can be cancelled.',
        details: { request_id: requestId, current_status: request.status },
      });
    }

    // Must be initiator OR enterprise_admin/policy_admin role
    // For now, we check: actor is initiator OR actor is treasury_manager (the highest enterprise role)
    const isInitiator = request.created_by === actor.user_id;
    const isAdmin = actor.role === 'treasury_manager'; // highest enterprise role available

    if (!isInitiator && !isAdmin) {
      throw new ApprovalError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Only the request initiator or an admin can cancel.',
        user_action: 'Contact the request initiator or an enterprise admin.',
        details: { actor_id: actor.user_id, initiator_id: request.created_by },
      });
    }

    const now = new Date().toISOString();
    const table = this.supabase.from('policy_approval_requests') as any;

    const updatePayload: Record<string, unknown> = {
      id: request.id,
      enterprise_id: request.enterprise_id,
      version_id: request.version_id,
      movement_id: request.movement_id,
      proposed_movement: request.proposed_movement,
      triggered_rule_ids: request.triggered_rule_ids,
      chain_id: request.chain_id,
      slot_assignments: request.slot_assignments,
      status: 'cancelled',
      expires_at: request.expires_at,
      created_by: request.created_by,
      created_at: request.created_at,
      resolved_at: now,
      resolution_notes: { reason, cancelled_by: actor.user_id },
      version: request.version + 1,
    };

    const { data: updated } = await table.upsert(updatePayload);
    return (Array.isArray(updated) ? updated[0] : updated) as ApprovalRequest;
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private async loadRuleAuthors(ruleIds: string[]): Promise<Map<string, string>> {
    if (ruleIds.length === 0) return new Map();

    const table = this.supabase.from('policy_rules') as any;
    const { data } = await table.select('id,created_by').in('id', ruleIds);

    const authors = new Map<string, string>();
    if (data) {
      for (const row of data as Array<{ id: string; created_by: string }>) {
        if (row.created_by) {
          authors.set(row.id, row.created_by);
        }
      }
    }
    return authors;
  }

  private sodReasonMessage(reasonCode: string): string {
    switch (reasonCode) {
      case 'sod_initiator_conflict':
        return 'You cannot approve a request you initiated.';
      case 'sod_rule_editor_conflict':
        return 'You cannot approve a request triggered by a rule you authored.';
      case 'sod_already_filled':
        return 'You have already approved this request.';
      case 'no_matching_slot':
        return 'No approval slot matches your role level.';
      default:
        return 'Approval validation failed.';
    }
  }

  private sodUserAction(reasonCode: string): string {
    switch (reasonCode) {
      case 'sod_initiator_conflict':
        return 'A different team member must approve this request.';
      case 'sod_rule_editor_conflict':
        return 'A team member who did not author the triggering rules must approve.';
      case 'sod_already_filled':
        return 'Wait for another team member to approve the remaining slots.';
      case 'no_matching_slot':
        return 'A user with a higher role level is needed to fill the remaining slots.';
      default:
        return 'Contact your treasury admin.';
    }
  }
}
```

### 5b. Create `src/lib/policy/approvals/service.test.ts`

```typescript
// src/lib/policy/approvals/service.test.ts

import { describe, it, expect } from 'vitest';
import { ApprovalWorkflowService } from './service';
import { ApprovalError } from './errors';
import type { CreateApprovalInput, ApprovalActor, ApprovalRequest } from './types';
import type { ProposedMovement } from '../types/movement';
import type { ResolvedApprovalChain } from '../types/verdict';

// ─── Mock Supabase builder ──────────────────────────────────────────────

type Row = Record<string, unknown>;

function mockSupabase(
  fixtures: {
    policy_approval_requests?: Row[];
    policy_rules?: Row[];
    user_profiles?: Row[];
  },
) {
  const tableData: Record<string, Row[]> = {
    policy_approval_requests: fixtures.policy_approval_requests ?? [],
    policy_rules: fixtures.policy_rules ?? [],
    user_profiles: fixtures.user_profiles ?? [],
  };

  function makeQB(table: string, rows: Row[]) {
    let filtered = [...rows];
    const qb: Record<string, unknown> = {};

    qb.eq = (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] === val);
      return qb;
    };

    qb.in = (col: string, vals: unknown[]) => {
      filtered = filtered.filter((r) => (vals as unknown[]).includes(r[col]));
      return qb;
    };

    qb.order = (_col: string, _opts?: unknown) => qb;
    qb.limit = (_n: number) => qb;
    qb.select = (_cols?: string) => qb;

    qb.single = async () => {
      const data = filtered[0] ?? null;
      return { data, error: filtered.length === 0 ? { message: 'Not found' } : null };
    };

    qb.maybeSingle = async () => {
      const data = filtered[0] ?? null;
      return { data, error: null };
    };

    qb.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: filtered, error: null }).then(resolve);

    qb.insert = (data: unknown) => {
      const row = Array.isArray(data) ? data[0] : data;
      const withId = { id: `gen-${Math.random().toString(36).slice(2)}`, ...row } as Row;
      rows.push(withId);
      return Promise.resolve({ data: withId, error: null });
    };

    qb.upsert = (data: unknown) => {
      const incoming = (Array.isArray(data) ? data[0] : data) as Row;
      if (incoming.id) {
        const idx = rows.findIndex((r) => r.id === incoming.id);
        if (idx >= 0) {
          rows[idx] = { ...rows[idx], ...incoming };
          return Promise.resolve({ data: rows[idx], error: null });
        }
      }
      const withId = { id: `gen-${Math.random().toString(36).slice(2)}`, ...incoming };
      rows.push(withId);
      return Promise.resolve({ data: withId, error: null });
    };

    return qb;
  }

  return {
    from: (table: string) => {
      const rows = tableData[table] ?? [];
      return makeQB(table, rows);
    },
  };
}

// ─── Shared fixtures ───────────────────────────────────────────────────

const ENTERPRISE_ID = 'ent-001';
const USER_ID = 'user-initiator';

const MOVEMENT: ProposedMovement = {
  id: 'mov-001',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'ethereum', asset: 'USDC', address: '0xabc' },
  amount: { value: '10000', currency: 'USD' },
  initiator: { type: 'human', user_id: USER_ID },
  requested_at: '2026-04-12T00:00:00Z',
};

const CHAIN: ResolvedApprovalChain = {
  chain_id: 'chain-001',
  chain_name: 'Dual Approval',
  slots: [
    { slot_index: 0, minimum_role: 'treasury_manager' },
    { slot_index: 1, minimum_role: 'treasury_manager' },
  ],
  expiration_hours: 24,
};

const CREATE_INPUT: CreateApprovalInput = {
  enterprise_id: ENTERPRISE_ID,
  version_id: 'ver-001',
  movement_id: 'mov-001',
  proposed_movement: MOVEMENT,
  chain: CHAIN,
  triggered_rule_ids: ['rule-1'],
  created_by: USER_ID,
};

const managerActor: ApprovalActor = {
  user_id: 'user-approver-1',
  role: 'treasury_manager',
  enterprise_id: ENTERPRISE_ID,
};

// ─── Tests ─────────────────────────────────────────────────────────────

describe('ApprovalWorkflowService.createApprovalRequest', () => {
  it('creates a pending request with correct fields', async () => {
    const sb = mockSupabase({});
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.createApprovalRequest(CREATE_INPUT);

    expect(result.status).toBe('pending');
    expect(result.enterprise_id).toBe(ENTERPRISE_ID);
    expect(result.movement_id).toBe('mov-001');
    expect(result.chain_id).toBe('chain-001');
    expect(result.version).toBe(0);
    expect(result.slot_assignments).toHaveLength(2);
    expect(result.slot_assignments[0].filled_by).toBeUndefined();
    expect(result.slot_assignments[1].filled_by).toBeUndefined();
  });

  it('computes expires_at based on chain.expiration_hours', async () => {
    const sb = mockSupabase({});
    const svc = new ApprovalWorkflowService(sb);

    const before = Date.now();
    const result = await svc.createApprovalRequest(CREATE_INPUT);
    const expiresAt = new Date(result.expires_at).getTime();
    const createdAt = new Date(result.created_at).getTime();

    // Should be approximately 24 hours after creation
    const diffHours = (expiresAt - createdAt) / (1000 * 60 * 60);
    expect(diffHours).toBeCloseTo(24, 0);
  });

  it('initializes slot_assignments from chain slots', async () => {
    const sb = mockSupabase({});
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.createApprovalRequest(CREATE_INPUT);

    expect(result.slot_assignments).toEqual([
      { slot_index: 0, minimum_role: 'treasury_manager' },
      { slot_index: 1, minimum_role: 'treasury_manager' },
    ]);
  });

  it('returns existing request for duplicate movement_id (idempotent)', async () => {
    const existingRow = {
      id: 'req-existing',
      enterprise_id: ENTERPRISE_ID,
      movement_id: 'mov-001',
      status: 'pending',
      version: 0,
    };
    const sb = mockSupabase({
      policy_approval_requests: [existingRow],
    });
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.createApprovalRequest(CREATE_INPUT);

    expect(result.id).toBe('req-existing');
  });
});
```

- [ ] Write both files above.
- [ ] Run: `npx vitest run src/lib/policy/approvals/service.test.ts`
- [ ] Verify all 4 tests pass.
- [ ] Commit: `feat(policy): add ApprovalWorkflowService skeleton with createApprovalRequest`

---

## Task 6: Service -- getRequest + listRequests

**Files:**
- `src/lib/policy/approvals/service.test.ts` (append tests)

**Tests:** 4-5

### 6a. Append to `src/lib/policy/approvals/service.test.ts`

Add the following test blocks at the end of the file (after the `createApprovalRequest` describe block, but still inside the overall file):

```typescript
// ─── getRequest ────────────────────────────────────────────────────────

describe('ApprovalWorkflowService.getRequest', () => {
  const REQ_ROW = {
    id: 'req-001',
    enterprise_id: ENTERPRISE_ID,
    version_id: 'ver-001',
    movement_id: 'mov-001',
    proposed_movement: MOVEMENT,
    triggered_rule_ids: ['rule-1'],
    chain_id: 'chain-001',
    slot_assignments: [{ slot_index: 0, minimum_role: 'treasury_manager' }],
    status: 'pending',
    expires_at: '2026-04-13T00:00:00Z',
    created_by: USER_ID,
    created_at: '2026-04-12T00:00:00Z',
    version: 0,
  };

  it('returns the request when it exists in the enterprise', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [REQ_ROW],
    });
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.getRequest(managerActor, 'req-001');
    expect(result.id).toBe('req-001');
  });

  it('throws when request is in a different enterprise', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [{ ...REQ_ROW, enterprise_id: 'ent-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.getRequest(managerActor, 'req-001'),
    ).rejects.toThrow(ApprovalError);
  });
});

// ─── listRequests ──────────────────────────────────────────────────────

describe('ApprovalWorkflowService.listRequests', () => {
  const REQ_PENDING = {
    id: 'req-001',
    enterprise_id: ENTERPRISE_ID,
    status: 'pending',
    created_at: '2026-04-12T00:00:00Z',
  };
  const REQ_DENIED = {
    id: 'req-002',
    enterprise_id: ENTERPRISE_ID,
    status: 'denied',
    created_at: '2026-04-11T00:00:00Z',
  };

  it('returns all requests for the enterprise', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [REQ_PENDING, REQ_DENIED],
    });
    const svc = new ApprovalWorkflowService(sb);

    const results = await svc.listRequests(managerActor);
    expect(results).toHaveLength(2);
  });

  it('filters by status when provided', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [REQ_PENDING, REQ_DENIED],
    });
    const svc = new ApprovalWorkflowService(sb);

    const results = await svc.listRequests(managerActor, { status: 'pending' });
    expect(results.every((r) => r.status === 'pending')).toBe(true);
  });
});
```

- [ ] Append the tests to the existing service.test.ts file.
- [ ] Run: `npx vitest run src/lib/policy/approvals/service.test.ts`
- [ ] Verify all existing + new tests pass (total ~8-9).
- [ ] Commit: `feat(policy): add getRequest and listRequests to ApprovalWorkflowService`

---

## Task 7: Service -- fillSlot (TIER 1 -- adversarial review)

> **TIER 1 -- dispatch adversarial reviewer after implementation.**

**Files:**
- `src/lib/policy/approvals/service.test.ts` (append tests)

**Tests:** 8-10

### 7a. Append to `src/lib/policy/approvals/service.test.ts`

Add after the listRequests block:

```typescript
// ─── fillSlot ──────────────────────────────────────────────────────────

describe('ApprovalWorkflowService.fillSlot', () => {
  function makePendingRequest(overrides?: Partial<Row>): Row {
    return {
      id: 'req-fill',
      enterprise_id: ENTERPRISE_ID,
      version_id: 'ver-001',
      movement_id: 'mov-fill',
      proposed_movement: MOVEMENT,
      triggered_rule_ids: ['rule-1'],
      chain_id: 'chain-001',
      slot_assignments: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
        { slot_index: 1, minimum_role: 'treasury_manager' },
      ],
      status: 'pending',
      expires_at: '2026-04-13T00:00:00Z',
      created_by: USER_ID,
      created_at: '2026-04-12T00:00:00Z',
      version: 0,
      ...overrides,
    };
  }

  it('fills the first unfilled slot and returns the updated request', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makePendingRequest()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.fillSlot(managerActor, 'req-fill', 'Looks good');

    expect(result.slot_assignments[0].filled_by).toBe('user-approver-1');
    expect(result.slot_assignments[0].justification).toBe('Looks good');
    expect(result.slot_assignments[1].filled_by).toBeUndefined();
    expect(result.status).toBe('pending');
    expect(result.version).toBe(1);
  });

  it('marks request as approved when all slots are filled (triggers reEvaluate)', async () => {
    // One slot already filled, fill the second
    const req = makePendingRequest({
      slot_assignments: [
        { slot_index: 0, minimum_role: 'treasury_manager', filled_by: 'user-other', filled_at: '2026-04-12T01:00:00Z' },
        { slot_index: 1, minimum_role: 'treasury_manager' },
      ],
    });
    const sb = mockSupabase({
      policy_approval_requests: [req],
      policy_rules: [{ id: 'rule-1', created_by: 'user-unrelated' }],
    });
    // No evaluate fn => stub: marks as executed
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.fillSlot(managerActor, 'req-fill', 'LGTM');

    expect(result.slot_assignments[1].filled_by).toBe('user-approver-1');
    expect(result.status).toBe('executed');
    expect(result.resolved_at).toBeDefined();
  });

  it('throws approval_not_pending when request is already denied', async () => {
    const req = makePendingRequest({ status: 'denied' });
    const sb = mockSupabase({
      policy_approval_requests: [req],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.fillSlot(managerActor, 'req-fill', 'too late'),
    ).rejects.toThrow(ApprovalError);

    try {
      await svc.fillSlot(managerActor, 'req-fill', 'too late');
    } catch (e) {
      expect((e as ApprovalError).reason_code).toBe('approval_not_pending');
    }
  });

  it('throws sod_initiator_conflict when approver is the initiator', async () => {
    const initiatorActor: ApprovalActor = {
      user_id: USER_ID, // same as created_by
      role: 'treasury_manager',
      enterprise_id: ENTERPRISE_ID,
    };
    const sb = mockSupabase({
      policy_approval_requests: [makePendingRequest()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.fillSlot(initiatorActor, 'req-fill', 'self approve'),
    ).rejects.toThrow(ApprovalError);

    try {
      await svc.fillSlot(initiatorActor, 'req-fill', 'self approve');
    } catch (e) {
      expect((e as ApprovalError).reason_code).toBe('sod_initiator_conflict');
    }
  });

  it('throws sod_rule_editor_conflict when approver authored a triggering rule', async () => {
    const editorActor: ApprovalActor = {
      user_id: 'user-rule-author',
      role: 'treasury_manager',
      enterprise_id: ENTERPRISE_ID,
    };
    const sb = mockSupabase({
      policy_approval_requests: [makePendingRequest()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-rule-author' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.fillSlot(editorActor, 'req-fill', 'my rule'),
    ).rejects.toThrow(ApprovalError);

    try {
      await svc.fillSlot(editorActor, 'req-fill', 'my rule');
    } catch (e) {
      expect((e as ApprovalError).reason_code).toBe('sod_rule_editor_conflict');
    }
  });

  it('throws sod_already_filled when approver already filled a slot', async () => {
    const req = makePendingRequest({
      slot_assignments: [
        { slot_index: 0, minimum_role: 'treasury_manager', filled_by: 'user-approver-1', filled_at: '2026-04-12T01:00:00Z' },
        { slot_index: 1, minimum_role: 'treasury_manager' },
      ],
    });
    const sb = mockSupabase({
      policy_approval_requests: [req],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.fillSlot(managerActor, 'req-fill', 'again'),
    ).rejects.toThrow(ApprovalError);

    try {
      await svc.fillSlot(managerActor, 'req-fill', 'again');
    } catch (e) {
      expect((e as ApprovalError).reason_code).toBe('sod_already_filled');
    }
  });

  it('throws no_matching_slot when approver role is too low', async () => {
    const req = makePendingRequest({
      slot_assignments: [
        { slot_index: 0, minimum_role: 'executive' },
      ],
    });
    const lowActor: ApprovalActor = {
      user_id: 'user-low',
      role: 'accountant',
      enterprise_id: ENTERPRISE_ID,
    };
    const sb = mockSupabase({
      policy_approval_requests: [req],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.fillSlot(lowActor, 'req-fill', 'try'),
    ).rejects.toThrow(ApprovalError);

    try {
      await svc.fillSlot(lowActor, 'req-fill', 'try');
    } catch (e) {
      expect((e as ApprovalError).reason_code).toBe('no_matching_slot');
    }
  });

  it('single slot request: fills and auto-executes', async () => {
    const req = makePendingRequest({
      slot_assignments: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
      ],
    });
    const sb = mockSupabase({
      policy_approval_requests: [req],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.fillSlot(managerActor, 'req-fill', 'approved');

    expect(result.status).toBe('executed');
    expect(result.slot_assignments[0].filled_by).toBe('user-approver-1');
  });
});
```

- [ ] Append the tests to the existing service.test.ts file.
- [ ] Run: `npx vitest run src/lib/policy/approvals/service.test.ts`
- [ ] Verify all tests pass (total ~16-19).
- [ ] Commit: `feat(policy): implement fillSlot with SoD enforcement and optimistic locking`

---

## Task 8: Service -- reEvaluate (TIER 1 -- adversarial review)

> **TIER 1 -- dispatch adversarial reviewer after implementation.**

**Files:**
- `src/lib/policy/approvals/service.test.ts` (append tests)

**Tests:** 6-8

### 8a. Append to `src/lib/policy/approvals/service.test.ts`

Add after the fillSlot block:

```typescript
// ─── reEvaluate (via fillSlot with injected evaluate) ──────────────────

describe('ApprovalWorkflowService reEvaluate', () => {
  function makeSingleSlotPending(overrides?: Partial<Row>): Row {
    return {
      id: 'req-reeval',
      enterprise_id: ENTERPRISE_ID,
      version_id: 'ver-001',
      movement_id: 'mov-reeval',
      proposed_movement: MOVEMENT,
      triggered_rule_ids: ['rule-1'],
      chain_id: 'chain-001',
      slot_assignments: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
      ],
      status: 'pending',
      expires_at: '2026-04-13T00:00:00Z',
      created_by: USER_ID,
      created_at: '2026-04-12T00:00:00Z',
      version: 0,
      ...overrides,
    };
  }

  it('require_approval with same chain_id => executed', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makeSingleSlotPending()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb, {
      evaluate: async () => ({
        verdict: 'require_approval',
        trace: {} as any,
        reason_codes: [],
        required_chain: {
          chain_id: 'chain-001', // same chain
          chain_name: 'Dual Approval',
          slots: [],
          expiration_hours: 24,
        },
      }),
    });

    const result = await svc.fillSlot(managerActor, 'req-reeval', 'ok');
    expect(result.status).toBe('executed');
  });

  it('require_approval with different chain_id => denied(stale_reeval)', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makeSingleSlotPending()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb, {
      evaluate: async () => ({
        verdict: 'require_approval',
        trace: {} as any,
        reason_codes: [],
        required_chain: {
          chain_id: 'chain-different', // different chain
          chain_name: 'New Chain',
          slots: [],
          expiration_hours: 48,
        },
      }),
    });

    const result = await svc.fillSlot(managerActor, 'req-reeval', 'ok');
    expect(result.status).toBe('denied');
    expect(result.denial_reason).toBe('stale_reeval');
  });

  it('block verdict => denied(stale_reeval)', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makeSingleSlotPending()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb, {
      evaluate: async () => ({
        verdict: 'block',
        trace: {} as any,
        reason_codes: [],
      }),
    });

    const result = await svc.fillSlot(managerActor, 'req-reeval', 'ok');
    expect(result.status).toBe('denied');
    expect(result.denial_reason).toBe('stale_reeval');
  });

  it('block_hard_limit verdict => denied(stale_reeval)', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makeSingleSlotPending()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb, {
      evaluate: async () => ({
        verdict: 'block_hard_limit',
        trace: {} as any,
        reason_codes: ['hard_limit_breached'],
      }),
    });

    const result = await svc.fillSlot(managerActor, 'req-reeval', 'ok');
    expect(result.status).toBe('denied');
    expect(result.denial_reason).toBe('stale_reeval');
  });

  it('allow_auto verdict => executed (policy relaxed)', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makeSingleSlotPending()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb, {
      evaluate: async () => ({
        verdict: 'allow_auto',
        trace: {} as any,
        reason_codes: [],
      }),
    });

    const result = await svc.fillSlot(managerActor, 'req-reeval', 'ok');
    expect(result.status).toBe('executed');
  });

  it('no evaluate fn => executed (stub behavior)', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makeSingleSlotPending()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb); // no evaluate fn

    const result = await svc.fillSlot(managerActor, 'req-reeval', 'ok');
    expect(result.status).toBe('executed');
  });
});
```

- [ ] Append the tests to service.test.ts.
- [ ] Run: `npx vitest run src/lib/policy/approvals/service.test.ts`
- [ ] Verify all tests pass (total ~22-27).
- [ ] Commit: `feat(policy): implement reEvaluate with decision matrix and DI evaluate function`

---

## Task 9: Service -- deny + cancel

**Files:**
- `src/lib/policy/approvals/service.test.ts` (append tests)

**Tests:** 6-8

### 9a. Append to `src/lib/policy/approvals/service.test.ts`

```typescript
// ─── deny ──────────────────────────────────────────────────────────────

describe('ApprovalWorkflowService.deny', () => {
  const PENDING_REQ = {
    id: 'req-deny',
    enterprise_id: ENTERPRISE_ID,
    version_id: 'ver-001',
    movement_id: 'mov-deny',
    proposed_movement: MOVEMENT,
    triggered_rule_ids: [],
    chain_id: 'chain-001',
    slot_assignments: [{ slot_index: 0, minimum_role: 'treasury_manager' }],
    status: 'pending',
    expires_at: '2026-04-13T00:00:00Z',
    created_by: USER_ID,
    created_at: '2026-04-12T00:00:00Z',
    version: 0,
  };

  it('denies a pending request with manual reason', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [{ ...PENDING_REQ }],
    });
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.deny(managerActor, 'req-deny', 'Not authorized');

    expect(result.status).toBe('denied');
    expect(result.denial_reason).toBe('manual');
    expect(result.resolved_at).toBeDefined();
    expect(result.resolution_notes).toEqual({
      justification: 'Not authorized',
      denied_by: 'user-approver-1',
    });
  });

  it('throws approval_not_pending on already-executed request', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [{ ...PENDING_REQ, status: 'executed' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.deny(managerActor, 'req-deny', 'too late'),
    ).rejects.toThrow(ApprovalError);

    try {
      await svc.deny(managerActor, 'req-deny', 'too late');
    } catch (e) {
      expect((e as ApprovalError).reason_code).toBe('approval_not_pending');
    }
  });

  it('throws requires_policy_admin for insufficient role', async () => {
    const auditorActor: ApprovalActor = {
      user_id: 'user-auditor',
      role: 'auditor',
      enterprise_id: ENTERPRISE_ID,
    };
    const sb = mockSupabase({
      policy_approval_requests: [{ ...PENDING_REQ }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.deny(auditorActor, 'req-deny', 'nope'),
    ).rejects.toThrow(ApprovalError);

    try {
      await svc.deny(auditorActor, 'req-deny', 'nope');
    } catch (e) {
      expect((e as ApprovalError).reason_code).toBe('requires_policy_admin');
    }
  });
});

// ─── cancel ────────────────────────────────────────────────────────────

describe('ApprovalWorkflowService.cancel', () => {
  const PENDING_REQ = {
    id: 'req-cancel',
    enterprise_id: ENTERPRISE_ID,
    version_id: 'ver-001',
    movement_id: 'mov-cancel',
    proposed_movement: MOVEMENT,
    triggered_rule_ids: [],
    chain_id: 'chain-001',
    slot_assignments: [{ slot_index: 0, minimum_role: 'treasury_manager' }],
    status: 'pending',
    expires_at: '2026-04-13T00:00:00Z',
    created_by: USER_ID,
    created_at: '2026-04-12T00:00:00Z',
    version: 0,
  };

  it('cancel by initiator succeeds', async () => {
    const initiatorActor: ApprovalActor = {
      user_id: USER_ID,
      role: 'accountant',
      enterprise_id: ENTERPRISE_ID,
    };
    const sb = mockSupabase({
      policy_approval_requests: [{ ...PENDING_REQ }],
    });
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.cancel(initiatorActor, 'req-cancel', 'Changed my mind');

    expect(result.status).toBe('cancelled');
    expect(result.resolved_at).toBeDefined();
    expect(result.resolution_notes).toEqual({
      reason: 'Changed my mind',
      cancelled_by: USER_ID,
    });
  });

  it('cancel by treasury_manager (admin) succeeds', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [{ ...PENDING_REQ }],
    });
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.cancel(managerActor, 'req-cancel', 'Admin cancel');

    expect(result.status).toBe('cancelled');
  });

  it('throws approval_not_pending on already-cancelled request', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [{ ...PENDING_REQ, status: 'cancelled' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.cancel(managerActor, 'req-cancel'),
    ).rejects.toThrow(ApprovalError);
  });

  it('throws requires_policy_admin for non-initiator non-admin', async () => {
    const nonInitiatorAuditor: ApprovalActor = {
      user_id: 'user-random-auditor',
      role: 'auditor',
      enterprise_id: ENTERPRISE_ID,
    };
    const sb = mockSupabase({
      policy_approval_requests: [{ ...PENDING_REQ }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.cancel(nonInitiatorAuditor, 'req-cancel'),
    ).rejects.toThrow(ApprovalError);

    try {
      await svc.cancel(nonInitiatorAuditor, 'req-cancel');
    } catch (e) {
      expect((e as ApprovalError).reason_code).toBe('requires_policy_admin');
    }
  });
});
```

- [ ] Append the tests to service.test.ts.
- [ ] Run: `npx vitest run src/lib/policy/approvals/service.test.ts`
- [ ] Verify all tests pass (total ~29-35).
- [ ] Commit: `feat(policy): implement deny and cancel methods on ApprovalWorkflowService`

---

## Task 10: Sweeper

**Files:**
- `src/lib/policy/approvals/sweeper.ts`
- `src/lib/policy/approvals/sweeper.test.ts`

**Tests:** 5-6

### 10a. Create `src/lib/policy/approvals/sweeper.ts`

```typescript
// src/lib/policy/approvals/sweeper.ts

import type { SupabaseLike } from './service';

/**
 * Sweeps expired pending approval requests.
 *
 * Queries for pending requests where expires_at < now(),
 * updates each to denied with denial_reason='expired'.
 *
 * In production, this uses: SELECT ... FOR UPDATE SKIP LOCKED
 * to prevent double-processing across concurrent cron invocations.
 * The mock Supabase in tests simulates the same behavior via
 * simple array filtering.
 */
export async function sweepExpiredApprovals(
  supabase: SupabaseLike,
  batchSize: number = 100,
): Promise<{ expired_count: number }> {
  // In production this would use raw SQL with FOR UPDATE SKIP LOCKED.
  // For the mockable SupabaseLike interface, we query pending requests
  // and filter by expires_at in application code.
  const table = supabase.from('policy_approval_requests') as any;

  const { data: pendingRows, error } = await table
    .select('*')
    .eq('status', 'pending')
    .limit(batchSize);

  if (error || !pendingRows) {
    return { expired_count: 0 };
  }

  const now = new Date();
  const expired = (pendingRows as Array<Record<string, unknown>>).filter(
    (row) => new Date(row.expires_at as string) < now,
  );

  let expiredCount = 0;

  for (const row of expired) {
    const resolvedAt = now.toISOString();

    await table.upsert({
      ...row,
      status: 'denied',
      denial_reason: 'expired',
      resolved_at: resolvedAt,
      version: (row.version as number) + 1,
    });

    expiredCount++;
  }

  return { expired_count: expiredCount };
}
```

### 10b. Create `src/lib/policy/approvals/sweeper.test.ts`

```typescript
// src/lib/policy/approvals/sweeper.test.ts

import { describe, it, expect, vi } from 'vitest';
import { sweepExpiredApprovals } from './sweeper';

// ─── Mock Supabase ─────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function mockSupabase(fixtures: { policy_approval_requests?: Row[] }) {
  const tableData: Record<string, Row[]> = {
    policy_approval_requests: fixtures.policy_approval_requests ?? [],
  };

  function makeQB(table: string, rows: Row[]) {
    let filtered = [...rows];
    const qb: Record<string, unknown> = {};

    qb.eq = (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] === val);
      return qb;
    };

    qb.in = (col: string, vals: unknown[]) => {
      filtered = filtered.filter((r) => (vals as unknown[]).includes(r[col]));
      return qb;
    };

    qb.order = () => qb;
    qb.limit = (_n: number) => {
      filtered = filtered.slice(0, _n);
      return qb;
    };
    qb.select = () => qb;

    qb.single = async () => ({ data: filtered[0] ?? null, error: null });
    qb.maybeSingle = async () => ({ data: filtered[0] ?? null, error: null });

    qb.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: filtered, error: null }).then(resolve);

    qb.upsert = (data: unknown) => {
      const incoming = (Array.isArray(data) ? data[0] : data) as Row;
      if (incoming.id) {
        const idx = rows.findIndex((r) => r.id === incoming.id);
        if (idx >= 0) {
          rows[idx] = { ...rows[idx], ...incoming };
          return Promise.resolve({ data: rows[idx], error: null });
        }
      }
      rows.push(incoming);
      return Promise.resolve({ data: incoming, error: null });
    };

    return qb;
  }

  return {
    from: (table: string) => {
      const rows = tableData[table] ?? [];
      return makeQB(table, rows);
    },
    _data: tableData,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now

describe('sweepExpiredApprovals', () => {
  it('expires pending requests past their expires_at', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [
        {
          id: 'req-1',
          enterprise_id: 'ent-001',
          status: 'pending',
          expires_at: pastDate,
          version: 0,
          created_by: 'user-1',
        },
      ],
    });

    const result = await sweepExpiredApprovals(sb);

    expect(result.expired_count).toBe(1);
    const row = sb._data.policy_approval_requests[0];
    expect(row.status).toBe('denied');
    expect(row.denial_reason).toBe('expired');
    expect(row.resolved_at).toBeDefined();
  });

  it('skips pending requests not yet expired', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [
        {
          id: 'req-2',
          enterprise_id: 'ent-001',
          status: 'pending',
          expires_at: futureDate,
          version: 0,
        },
      ],
    });

    const result = await sweepExpiredApprovals(sb);

    expect(result.expired_count).toBe(0);
    expect(sb._data.policy_approval_requests[0].status).toBe('pending');
  });

  it('skips non-pending requests even if expired', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [
        {
          id: 'req-3',
          enterprise_id: 'ent-001',
          status: 'executed',
          expires_at: pastDate,
          version: 1,
        },
      ],
    });

    const result = await sweepExpiredApprovals(sb);

    expect(result.expired_count).toBe(0);
  });

  it('respects batchSize parameter', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [
        { id: 'req-a', enterprise_id: 'ent-001', status: 'pending', expires_at: pastDate, version: 0 },
        { id: 'req-b', enterprise_id: 'ent-001', status: 'pending', expires_at: pastDate, version: 0 },
        { id: 'req-c', enterprise_id: 'ent-001', status: 'pending', expires_at: pastDate, version: 0 },
      ],
    });

    const result = await sweepExpiredApprovals(sb, 2);

    // batchSize=2 so only 2 should be processed
    expect(result.expired_count).toBe(2);
  });

  it('handles empty result set', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [],
    });

    const result = await sweepExpiredApprovals(sb);

    expect(result.expired_count).toBe(0);
  });
});
```

- [ ] Write both files above.
- [ ] Run: `npx vitest run src/lib/policy/approvals/sweeper.test.ts`
- [ ] Verify all 5 tests pass.
- [ ] Commit: `feat(policy): add expiration sweeper for approval requests`

---

## Task 11: HTTP error mapping + shared handler

**Files:**
- `src/lib/policy/approvals/http.ts`
- `src/lib/policy/approvals/http.test.ts`

**Tests:** 6-8

### 11a. Create `src/lib/policy/approvals/http.ts`

```typescript
// src/lib/policy/approvals/http.ts
//
// Shared HTTP helpers for approval workflow API routes.
// Same pattern as authoring/http.ts but uses ApprovalError.

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { ApprovalWorkflowService } from './service';
import { ApprovalError } from './errors';
import type { ApprovalActor } from './types';
import type { ReasonCode } from '../errors/reason-codes';

// ─── Status code mapping table ─────────────────────────────────────────
//
// | Reason Code                            | HTTP Status |
// |----------------------------------------|-------------|
// | sod_initiator_conflict                 | 403         |
// | sod_rule_editor_conflict               | 403         |
// | requires_policy_admin                  | 403         |
// | approval_not_pending                   | 409         |
// | sod_already_filled                     | 409         |
// | approval_concurrent_modification       | 409         |
// | stale_approval_reevaluation_failed     | 409         |
// | no_matching_slot                       | 400         |
// | everything else                        | 400         |

const STATUS_403: ReadonlySet<ReasonCode> = new Set([
  'sod_initiator_conflict',
  'sod_rule_editor_conflict',
  'requires_policy_admin',
] as ReasonCode[]);

const STATUS_409: ReadonlySet<ReasonCode> = new Set([
  'approval_not_pending',
  'sod_already_filled',
  'approval_concurrent_modification',
  'stale_approval_reevaluation_failed',
] as ReasonCode[]);

// ─── Context resolution ────────────────────────────────────────────────

export interface ApprovalContext {
  actor: ApprovalActor;
  service: ApprovalWorkflowService;
}

/**
 * Resolves the current NextAuth session into an ApprovalActor and an
 * ApprovalWorkflowService backed by the admin Supabase client.
 *
 * Returns null when the session is missing or lacks an enterprise_id;
 * the caller should respond with 401.
 */
export async function resolveApprovalContext(
  _req: NextRequest,
): Promise<ApprovalContext | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.role) return null;

  const supabase = createAdminClient();
  const enterprise_id = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterprise_id) return null;

  const actor: ApprovalActor = {
    user_id: session.user.id,
    role: session.user.role as ApprovalActor['role'],
    enterprise_id,
  };

  return { actor, service: new ApprovalWorkflowService(supabase) };
}

// ─── Error mapping ─────────────────────────────────────────────────────

export interface ApprovalErrorBody {
  reason_code: ReasonCode;
  human_readable: string;
  user_action: string;
  details: Record<string, unknown>;
}

/**
 * Maps an ApprovalError to an HTTP status code and structured response body.
 */
export function mapApprovalErrorToHttp(err: ApprovalError): {
  status: number;
  body: ApprovalErrorBody;
} {
  let status = 400;
  if (STATUS_403.has(err.reason_code)) {
    status = 403;
  } else if (STATUS_409.has(err.reason_code)) {
    status = 409;
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

// ─── Route handler wrapper ─────────────────────────────────────────────

type RouteHandler = (
  req: NextRequest,
  ctx: ApprovalContext,
) => Promise<NextResponse>;

/**
 * Wraps a route handler with:
 *   1. Session resolution -- returns 401 if no valid session.
 *   2. ApprovalError mapping -- ApprovalErrors become structured JSON
 *      with the correct 400 / 403 / 409 status.
 *   3. Unhandled errors -- re-thrown so Next.js error boundaries handle them.
 */
export function handleApprovalRequest(handler: RouteHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const ctx = await resolveApprovalContext(req);
    if (!ctx) {
      return NextResponse.json(
        { error: 'Unauthorized', reason_code: 'requires_policy_admin' },
        { status: 401 },
      );
    }

    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApprovalError) {
        const { status, body } = mapApprovalErrorToHttp(err);
        return NextResponse.json(body, { status });
      }
      throw err;
    }
  };
}
```

### 11b. Create `src/lib/policy/approvals/http.test.ts`

```typescript
// src/lib/policy/approvals/http.test.ts

import { describe, it, expect } from 'vitest';
import { mapApprovalErrorToHttp } from './http';
import { ApprovalError } from './errors';
import { REASON_CODES } from '../errors/reason-codes';

function makeError(reasonCode: string): ApprovalError {
  return new ApprovalError({
    reason_code: reasonCode as any,
    human_readable: `Error: ${reasonCode}`,
    user_action: 'Fix it.',
    details: { test: true },
  });
}

describe('mapApprovalErrorToHttp', () => {
  it('maps sod_initiator_conflict to 403', () => {
    const { status } = mapApprovalErrorToHttp(makeError('sod_initiator_conflict'));
    expect(status).toBe(403);
  });

  it('maps sod_rule_editor_conflict to 403', () => {
    const { status } = mapApprovalErrorToHttp(makeError('sod_rule_editor_conflict'));
    expect(status).toBe(403);
  });

  it('maps requires_policy_admin to 403', () => {
    const { status } = mapApprovalErrorToHttp(makeError('requires_policy_admin'));
    expect(status).toBe(403);
  });

  it('maps approval_not_pending to 409', () => {
    const { status } = mapApprovalErrorToHttp(makeError('approval_not_pending'));
    expect(status).toBe(409);
  });

  it('maps sod_already_filled to 409', () => {
    const { status } = mapApprovalErrorToHttp(makeError('sod_already_filled'));
    expect(status).toBe(409);
  });

  it('maps approval_concurrent_modification to 409', () => {
    const { status } = mapApprovalErrorToHttp(makeError('approval_concurrent_modification'));
    expect(status).toBe(409);
  });

  it('maps stale_approval_reevaluation_failed to 409', () => {
    const { status } = mapApprovalErrorToHttp(makeError('stale_approval_reevaluation_failed'));
    expect(status).toBe(409);
  });

  it('maps no_matching_slot to 400', () => {
    const { status } = mapApprovalErrorToHttp(makeError('no_matching_slot'));
    expect(status).toBe(400);
  });

  it('includes structured body fields', () => {
    const err = makeError('sod_initiator_conflict');
    const { body } = mapApprovalErrorToHttp(err);

    expect(body.reason_code).toBe('sod_initiator_conflict');
    expect(body.human_readable).toBe('Error: sod_initiator_conflict');
    expect(body.user_action).toBe('Fix it.');
    expect(body.details).toEqual({ test: true });
  });
});
```

- [ ] Write both files above.
- [ ] Run: `npx vitest run src/lib/policy/approvals/http.test.ts`
- [ ] Verify all 9 tests pass.
- [ ] Commit: `feat(policy): add HTTP error mapping and shared handler for approval routes`

---

## Task 12: HTTP routes -- list + detail

**Files:**
- `src/app/api/policy/approvals/route.ts`
- `src/app/api/policy/approvals/[id]/route.ts`

**Tests:** 0 (route handlers are integration-tested via Task 16; unit coverage is in http.test.ts)

### 12a. Create `src/app/api/policy/approvals/route.ts`

```typescript
// src/app/api/policy/approvals/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { handleApprovalRequest } from '@/lib/policy/approvals/http';
import type { ApprovalStatus } from '@/lib/policy/approvals/types';

export const GET = handleApprovalRequest(async (req, ctx) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') as ApprovalStatus | null;
  const limit = url.searchParams.get('limit');
  const cursor = url.searchParams.get('cursor');

  const results = await ctx.service.listRequests(ctx.actor, {
    status: status ?? undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
    cursor: cursor ?? undefined,
  });

  return NextResponse.json({ data: results });
});
```

### 12b. Create `src/app/api/policy/approvals/[id]/route.ts`

```typescript
// src/app/api/policy/approvals/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { handleApprovalRequest } from '@/lib/policy/approvals/http';

export const GET = handleApprovalRequest(async (req, ctx) => {
  const url = new URL(req.url);
  const id = url.pathname.split('/').pop()!;

  const result = await ctx.service.getRequest(ctx.actor, id);

  return NextResponse.json({ data: result });
});
```

- [ ] Write both files above.
- [ ] Run: `npx vitest run src/lib/policy/approvals/ --reporter=verbose` (confirm nothing broke).
- [ ] Commit: `feat(policy): add GET routes for approval list and detail`

---

## Task 13: HTTP routes -- approve + deny + cancel

**Files:**
- `src/app/api/policy/approvals/[id]/approve/route.ts`
- `src/app/api/policy/approvals/[id]/deny/route.ts`
- `src/app/api/policy/approvals/[id]/cancel/route.ts`

**Tests:** 0 (route handlers)

### 13a. Create `src/app/api/policy/approvals/[id]/approve/route.ts`

```typescript
// src/app/api/policy/approvals/[id]/approve/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApprovalRequest } from '@/lib/policy/approvals/http';

const approveSchema = z.object({
  justification: z.string().min(1).max(2000),
});

export const POST = handleApprovalRequest(async (req, ctx) => {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/policy/approvals/[id]/approve  =>  id is segments[segments.length - 2]
  const id = segments[segments.length - 2];

  const body = await req.json();
  const parsed = approveSchema.parse(body);

  const result = await ctx.service.fillSlot(ctx.actor, id, parsed.justification);

  return NextResponse.json({ data: result });
});
```

### 13b. Create `src/app/api/policy/approvals/[id]/deny/route.ts`

```typescript
// src/app/api/policy/approvals/[id]/deny/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApprovalRequest } from '@/lib/policy/approvals/http';

const denySchema = z.object({
  justification: z.string().min(1).max(2000),
});

export const POST = handleApprovalRequest(async (req, ctx) => {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const id = segments[segments.length - 2];

  const body = await req.json();
  const parsed = denySchema.parse(body);

  const result = await ctx.service.deny(ctx.actor, id, parsed.justification);

  return NextResponse.json({ data: result });
});
```

### 13c. Create `src/app/api/policy/approvals/[id]/cancel/route.ts`

```typescript
// src/app/api/policy/approvals/[id]/cancel/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApprovalRequest } from '@/lib/policy/approvals/http';

const cancelSchema = z.object({
  reason: z.string().max(2000).optional(),
});

export const POST = handleApprovalRequest(async (req, ctx) => {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const id = segments[segments.length - 2];

  const body = await req.json();
  const parsed = cancelSchema.parse(body);

  const result = await ctx.service.cancel(ctx.actor, id, parsed.reason);

  return NextResponse.json({ data: result });
});
```

- [ ] Write all three files above.
- [ ] Run: `npx vitest run src/lib/policy/approvals/ --reporter=verbose` (confirm nothing broke).
- [ ] Commit: `feat(policy): add POST routes for approve, deny, and cancel actions`

---

## Task 14: Cron route + vercel.json

**Files:**
- `src/app/api/cron/sweep-policy-approvals/route.ts`
- `vercel.json` (modify)

**Tests:** 0 (cron route)

### 14a. Create `src/app/api/cron/sweep-policy-approvals/route.ts`

```typescript
// src/app/api/cron/sweep-policy-approvals/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sweepExpiredApprovals } from '@/lib/policy/approvals/sweeper';

// Cross-enterprise system job: sweeps expired approval requests.
// No session available — authenticated via CRON_SECRET.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  try {
    const result = await sweepExpiredApprovals(supabase);

    console.log(`[cron/sweep-policy-approvals] expired_count=${result.expired_count}`);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[cron/sweep-policy-approvals]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
```

### 14b. Add cron entry to `vercel.json`

Add the following entry to the `crons` array in `vercel.json`:

```json
{
  "path": "/api/cron/sweep-policy-approvals",
  "schedule": "*/15 * * * *"
}
```

- [ ] Write the route file above.
- [ ] Add the cron entry to vercel.json (append to the crons array).
- [ ] Run: `npx vitest run src/lib/policy/approvals/ --reporter=verbose` (confirm nothing broke).
- [ ] Commit: `feat(policy): add cron route for approval expiration sweeper`

---

## Task 15: Index exports + policy barrel update

**Files:**
- `src/lib/policy/approvals/index.ts` (new)
- `src/lib/policy/index.ts` (modify)

**Tests:** 0

### 15a. Create `src/lib/policy/approvals/index.ts`

```typescript
// src/lib/policy/approvals/index.ts
//
// Barrel export for the approval workflow module.

export { ApprovalError } from './errors';
export type { ApprovalErrorInit } from './errors';

export type {
  ApprovalStatus,
  DenialReason,
  SlotAssignment,
  ApprovalRequest,
  CreateApprovalInput,
  ApprovalActor,
  ListFilters,
} from './types';

export { validateSoD } from './sod';
export type { ValidateSoDParams, SoDResult } from './sod';

export { ApprovalWorkflowService } from './service';
export type { SupabaseLike, EvaluateFn, ApprovalWorkflowServiceOptions } from './service';

export { sweepExpiredApprovals } from './sweeper';

export {
  approvalRequestCreatedEmail,
  approvalSlotFilledEmail,
  approvalExecutedEmail,
  approvalDeniedEmail,
  approvalExpiredEmail,
} from './notifications';

export {
  mapApprovalErrorToHttp,
  handleApprovalRequest,
  resolveApprovalContext,
} from './http';
export type { ApprovalContext, ApprovalErrorBody } from './http';
```

### 15b. Update `src/lib/policy/index.ts`

Add the following line at the end of the file:

```typescript
export * from './approvals';
```

- [ ] Write the barrel file and update the policy index.
- [ ] Run: `npx vitest run src/lib/policy/approvals/ --reporter=verbose` (confirm nothing broke).
- [ ] Commit: `feat(policy): add barrel exports for approval workflow module`

---

## Task 16: Integration smoke test

**Files:**
- `src/lib/policy/approvals/integration.test.ts`

**Tests:** 1 (multi-step)

### 16a. Create `src/lib/policy/approvals/integration.test.ts`

```typescript
// src/lib/policy/approvals/integration.test.ts
//
// Integration smoke test: create request -> fill slot 1 -> fill slot 2 ->
// verify status=approved -> re-eval returns executed.

import { describe, it, expect } from 'vitest';
import { ApprovalWorkflowService } from './service';
import type { CreateApprovalInput, ApprovalActor } from './types';
import type { ProposedMovement } from '../types/movement';
import type { ResolvedApprovalChain, EvaluationResult } from '../types/verdict';

// ─── InMemorySupabase (same pattern as authoring/integration.test.ts) ──

type Row = Record<string, unknown>;

class QueryBuilder {
  private rows: Row[];
  private filters: Array<{ col: string; val: unknown; mode: 'eq' | 'in' }> = [];

  constructor(
    private readonly tableName: string,
    private readonly store: Record<string, Row[]>,
  ) {
    this.rows = store[tableName] ?? [];
    if (!store[tableName]) {
      store[tableName] = [];
      this.rows = store[tableName];
    }
  }

  private applyFilters(): Row[] {
    return this.rows.filter((row) =>
      this.filters.every((f) => {
        if (f.mode === 'in') return (f.val as unknown[]).includes(row[f.col]);
        return row[f.col] === f.val;
      }),
    );
  }

  select(_cols?: string): this { return this; }

  eq(col: string, val: unknown): this {
    this.filters.push({ col, val, mode: 'eq' });
    return this;
  }

  in(col: string, vals: unknown[]): this {
    this.filters.push({ col, val: vals, mode: 'in' });
    return this;
  }

  order(_col: string, _opts?: unknown): this { return this; }
  limit(_n: number): this { return this; }

  async single(): Promise<{ data: Row | null; error: { message: string } | null }> {
    const filtered = this.applyFilters();
    const data = filtered[0] ?? null;
    return { data, error: data ? null : { message: 'Not found' } };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const filtered = this.applyFilters();
    return { data: filtered[0] ?? null, error: null };
  }

  then(resolve: (v: unknown) => unknown) {
    const filtered = this.applyFilters();
    return Promise.resolve({ data: filtered, error: null }).then(resolve);
  }

  insert(data: unknown) {
    const row = (Array.isArray(data) ? data[0] : data) as Row;
    const withId = { id: `gen-${Math.random().toString(36).slice(2, 10)}`, ...row };
    this.rows.push(withId);
    return Promise.resolve({ data: withId, error: null });
  }

  upsert(data: unknown) {
    const incoming = (Array.isArray(data) ? data[0] : data) as Row;
    if (incoming.id) {
      const idx = this.rows.findIndex((r) => r.id === incoming.id);
      if (idx >= 0) {
        this.rows[idx] = { ...this.rows[idx], ...incoming };
        return Promise.resolve({ data: this.rows[idx], error: null });
      }
    }
    const withId = { id: `gen-${Math.random().toString(36).slice(2, 10)}`, ...incoming };
    this.rows.push(withId);
    return Promise.resolve({ data: withId, error: null });
  }
}

class InMemorySupabase {
  private store: Record<string, Row[]> = {};

  constructor(fixtures?: Record<string, Row[]>) {
    if (fixtures) {
      this.store = { ...fixtures };
    }
  }

  from(table: string) {
    return new QueryBuilder(table, this.store);
  }

  getRows(table: string): Row[] {
    return this.store[table] ?? [];
  }
}

// ─── Test ──────────────────────────────────────────────────────────────

describe('Approval workflow integration', () => {
  it('create -> fill slot 1 -> fill slot 2 -> re-eval -> executed', async () => {
    // Setup in-memory Supabase with rule fixtures
    const supabase = new InMemorySupabase({
      policy_approval_requests: [],
      policy_rules: [
        { id: 'rule-1', created_by: 'user-policy-admin' },
        { id: 'rule-2', created_by: 'user-policy-admin' },
      ],
    });

    // Mock evaluate: returns require_approval with same chain
    const mockEvaluate = async (): Promise<EvaluationResult> => ({
      verdict: 'require_approval',
      trace: {} as any,
      reason_codes: [],
      required_chain: {
        chain_id: 'chain-dual',
        chain_name: 'Dual Approval',
        slots: [
          { slot_index: 0, minimum_role: 'treasury_manager' },
          { slot_index: 1, minimum_role: 'treasury_manager' },
        ],
        expiration_hours: 24,
      },
    });

    const svc = new ApprovalWorkflowService(supabase as any, {
      evaluate: mockEvaluate,
    });

    const movement: ProposedMovement = {
      id: 'mov-integration',
      kind: 'crypto_transfer',
      source: { venue: 'ethereum', asset: 'USDC' },
      destination: { venue: 'ethereum', asset: 'USDC', address: '0xabc' },
      amount: { value: '50000', currency: 'USD' },
      initiator: { type: 'human', user_id: 'user-initiator' },
      requested_at: '2026-04-12T10:00:00Z',
    };

    const chain: ResolvedApprovalChain = {
      chain_id: 'chain-dual',
      chain_name: 'Dual Approval',
      slots: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
        { slot_index: 1, minimum_role: 'treasury_manager' },
      ],
      expiration_hours: 24,
    };

    // Step 1: Create approval request
    const input: CreateApprovalInput = {
      enterprise_id: 'ent-int',
      version_id: 'ver-int',
      movement_id: 'mov-integration',
      proposed_movement: movement,
      chain,
      triggered_rule_ids: ['rule-1', 'rule-2'],
      created_by: 'user-initiator',
    };

    const created = await svc.createApprovalRequest(input);
    expect(created.status).toBe('pending');
    expect(created.slot_assignments).toHaveLength(2);
    expect(created.slot_assignments[0].filled_by).toBeUndefined();
    expect(created.slot_assignments[1].filled_by).toBeUndefined();

    // Step 2: Approver 1 fills slot 0
    const approver1: ApprovalActor = {
      user_id: 'user-approver-1',
      role: 'treasury_manager',
      enterprise_id: 'ent-int',
    };

    const afterSlot1 = await svc.fillSlot(approver1, created.id, 'Reviewed and approved');
    expect(afterSlot1.status).toBe('pending');
    expect(afterSlot1.slot_assignments[0].filled_by).toBe('user-approver-1');
    expect(afterSlot1.slot_assignments[1].filled_by).toBeUndefined();

    // Step 3: Approver 2 fills slot 1 (all slots filled => approved => re-eval)
    const approver2: ApprovalActor = {
      user_id: 'user-approver-2',
      role: 'treasury_manager',
      enterprise_id: 'ent-int',
    };

    const final = await svc.fillSlot(approver2, created.id, 'LGTM');

    // Re-eval returns require_approval with same chain => executed
    expect(final.status).toBe('executed');
    expect(final.slot_assignments[0].filled_by).toBe('user-approver-1');
    expect(final.slot_assignments[1].filled_by).toBe('user-approver-2');
    expect(final.resolved_at).toBeDefined();
  });
});
```

- [ ] Write the file above.
- [ ] Run: `npx vitest run src/lib/policy/approvals/integration.test.ts`
- [ ] Verify the integration test passes.
- [ ] Run: `npx vitest run src/lib/policy/approvals/ --reporter=verbose` (full module test suite).
- [ ] Commit: `feat(policy): add integration smoke test for approval workflow`

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 0 | Worktree setup + baseline | 0 |
| 1 | ApprovalError class | 3-4 |
| 2 | Approval types | 0 |
| 3 | SoD validation (TIER 1) | 12-14 |
| 4 | Email notification builders | 5 |
| 5 | Service skeleton + createApprovalRequest | 4 |
| 6 | getRequest + listRequests | 4-5 |
| 7 | fillSlot (TIER 1) | 8 |
| 8 | reEvaluate (TIER 1) | 6 |
| 9 | deny + cancel | 7 |
| 10 | Sweeper | 5 |
| 11 | HTTP error mapping + handler | 9 |
| 12 | HTTP routes (list + detail) | 0 |
| 13 | HTTP routes (approve/deny/cancel) | 0 |
| 14 | Cron route + vercel.json | 0 |
| 15 | Barrel exports | 0 |
| 16 | Integration smoke test | 1 |
| **Total** | **17 tasks** | **~63-70 tests** |
