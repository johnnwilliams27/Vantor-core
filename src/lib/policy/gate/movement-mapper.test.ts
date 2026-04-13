// src/lib/policy/gate/movement-mapper.test.ts

import { describe, it, expect } from 'vitest';
import {
  mapTransferToMovement,
  mapYieldDepositToMovement,
  mapYieldWithdrawToMovement,
  mapRampToMovement,
  mapFiatPaymentToMovement,
  mapSwapToMovement,
  mapBridgeToMovement,
  mapScheduledOperationToMovement,
  type TransferMovementInput,
  type MapperContext,
} from './movement-mapper';

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

describe('mapYieldDepositToMovement', () => {
  it('maps wallet→protocol with protocol as destination venue', () => {
    const m = mapYieldDepositToMovement(
      {
        protocol: 'aave_v3',
        token: 'USDC',
        amount: '10000',
        walletAddress: '0xwallet',
        chain: 'ethereum',
        vaultAddress: '0xvault',
      },
      CTX,
    );

    expect(m.kind).toBe('yield_deposit');
    expect(m.source).toEqual({ venue: 'ethereum', asset: 'USDC', address: '0xwallet' });
    expect(m.destination).toEqual({
      venue: 'aave_v3',
      asset: 'USDC',
      address: '0xvault',
      label: 'aave_v3',
    });
    expect(m.amount).toEqual({ amount: '10000', asset: 'USDC' });
    expect(m.metadata).toMatchObject({ enterprise_id: 'ent-1', protocol: 'aave_v3' });
  });

  it('omits destination.address when vaultAddress not provided', () => {
    const m = mapYieldDepositToMovement(
      { protocol: 'morpho_reservoir', token: 'USDT', amount: '500', walletAddress: '0xw', chain: 'ethereum' },
      CTX,
    );
    expect(m.destination.address).toBeUndefined();
  });
});

describe('mapYieldWithdrawToMovement', () => {
  it('maps protocol→wallet with position_id + protocol in metadata', () => {
    const m = mapYieldWithdrawToMovement(
      {
        positionId: 'pos-1',
        protocol: 'aave_v3',
        token: 'USDC',
        amount: '2500',
        walletAddress: '0xwallet',
        chain: 'ethereum',
      },
      CTX,
    );

    expect(m.kind).toBe('yield_withdraw');
    expect(m.source.venue).toBe('aave_v3');
    expect(m.destination).toEqual({ venue: 'ethereum', asset: 'USDC', address: '0xwallet' });
    expect(m.metadata).toMatchObject({
      enterprise_id: 'ent-1',
      protocol: 'aave_v3',
      position_id: 'pos-1',
    });
  });
});

describe('mapRampToMovement', () => {
  it('offramp: source is chain, destination is bank', () => {
    const m = mapRampToMovement(
      {
        direction: 'offramp',
        cryptoToken: 'USDC',
        cryptoAmount: '5000',
        fiatCurrency: 'USD',
        bankAccountId: 'bank-1',
        walletAddress: '0xw',
      },
      CTX,
    );

    expect(m.kind).toBe('fiat_ramp');
    expect(m.source).toMatchObject({ venue: 'ethereum', asset: 'USDC', address: '0xw' });
    expect(m.destination).toEqual({ venue: 'bank', asset: 'USD', account_id: 'bank-1' });
    expect(m.amount).toEqual({ amount: '5000', asset: 'USDC' });
    expect(m.metadata).toMatchObject({
      enterprise_id: 'ent-1',
      direction: 'offramp',
      fiat_currency: 'USD',
    });
  });

  it('onramp: source is bank, destination is chain', () => {
    const m = mapRampToMovement(
      {
        direction: 'onramp',
        cryptoToken: 'USDT',
        cryptoAmount: '2000',
        fiatCurrency: 'USD',
        bankAccountId: 'bank-1',
      },
      CTX,
    );

    expect(m.source).toMatchObject({ venue: 'bank', account_id: 'bank-1' });
    expect(m.destination).toMatchObject({ venue: 'ethereum', asset: 'USDT' });
    expect(m.metadata).toMatchObject({ direction: 'onramp' });
  });

  it('attaches fiat_amount + memo to metadata when provided', () => {
    const m = mapRampToMovement(
      {
        direction: 'offramp',
        cryptoToken: 'USDC',
        cryptoAmount: '1000',
        fiatCurrency: 'EUR',
        fiatAmount: '910.50',
        bankAccountId: 'bank-1',
        memo: 'Q3 payroll',
      },
      CTX,
    );
    expect(m.metadata).toMatchObject({
      fiat_currency: 'EUR',
      fiat_amount: '910.50',
      memo: 'Q3 payroll',
    });
  });
});

