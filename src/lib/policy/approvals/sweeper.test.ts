// src/lib/policy/approvals/sweeper.test.ts

import { describe, it, expect } from 'vitest';
import { sweepExpiredApprovals } from './sweeper';

// ─── Mock Supabase ─────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function mockSupabase(fixtures: { policy_approval_requests?: Row[] }) {
  const tableData: Record<string, Row[]> = {
    policy_approval_requests: fixtures.policy_approval_requests ?? [],
  };

  function makeQB(table: string, rows: Row[]) {
    let filtered = [...rows];
    const qb: Record<string, unknown> = {};

    qb.eq = (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] === val);
      return qb;
    };

    qb.in = (col: string, vals: unknown[]) => {
      filtered = filtered.filter((r) => (vals as unknown[]).includes(r[col]));
      return qb;
    };

    qb.order = () => qb;
    qb.limit = (_n: number) => {
      filtered = filtered.slice(0, _n);
      return qb;
    };
    qb.select = () => qb;

    qb.single = async () => ({ data: filtered[0] ?? null, error: null });
    qb.maybeSingle = async () => ({ data: filtered[0] ?? null, error: null });

    qb.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: filtered, error: null }).then(resolve);

    // Update with version-predicate (same pattern as service.test.ts)
    qb.update = (payload: Row) => {
      const updateFilters: Array<{ col: string; val: unknown }> = [];
      const updateQB: Record<string, unknown> = {};

      const execute = () => {
        const matched = rows.filter((r) =>
          updateFilters.every((f) => r[f.col] === f.val),
        );
        const updatedRows: Row[] = [];
        for (const m of matched) {
          const idx = rows.indexOf(m);
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...payload };
            updatedRows.push(rows[idx]);
          }
        }
        return { data: updatedRows, error: null as null | { message: string } };
      };

      updateQB.eq = (col: string, val: unknown) => {
        updateFilters.push({ col, val });
        return updateQB;
      };
      updateQB.select = () => ({
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(execute()).then(resolve),
      });
      updateQB.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(execute()).then(resolve);

      return updateQB;
    };

    return qb;
  }

  return {
    from: (table: string) => {
      const rows = tableData[table] ?? [];
      return makeQB(table, rows);
    },
    _data: tableData,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now

describe('sweepExpiredApprovals', () => {
  it('expires pending requests past their expires_at', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [
        {
          id: 'req-1',
          enterprise_id: 'ent-001',
          status: 'pending',
          expires_at: pastDate,
          version: 0,
          created_by: 'user-1',
        },
      ],
    });

    const result = await sweepExpiredApprovals(sb);

    expect(result.expired_count).toBe(1);
    const row = sb._data.policy_approval_requests[0];
    expect(row.status).toBe('denied');
    expect(row.denial_reason).toBe('expired');
    expect(row.resolved_at).toBeDefined();
  });

  it('skips pending requests not yet expired', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [
        {
          id: 'req-2',
          enterprise_id: 'ent-001',
          status: 'pending',
          expires_at: futureDate,
          version: 0,
        },
      ],
    });

    const result = await sweepExpiredApprovals(sb);

    expect(result.expired_count).toBe(0);
    expect(sb._data.policy_approval_requests[0].status).toBe('pending');
  });

  it('skips non-pending requests even if expired', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [
        {
          id: 'req-3',
          enterprise_id: 'ent-001',
          status: 'executed',
          expires_at: pastDate,
          version: 1,
        },
      ],
    });

    const result = await sweepExpiredApprovals(sb);

    expect(result.expired_count).toBe(0);
  });

  it('respects batchSize parameter', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [
        { id: 'req-a', enterprise_id: 'ent-001', status: 'pending', expires_at: pastDate, version: 0 },
        { id: 'req-b', enterprise_id: 'ent-001', status: 'pending', expires_at: pastDate, version: 0 },
        { id: 'req-c', enterprise_id: 'ent-001', status: 'pending', expires_at: pastDate, version: 0 },
      ],
    });

    const result = await sweepExpiredApprovals(sb, 2);

    // batchSize=2 so only 2 should be processed
    expect(result.expired_count).toBe(2);
  });

  it('handles empty result set', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [],
    });

    const result = await sweepExpiredApprovals(sb);

    expect(result.expired_count).toBe(0);
  });
});
