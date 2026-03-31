// src/lib/test-mode/seed/helpers.ts

/** Days ago from now as ISO string */
export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

/** Days from now as ISO string */
export function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString();
}

/** Days from now as YYYY-MM-DD */
export function dateDaysFromNow(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().split('T')[0];
}

/** Days ago as YYYY-MM-DD */
export function dateDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().split('T')[0];
}

/** Random float between min and max */
export function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/** Random integer between min and max (inclusive) */
export function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

/** Generate a fake Ethereum tx hash */
export function ethHash(): string {
  const chars = '0123456789abcdef';
  let hash = '0x';
  for (let i = 0; i < 64; i++) hash += chars[Math.floor(Math.random() * 16)];
  return hash;
}

/** Generate a fake Solana tx hash */
export function solHash(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let hash = '';
  for (let i = 0; i < 88; i++) hash += chars[Math.floor(Math.random() * chars.length)];
  return hash;
}

/** Pick a random element from an array */
export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Supabase admin client type shorthand */
export type SupabaseAdmin = ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>;

/** Common params for all seed modules */
export interface SeedContext {
  supabase: SupabaseAdmin;
  enterpriseId: string;
  userId: string;
}
