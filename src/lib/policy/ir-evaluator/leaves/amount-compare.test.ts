import { describe, it, expect } from 'vitest';
import { evalAmountCompare, LeafResult } from './amount-compare';
import { AmountCompareNode } from '../../types/ir';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';

const makeMovement = (overrides: Partial<ProposedMovement> = {}): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'solana', asset: 'USDC' },
  amount: { amount: '50000', asset: 'USDC' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: '2026-04-10T14:22:33.000Z',
  ...overrides,
});

const makeContext = (overrides: Partial<EvaluationContext> = {}): EvaluationContext => ({
  now: new Date('2026-04-10T14:22:33.000Z'),
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
    positions_by_asset: { USDC: '1000000', USDT: '500000' },
    positions_by_asset_venue: { 'USDC:ethereum': '800000', 'USDC:solana': '200000' },
    positions_usd_by_asset: { USDC: '1000000', USDT: '500000' },
    total_treasury_usd: '1500000',
    cash_equivalent_usd: '1500000',
    loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '50000',
    native_asset: 'USDC',
    canonical_amount: '50010', // 50000 * 1.0002
    canonical_currency: 'USD',
    rate: '1.0002',
    rate_source: 'coingecko',
    rate_as_of: new Date(),
    max_age_ms: 60_000,
  },
  aggregates: {
    system_splitting_guard_24h: {
      window_spec_hash: 'sys-24h',
      window_start: new Date('2026-04-09T14:22:33.000Z'),
      window_end: new Date('2026-04-10T14:22:33.000Z'),
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
    query_metadata: {
      mode: 'stub',
      snapshot_taken_at: new Date(),
      source: 'stub-pass-through',
      warnings: [],
    },
    hypothetical_metadata: {
      mode: 'stub',
      snapshot_taken_at: new Date(),
      source: 'stub-pass-through',
      warnings: [],
    },
    results: {},
  },
  ...overrides,
});

describe('evalAmountCompare — transfer.amount, direct comparison', () => {
  it('returns matched=true when native amount exceeds native-currency threshold', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '10000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(true);
    expect(result.via).toBe('direct');
    expect(result.failure).toBeUndefined();
  });

  it('returns matched=false when native amount is below native-currency threshold', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '100000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(false);
  });
});

describe('evalAmountCompare — transfer.amount, canonicalized comparison', () => {
  it('uses canonical_amount when rule currency is USD and transfer asset is USDC', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '50000', currency: 'USD' }, // 50000 USD threshold
    };
    // Context has canonical_amount = 50010 (50000 USDC * 1.0002 rate)
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(true); // 50010 > 50000
  });

  it('returns failure when canonicalization failed', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '50000', currency: 'USD' },
    };
    const ctx = makeContext({
      canonicalization: {
        native_amount: '50000',
        native_asset: 'USDC',
        canonical_amount: '',
        canonical_currency: 'USD',
        rate: '',
        rate_source: '',
        rate_as_of: new Date(0),
        max_age_ms: 0,
        failure: {
          reason_code: 'canonicalization_failed',
          human_readable: 'Rate unavailable',
          details: {},
          user_action: 'Retry',
        },
      },
    });
    const result = evalAmountCompare(node, makeMovement(), ctx);
    expect(result.matched).toBe(false);
    expect(result.failure).toBeDefined();
    expect(result.failure?.reason_code).toBe('canonicalization_failed');
  });
});

