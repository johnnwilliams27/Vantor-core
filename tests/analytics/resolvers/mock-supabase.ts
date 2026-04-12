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
    // .single() returns first row
    chain.single = () => {
      const singleChain = { ...chain };
      for (const m of methods) {
        singleChain[m] = (..._args: unknown[]) => singleChain;
      }
      singleChain.single = () => singleChain;
      singleChain.then = (resolve: (v: unknown) => void, reject?: (v: unknown) => void) =>
        Promise.resolve({ data: rows[0] ?? null, error: null }).then(resolve, reject);
      return singleChain;
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}
