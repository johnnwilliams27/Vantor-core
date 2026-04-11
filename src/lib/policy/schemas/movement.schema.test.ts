import { describe, it, expect } from 'vitest';
import { proposedMovementSchema } from './movement.schema';

describe('proposedMovementSchema', () => {
  const validMovement = {
    id: 'mv-abc123',
    kind: 'crypto_transfer' as const,
    source: { venue: 'ethereum', asset: 'USDC', address: '0xdeadbeef' },
    destination: { venue: 'solana', asset: 'USDC', address: 'So1ana...' },
    amount: { amount: '50000', asset: 'USDC' },
    initiator: { type: 'human' as const, user_id: 'user-1' },
    requested_at: '2026-04-10T14:22:33.000Z',
  };

  it('accepts a minimal valid movement', () => {
    const result = proposedMovementSchema.safeParse(validMovement);
    expect(result.success).toBe(true);
  });

  it('accepts a movement with optional fields', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      counterparty: { id: 'cp-1', type: 'known', jurisdiction: 'US' },
      purpose_code: 'payroll',
      rail: 'ethereum',
      metadata: { tag: 'test' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a movement with missing required fields', () => {
    const { id, ...withoutId } = validMovement;
    const result = proposedMovementSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it('rejects a movement with invalid kind', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      kind: 'bogus_kind',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a movement where initiator.type=human but no user_id', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      initiator: { type: 'human' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a movement where initiator.type=ai_recommendation but no recommendation_id', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      initiator: { type: 'ai_recommendation' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a movement with a non-decimal amount string', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      amount: { amount: 'not-a-number', asset: 'USDC' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a movement with a zero amount (permitted for some flows)', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      amount: { amount: '0', asset: 'USDC' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a movement with a negative amount', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      amount: { amount: '-100', asset: 'USDC' },
    });
    expect(result.success).toBe(false);
  });

  // ─── C2 regression guard ─────────────────────────────────────────────
  it('rejects a movement where initiator.type=ai_recommendation has a leaked user_id (C2 regression)', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      initiator: {
        type: 'ai_recommendation',
        recommendation_id: 'rec-1',
        user_id: 'hijack',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a movement where initiator.type=human has a leaked agent_id (C2 regression)', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      initiator: {
        type: 'human',
        user_id: 'user-1',
        agent_id: 'hijack',
      },
    });
    expect(result.success).toBe(false);
  });

  // ─── Symmetry: missing-identity cases for the two other initiator types ─
  it('rejects a movement where initiator.type=agent but no agent_id', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      initiator: { type: 'agent' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a movement where initiator.type=schedule but no scheduled_op_id', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      initiator: { type: 'schedule' },
    });
    expect(result.success).toBe(false);
  });

  // ─── Asset code is now closed ────────────────────────────────────────
  it('rejects a movement with an unknown asset code', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      amount: { amount: '100', asset: 'BOGUS' },
    });
    expect(result.success).toBe(false);
  });
});