describe('evalAmountCompare — splitting guard', () => {
  it('matches when 24h rolling sum exceeds threshold even if direct does not', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '50000', currency: 'USD' },
    };
    // Movement is only 5000 USDC (~5000 USD), direct comparison fails.
    // But 24h rolling sum is 47000 USD — add proposed 5000 = 52000, which exceeds.
    const movement = makeMovement({ amount: { amount: '5000', asset: 'USDC' } });
    const ctx = makeContext({
      canonicalization: {
        native_amount: '5000',
        native_asset: 'USDC',
        canonical_amount: '5001', // 5000 * 1.0002
        canonical_currency: 'USD',
        rate: '1.0002',
        rate_source: 'coingecko',
        rate_as_of: new Date(),
        max_age_ms: 60_000,
      },
      aggregates: {
        system_splitting_guard_24h: {
          window_spec_hash: 'sys-24h',
          window_start: new Date('2026-04-09T14:22:33.000Z'),
          window_end: new Date('2026-04-10T14:22:33.000Z'),
          sum_amount_usd: '47000',
          sum_amount_by_asset: {},
          count: 9,
          distinct_destinations: 1,
          distinct_counterparties: 1,
          included_evaluation_ids: [],
          includes_proposed: false,
        },
        user_specs: {},
      },
    });
    const result = evalAmountCompare(node, movement, ctx);
    expect(result.matched).toBe(true);
    expect(result.via).toBe('splitting');
    expect(result.splitting_note).toContain('24-hour');
  });

  it('does not apply splitting guard when attr is not transfer.amount', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'treasury.position',
      scope: { asset: 'USDC' },
      op: '>',
      value: { amount: '2000000', currency: 'USDC' },
    };
    // Position is 1M USDC, threshold is 2M — no match, no splitting involved
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(false);
  });

  it('splitting guard fail-closed when system_splitting_guard_24h.failure is set', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '100000', currency: 'USD' },
    };
    const ctx = makeContext({
      aggregates: {
        system_splitting_guard_24h: {
          window_spec_hash: 'sys-24h',
          window_start: new Date('2026-04-09T14:22:33.000Z'),
          window_end: new Date('2026-04-10T14:22:33.000Z'),
          sum_amount_usd: '',
          sum_amount_by_asset: {},
          count: 0,
          distinct_destinations: 0,
          distinct_counterparties: 0,
          included_evaluation_ids: [],
          includes_proposed: false,
          failure: {
            reason_code: 'aggregate_query_failed',
            human_readable: 'Could not load 24h aggregate window',
            details: {},
          },
        },
        user_specs: {},
      },
    });
    const result = evalAmountCompare(node, makeMovement(), ctx);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('aggregate_query_failed');
  });

  it('non-USD transfer with empty canonical_amount and no failure flag now fails closed', () => {
    // CRITICAL 2 regression guard: the previous behavior was to silently
    // return matched:false with splitting_check:'skipped_no_canonical'
    // (a fail-open). New behavior: non-USD transfer + empty canonical +
    // no canonicalization.failure is treated as a canonicalizer bug and
    // surfaces a structured condition_node_evaluation_failed.
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '100000', currency: 'USD' },
    };
    const ctx = makeContext({
      canonicalization: {
        native_amount: '50000',
        native_asset: 'USDC',
        canonical_amount: '', // no canonical result
        canonical_currency: 'USD',
        rate: '',
        rate_source: '',
        rate_as_of: new Date(0),
        max_age_ms: 0,
        // no `failure` field — just no canonical
      },
    });
    const result = evalAmountCompare(node, makeMovement(), ctx);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.evaluation_details.splitting_check).toBe('failed_no_canonical');
  });

  it('splitting guard does not apply to non-USD rules (phase-1 limitation)', () => {
    // A USDC-denominated rule whose threshold WOULD be breached by a splitting
    // attack if the 24h aggregate were compared — but because the aggregate is
    // stored in USD and the rule currency is USDC, phase 1 skips the splitting
    // check. This locks in the current behavior.
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '50000', currency: 'USDC' },
    };
    const movement = makeMovement({ amount: { amount: '5000', asset: 'USDC' } });
    const ctx = makeContext({
      canonicalization: {
        native_amount: '5000',
        native_asset: 'USDC',
        canonical_amount: '5001',
        canonical_currency: 'USD',
        rate: '1.0002',
        rate_source: 'coingecko',
        rate_as_of: new Date(),
        max_age_ms: 60_000,
      },
      aggregates: {
        system_splitting_guard_24h: {
          window_spec_hash: 'sys-24h',
          window_start: new Date('2026-04-09T14:22:33.000Z'),
          window_end: new Date('2026-04-10T14:22:33.000Z'),
          sum_amount_usd: '47000', // would breach 50k USD, but rule is in USDC
          sum_amount_by_asset: {},
          count: 9,
          distinct_destinations: 1,
          distinct_counterparties: 1,
          included_evaluation_ids: [],
          includes_proposed: false,
        },
        user_specs: {},
      },
    });
    const result = evalAmountCompare(node, movement, ctx);
    expect(result.matched).toBe(false);
    expect(result.via).toBe('direct');
    expect(result.failure).toBeUndefined();
  });
});

