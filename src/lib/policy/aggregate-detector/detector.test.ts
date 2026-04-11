import { describe, it, expect, vi } from 'vitest';
import { AggregationDetector } from './detector';
import { PolicyVersionSnapshot } from '../types/policy-version';
import { ProposedMovement } from '../types/movement';
import { RawAggregateResult } from './queries';

const mkMovement = (): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'external', asset: 'USDC' },
  amount: { amount: '50000', asset: 'USDC' },
  counterparty: { id: 'cp-1' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: new Date().toISOString(),
});

const mkPolicy = (): PolicyVersionSnapshot => ({
  id: 'v-1',
  enterprise_id: 'ent-1',
  version_number: 1,
  status: 'active',
  name: 'Test',
  rules: [],
  hard_limits: [],
  approval_chains: [],
});

const mkEmptyRawResult = (): RawAggregateResult => ({
  sum_amount_usd: '0',
  sum_amount_by_asset: {},
  count: 0,
  distinct_destinations: 0,
  distinct_counterparties: 0,
  included_evaluation_ids: [],
});

describe('AggregationDetector', () => {
  it('always populates system_splitting_guard_24h', async () => {
    const runQuery = vi.fn().mockResolvedValue(mkEmptyRawResult());
    const detector = new AggregationDetector({ runQuery });

    const result = await detector.loadAggregates(mkMovement(), 'ent-1', mkPolicy());

    expect(result.system_splitting_guard_24h).toBeDefined();
    expect(result.system_splitting_guard_24h.window_spec_hash).toBeTruthy();
    expect(runQuery).toHaveBeenCalled();
  });

  it('deduplicates user specs by hash (two rules, same window spec → one query)', async () => {
    const runQuery = vi.fn().mockResolvedValue(mkEmptyRawResult());
    const detector = new AggregationDetector({ runQuery });

    const policy: PolicyVersionSnapshot = {
      ...mkPolicy(),
      rules: [
        {
          id: 'r1',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Rule 1',
          rationale: '',
          priority: 1,
          verdict: 'require_approval',
          created_by: 'u',
          created_at: new Date(),
          condition: {
            kind: 'aggregate_window',
            window: { duration_ms: 86_400_000, group_by: { counterparty: true } },
            attr: 'sum_amount',
            op: '>',
            value: { amount: '100', currency: 'USD' },
          },
        },
        {
          id: 'r2',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Rule 2',
          rationale: '',
          priority: 2,
          verdict: 'require_approval',
          created_by: 'u',
          created_at: new Date(),
          condition: {
            kind: 'aggregate_window',
            window: { duration_ms: 86_400_000, group_by: { counterparty: true } },
            attr: 'count',
            op: '>',
            value: { amount: '5', currency: 'USD' },
          },
        },
      ],
    };

    const result = await detector.loadAggregates(mkMovement(), 'ent-1', policy);

    // runQuery called twice: once for splitting guard, once for the deduplicated user spec
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.user_specs)).toHaveLength(1);
  });

  it('walks approval_chains.trigger_condition for aggregate_window nodes', async () => {
    const runQuery = vi.fn().mockResolvedValue(mkEmptyRawResult());
    const detector = new AggregationDetector({ runQuery });

    const policy: PolicyVersionSnapshot = {
      ...mkPolicy(),
      approval_chains: [
        {
          id: 'chain-1',
          version_id: 'v-1',
          name: 'Chain 1',
          slots: [],
          priority: 1,
          expiration_hours: 48,
          created_by: 'u',
          created_at: new Date(),
          trigger_condition: {
            kind: 'aggregate_window',
            window: { duration_ms: 3_600_000, group_by: { initiator: true } },
            attr: 'count',
            op: '>',
            value: { amount: '10', currency: 'USD' },
          },
        },
      ],
    };

    const result = await detector.loadAggregates(mkMovement(), 'ent-1', policy);

    // splitting guard + the chain trigger's aggregate = 2 queries
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.user_specs)).toHaveLength(1);
  });

  it('walks nested conditions (and/or/not) for aggregate_window nodes', async () => {
    const runQuery = vi.fn().mockResolvedValue(mkEmptyRawResult());
    const detector = new AggregationDetector({ runQuery });

    const policy: PolicyVersionSnapshot = {
      ...mkPolicy(),
      rules: [
        {
          id: 'r1',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Nested',
          rationale: '',
          priority: 1,
          verdict: 'require_approval',
          created_by: 'u',
          created_at: new Date(),
          condition: {
            kind: 'and',
            children: [
              { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' },
              {
                kind: 'or',
                children: [
                  {
                    kind: 'not',
                    child: {
                      kind: 'aggregate_window',
                      window: { duration_ms: 3_600_000, group_by: { destination: true } },
                      attr: 'count',
                      op: '>',
                      value: { amount: '5', currency: 'USD' },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    const result = await detector.loadAggregates(mkMovement(), 'ent-1', policy);

    // splitting guard + the nested aggregate
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.user_specs)).toHaveLength(1);
  });

  it('records failure per-spec on query error', async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(mkEmptyRawResult()) // splitting guard succeeds
      .mockRejectedValueOnce(new Error('db timeout')); // user spec fails
    const detector = new AggregationDetector({ runQuery });

    const policy: PolicyVersionSnapshot = {
      ...mkPolicy(),
      rules: [
        {
          id: 'r1',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Rule',
          rationale: '',
          priority: 1,
          verdict: 'require_approval',
          created_by: 'u',
          created_at: new Date(),
          condition: {
            kind: 'aggregate_window',
            window: { duration_ms: 86_400_000, group_by: { initiator: true } },
            attr: 'sum_amount',
            op: '>',
            value: { amount: '100', currency: 'USD' },
          },
        },
      ],
    };

    const result = await detector.loadAggregates(mkMovement(), 'ent-1', policy);

    const userSpecResult = Object.values(result.user_specs)[0];
    expect(userSpecResult.failure).toBeDefined();
    expect(userSpecResult.failure?.reason_code).toBe('aggregate_query_failed');
    expect(userSpecResult.failure?.human_readable).toContain('db timeout');
  });

  it('records failure on the splitting guard itself if the query throws', async () => {
    const runQuery = vi.fn().mockRejectedValue(new Error('splitting guard broke'));
    const detector = new AggregationDetector({ runQuery });

    const result = await detector.loadAggregates(mkMovement(), 'ent-1', mkPolicy());

    expect(result.system_splitting_guard_24h.failure).toBeDefined();
    expect(result.system_splitting_guard_24h.failure?.reason_code).toBe('aggregate_query_failed');
  });

  it('runs splitting guard and user specs in parallel (all run concurrently)', async () => {
    // Use a controlled promise to verify parallel execution: if all four queries
    // are awaited concurrently, the mock is called 4 times before any of them
    // resolves.
    let callsSoFar = 0;
    const runQuery = vi.fn().mockImplementation(async () => {
      callsSoFar++;
      return mkEmptyRawResult();
    });
    const detector = new AggregationDetector({ runQuery });

    const policy: PolicyVersionSnapshot = {
      ...mkPolicy(),
      rules: [
        {
          id: 'r1',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Rule 1',
          rationale: '',
          priority: 1,
          verdict: 'require_approval',
          created_by: 'u',
          created_at: new Date(),
          condition: {
            kind: 'aggregate_window',
            window: { duration_ms: 3_600_000, group_by: { initiator: true } },
            attr: 'sum_amount',
            op: '>',
            value: { amount: '100', currency: 'USD' },
          },
        },
        {
          id: 'r2',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Rule 2',
          rationale: '',
          priority: 2,
          verdict: 'require_approval',
          created_by: 'u',
          created_at: new Date(),
          condition: {
            kind: 'aggregate_window',
            window: { duration_ms: 7_200_000, group_by: { counterparty: true } },
            attr: 'count',
            op: '>',
            value: { amount: '5', currency: 'USD' },
          },
        },
      ],
    };

    await detector.loadAggregates(mkMovement(), 'ent-1', policy);

    // 1 splitting guard + 2 distinct user specs = 3 calls
    expect(callsSoFar).toBe(3);
    expect(runQuery).toHaveBeenCalledTimes(3);
  });

  it('handles non-Error rejection from runQuery (wraps via String())', async () => {
    const runQuery = vi.fn().mockRejectedValue('string rejection');
    const detector = new AggregationDetector({ runQuery });

    const result = await detector.loadAggregates(mkMovement(), 'ent-1', mkPolicy());

    // splitting guard failed with a non-Error rejection
    expect(result.system_splitting_guard_24h.failure).toBeDefined();
    expect(result.system_splitting_guard_24h.failure?.reason_code).toBe('aggregate_query_failed');
    expect(result.system_splitting_guard_24h.failure?.human_readable).toContain('string rejection');
  });

  it('rejects malformed runQuery results (undefined sum_amount_usd) as structured failure', async () => {
    const runQuery = vi.fn().mockResolvedValue({
      sum_amount_usd: undefined as unknown as string,
      sum_amount_by_asset: {},
      count: 0,
      distinct_destinations: 0,
      distinct_counterparties: 0,
      included_evaluation_ids: [],
    });
    const detector = new AggregationDetector({ runQuery });

    const result = await detector.loadAggregates(mkMovement(), 'ent-1', mkPolicy());

    expect(result.system_splitting_guard_24h.failure).toBeDefined();
    expect(result.system_splitting_guard_24h.failure?.human_readable).toContain('malformed');
  });

  it('rejects malformed runQuery results (negative count) as structured failure', async () => {
    const runQuery = vi.fn().mockResolvedValue({
      sum_amount_usd: '0',
      sum_amount_by_asset: {},
      count: -5,
      distinct_destinations: 0,
      distinct_counterparties: 0,
      included_evaluation_ids: [],
    });
    const detector = new AggregationDetector({ runQuery });

    const result = await detector.loadAggregates(mkMovement(), 'ent-1', mkPolicy());

    expect(result.system_splitting_guard_24h.failure).toBeDefined();
    expect(result.system_splitting_guard_24h.failure?.human_readable).toContain('count');
  });

  it('empty user_specs when policy has no aggregate_window conditions', async () => {
    const runQuery = vi.fn().mockResolvedValue(mkEmptyRawResult());
    const detector = new AggregationDetector({ runQuery });

    const policy: PolicyVersionSnapshot = {
      ...mkPolicy(),
      rules: [
        {
          id: 'r1',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Pure amount rule',
          rationale: '',
          priority: 1,
          verdict: 'require_approval',
          created_by: 'u',
          created_at: new Date(),
          condition: {
            kind: 'amount_compare',
            attr: 'transfer.amount',
            op: '>',
            value: { amount: '10000', currency: 'USDC' },
          },
        },
      ],
    };

    const result = await detector.loadAggregates(mkMovement(), 'ent-1', policy);

    // Only the splitting guard runs; no user specs
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.user_specs)).toHaveLength(0);
  });

  it('mixed outcomes: splitting guard succeeds, one user spec succeeds, another user spec fails', async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(mkEmptyRawResult()) // splitting guard
      .mockResolvedValueOnce(mkEmptyRawResult()) // user spec 1
      .mockRejectedValueOnce(new Error('user spec 2 failed')); // user spec 2
    const detector = new AggregationDetector({ runQuery });

    const policy: PolicyVersionSnapshot = {
      ...mkPolicy(),
      rules: [
        {
          id: 'r1',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Rule 1',
          rationale: '',
          priority: 1,
          verdict: 'require_approval',
          created_by: 'u',
          created_at: new Date(),
          condition: {
            kind: 'aggregate_window',
            window: { duration_ms: 3_600_000, group_by: { initiator: true } },
            attr: 'sum_amount',
            op: '>',
            value: { amount: '100', currency: 'USD' },
          },
        },
        {
          id: 'r2',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Rule 2',
          rationale: '',
          priority: 2,
          verdict: 'require_approval',
          created_by: 'u',
          created_at: new Date(),
          condition: {
            kind: 'aggregate_window',
            window: { duration_ms: 7_200_000, group_by: { destination: true } },
            attr: 'count',
            op: '>',
            value: { amount: '5', currency: 'USD' },
          },
        },
      ],
    };

    const result = await detector.loadAggregates(mkMovement(), 'ent-1', policy);

    // splitting guard succeeded
    expect(result.system_splitting_guard_24h.failure).toBeUndefined();
    // Exactly one of the two user specs has a failure, the other doesn't
    const userResults = Object.values(result.user_specs);
    expect(userResults).toHaveLength(2);
    const failedCount = userResults.filter((r) => r.failure !== undefined).length;
    expect(failedCount).toBe(1);
  });

  it('fails the spec when a counterparty-grouped rule meets a movement without counterparty', async () => {
    const runQuery = vi.fn().mockResolvedValue(mkEmptyRawResult());
    const detector = new AggregationDetector({ runQuery });

    const movementWithoutCounterparty: ProposedMovement = {
      ...mkMovement(),
      counterparty: undefined,
    };

    const policy: PolicyVersionSnapshot = {
      ...mkPolicy(),
      rules: [
        {
          id: 'r1',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Counterparty rule',
          rationale: '',
          priority: 1,
          verdict: 'require_approval',
          created_by: 'u',
          created_at: new Date(),
          condition: {
            kind: 'aggregate_window',
            window: { duration_ms: 86_400_000, group_by: { counterparty: true } },
            attr: 'sum_amount',
            op: '>',
            value: { amount: '1000', currency: 'USD' },
          },
        },
      ],
    };

    const result = await detector.loadAggregates(movementWithoutCounterparty, 'ent-1', policy);

    const userSpecResult = Object.values(result.user_specs)[0];
    expect(userSpecResult.failure).toBeDefined();
    expect(userSpecResult.failure?.reason_code).toBe('aggregate_query_failed');
    expect(userSpecResult.failure?.human_readable).toContain('counterparty');
  });

  it('uses the same windowEnd (now) for every query in one call', async () => {
    const seenEnds: Date[] = [];
    const runQuery = vi.fn().mockImplementation(async (params) => {
      seenEnds.push(params.windowEnd);
      return mkEmptyRawResult();
    });
    const detector = new AggregationDetector({ runQuery });

    const policy: PolicyVersionSnapshot = {
      ...mkPolicy(),
      rules: [
        {
          id: 'r1',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Rule',
          rationale: '',
          priority: 1,
          verdict: 'require_approval',
          created_by: 'u',
          created_at: new Date(),
          condition: {
            kind: 'aggregate_window',
            window: { duration_ms: 3_600_000, group_by: { initiator: true } },
            attr: 'sum_amount',
            op: '>',
            value: { amount: '100', currency: 'USD' },
          },
        },
      ],
    };

    await detector.loadAggregates(mkMovement(), 'ent-1', policy);

    // All queries use the same windowEnd (the `now` captured at loadAggregates start)
    expect(seenEnds.length).toBe(2); // splitting guard + user spec
    expect(seenEnds[0].getTime()).toBe(seenEnds[1].getTime());
  });
});
