import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, it, expect } from 'vitest';

// Static guardrail: every API route that creates a money-movement row
// MUST import PolicyGateService. Catches two regressions that a pure
// unit-test suite can't see:
//   1. someone drops the gate from an existing route (e.g. during a
//      refactor) — the money-movement row would persist un-gated.
//   2. a new route is added that writes to one of the money-movement
//      tables but forgets to wire the gate.
//
// Exemptions below are explicit. Stale exemptions are caught by a
// secondary assertion that every exempt path still exists on disk.

const API_DIR = 'src/app/api';

/** Supabase tables that, if `.insert(...)`-ed from a route, represent
 *  money movement and therefore must pass through the policy gate. */
const MONEY_MOVEMENT_TABLES = [
  'transfers',
  'fiat_transactions',
  'yield_transactions',
  'bridge_transfers',
  'fiat_payments',
];

/** Exemptions, each with a documented reason. Keep narrow — every
 *  addition here is a promise that the route is either gated elsewhere
 *  or deliberately not money-movement. */
const EXEMPT_ROUTES: ReadonlyArray<{ path: string; reason: string }> = [
  // Provider adapters not yet integrated; POST returns 501.
  { path: 'src/app/api/payments/route.ts',        reason: 'disabled (501) — re-gate when bank-payment provider lands' },
  { path: 'src/app/api/bridges/execute/route.ts', reason: 'disabled (501) — re-gate when bridging provider lands' },
  { path: 'src/app/api/swaps/execute/route.ts',   reason: 'disabled (501) — re-gate when DEX aggregator lands' },

  // Post-sign confirmation endpoints. The gate ran at the create step
  // (POST /api/transfers, /api/yield/deposit, /api/yield/withdraw);
  // these just persist the result after the client signed on-chain.
  { path: 'src/app/api/transfers/confirm/route.ts',       reason: 'confirm-step — gate ran at POST /api/transfers' },
  { path: 'src/app/api/yield/confirm-deposit/route.ts',   reason: 'confirm-step — gate ran at POST /api/yield/deposit' },
  { path: 'src/app/api/yield/confirm-withdraw/route.ts',  reason: 'confirm-step — gate ran at POST /api/yield/withdraw' },

  // ─── KNOWN VIOLATIONS — follow-up work, not legitimate exemptions ──
  //
  // These three call `adapter.executeRamp(...)` + insert into
  // `fiat_transactions` without passing through the policy gate. They
  // also conflict with the project memory invariant
  // "AI Recommendations Always Require Human Approval":
  //   - /api/treasury/recommendations/generate has a willAutoExecute path
  //   - /api/treasury/recommendations/[id]/approve runs an ungated ramp
  //   - /api/integrations/slack/callback does the same via Slack approval
  //
  // Exempting here so the guardrail can land; each needs a dedicated PR
  // that builds mapRecommendationToMovement() + wires PolicyGateService
  // for the AI-recommendation flow. When fixed, remove from this list so
  // the guardrail enforces.
  { path: 'src/app/api/treasury/recommendations/generate/route.ts',       reason: 'FOLLOW-UP: ungated AI auto-execute path — violates human-approval invariant' },
  { path: 'src/app/api/treasury/recommendations/[id]/approve/route.ts',   reason: 'FOLLOW-UP: ungated ramp on human-approved AI rec' },
  { path: 'src/app/api/integrations/slack/callback/route.ts',             reason: 'FOLLOW-UP: ungated ramp on Slack-approved AI rec' },
];

/** Directories that seed / reset test-mode fixtures rather than moving
 *  real user money. Service-role only, guarded upstream. */
const EXEMPT_DIRS: readonly string[] = ['src/app/api/seed'];

function toPosix(p: string): string {
  return p.split(/[\\/]/).join('/');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      const st = statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (name === 'route.ts') out.push(toPosix(full));
    }
  }
  return out;
}

function tablesInsertedBy(src: string): string[] {
  const matches: string[] = [];
  for (const table of MONEY_MOVEMENT_TABLES) {
    // .from('X').insert / .from("X").insert / .from(`X`).insert, whitespace-permissive.
    const re = new RegExp(
      `\\.from\\(\\s*['"\`]${table}['"\`]\\s*\\)[\\s\\S]*?\\.insert\\s*\\(`,
      'g',
    );
    if (re.test(src)) matches.push(table);
  }
  return matches;
}

function hasPostHandler(src: string): boolean {
  return /export\s+async\s+function\s+POST\s*\(/.test(src);
}

function importsPolicyGate(src: string): boolean {
  return /PolicyGateService/.test(src);
}

describe('policy gate — route coverage guardrail', () => {
  const files = walk(API_DIR).map(toPosix);

  const isExempt = (f: string) =>
    EXEMPT_ROUTES.some((e) => f.endsWith(toPosix(e.path))) ||
    EXEMPT_DIRS.some((d) => f.startsWith(toPosix(d) + posix.sep));

  it('every money-movement route imports PolicyGateService', () => {
    const violations: Array<{ file: string; tables: string[] }> = [];
    for (const f of files) {
      if (isExempt(f)) continue;
      const src = readFileSync(f, 'utf-8');
      if (!hasPostHandler(src)) continue;
      const tables = tablesInsertedBy(src);
      if (tables.length === 0) continue;
      if (!importsPolicyGate(src)) {
        violations.push({ file: f, tables });
      }
    }
    const msg = violations.length
      ? `Found money-movement route(s) without PolicyGateService:\n${violations
          .map((v) => `  - ${v.file} (inserts ${v.tables.join(', ')})`)
          .join('\n')}`
      : '';
    expect(violations, msg).toEqual([]);
  });

  it('each exempt route still exists on disk (catches stale exemptions)', () => {
    for (const e of EXEMPT_ROUTES) {
      const normalized = toPosix(e.path);
      const found = files.some((f) => f.endsWith(normalized));
      expect(
        found,
        `Exempt route "${e.path}" not found. If it was moved or deleted, remove it from EXEMPT_ROUTES.`,
      ).toBe(true);
    }
  });

  it('enumerates all currently-gated money-movement routes (regression floor)', () => {
    // Snapshot-ish list: if a route drops out of this, something was
    // deleted or renamed. Ensures a surface-level change is intentional.
    const gated: string[] = [];
    for (const f of files) {
      if (isExempt(f)) continue;
      const src = readFileSync(f, 'utf-8');
      if (!hasPostHandler(src)) continue;
      if (!importsPolicyGate(src)) continue;
      gated.push(f);
    }
    // Sort for stable comparison.
    gated.sort();
    expect(gated).toEqual([
      'src/app/api/ramps/execute/route.ts',
      'src/app/api/scheduled-operations/route.ts',
      'src/app/api/transfers/route.ts',
      'src/app/api/treasury/withdraw-and-offramp/route.ts',
      'src/app/api/yield/deposit/route.ts',
      'src/app/api/yield/withdraw/route.ts',
    ]);
  });
});