describe('evalAmountCompare — treasury.position', () => {
  it('reads the per-asset native position from treasury state', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'treasury.position',
      scope: { asset: 'USDC' },
      op: '>',
      value: { amount: '500000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(true); // 1M > 500k
  });

  it('requires scope.asset for treasury.position', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'treasury.position',
      op: '>',
      value: { amount: '500000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });
});

describe('evalAmountCompare — treasury.post_position', () => {
  it('decreases position by movement amount on outflow of scoped asset', () => {
    // Source asset = USDC (outflow), destination asset = USDT (so only outflow side matches).
    // Current position = 1,000,000 USDC. Movement amount = 50,000. Post = 950,000.
    // Threshold 900,000 — should match (>).
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'treasury.post_position',
      scope: { asset: 'USDC' },
      op: '>',
      value: { amount: '900000', currency: 'USDC' },
    };
    const movement = makeMovement({
      source: { venue: 'ethereum', asset: 'USDC' },
      destination: { venue: 'mercury', asset: 'USDT' },
      amount: { amount: '50000', asset: 'USDC' },
    });
    const result = evalAmountCompare(node, movement, makeContext());
    expect(result.matched).toBe(true); // 950000 > 900000
    expect(result.evaluation_details.position_value).toBe('950000');
  });

  it('leaves position unchanged when scoped asset is neither source nor destination', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'treasury.post_position',
      scope: { asset: 'USDT' },
      op: '>',
      value: { amount: '400000', currency: 'USDT' },
    };
    const movement = makeMovement({
      source: { venue: 'ethereum', asset: 'USDC' },
      destination: { venue: 'solana', asset: 'USDC' },
      amount: { amount: '50000', asset: 'USDC' },
    });
    const result = evalAmountCompare(node, movement, makeContext());
    expect(result.matched).toBe(true); // 500000 > 400000, unchanged
    expect(result.evaluation_details.position_value).toBe('500000');
  });
});

describe('evalAmountCompare — rolling_sum attribute', () => {
  it('always returns a condition_node_evaluation_failed failure', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'rolling_sum',
      op: '>',
      value: { amount: '10000', currency: 'USD' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });
});

describe('evalAmountCompare — between operator', () => {
  it('matches when value falls within [value, value_upper]', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: 'between',
      value: { amount: '10000', currency: 'USDC' },
      value_upper: { amount: '100000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(true); // 50000 between 10k and 100k
  });

  it('does not match when value is outside the range', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: 'between',
      value: { amount: '60000', currency: 'USDC' },
      value_upper: { amount: '100000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(false);
  });

  it('returns false (not throws) when between is missing value_upper', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: 'between',
      value: { amount: '10000', currency: 'USDC' },
      // value_upper intentionally omitted
    };
    let threw = false;
    let result: LeafResult | undefined;
    try {
      result = evalAmountCompare(node, makeMovement(), makeContext());
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result?.matched).toBe(false);
  });
});

