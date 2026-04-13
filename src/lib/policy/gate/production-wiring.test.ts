import { describe, it, expect, vi } from 'vitest';
import { buildRunAggregateQuery } from './production-wiring';
import type { ProposedMovement } from '../types/movement';
import type { AggregateQueryParams } from '../aggregate-detector/queries';
import type { WindowSpec } from '../types/ir';

// buildRunAggregateQuery is the adapter that replaced the hardcoded
// { sum: 0, count: 0 } aggregate stub. Tests exercise it directly rather
// than routing through AggregationDetector, which would require mocking
// a full PolicyVersionSnapshot with aggregate_window conditions.

function mkMovement(overrides: Partial<ProposedMovement> = {}): ProposedMovement {
  return {
    id: 'mv_1',
    kind: 'crypto_transfer',
    amount: { asset: 'USDC', amount: '1000', amount_usd: '1000' },
    source: { venue: 'wallet_1', account_id: null, address: '0xsrc' },
    destination: { venue: 'wallet_2', account_id: null, address: '0xdest' },
    initiator: { type: 'human', user_id: 'u_1' },
    counterparty: { id: 'cp_1', label: 'Counterparty 1' },
    metadata: { enterprise_id: 'ent_1' },
    ...overrides,
  } as unknown as ProposedMovement;
}

function mkParams(overrides: Partial<AggregateQueryParams> = {}): AggregateQueryParams {
  const baseSpec: WindowSpec = {
    duration_ms: 30 * 24 * 60 * 60 * 1000,
    group_by: {},
    direction: 'outflow',
  };
  return {
    enterpriseId: 'ent_1',
    window: baseSpec,
    movement: mkMovement(),
    windowStart: new Date('2026-03-14T00:00:00Z'),
    windowEnd: new Date('2026-04-13T00:00:00Z'),
    ...overrides,
  };
}

function mockSupabase(
  rpcImpl: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>,
) {
  return {
    rpc: vi.fn(async (fn: string, params: Record<string, unknown>) =>
      rpcImpl(fn, params),
    ),
  } as any;
}

