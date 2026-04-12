// src/lib/policy/authoring/satisfiability.test.ts

import { describe, it, expect } from 'vitest';
import {
  checkChainSatisfiability,
  type SatisfiabilityUserRow,
} from './satisfiability';
import type { ApprovalChain } from '../types/policy-version';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChain(
  slots: Array<{ slot_index: number; minimum_role: string }>,
  overrides: Partial<ApprovalChain> = {},
): ApprovalChain {
  return {
    id: 'chain-1',
    version_id: 'v1',
    name: 'Test Chain',
    slots: slots as ApprovalChain['slots'],
    priority: 0,
    expiration_hours: 24,
    created_by: 'user-0',
    created_at: new Date(),
    ...overrides,
  };
}

function users(...pairs: Array<[string, SatisfiabilityUserRow['role']]>): SatisfiabilityUserRow[] {
  return pairs.map(([user_id, role]) => ({ user_id, role }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkChainSatisfiability', () => {
  it('returns satisfiable when one slot needs treasury_manager and one TM user exists', () => {
    const chain = makeChain([{ slot_index: 0, minimum_role: 'treasury_manager' }]);
    const pool = users(['u1', 'treasury_manager']);
    const result = checkChainSatisfiability(chain, pool);
    expect(result.satisfiable).toBe(true);
    expect(result.unsatisfied_slots).toBeUndefined();
  });

  it('returns unsatisfiable when slot needs treasury_manager but only auditor users exist', () => {
    const chain = makeChain([{ slot_index: 0, minimum_role: 'treasury_manager' }]);
    const pool = users(['u1', 'auditor'], ['u2', 'auditor']);
    const result = checkChainSatisfiability(chain, pool);
    expect(result.satisfiable).toBe(false);
    expect(result.unsatisfied_slots).toContain(0);
  });

  it('returns unsatisfiable when 2 slots need treasury_manager but only 1 TM user exists', () => {
    const chain = makeChain([
      { slot_index: 0, minimum_role: 'treasury_manager' },
      { slot_index: 1, minimum_role: 'treasury_manager' },
    ]);
    const pool = users(['u1', 'treasury_manager']);
    const result = checkChainSatisfiability(chain, pool);
    expect(result.satisfiable).toBe(false);
    // One slot should be unsatisfied (the second one after the first is consumed)
    expect(result.unsatisfied_slots).toHaveLength(1);
  });

  it('allows a higher-role user to fill a lower-role slot', () => {
    // slot requires accountant, user is treasury_manager (rank 2 >= 1)
    const chain = makeChain([{ slot_index: 0, minimum_role: 'accountant' }]);
    const pool = users(['u1', 'treasury_manager']);
    const result = checkChainSatisfiability(chain, pool);
    expect(result.satisfiable).toBe(true);
  });

  it('higher-role user fills multiple lower-role slots correctly when count matches', () => {
    const chain = makeChain([
      { slot_index: 0, minimum_role: 'auditor' },
      { slot_index: 1, minimum_role: 'accountant' },
    ]);
    // One accountant satisfies auditor slot, one TM satisfies accountant slot
    const pool = users(['u1', 'accountant'], ['u2', 'treasury_manager']);
    const result = checkChainSatisfiability(chain, pool);
    expect(result.satisfiable).toBe(true);
  });

  it('returns unsatisfiable for unknown/Plan-2b role (executive) with current user base', () => {
    const chain = makeChain([{ slot_index: 0, minimum_role: 'executive' }]);
    // Even with a treasury_manager, executive (rank 4) > treasury_manager (rank 2)
    const pool = users(['u1', 'treasury_manager']);
    const result = checkChainSatisfiability(chain, pool);
    expect(result.satisfiable).toBe(false);
    expect(result.unsatisfied_slots).toContain(0);
  });

  it('returns unsatisfiable for a truly unknown role string', () => {
    const chain = makeChain([{ slot_index: 0, minimum_role: 'super_admin' }]);
    const pool = users(['u1', 'treasury_manager'], ['u2', 'accountant']);
    const result = checkChainSatisfiability(chain, pool);
    expect(result.satisfiable).toBe(false);
    expect(result.unsatisfied_slots).toContain(0);
  });

  it('returns unsatisfiable with empty slots array', () => {
    const chain = makeChain([]);
    const pool = users(['u1', 'treasury_manager']);
    const result = checkChainSatisfiability(chain, pool);
    expect(result.satisfiable).toBe(false);
    expect(result.unsatisfied_slots).toEqual([]);
  });

  it('returns unsatisfiable when user pool is empty', () => {
    const chain = makeChain([{ slot_index: 0, minimum_role: 'auditor' }]);
    const result = checkChainSatisfiability(chain, []);
    expect(result.satisfiable).toBe(false);
    expect(result.unsatisfied_slots).toContain(0);
  });

  it('result includes chain_id and chain_name', () => {
    const chain = makeChain(
      [{ slot_index: 0, minimum_role: 'auditor' }],
      { id: 'chain-abc', name: 'My Chain' },
    );
    const pool = users(['u1', 'auditor']);
    const result = checkChainSatisfiability(chain, pool);
    expect(result.chain_id).toBe('chain-abc');
    expect(result.chain_name).toBe('My Chain');
  });
});