describe('evalAmountCompare — malformed numeric input', () => {
  // Shared helper: build a treasury.position context with a hostile
  // positions_by_asset[USDC] value and assert the leaf returns a
  // structured cannot-evaluate failure (NOT a silent matched:false,
  // which would fail-open a min-reserve rule).
  const assertMalformedPositionFailsClosed = (
    raw: string,
    label: string
  ) => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'treasury.position',
      scope: { asset: 'USDC' },
      op: '<',
      // Min-reserve floor: "block if position < 100k USDC".
      // If position value is garbage, this rule MUST NOT silently
      // return matched:false — that would let the transfer through.
      value: { amount: '100000', currency: 'USDC' },
    };
    const ctx = makeContext({
      treasury_state: {
        positions_by_asset: { USDC: raw as string, USDT: '500000' },
        positions_by_asset_venue: {},
        positions_usd_by_asset: { USDC: '0', USDT: '500000' },
        total_treasury_usd: '500000',
        cash_equivalent_usd: '500000',
        loaded_at: new Date(),
      },
    });

    let threw = false;
    let result: LeafResult | undefined;
    try {
      result = evalAmountCompare(node, makeMovement(), ctx);
    } catch {
      threw = true;
    }
    expect(threw, `threw for ${label}`).toBe(false);
    expect(result?.matched, `matched for ${label}`).toBe(false);
    expect(
      result?.failure?.reason_code,
      `failure reason_code for ${label}`
    ).toBe('condition_node_evaluation_failed');
    expect(
      (result?.failure?.details as { position_value_raw?: string } | undefined)
        ?.position_value_raw,
      `position_value_raw for ${label}`
    ).toBe(raw);
  };

  it('returns structured failure (not silent false) for "garbage"', () => {
    assertMalformedPositionFailsClosed('garbage', 'garbage');
  });

  it('returns structured failure for "NaN"', () => {
    assertMalformedPositionFailsClosed('NaN', 'NaN');
  });

  it('returns structured failure for empty string ""', () => {
    assertMalformedPositionFailsClosed('', 'empty string');
  });

  it('returns structured failure for comma-formatted "1,000"', () => {
    assertMalformedPositionFailsClosed('1,000', 'comma-formatted');
  });

  it('returns structured failure for semver-like "1.2.3"', () => {
    assertMalformedPositionFailsClosed('1.2.3', 'semver-like');
  });

  it('returns structured failure for negative "-100"', () => {
    // Treasury positions are non-negative by construction.
    assertMalformedPositionFailsClosed('-100', 'negative');
  });

  it('treats a missing asset key as a valid zero position (not a failure)', () => {
    // The upstream `?? '0'` fallback converts a missing key to '0',
    // which IS a valid non-negative decimal. A missing position
    // legitimately means zero — only genuinely malformed values
    // should fail-closed.
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'treasury.position',
      scope: { asset: 'USDC' },
      op: '<',
      value: { amount: '100000', currency: 'USDC' },
    };
    const ctx = makeContext({
      treasury_state: {
        // USDC key intentionally missing
        positions_by_asset: { USDT: '500000' },
        positions_by_asset_venue: {},
        positions_usd_by_asset: { USDT: '500000' },
        total_treasury_usd: '500000',
        cash_equivalent_usd: '500000',
        loaded_at: new Date(),
      },
    });
    const result = evalAmountCompare(node, makeMovement(), ctx);
    expect(result.failure).toBeUndefined();
    // 0 < 100000 — matches the min-reserve floor
    expect(result.matched).toBe(true);
  });
});

describe('evalAmountCompare — USD-native splitting guard', () => {
  // A USD-native transfer (source.asset=USD, dest.asset=USD, amount.asset=USD)
  // with an empty canonical_amount must still be caught by the splitting
  // guard. Previously the splitting branch required a populated
  // ctx.canonicalization.canonical_amount and silently returned
  // skipped_no_canonical for USD-native transfers — a fail-open for
  // genuine USD→USD structuring attacks.

  const makeUsdNativeMovement = (amount: string): ProposedMovement => ({
    id: 'mv-usd-1',
    kind: 'crypto_transfer',
    source: { venue: 'svb', asset: 'USD' },
    destination: { venue: 'mercury', asset: 'USD' },
    amount: { amount, asset: 'USD' },
    initiator: { type: 'human', user_id: 'user-1' },
    requested_at: '2026-04-10T14:22:33.000Z',
  });

  const emptyCanonicalCtx = (overrides: Partial<EvaluationContext> = {}) =>
    makeContext({
      canonicalization: {
        native_amount: '',
        native_asset: 'USD',
        canonical_amount: '', // USD is identity; upstream may leave this empty
        canonical_currency: 'USD',
        rate: '',
        rate_source: '',
        rate_as_of: new Date(0),
        max_age_ms: 0,
        // no `failure` field set
      },
      ...overrides,
    });

  it('(a) USD-native splitting fires even when canonical_amount is empty', () => {
    // Rule: block when transfer.amount > 50000 USD
    // Direct: 5000 < 50000 (fails)
    // Splitting: 47000 rolling + 5000 proposed = 52000 > 50000 (fires)
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '50000', currency: 'USD' },
    };
    const movement = makeUsdNativeMovement('5000');
    const ctx = emptyCanonicalCtx({
      aggregates: {
        system_splitting_guard_24h: {
          window_spec_hash: 'sys-24h',
          window_start: new Date('2026-04-09T14:22:33.000Z'),
          window_end: new Date('2026-04-10T14:22:33.000Z'),
          sum_amount_usd: '47000',
          sum_amount_by_asset: {},
          count: 9,
          distinct_destinations: 1,
          distinct_counterparties: 1,
          included_evaluation_ids: [],
          includes_proposed: false,
        },
        user_specs: {},
      },
    });
    const result = evalAmountCompare(node, movement, ctx);
    expect(result.failure).toBeUndefined();
    expect(result.matched).toBe(true);
    expect(result.via).toBe('splitting');
  });

  it('(b) USD-native splitting catches structuring with realistic values', () => {
    // Rolling 48500 + proposed 2000 = 50500, threshold > 50000 — fires.
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '50000', currency: 'USD' },
    };
    const movement = makeUsdNativeMovement('2000');
    const ctx = emptyCanonicalCtx({
      aggregates: {
        system_splitting_guard_24h: {
          window_spec_hash: 'sys-24h',
          window_start: new Date('2026-04-09T14:22:33.000Z'),
          window_end: new Date('2026-04-10T14:22:33.000Z'),
          sum_amount_usd: '48500',
          sum_amount_by_asset: {},
          count: 10,
          distinct_destinations: 1,
          distinct_counterparties: 1,
          included_evaluation_ids: [],
          includes_proposed: false,
        },
        user_specs: {},
      },
    });
    const result = evalAmountCompare(node, movement, ctx);
    expect(result.matched).toBe(true);
    expect(result.via).toBe('splitting');
    expect(result.evaluation_details.rolling_with_proposed).toBe('50500');
  });

  it('(c) non-USD transfer with missing canonical and no failure flag returns structured failure', () => {
    // Defense in depth: non-USD transfer, empty canonical_amount, no
    // canonicalization.failure set. Previous behavior: silent
    // skipped_no_canonical (fail-open). New behavior: structured
    // condition_node_evaluation_failed.
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '100000', currency: 'USD' },
    };
    const movement = makeMovement({ amount: { amount: '5000', asset: 'USDC' } });
    const ctx = makeContext({
      canonicalization: {
        native_amount: '5000',
        native_asset: 'USDC',
        canonical_amount: '', // empty — canonicalizer bug
        canonical_currency: 'USD',
        rate: '',
        rate_source: '',
        rate_as_of: new Date(0),
        max_age_ms: 0,
        // no `failure` field set
      },
    });
    const result = evalAmountCompare(node, movement, ctx);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.evaluation_details.splitting_check).toBe('failed_no_canonical');
  });
});

