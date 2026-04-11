// src/lib/policy/__fixtures__/movements.ts

import { ProposedMovement } from '../types/movement';

export function humanUsdcTransfer(overrides: Partial<ProposedMovement> = {}): ProposedMovement {
  return {
    id: 'mv-fixture-human-usdc',
    kind: 'crypto_transfer',
    source: { venue: 'ethereum', asset: 'USDC', address: '0xsource' },
    destination: { venue: 'external', asset: 'USDC', address: '0xdest' },
    amount: { amount: '10000', asset: 'USDC' },
    counterparty: { id: 'cp-acme', type: 'known', jurisdiction: 'US' },
    initiator: { type: 'human', user_id: 'user-1' },
    purpose_code: 'payroll',
    rail: 'ethereum',
    requested_at: '2026-04-10T14:22:33.000Z',
    ...overrides,
  };
}

export function aiRecommendedRebalance(
  overrides: Partial<ProposedMovement> = {},
): ProposedMovement {
  return {
    id: 'mv-fixture-ai-rebalance',
    kind: 'swap',
    source: { venue: 'ethereum', asset: 'USDC', address: '0xtreasury' },
    destination: { venue: 'ethereum', asset: 'USDT', address: '0xtreasury' },
    amount: { amount: '100000', asset: 'USDC' },
    initiator: { type: 'ai_recommendation', recommendation_id: 'rec-fixture-1' },
    rail: 'ethereum',
    requested_at: '2026-04-10T14:22:33.000Z',
    ...overrides,
  };
}

export function scheduledYieldDeposit(
  overrides: Partial<ProposedMovement> = {},
): ProposedMovement {
  return {
    id: 'mv-fixture-scheduled-yield',
    kind: 'yield_deposit',
    source: { venue: 'ethereum', asset: 'USDC', address: '0xtreasury' },
    destination: { venue: 'ondo', asset: 'USDC' },
    amount: { amount: '250000', asset: 'USDC' },
    initiator: { type: 'schedule', scheduled_op_id: 'op-fixture-1' },
    rail: 'ethereum',
    requested_at: '2026-04-10T14:22:33.000Z',
    ...overrides,
  };
}

export function largeHumanWire(overrides: Partial<ProposedMovement> = {}): ProposedMovement {
  return {
    id: 'mv-fixture-large-wire',
    kind: 'fiat_ramp',
    source: { venue: 'svb', asset: 'USD', account_id: 'acct-operating' },
    destination: { venue: 'external-bank', asset: 'USD', account_id: 'acct-vendor' },
    amount: { amount: '500000', asset: 'USD' },
    counterparty: { id: 'cp-vendor-1', type: 'known' },
    initiator: { type: 'human', user_id: 'user-1' },
    purpose_code: 'acquisition',
    rail: 'wire',
    requested_at: '2026-04-10T14:22:33.000Z',
    ...overrides,
  };
}
