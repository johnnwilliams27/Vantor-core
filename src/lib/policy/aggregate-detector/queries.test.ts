import { describe, it, expect } from 'vitest';
import { buildAggregateQuerySql } from './queries';
import { ProposedMovement } from '../types/movement';
import { WindowSpec } from '../types/ir';

const mkMovement = (): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'solana', asset: 'USDC', address: '0xabc123' },
  amount: { amount: '50000', asset: 'USDC' },
  counterparty: { id: 'cp-1' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: new Date().toISOString(),
});

describe('buildAggregateQuerySql', () => {
  it('parameterizes enterprise and time range', () => {
    const window: WindowSpec = { duration_ms: 86_400_000, group_by: {} };
    const start = new Date('2026-04-10T00:00:00Z');
    const end = new Date('2026-04-11T00:00:00Z');
    const result = buildAggregateQuerySql({
      enterpriseId: 'ent-1',
      window,
      movement: mkMovement(),
      windowStart: start,
      windowEnd: end,
    });

    expect(result.bindings[0]).toBe('ent-1');
    expect(result.bindings[1]).toBe(start.toISOString());
    expect(result.bindings[2]).toBe(end.toISOString());
    expect(result.sql).toContain('enterprise_id = $1');
    expect(result.sql).toContain('executed_at >= $2');
    expect(result.sql).toContain('executed_at <  $3');
  });

  it('adds filter and binding for group_by.initiator (human)', () => {
    const window: WindowSpec = { duration_ms: 86_400_000, group_by: { initiator: true } };
    const result = buildAggregateQuerySql({
      enterpriseId: 'ent-1',
      window,
      movement: mkMovement(),
      windowStart: new Date(),
      windowEnd: new Date(),
    });
    expect(result.bindings).toContain('user-1');
    expect(result.sql).toContain("proposed_movement->'initiator'->>'user_id'");
  });

  it('adds filter and binding for group_by.counterparty', () => {
    const window: WindowSpec = { duration_ms: 86_400_000, group_by: { counterparty: true } };
    const result = buildAggregateQuerySql({
      enterpriseId: 'ent-1',
      window,
      movement: mkMovement(),
      windowStart: new Date(),
      windowEnd: new Date(),
    });
    expect(result.bindings).toContain('cp-1');
    expect(result.sql).toContain("proposed_movement->'counterparty'->>'id'");
  });

  it('adds filter for group_by.destination using venue:address identity', () => {
    const window: WindowSpec = { duration_ms: 86_400_000, group_by: { destination: true } };
    const result = buildAggregateQuerySql({
      enterpriseId: 'ent-1',
      window,
      movement: mkMovement(),
      windowStart: new Date(),
      windowEnd: new Date(),
    });
    expect(result.bindings).toContain('solana:0xabc123');
  });

  it('adds direction filter for outflow (default) and inflow', () => {
    const outflow = buildAggregateQuerySql({
      enterpriseId: 'ent-1',
      window: { duration_ms: 86_400_000, group_by: {} },
      movement: mkMovement(),
      windowStart: new Date(),
      windowEnd: new Date(),
    });
    expect(outflow.sql).toContain("= 'outflow'");

    const inflow = buildAggregateQuerySql({
      enterpriseId: 'ent-1',
      window: { duration_ms: 86_400_000, group_by: {}, direction: 'inflow' },
      movement: mkMovement(),
      windowStart: new Date(),
      windowEnd: new Date(),
    });
    expect(inflow.sql).toContain("= 'inflow'");
  });

  it('omits direction filter when direction is "both"', () => {
    const result = buildAggregateQuerySql({
      enterpriseId: 'ent-1',
      window: { duration_ms: 86_400_000, group_by: {}, direction: 'both' },
      movement: mkMovement(),
      windowStart: new Date(),
      windowEnd: new Date(),
    });
    expect(result.sql).not.toContain("= 'outflow'");
    expect(result.sql).not.toContain("= 'inflow'");
  });

  it('handles agent initiator (reads agent_id from discriminated union)', () => {
    const agentMovement: ProposedMovement = {
      ...mkMovement(),
      initiator: { type: 'agent', agent_id: 'agent-42' },
    };
    const result = buildAggregateQuerySql({
      enterpriseId: 'ent-1',
      window: { duration_ms: 86_400_000, group_by: { initiator: true } },
      movement: agentMovement,
      windowStart: new Date(),
      windowEnd: new Date(),
    });
    expect(result.bindings).toContain('agent-42');
  });
});
