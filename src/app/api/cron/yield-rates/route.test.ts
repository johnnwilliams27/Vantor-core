import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sweepUndeclaredRateRows } from './sweep';
import type { RateKey } from '@/lib/yield/rates';

type Row = { protocol: string; token: string; chain: string };

function buildFakeClient(rows: Row[]) {
  const deleted: Row[] = [];
  const client = {
    from(table: string) {
      if (table !== 'yield_rate_cache') throw new Error(`unexpected table ${table}`);
      return {
        select: (_cols: string) =>
          Promise.resolve({ data: rows.slice(), error: null }),
        delete() {
          const filter: Partial<Row> = {};
          const chain = {
            eq(col: keyof Row, val: string) {
              filter[col] = val;
              if (filter.protocol && filter.token && filter.chain) {
                const before = rows.length;
                for (let i = rows.length - 1; i >= 0; i--) {
                  const r = rows[i];
                  if (
                    r.protocol === filter.protocol &&
                    r.token === filter.token &&
                    r.chain === filter.chain
                  ) {
                    deleted.push(r);
                    rows.splice(i, 1);
                  }
                }
                return Promise.resolve({ data: null, error: null, count: before - rows.length });
              }
              return chain;
            },
          };
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, deleted, remaining: rows };
}

const DECLARED: ReadonlyArray<RateKey> = [
  { protocol: 'aave', token: 'USDC', chain: 'ethereum' },
  { protocol: 'kamino', token: 'USDC', chain: 'solana' },
];

describe('sweepUndeclaredRateRows', () => {
  it('deletes rows whose key is not in the declared set', async () => {
    const { client, deleted, remaining } = buildFakeClient([
      { protocol: 'aave', token: 'USDC', chain: 'ethereum' }, // declared
      { protocol: 'kamino', token: 'USDC', chain: 'solana' }, // declared
      { protocol: 'kamino_multiply', token: 'USDC', chain: 'solana' }, // orphan
      { protocol: 'kamino', token: 'USDT', chain: 'solana' }, // orphan
    ]);

    const result = await sweepUndeclaredRateRows(client, DECLARED);

    expect(result).toEqual({ swept: 2, skipped: false });
    expect(deleted).toEqual(
      expect.arrayContaining([
        { protocol: 'kamino_multiply', token: 'USDC', chain: 'solana' },
        { protocol: 'kamino', token: 'USDT', chain: 'solana' },
      ]),
    );
    expect(remaining).toHaveLength(2);
    expect(remaining).toEqual(
      expect.arrayContaining([
        { protocol: 'aave', token: 'USDC', chain: 'ethereum' },
        { protocol: 'kamino', token: 'USDC', chain: 'solana' },
      ]),
    );
  });

  it('is a no-op when every row is declared', async () => {
    const { client, deleted, remaining } = buildFakeClient([
      { protocol: 'aave', token: 'USDC', chain: 'ethereum' },
      { protocol: 'kamino', token: 'USDC', chain: 'solana' },
    ]);

    const result = await sweepUndeclaredRateRows(client, DECLARED);

    expect(result).toEqual({ swept: 0, skipped: false });
    expect(deleted).toHaveLength(0);
    expect(remaining).toHaveLength(2);
  });

  it('skips entirely when declared set is empty (safety guard)', async () => {
    const { client, deleted, remaining } = buildFakeClient([
      { protocol: 'aave', token: 'USDC', chain: 'ethereum' },
      { protocol: 'kamino', token: 'USDC', chain: 'solana' },
    ]);

    const result = await sweepUndeclaredRateRows(client, []);

    expect(result).toEqual({ swept: 0, skipped: true });
    expect(deleted).toHaveLength(0);
    expect(remaining).toHaveLength(2);
  });

  it('skips when the initial select fails (does not delete on partial knowledge)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = {
      from() {
        return {
          select: () =>
            Promise.resolve({ data: null, error: { message: 'boom' } }),
        };
      },
    } as unknown as SupabaseClient;

    const result = await sweepUndeclaredRateRows(client, DECLARED);

    expect(result).toEqual({ swept: 0, skipped: true });
    errorSpy.mockRestore();
  });
});
