import { describe, it, expect } from 'vitest';
import { evalStringCompare } from './string-compare';
import { StringCompareNode } from '../../types/ir';
import { ProposedMovement } from '../../types/movement';

const makeMovement = (overrides: Partial<ProposedMovement> = {}): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'solana', asset: 'USDC' },
  amount: { amount: '50000', asset: 'USDC' },
  counterparty: { id: 'cp-acme', type: 'known' },
  initiator: { type: 'human', user_id: 'user-1' },
  purpose_code: 'payroll',
  rail: 'ethereum',
  requested_at: '2026-04-10T14:22:33.000Z',
  ...overrides,
});

describe('evalStringCompare', () => {
  it('== matches when values are equal', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.counterparty_id',
      op: '==',
      value: 'cp-acme',
    };
    expect(evalStringCompare(node, makeMovement()).matched).toBe(true);
  });

  it('== does not match when values differ', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.counterparty_id',
      op: '==',
      value: 'cp-other',
    };
    expect(evalStringCompare(node, makeMovement()).matched).toBe(false);
  });

  it('!= is the negation of ==', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.initiator_type',
      op: '!=',
      value: 'agent',
    };
    expect(evalStringCompare(node, makeMovement()).matched).toBe(true); // initiator is 'human'
  });

  it('in matches when value is in list', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.rail',
      op: 'in',
      value: ['ethereum', 'solana', 'base'],
    };
    expect(evalStringCompare(node, makeMovement()).matched).toBe(true);
  });

  it('not_in matches when value is not in list', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.purpose_code',
      op: 'not_in',
      value: ['refund', 'chargeback'],
    };
    expect(evalStringCompare(node, makeMovement()).matched).toBe(true); // payroll is not in list
  });

  it('returns matched=false (no failure) when the attribute is absent and op is == (rule did not fire)', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.counterparty_id',
      op: '==',
      value: 'cp-1',
    };
    const result = evalStringCompare(node, makeMovement({ counterparty: undefined }));
    expect(result.matched).toBe(false);
    expect(result.failure).toBeUndefined();
  });

  it('returns structured failure when the attribute is absent and op is != (fail-closed to prevent silent bypass)', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.counterparty_id',
      op: '!=',
      value: 'cp-trusted',
    };
    const result = evalStringCompare(node, makeMovement({ counterparty: undefined }));
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('absent');
  });

  it('returns structured failure when the attribute is absent and op is not_in (fail-closed)', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.purpose_code',
      op: 'not_in',
      value: ['refund', 'chargeback'],
    };
    const result = evalStringCompare(node, makeMovement({ purpose_code: undefined }));
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });

  it('returns matched=false (no failure) when attribute is absent and op is in', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.purpose_code',
      op: 'in',
      value: ['payroll', 'vendor'],
    };
    const result = evalStringCompare(node, makeMovement({ purpose_code: undefined }));
    expect(result.matched).toBe(false);
    expect(result.failure).toBeUndefined();
  });

  it('reads transfer.source_venue from source.venue', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.source_venue',
      op: '==',
      value: 'ethereum',
    };
    expect(evalStringCompare(node, makeMovement()).matched).toBe(true);
  });

  it('reads transfer.destination_venue from destination.venue', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.destination_venue',
      op: '==',
      value: 'solana',
    };
    expect(evalStringCompare(node, makeMovement()).matched).toBe(true);
  });

  // Watch-out tests: malformed rules return structured failure, not silent match
  it('returns failure when == is paired with an array value (malformed rule)', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.purpose_code',
      op: '==',
      // intentional schema bypass — the schema should reject this, but defense in depth
      value: ['payroll'] as unknown as string,
    };
    const result = evalStringCompare(node, makeMovement());
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('malformed');
  });

  it('returns failure when != is paired with an array value (malformed rule)', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.purpose_code',
      op: '!=',
      value: ['refund'] as unknown as string,
    };
    const result = evalStringCompare(node, makeMovement());
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });

  it('returns failure when in is paired with a scalar value (malformed rule)', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.purpose_code',
      op: 'in',
      value: 'payroll' as unknown as string[],
    };
    const result = evalStringCompare(node, makeMovement());
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });

  it('contract: matched=true results have failure undefined', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.counterparty_id',
      op: '==',
      value: 'cp-acme',
    };
    const result = evalStringCompare(node, makeMovement());
    expect(result.matched).toBe(true);
    expect(result.failure).toBeUndefined();
  });
});
