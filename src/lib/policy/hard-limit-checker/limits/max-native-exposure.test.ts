import { describe, it, expect } from 'vitest';
import { checkMaxNativeExposure } from './max-native-exposure';
import { HardLimit } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';

const mkLimit = (asset: 'USDC' | 'USDT' | undefined, value: string): HardLimit => ({
  id: 'hl-1',
  limit_type: 'max_native_exposure',
  name: `${asset ?? 'Unscoped'} Exposure Cap`,
  limit_value: value,
  scope: asset ? { asset } : {},
});

const mkMovement = (
  sourceAsset: 'USDC' | 'USDT',
  destAsset: 'USDC' | 'USDT',
  amount: string,
): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: sourceAsset },
  destination: { venue: 'solana', asset: destAsset },
  amount: { amount, asset: sourceAsset },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: new Date().toISOString(),
});

const mkContext = (positions: Record<string, string>): EvaluationContext => ({
  now: new Date(),
  enterprise_id: 'ent-1',
  policy_version: {
    id: 'v-1',
    enterprise_id: 'ent-1',
    version_number: 1,
    status: 'active',
    name: 'Test',
    rules: [],
    hard_limits: [],
    approval_chains: [],
  },
  treasury_state: {
    positions_by_asset: positions,
    positions_by_asset_venue: {},
    positions_usd_by_asset: {},
    total_treasury_usd: '0',
    cash_equivalent_usd: '0',
    loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '0',
    native_asset: 'USDC',
    canonical_amount: '0',
    canonical_currency: 'USD',
    rate: '1',
    rate_source: 'test',
    rate_as_of: new Date(),
    max_age_ms: 60000,
  },
  aggregates: {
    system_splitting_guard_24h: {
      window_spec_hash: 'sys',
      window_start: new Date(),
      window_end: new Date(),
      sum_amount_usd: '0',
      sum_amount_by_asset: {},
      count: 0,
      distinct_destinations: 0,
      distinct_counterparties: 0,
      included_evaluation_ids: [],
      includes_proposed: false,
    },
    user_specs: {},
  },
  sanctions: { status: 'clear' },
  forecast: {
    query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    results: {},
  },
});

describe('checkMaxNativeExposure', () => {
  it('outflow not breached when post-position is under cap', () => {
    const result = checkMaxNativeExposure(
      mkLimit('USDC', '1000000'),
      mkMovement('USDC', 'USDT', '100000'),
      mkContext({ USDC: '500000' }),
    );
    expect(result.breached).toBe(false);
    expect(result.post_transfer_value).toBe('400000');
  });

  it('inflow breached when post-position exceeds cap', () => {
    const result = checkMaxNativeExposure(
      mkLimit('USDC', '500000'),
      mkMovement('USDT', 'USDC', '300000'),
      mkContext({ USDC: '300000' }),
    );
    expect(result.breached).toBe(true);
    expect(result.post_transfer_value).toBe('600000');
    expect(result.overage).toBe('100000');
  });

  it('movement in unrelated asset is not affected (current=post, not breached)', () => {
    const result = checkMaxNativeExposure(
      mkLimit('USDC', '1000000'),
      mkMovement('USDT', 'USDT', '500000'),
      mkContext({ USDC: '800000' }),
    );
    expect(result.breached).toBe(false);
    expect(result.current_value).toBe('800000');
    expect(result.post_transfer_value).toBe('800000');
  });

  it('venue-to-venue same-asset transfer has net zero change', () => {
    const result = checkMaxNativeExposure(
      mkLimit('USDC', '1000000'),
      mkMovement('USDC', 'USDC', '100000'),
      mkContext({ USDC: '500000' }),
    );
    expect(result.breached).toBe(false);
    expect(result.post_transfer_value).toBe('500000');
  });

  it('returns scope_resolution_failed when limit has no scope.asset', () => {
    const result = checkMaxNativeExposure(
      mkLimit(undefined, '1000000'),
      mkMovement('USDC', 'USDT', '100000'),
      mkContext({ USDC: '500000' }),
    );
    expect(result.failure?.reason_code).toBe('scope_resolution_failed');
  });

  it('returns structured failure when treasury position is malformed', () => {
    const result = checkMaxNativeExposure(
      mkLimit('USDC', '1000000'),
      mkMovement('USDC', 'USDT', '100000'),
      mkContext({ USDC: 'garbage' }),
    );
    expect(result.failure?.reason_code).toBe('treasury_state_unavailable');
  });
});
