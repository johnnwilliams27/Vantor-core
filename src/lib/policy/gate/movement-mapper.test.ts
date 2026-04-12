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

  it('stashes enterprise_id in metadata and attaches memo when provided', () => {
    const movement = mapTransferToMovement({ ...INPUT, memo: 'Q2 vendor payment' }, CTX);
    expect(movement.metadata).toEqual({
      enterprise_id: 'ent-1',
      memo: 'Q2 vendor payment',
    });
  });

  it('omits memo from metadata when not provided, keeps enterprise_id', () => {
    const movement = mapTransferToMovement(INPUT, CTX);
    expect(movement.metadata).toEqual({ enterprise_id: 'ent-1' });
  });

  it('attaches counterparty when counterpartyId is provided', () => {
    const movement = mapTransferToMovement({ ...INPUT, counterpartyId: 'cp-1' }, CTX);
    expect(movement.counterparty).toEqual({ id: 'cp-1', type: 'known' });
  });
});
