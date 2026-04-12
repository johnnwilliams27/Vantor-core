import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Build a mock Supabase client for resolver tests.
 * Provide table → rows mapping; the chain builder returns those rows.
 */
export function mockSupabase(tableData: Record<string, Record<string, unknown>[]>) {
  const from = (table: string) => {
    const rows = tableData[table] ?? [];
    const chain: Record<string, any> = {};
    const methods = [
      'select', 'eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'in', 'order', 'limit',
    ];
    for (const m of methods) {
      chain[m] = (..._args: unknown[]) => chain;
    }
    // Make it thenable — default returns all rows
    const result = { data: rows, error: null };
    chain.then = (resolve: (v: unknown) => void, reject?: (v: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject);
    // .single() / .maybeSingle() both return first row. The real
    // PostgREST semantics differ (single errors on >1 row, maybeSingle
    // doesn't) but for test purposes they're equivalent.
    const singleFactory = (): Record<string, any> => {
      const singleChain: Record<string, any> = { ...chain };
      for (const m of methods) {
        singleChain[m] = (..._args: unknown[]) => singleChain;
      }
      singleChain.single = singleFactory;
      singleChain.maybeSingle = singleFactory;
      singleChain.then = (resolve: (v: unknown) => void, reject?: (v: unknown) => void) =>
        Promise.resolve({ data: rows[0] ?? null, error: null }).then(resolve, reject);
      return singleChain;
    };
    chain.single = singleFactory;
    chain.maybeSingle = singleFactory;
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}