describe('mapFiatPaymentToMovement', () => {
  it('maps bank→external-bank with routing + last4 in metadata', () => {
    const m = mapFiatPaymentToMovement(
      {
        fromBankAccountId: 'bank-1',
        toBankName: 'Chase',
        toAccountNumber: '123456789',
        toRoutingNumber: '021000021',
        toAccountHolder: 'ACME Corp',
        amount: '50000',
        currency: 'USD',
      },
      CTX,
    );

    expect(m.kind).toBe('payment');
    expect(m.source).toEqual({ venue: 'bank', asset: 'USD', account_id: 'bank-1' });
    expect(m.destination.venue).toBe('bank');
    expect(m.destination.label).toBe('Chase ****6789');
    expect(m.metadata).toMatchObject({
      enterprise_id: 'ent-1',
      to_bank_name: 'Chase',
      to_routing_number: '021000021',
      to_account_last4: '6789',
    });
  });
});

describe('mapSwapToMovement', () => {
  it('maps same-chain USDC→USDT with both endpoints on the wallet', () => {
    const m = mapSwapToMovement(
      {
        walletAddress: '0xw',
        chain: 'ethereum',
        fromToken: 'USDC',
        toToken: 'USDT',
        fromAmount: '1500',
      },
      CTX,
    );

    expect(m.kind).toBe('swap');
    expect(m.source).toEqual({ venue: 'ethereum', asset: 'USDC', address: '0xw' });
    expect(m.destination).toEqual({ venue: 'ethereum', asset: 'USDT', address: '0xw' });
    expect(m.amount).toEqual({ amount: '1500', asset: 'USDC' });
    expect(m.metadata).toMatchObject({ from_token: 'USDC', to_token: 'USDT' });
  });
});

describe('mapBridgeToMovement', () => {
  it('maps ethereum→solana with chains captured on endpoints + metadata', () => {
    const m = mapBridgeToMovement(
      {
        fromWalletAddress: '0xeth',
        toWalletAddress: 'Sol123',
        fromChain: 'ethereum',
        toChain: 'solana',
        token: 'USDC',
        amount: '7500',
      },
      CTX,
    );

    expect(m.kind).toBe('bridge');
    expect(m.source.venue).toBe('ethereum');
    expect(m.destination.venue).toBe('solana');
    expect(m.metadata).toMatchObject({ from_chain: 'ethereum', to_chain: 'solana' });
  });
});

describe('mapScheduledOperationToMovement', () => {
  it('wraps an inner movement, switches initiator to schedule, carries scheduled_op_id', () => {
    const inner = mapRampToMovement(
      {
        direction: 'offramp',
        cryptoToken: 'USDC',
        cryptoAmount: '1000',
        fiatCurrency: 'USD',
        bankAccountId: 'bank-1',
      },
      CTX,
    );

    const m = mapScheduledOperationToMovement(
      { scheduledOpId: 'sop-42', type: 'ramp', inner },
      CTX,
    );

    expect(m.kind).toBe('fiat_ramp'); // inherited
    expect(m.initiator).toEqual({ type: 'schedule', scheduled_op_id: 'sop-42' });
    expect(m.id).not.toBe(inner.id); // fresh UUID
    expect(m.metadata).toMatchObject({
      enterprise_id: 'ent-1',
      scheduled_op_id: 'sop-42',
      scheduled_op_type: 'ramp',
      direction: 'offramp',
    });
  });
});