describe('buildRunAggregateQuery (policy_aggregate_window RPC adapter)', () => {
  it('calls policy_aggregate_window with window bounds and direction', async () => {
    const supabase = mockSupabase(async () => ({
      data: [
        {
          sum_amount_usd: '12345.67',
          count: 5,
          distinct_destinations: 3,
          distinct_counterparties: 2,
          included_evaluation_ids: ['e1', 'e2'],
        },
      ],
      error: null,
    }));

    const runQuery = buildRunAggregateQuery(supabase);
    const result = await runQuery(mkParams());

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = supabase.rpc.mock.calls[0];
    expect(fnName).toBe('policy_aggregate_window');
    expect(args).toEqual({
      p_enterprise_id: 'ent_1',
      p_window_start: '2026-03-14T00:00:00.000Z',
      p_window_end: '2026-04-13T00:00:00.000Z',
      p_direction: 'outflow',
      p_initiator_id: null,
      p_counterparty_id: null,
      p_destination_identity: null,
      p_asset: null,
    });

    expect(result.sum_amount_usd).toBe('12345.67');
    expect(result.count).toBe(5);
    expect(result.distinct_destinations).toBe(3);
    expect(result.distinct_counterparties).toBe(2);
    expect(result.included_evaluation_ids).toEqual(['e1', 'e2']);
    expect(result.sum_amount_by_asset).toEqual({});
  });

  it('defaults direction to "outflow" when the window does not specify', async () => {
    const supabase = mockSupabase(async () => ({
      data: [{ sum_amount_usd: '0', count: 0, distinct_destinations: 0, distinct_counterparties: 0, included_evaluation_ids: [] }],
      error: null,
    }));

    const runQuery = buildRunAggregateQuery(supabase);
    await runQuery(
      mkParams({
        window: { duration_ms: 3600_000, group_by: {} }, // no direction
      }),
    );

    expect(supabase.rpc.mock.calls[0][1].p_direction).toBe('outflow');
  });

  it('populates group_by filters when the window asks for them', async () => {
    const supabase = mockSupabase(async () => ({
      data: [{ sum_amount_usd: '0', count: 0, distinct_destinations: 0, distinct_counterparties: 0, included_evaluation_ids: [] }],
      error: null,
    }));

    const runQuery = buildRunAggregateQuery(supabase);
    await runQuery(
      mkParams({
        window: {
          duration_ms: 7 * 24 * 3600_000,
          group_by: {
            initiator: true,
            counterparty: true,
            destination: true,
            asset: true,
          },
          direction: 'outflow',
        },
      }),
    );

    const args = supabase.rpc.mock.calls[0][1];
    expect(args.p_initiator_id).toBe('u_1');
    expect(args.p_counterparty_id).toBe('cp_1');
    expect(args.p_destination_identity).toBe('wallet_2:0xdest');
    expect(args.p_asset).toBe('USDC');
  });

  it('extracts the right identity for each initiator kind', async () => {
    const supabase = mockSupabase(async () => ({
      data: [{ sum_amount_usd: '0', count: 0, distinct_destinations: 0, distinct_counterparties: 0, included_evaluation_ids: [] }],
      error: null,
    }));

    const runQuery = buildRunAggregateQuery(supabase);
    const spec: WindowSpec = { duration_ms: 86_400_000, group_by: { initiator: true } };

    await runQuery(
      mkParams({
        window: spec,
        movement: mkMovement({ initiator: { type: 'agent', agent_id: 'ag_1' } as any }),
      }),
    );
    expect(supabase.rpc.mock.calls.at(-1)![1].p_initiator_id).toBe('ag_1');

    await runQuery(
      mkParams({
        window: spec,
        movement: mkMovement({
          initiator: { type: 'ai_recommendation', recommendation_id: 'rec_1' } as any,
        }),
      }),
    );
    expect(supabase.rpc.mock.calls.at(-1)![1].p_initiator_id).toBe('rec_1');

    await runQuery(
      mkParams({
        window: spec,
        movement: mkMovement({
          initiator: { type: 'schedule', scheduled_op_id: 'so_1' } as any,
        }),
      }),
    );
    expect(supabase.rpc.mock.calls.at(-1)![1].p_initiator_id).toBe('so_1');
  });

  it('omits counterparty filter when group_by asks but movement has none', async () => {
    // Mirror of a quirk in the SQL builder: if group_by.counterparty is
    // true but movement.counterparty is undefined, the filter is not
    // emitted. Upstream in detector runOne() this case short-circuits
    // to a structured failure before we get here — but the adapter
    // should still behave consistently.
    const supabase = mockSupabase(async () => ({
      data: [{ sum_amount_usd: '0', count: 0, distinct_destinations: 0, distinct_counterparties: 0, included_evaluation_ids: [] }],
      error: null,
    }));

    const runQuery = buildRunAggregateQuery(supabase);
    await runQuery(
      mkParams({
        window: { duration_ms: 3600_000, group_by: { counterparty: true } },
        movement: mkMovement({ counterparty: undefined as any }),
      }),
    );
    expect(supabase.rpc.mock.calls[0][1].p_counterparty_id).toBeNull();
  });

  it('fails closed when the RPC returns an error — no silent zero pass-through', async () => {
    const supabase = mockSupabase(async () => ({
      data: null,
      error: { message: 'function policy_aggregate_window does not exist' },
    }));

    const runQuery = buildRunAggregateQuery(supabase);
    await expect(runQuery(mkParams())).rejects.toThrow(
      /policy_aggregate_window rpc failed.*does not exist/,
    );
    // The detector's runOne() catches this and produces a structured
    // aggregate_query_failed failure record; see
    // aggregate-detector/detector.test.ts for coverage of that path.
  });

  it('treats an empty RPC response as "no rows in window"', async () => {
    const supabase = mockSupabase(async () => ({ data: [], error: null }));

    const runQuery = buildRunAggregateQuery(supabase);
    const result = await runQuery(mkParams());
    expect(result.sum_amount_usd).toBe('0');
    expect(result.count).toBe(0);
    expect(result.distinct_destinations).toBe(0);
    expect(result.distinct_counterparties).toBe(0);
    expect(result.included_evaluation_ids).toEqual([]);
  });

  it('handles a single object (not array) RPC response', async () => {
    // PostgREST sometimes unwraps single-row TABLE returns — handle both.
    const supabase = mockSupabase(async () => ({
      data: {
        sum_amount_usd: '500',
        count: 1,
        distinct_destinations: 1,
        distinct_counterparties: 1,
        included_evaluation_ids: ['e1'],
      },
      error: null,
    }));

    const runQuery = buildRunAggregateQuery(supabase);
    const result = await runQuery(mkParams());
    expect(result.sum_amount_usd).toBe('500');
    expect(result.count).toBe(1);
  });

  it('coerces numeric strings from PostgREST into numbers', async () => {
    const supabase = mockSupabase(async () => ({
      data: [
        {
          // NUMERIC serializes as string, INT as number — test both paths.
          sum_amount_usd: '987654.321',
          count: 7,
          distinct_destinations: 4,
          distinct_counterparties: 3,
          included_evaluation_ids: ['e1'],
        },
      ],
      error: null,
    }));

    const runQuery = buildRunAggregateQuery(supabase);
    const result = await runQuery(mkParams());
    expect(result.sum_amount_usd).toBe('987654.321');
    expect(typeof result.count).toBe('number');
    expect(result.count).toBe(7);
  });
});