describe('evalAmountCompare — between + splitting guard', () => {
  it('skips the splitting check for between op (semantic mismatch)', () => {
    // `between 10000 and 50000 USD` with a 60000 rolling sum. Direct
    // comparison on 50010 (canonical of 50000 USDC) falls OUTSIDE the
    // range (50010 > 50000). The splitting guard has no meaningful
    // mapping for range comparisons, so it must be skipped.
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: 'between',
      value: { amount: '10000', currency: 'USD' },
      value_upper: { amount: '50000', currency: 'USD' },
    };
    const movement = makeMovement({ amount: { amount: '50000', asset: 'USDC' } });
    const ctx = makeContext({
      aggregates: {
        system_splitting_guard_24h: {
          window_spec_hash: 'sys-24h',
          window_start: new Date('2026-04-09T14:22:33.000Z'),
          window_end: new Date('2026-04-10T14:22:33.000Z'),
          sum_amount_usd: '60000', // high rolling sum
          sum_amount_by_asset: {},
          count: 12,
          distinct_destinations: 1,
          distinct_counterparties: 1,
          included_evaluation_ids: [],
          includes_proposed: false,
        },
        user_specs: {},
      },
    });
    const result = evalAmountCompare(node, movement, ctx);
    expect(result.matched).toBe(false);
    expect(result.failure).toBeUndefined();
    expect(result.evaluation_details.splitting_check).toBe('skipped_op_between');
  });
});

describe('evalAmountCompare — treasury.position scope.venue rejection', () => {
  it('returns structured failure when scope.venue is set (phase-1 limitation)', () => {
    // Authoring "USDC position on ethereum < 100k" must NOT silently
    // return the aggregate USDC position — it must reject the rule
    // until phase-2 venue-scoped position support lands.
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'treasury.position',
      scope: { asset: 'USDC', venue: 'ethereum' },
      op: '<',
      value: { amount: '100000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(
      (result.failure?.details as { venue?: string } | undefined)?.venue
    ).toBe('ethereum');
  });

  it('returns structured failure for treasury.post_position + scope.venue', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'treasury.post_position',
      scope: { asset: 'USDC', venue: 'solana' },
      op: '>',
      value: { amount: '100000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });
});

describe('evalAmountCompare — contract: matched:true implies failure:undefined', () => {
  it('happy path returns failure:undefined', () => {
    // Lock in the contract invariant. Any matched:true result MUST NOT
    // carry a failure. This prevents a whole class of bugs where
    // downstream readers see matched:true and skip the failure check.
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '10000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(true);
    expect(result.failure).toBeUndefined();
  });
});
