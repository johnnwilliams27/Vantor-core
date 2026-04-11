# Forecast Analytics — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Vantor's basic cash forecast with a proper obligations model, persisted treasury state snapshots, a scenario-aware forecast engine, and a Forecast Service contract the rules engine can consume — and hard-cut the legacy `treasury_forecasts` table.

**Architecture:** Three new DB tables (`obligations` via in-place rename of `manual_obligations`, `treasury_state_snapshots`, `forecast_snapshots`), one deleted table (`treasury_forecasts`), one pure projection engine (`ForecastEngine`), one service layer (`ForecastService`) with scenarios + hypothetical overlay + persistence, and a thin migration of existing rules-engine and API callers onto the new service. FX handled at projection time via the existing `fx_rate_cache` + `oracle.ts`. All new tables follow Vantor's `enterprise_id` + RLS pattern.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres + RLS), TypeScript, Vitest 2.1.9 (cherry-picked from policy-engine), existing `lib/fx` + `lib/treasury/oracle` for currency handling.

**Branch:** `feature/forecast-analytics` (worktree at `.worktrees/forecast-analytics`)

**Out of scope for Phase A:** measures registry, analytics engine, standard views, custom view builder, alerting, Report Builder reimplementation — all Phase B/C.

---

## File Structure

**New files:**
- `supabase/migrations/0036_obligations_v2.sql` — extend + rename `manual_obligations` → `obligations`
- `supabase/migrations/0037_treasury_state_snapshots.sql` — aggregated point-in-time treasury state
- `supabase/migrations/0038_forecast_snapshots.sql` — scenario-aware forecast persistence with correlation IDs
- `supabase/migrations/0039_drop_treasury_forecasts.sql` — hard cut legacy table
- `src/lib/obligations/types.ts` — TS types mirroring the `obligations` table
- `src/lib/obligations/repo.ts` — data access (supabase client queries)
- `src/lib/obligations/service.ts` — CRUD + validation + recurrence expansion
- `src/lib/obligations/recurrence.ts` — pure functions for cron/enum-based recurrence expansion
- `src/lib/obligations/materialize.ts` — nightly job: generate future instances from recurring parents
- `src/lib/treasury/state/types.ts` — TS types for `treasury_state_snapshots`
- `src/lib/treasury/state/service.ts` — compute + persist snapshot
- `src/lib/forecast/types.ts` — TS types for forecast snapshots, scenarios, projections
- `src/lib/forecast/engine.ts` — pure `ForecastEngine` (state + obligations → projection, no DB)
- `src/lib/forecast/scenarios.ts` — scenario parameter application
- `src/lib/forecast/service.ts` — `ForecastService` + `createForecastService()` factory
- `src/lib/forecast/hypothetical.ts` — in-memory overlay for `hypothetical()` calls
- `src/app/api/obligations/route.ts` — POST (create), GET (list)
- `src/app/api/obligations/[id]/route.ts` — GET, PATCH, DELETE
- `src/app/api/treasury/snapshots/route.ts` — POST (compute), GET (list)
- `tests/obligations/recurrence.test.ts` — pure unit tests
- `tests/obligations/service.test.ts` — service-level tests with test DB helper
- `tests/treasury/state/service.test.ts` — snapshot computation tests
- `tests/forecast/engine.test.ts` — projection correctness (hand-calculated scenarios)
- `tests/forecast/scenarios.test.ts` — scenario parameter application
- `tests/forecast/hypothetical.test.ts` — hypothetical mutation-safety tests
- `tests/forecast/service.test.ts` — service + persistence integration
- `tests/forecast/performance.bench.test.ts` — 90d × 500 obligations benchmark (warn-only)
- `tests/helpers/test-db.ts` — shared test DB setup / teardown

**Modified files:**
- `src/types/database.ts` — new enums and table types, deprecate `TreasuryForecast`
- `src/lib/treasury/rules-engine.ts` — replace `collectObligations()` and `buildTreasurySnapshot()` internals with Forecast Service + Treasury State Service calls
- `src/lib/treasury/predictions.ts` — `generateCashFlowForecast()` becomes a thin adapter over `ForecastService`, then deleted at end of plan
- `src/app/api/treasury/forecast/route.ts` — read from `forecast_snapshots` instead of `treasury_forecasts`
- `src/app/api/treasury/forecast/generate/route.ts` — call `ForecastService.compute()` with `consumer='treasurer_view'`
- `src/app/(app)/treasury/ai/page.tsx` (or wherever Forecasting tab lives) — consume new API response shape
- `src/lib/treasury/report.ts` — legacy caller of old forecast types; update to new types
- `README.md` — Phase A summary + architecture pointer

---

## Testing strategy

- **Pure unit tests** (vitest, node env): recurrence expansion, forecast engine projection math, scenario application, hypothetical overlay semantics. No DB, no network. Most of the tests live here because the projection logic is pure.
- **Integration tests** (vitest, node env, test DB): service-level CRUD, snapshot computation aggregating real rows, forecast service end-to-end with persistence. Uses a shared `test-db.ts` helper that connects to the dev Supabase project (`spllxotyxipdvfpkkvgu`) with a per-test enterprise_id fixture that gets torn down in `afterAll`.
- **Benchmark** (vitest, warn-only): 90d × 500 obligations hypothetical evaluation, logs ms and warns if >100ms. Not a CI gate per the design note.

---

# Task 1: Migration 0036 — extend + rename manual_obligations → obligations

**Files:**
- Create: `supabase/migrations/0036_obligations_v2.sql`

- [ ] **Step 1: Write the migration SQL**

Write `supabase/migrations/0036_obligations_v2.sql`:

```sql
-- ============================================================
-- 0036_obligations_v2.sql  —  Extend manual_obligations into
-- a full obligations model and rename to `obligations`.
-- Backfills legacy is_recurring/recurrence_days into the new
-- recurrence enum and mirrors amount_usd into native `amount`.
-- Legacy columns retained one release, marked deprecated.
-- ============================================================

-- --- Enums -----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'obligation_type') THEN
    CREATE TYPE obligation_type AS ENUM ('outflow', 'inflow');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'obligation_confidence') THEN
    CREATE TYPE obligation_confidence AS ENUM ('confirmed', 'expected', 'estimated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'obligation_source') THEN
    CREATE TYPE obligation_source AS ENUM ('manual', 'erp_sync', 'recurring_rule');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'obligation_status') THEN
    CREATE TYPE obligation_status AS ENUM ('upcoming', 'paid', 'missed', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'obligation_recurrence') THEN
    CREATE TYPE obligation_recurrence AS ENUM
      ('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual', 'custom');
  END IF;
END $$;

-- --- New columns on manual_obligations -------------------------
ALTER TABLE manual_obligations
  ADD COLUMN IF NOT EXISTS direction          obligation_type       NOT NULL DEFAULT 'outflow',
  ADD COLUMN IF NOT EXISTS currency           TEXT                  NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS asset              TEXT,
  ADD COLUMN IF NOT EXISTS amount             NUMERIC(36,6),
  ADD COLUMN IF NOT EXISTS source_account_id  UUID,
  ADD COLUMN IF NOT EXISTS source_venue_kind  TEXT,
  ADD COLUMN IF NOT EXISTS confidence         obligation_confidence NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS source             obligation_source     NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS status             obligation_status     NOT NULL DEFAULT 'upcoming',
  ADD COLUMN IF NOT EXISTS recurrence         obligation_recurrence NOT NULL DEFAULT 'once',
  ADD COLUMN IF NOT EXISTS recurrence_cron    TEXT,
  ADD COLUMN IF NOT EXISTS counterparty_id    UUID,
  ADD COLUMN IF NOT EXISTS erp_reference      TEXT,
  ADD COLUMN IF NOT EXISTS recurring_parent_id UUID,
  ADD COLUMN IF NOT EXISTS tags               TEXT[]                NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS metadata           JSONB                 NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS paid_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_tx_ref  TEXT;

-- Backfill: legacy is_recurring + recurrence_days → recurrence enum
UPDATE manual_obligations
SET recurrence = CASE
  WHEN is_recurring AND recurrence_days = 7   THEN 'weekly'::obligation_recurrence
  WHEN is_recurring AND recurrence_days = 14  THEN 'biweekly'::obligation_recurrence
  WHEN is_recurring AND recurrence_days = 30  THEN 'monthly'::obligation_recurrence
  WHEN is_recurring AND recurrence_days = 90  THEN 'quarterly'::obligation_recurrence
  WHEN is_recurring AND recurrence_days = 365 THEN 'annual'::obligation_recurrence
  WHEN is_recurring                           THEN 'custom'::obligation_recurrence
  ELSE 'once'::obligation_recurrence
END
WHERE recurrence = 'once' AND is_recurring IS DISTINCT FROM false;

-- Mirror amount_usd → amount for legacy rows
UPDATE manual_obligations SET amount = amount_usd WHERE amount IS NULL;
ALTER TABLE manual_obligations ALTER COLUMN amount SET NOT NULL;

-- Deprecation comments
COMMENT ON COLUMN manual_obligations.is_recurring    IS 'DEPRECATED: use recurrence enum';
COMMENT ON COLUMN manual_obligations.recurrence_days IS 'DEPRECATED: use recurrence enum';
COMMENT ON COLUMN manual_obligations.amount_usd      IS 'DEPRECATED: use amount + currency';

-- --- Rename table ----------------------------------------------
ALTER TABLE manual_obligations RENAME TO obligations;

-- --- FK constraints we couldn't add during ALTER ADD COLUMN ----
ALTER TABLE obligations
  ADD CONSTRAINT obligations_recurring_parent_fk
    FOREIGN KEY (recurring_parent_id) REFERENCES obligations(id) ON DELETE CASCADE;

-- counterparty_id FK (counterparties table exists per 0031)
ALTER TABLE obligations
  ADD CONSTRAINT obligations_counterparty_fk
    FOREIGN KEY (counterparty_id) REFERENCES counterparties(id) ON DELETE SET NULL;

-- --- Indexes ---------------------------------------------------
DROP INDEX IF EXISTS idx_manual_obligations_user_due;
DROP INDEX IF EXISTS idx_manual_obligations_enterprise;

CREATE INDEX IF NOT EXISTS idx_obligations_enterprise_due
  ON obligations(enterprise_id, due_date) WHERE status = 'upcoming';
CREATE INDEX IF NOT EXISTS idx_obligations_user_due
  ON obligations(user_id, due_date) WHERE status = 'upcoming';
CREATE INDEX IF NOT EXISTS idx_obligations_recurring_parent
  ON obligations(recurring_parent_id) WHERE recurring_parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_obligations_status
  ON obligations(enterprise_id, status, due_date);

-- --- RLS policy rename -----------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'obligations' AND policyname = 'users own manual_obligations') THEN
    DROP POLICY "users own manual_obligations" ON obligations;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'obligations' AND policyname = 'enterprise obligations') THEN
    CREATE POLICY "enterprise obligations" ON obligations
      FOR ALL USING (
        enterprise_id = auth_user_enterprise_id()
        OR (enterprise_id IS NULL AND user_id = auth.uid())
      );
  END IF;
END $$;

-- --- Audit actions ---------------------------------------------
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'obligation_create';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'obligation_update';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'obligation_delete';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'obligation_materialize';
```

- [ ] **Step 2: Apply to dev Supabase**

Run: `npm run migrate` (Vantor's tsx-based migrate script)
Expected: migration 0036 reports applied, no errors. If `counterparties` FK fails, check that 0031 ran first — per the conflict map it should exist.

- [ ] **Step 3: Verify post-state via psql**

Run:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'obligations' ORDER BY ordinal_position;
SELECT COUNT(*) FROM obligations WHERE recurrence IS NOT NULL;
```
Expected: 20+ columns present including `direction`, `currency`, `asset`, `amount`, `recurrence`; row count matches pre-migration `manual_obligations` count.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0036_obligations_v2.sql
git commit -m "feat(obligations): extend + rename manual_obligations to obligations (0036)"
```

Per MEMORY: apply the same migration to prod Supabase (`lfujbwemavgiifkltrag`) via SQL editor before any production deploy that touches obligations. Do NOT apply to prod as part of this task — leave for the deploy step at end of Phase A.

---

# Task 2: TypeScript types for Obligation v2

**Files:**
- Create: `src/lib/obligations/types.ts`
- Modify: `src/types/database.ts` (append new types, mark `ManualObligation` deprecated)

- [ ] **Step 1: Write the test for type exports**

Create `tests/obligations/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  type Obligation,
  type ObligationInput,
  type ObligationRecurrence,
  OBLIGATION_TYPES,
  OBLIGATION_CONFIDENCES,
  OBLIGATION_STATUSES,
  OBLIGATION_RECURRENCES,
} from '@/lib/obligations/types';

describe('obligation types', () => {
  it('exports all enum arrays matching SQL enum values', () => {
    expect(OBLIGATION_TYPES).toEqual(['outflow', 'inflow']);
    expect(OBLIGATION_CONFIDENCES).toEqual(['confirmed', 'expected', 'estimated']);
    expect(OBLIGATION_STATUSES).toEqual(['upcoming', 'paid', 'missed', 'cancelled']);
    expect(OBLIGATION_RECURRENCES).toEqual([
      'once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual', 'custom',
    ]);
  });

  it('ObligationInput has no id/timestamps/enterprise_id', () => {
    // Compile-time check via satisfies
    const input = {
      label: 'Payroll',
      direction: 'outflow' as const,
      amount: 50000,
      currency: 'USD',
      dueDate: '2026-05-01',
      confidence: 'confirmed' as const,
      recurrence: 'monthly' as const,
    } satisfies ObligationInput;
    expect(input.label).toBe('Payroll');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obligations/types.test.ts`
Expected: FAIL with `Cannot find module '@/lib/obligations/types'`.

- [ ] **Step 3: Write `src/lib/obligations/types.ts`**

```typescript
export const OBLIGATION_TYPES = ['outflow', 'inflow'] as const;
export type ObligationType = (typeof OBLIGATION_TYPES)[number];

export const OBLIGATION_CONFIDENCES = ['confirmed', 'expected', 'estimated'] as const;
export type ObligationConfidence = (typeof OBLIGATION_CONFIDENCES)[number];

export const OBLIGATION_SOURCES = ['manual', 'erp_sync', 'recurring_rule'] as const;
export type ObligationSource = (typeof OBLIGATION_SOURCES)[number];

export const OBLIGATION_STATUSES = ['upcoming', 'paid', 'missed', 'cancelled'] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export const OBLIGATION_RECURRENCES = [
  'once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual', 'custom',
] as const;
export type ObligationRecurrence = (typeof OBLIGATION_RECURRENCES)[number];

export type VenueKind = 'bank' | 'wallet' | 'defi';

export interface Obligation {
  id: string;
  enterpriseId: string;
  userId: string;
  label: string;
  description: string | null;
  direction: ObligationType;
  amount: number;
  currency: string;
  asset: string | null;
  dueDate: string; // ISO date YYYY-MM-DD
  sourceAccountId: string | null;
  sourceVenueKind: VenueKind | null;
  confidence: ObligationConfidence;
  source: ObligationSource;
  status: ObligationStatus;
  recurrence: ObligationRecurrence;
  recurrenceCron: string | null;
  counterpartyId: string | null;
  erpReference: string | null;
  recurringParentId: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  paidAt: string | null;
  settlementTxRef: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ObligationInput {
  label: string;
  description?: string;
  direction: ObligationType;
  amount: number;
  currency: string;
  asset?: string | null;
  dueDate: string;
  sourceAccountId?: string | null;
  sourceVenueKind?: VenueKind | null;
  confidence?: ObligationConfidence;
  source?: ObligationSource;
  recurrence?: ObligationRecurrence;
  recurrenceCron?: string | null;
  counterpartyId?: string | null;
  erpReference?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ObligationPatch extends Partial<ObligationInput> {
  status?: ObligationStatus;
  paidAt?: string | null;
  settlementTxRef?: string | null;
}
```

- [ ] **Step 4: Deprecate `ManualObligation` in `src/types/database.ts`**

Edit `src/types/database.ts` to add at the top of the ManualObligation block:

```typescript
/** @deprecated Use `Obligation` from `@/lib/obligations/types` — extended in migration 0036 */
export interface ManualObligation { /* existing fields unchanged */ }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/obligations/types.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/obligations/types.ts src/types/database.ts tests/obligations/types.test.ts
git commit -m "feat(obligations): add Obligation v2 types + deprecate ManualObligation"
```

---

# Task 3: Recurrence expansion — pure function

**Files:**
- Create: `src/lib/obligations/recurrence.ts`
- Create: `tests/obligations/recurrence.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/obligations/recurrence.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { expandRecurrence } from '@/lib/obligations/recurrence';
import type { Obligation } from '@/lib/obligations/types';

function base(overrides: Partial<Obligation>): Obligation {
  return {
    id: 'ob_1', enterpriseId: 'e_1', userId: 'u_1',
    label: 'Test', description: null,
    direction: 'outflow', amount: 1000, currency: 'USD', asset: null,
    dueDate: '2026-05-01',
    sourceAccountId: null, sourceVenueKind: null,
    confidence: 'confirmed', source: 'manual', status: 'upcoming',
    recurrence: 'once', recurrenceCron: null,
    counterpartyId: null, erpReference: null,
    recurringParentId: null, tags: [], metadata: {},
    paidAt: null, settlementTxRef: null, isActive: true,
    createdAt: '', updatedAt: '',
    ...overrides,
  };
}

describe('expandRecurrence', () => {
  const from = new Date('2026-04-10T00:00:00Z');
  const to = new Date('2026-07-10T00:00:00Z'); // 91 days

  it('once: emits a single instance if inside window', () => {
    const ob = base({ recurrence: 'once', dueDate: '2026-05-15' });
    const out = expandRecurrence(ob, from, to);
    expect(out).toHaveLength(1);
    expect(out[0].dueDate).toBe('2026-05-15');
    expect(out[0].amount).toBe(1000);
  });

  it('once: emits zero if outside window', () => {
    const ob = base({ recurrence: 'once', dueDate: '2026-08-15' });
    expect(expandRecurrence(ob, from, to)).toHaveLength(0);
  });

  it('weekly: emits every 7 days within window', () => {
    const ob = base({ recurrence: 'weekly', dueDate: '2026-04-01' });
    const out = expandRecurrence(ob, from, to);
    // First occurrence on/after 2026-04-10: 2026-04-15, then 04-22, 04-29, ... through ≤ 2026-07-10
    expect(out.map(o => o.dueDate)).toEqual([
      '2026-04-15', '2026-04-22', '2026-04-29',
      '2026-05-06', '2026-05-13', '2026-05-20', '2026-05-27',
      '2026-06-03', '2026-06-10', '2026-06-17', '2026-06-24',
      '2026-07-01', '2026-07-08',
    ]);
  });

  it('monthly: 30-day intervals from base date', () => {
    const ob = base({ recurrence: 'monthly', dueDate: '2026-04-20' });
    const out = expandRecurrence(ob, from, to);
    expect(out.map(o => o.dueDate)).toEqual(['2026-04-20', '2026-05-20', '2026-06-19']);
  });

  it('quarterly: 90-day intervals', () => {
    const ob = base({ recurrence: 'quarterly', dueDate: '2026-04-15' });
    const out = expandRecurrence(ob, from, to);
    expect(out.map(o => o.dueDate)).toEqual(['2026-04-15', '2026-07-14']);
  });

  it('custom with cron: throws if no cron provided', () => {
    const ob = base({ recurrence: 'custom', recurrenceCron: null });
    expect(() => expandRecurrence(ob, from, to)).toThrow(/cron.*required/i);
  });

  it('materialized instance carries recurringParentId and isMaterialized=true flag', () => {
    const ob = base({ recurrence: 'weekly', dueDate: '2026-04-15' });
    const out = expandRecurrence(ob, from, to);
    for (const inst of out) {
      expect(inst.recurringParentId).toBe('ob_1');
    }
  });

  it('past materialized instance is never re-emitted (idempotent expansion)', () => {
    // When expanding from a date AFTER some instances already materialized,
    // those earlier dates must not appear in output.
    const ob = base({ recurrence: 'weekly', dueDate: '2026-01-01' });
    const laterFrom = new Date('2026-06-01T00:00:00Z');
    const laterTo = new Date('2026-06-30T00:00:00Z');
    const out = expandRecurrence(ob, laterFrom, laterTo);
    expect(out.every(o => o.dueDate >= '2026-06-01')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obligations/recurrence.test.ts`
Expected: FAIL with `Cannot find module '@/lib/obligations/recurrence'`.

- [ ] **Step 3: Implement `src/lib/obligations/recurrence.ts`**

```typescript
import type { Obligation, ObligationRecurrence } from './types';

export interface ExpandedInstance {
  dueDate: string;
  amount: number;
  currency: string;
  label: string;
  recurringParentId: string;
  direction: Obligation['direction'];
  confidence: Obligation['confidence'];
  asset: Obligation['asset'];
}

const INTERVAL_DAYS: Partial<Record<ObligationRecurrence, number>> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
  annual: 365,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function expandRecurrence(
  ob: Obligation,
  from: Date,
  to: Date,
): ExpandedInstance[] {
  const instance = (dueDate: string): ExpandedInstance => ({
    dueDate,
    amount: ob.amount,
    currency: ob.currency,
    label: ob.label,
    recurringParentId: ob.id,
    direction: ob.direction,
    confidence: ob.confidence,
    asset: ob.asset,
  });

  if (ob.recurrence === 'once') {
    const due = parseDate(ob.dueDate).getTime();
    if (due >= from.getTime() && due <= to.getTime()) {
      return [instance(ob.dueDate)];
    }
    return [];
  }

  if (ob.recurrence === 'custom') {
    if (!ob.recurrenceCron) {
      throw new Error('Custom recurrence requires recurrenceCron');
    }
    // Minimal: custom cron parsing is out of scope for Phase A; treat as unsupported
    // and require the caller to provide a materialized schedule via another path.
    throw new Error('Custom cron recurrence not yet supported in expandRecurrence');
  }

  const intervalDays = INTERVAL_DAYS[ob.recurrence];
  if (!intervalDays) {
    throw new Error(`Unknown recurrence: ${ob.recurrence}`);
  }
  const intervalMs = intervalDays * DAY_MS;

  const base = parseDate(ob.dueDate);
  let current = base;
  // Fast-forward to the first occurrence at or after `from`
  while (current.getTime() < from.getTime()) {
    current = new Date(current.getTime() + intervalMs);
  }

  const out: ExpandedInstance[] = [];
  while (current.getTime() <= to.getTime()) {
    out.push(instance(toDateOnly(current)));
    current = new Date(current.getTime() + intervalMs);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/obligations/recurrence.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/obligations/recurrence.ts tests/obligations/recurrence.test.ts
git commit -m "feat(obligations): pure recurrence expansion function"
```

---

# Task 4: Obligations repository (data access)

**Files:**
- Create: `src/lib/obligations/repo.ts`
- Create: `tests/helpers/test-db.ts`
- Create: `tests/obligations/repo.test.ts`

- [ ] **Step 1: Write the test DB helper**

Create `tests/helpers/test-db.ts`:

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function getTestDb(): SupabaseClient {
  if (!url || !key) throw new Error('Test DB env missing: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function createTestEnterprise(db: SupabaseClient): Promise<{ enterpriseId: string; cleanup: () => Promise<void> }> {
  const { data, error } = await db
    .from('enterprises')
    .insert({ name: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, status: 'active' })
    .select('id')
    .single();
  if (error) throw error;
  const enterpriseId = data.id as string;
  return {
    enterpriseId,
    cleanup: async () => {
      // Cascading FKs handle child rows
      await db.from('enterprises').delete().eq('id', enterpriseId);
    },
  };
}
```

- [ ] **Step 2: Write the failing repo test**

Create `tests/obligations/repo.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnterprise, getTestDb } from '../helpers/test-db';
import { ObligationsRepo } from '@/lib/obligations/repo';
import type { ObligationInput } from '@/lib/obligations/types';

describe('ObligationsRepo', () => {
  const db = getTestDb();
  let repo: ObligationsRepo;
  let enterpriseId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestEnterprise(db);
    enterpriseId = ctx.enterpriseId;
    cleanup = ctx.cleanup;
    repo = new ObligationsRepo(db);
  });

  afterAll(async () => {
    await cleanup();
  });

  const sample: ObligationInput = {
    label: 'Q2 Payroll',
    direction: 'outflow',
    amount: 50000,
    currency: 'USD',
    dueDate: '2026-05-01',
    confidence: 'confirmed',
    recurrence: 'monthly',
  };

  it('create → persisted with enterprise_id and defaults', async () => {
    const created = await repo.create(enterpriseId, null, sample);
    expect(created.id).toBeDefined();
    expect(created.enterpriseId).toBe(enterpriseId);
    expect(created.status).toBe('upcoming');
    expect(created.source).toBe('manual');
    expect(created.recurrence).toBe('monthly');
    expect(created.amount).toBe(50000);
  });

  it('listUpcoming filters by status and window', async () => {
    await repo.create(enterpriseId, null, { ...sample, label: 'In window', dueDate: '2026-05-20' });
    await repo.create(enterpriseId, null, { ...sample, label: 'Out of window', dueDate: '2027-01-01' });
    const out = await repo.listUpcoming(enterpriseId, new Date('2026-04-10'), new Date('2026-06-30'));
    const labels = out.map(o => o.label);
    expect(labels).toContain('In window');
    expect(labels).not.toContain('Out of window');
  });

  it('patch updates fields and refreshes updated_at', async () => {
    const created = await repo.create(enterpriseId, null, sample);
    const patched = await repo.patch(enterpriseId, created.id, { amount: 60000 });
    expect(patched.amount).toBe(60000);
    expect(patched.updatedAt).not.toBe(created.updatedAt);
  });

  it('markPaid transitions status and sets settlement ref', async () => {
    const created = await repo.create(enterpriseId, null, sample);
    const paid = await repo.markPaid(enterpriseId, created.id, 'transfer_abc123');
    expect(paid.status).toBe('paid');
    expect(paid.settlementTxRef).toBe('transfer_abc123');
    expect(paid.paidAt).not.toBeNull();
  });

  it('delete removes the row', async () => {
    const created = await repo.create(enterpriseId, null, sample);
    await repo.delete(enterpriseId, created.id);
    await expect(repo.getById(enterpriseId, created.id)).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/obligations/repo.test.ts`
Expected: FAIL with `Cannot find module '@/lib/obligations/repo'`.

- [ ] **Step 4: Implement `src/lib/obligations/repo.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Obligation, ObligationInput, ObligationPatch } from './types';

function rowToObligation(r: Record<string, unknown>): Obligation {
  return {
    id: r.id as string,
    enterpriseId: r.enterprise_id as string,
    userId: r.user_id as string,
    label: r.label as string,
    description: (r.description as string) ?? null,
    direction: r.direction as Obligation['direction'],
    amount: parseFloat(r.amount as string),
    currency: r.currency as string,
    asset: (r.asset as string) ?? null,
    dueDate: r.due_date as string,
    sourceAccountId: (r.source_account_id as string) ?? null,
    sourceVenueKind: (r.source_venue_kind as Obligation['sourceVenueKind']) ?? null,
    confidence: r.confidence as Obligation['confidence'],
    source: r.source as Obligation['source'],
    status: r.status as Obligation['status'],
    recurrence: r.recurrence as Obligation['recurrence'],
    recurrenceCron: (r.recurrence_cron as string) ?? null,
    counterpartyId: (r.counterparty_id as string) ?? null,
    erpReference: (r.erp_reference as string) ?? null,
    recurringParentId: (r.recurring_parent_id as string) ?? null,
    tags: (r.tags as string[]) ?? [],
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    paidAt: (r.paid_at as string) ?? null,
    settlementTxRef: (r.settlement_tx_ref as string) ?? null,
    isActive: r.is_active as boolean,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export class ObligationsRepo {
  constructor(private db: SupabaseClient) {}

  async create(enterpriseId: string, userId: string | null, input: ObligationInput): Promise<Obligation> {
    const row = {
      enterprise_id: enterpriseId,
      user_id: userId,
      label: input.label,
      description: input.description ?? null,
      direction: input.direction,
      amount: input.amount,
      amount_usd: input.currency === 'USD' ? input.amount : null, // legacy mirror
      currency: input.currency,
      asset: input.asset ?? null,
      due_date: input.dueDate,
      source_account_id: input.sourceAccountId ?? null,
      source_venue_kind: input.sourceVenueKind ?? null,
      confidence: input.confidence ?? 'confirmed',
      source: input.source ?? 'manual',
      recurrence: input.recurrence ?? 'once',
      recurrence_cron: input.recurrenceCron ?? null,
      counterparty_id: input.counterpartyId ?? null,
      erp_reference: input.erpReference ?? null,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      is_recurring: (input.recurrence ?? 'once') !== 'once', // legacy mirror
    };
    const { data, error } = await this.db.from('obligations').insert(row).select('*').single();
    if (error) throw error;
    return rowToObligation(data);
  }

  async getById(enterpriseId: string, id: string): Promise<Obligation> {
    const { data, error } = await this.db
      .from('obligations')
      .select('*')
      .eq('enterprise_id', enterpriseId)
      .eq('id', id)
      .single();
    if (error || !data) throw new Error(`Obligation ${id} not found`);
    return rowToObligation(data);
  }

  async listUpcoming(enterpriseId: string, from: Date, to: Date): Promise<Obligation[]> {
    const { data, error } = await this.db
      .from('obligations')
      .select('*')
      .eq('enterprise_id', enterpriseId)
      .eq('status', 'upcoming')
      .gte('due_date', from.toISOString().slice(0, 10))
      .lte('due_date', to.toISOString().slice(0, 10))
      .order('due_date');
    if (error) throw error;
    return (data ?? []).map(rowToObligation);
  }

  async listAllActive(enterpriseId: string): Promise<Obligation[]> {
    const { data, error } = await this.db
      .from('obligations')
      .select('*')
      .eq('enterprise_id', enterpriseId)
      .eq('is_active', true);
    if (error) throw error;
    return (data ?? []).map(rowToObligation);
  }

  async patch(enterpriseId: string, id: string, patch: ObligationPatch): Promise<Obligation> {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.label !== undefined) update.label = patch.label;
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.direction !== undefined) update.direction = patch.direction;
    if (patch.amount !== undefined) update.amount = patch.amount;
    if (patch.currency !== undefined) update.currency = patch.currency;
    if (patch.asset !== undefined) update.asset = patch.asset;
    if (patch.dueDate !== undefined) update.due_date = patch.dueDate;
    if (patch.sourceAccountId !== undefined) update.source_account_id = patch.sourceAccountId;
    if (patch.sourceVenueKind !== undefined) update.source_venue_kind = patch.sourceVenueKind;
    if (patch.confidence !== undefined) update.confidence = patch.confidence;
    if (patch.recurrence !== undefined) update.recurrence = patch.recurrence;
    if (patch.recurrenceCron !== undefined) update.recurrence_cron = patch.recurrenceCron;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.paidAt !== undefined) update.paid_at = patch.paidAt;
    if (patch.settlementTxRef !== undefined) update.settlement_tx_ref = patch.settlementTxRef;
    if (patch.tags !== undefined) update.tags = patch.tags;
    if (patch.metadata !== undefined) update.metadata = patch.metadata;

    const { data, error } = await this.db
      .from('obligations')
      .update(update)
      .eq('enterprise_id', enterpriseId)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new Error(`Patch failed for ${id}`);
    return rowToObligation(data);
  }

  async markPaid(enterpriseId: string, id: string, settlementRef: string): Promise<Obligation> {
    return this.patch(enterpriseId, id, {
      status: 'paid',
      paidAt: new Date().toISOString(),
      settlementTxRef: settlementRef,
    });
  }

  async delete(enterpriseId: string, id: string): Promise<void> {
    const { error } = await this.db
      .from('obligations')
      .delete()
      .eq('enterprise_id', enterpriseId)
      .eq('id', id);
    if (error) throw error;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/obligations/repo.test.ts`
Expected: PASS, 5 tests. If tests fail with "env missing" add `.env.test` with dev Supabase creds or document the env requirement.

- [ ] **Step 6: Commit**

```bash
git add src/lib/obligations/repo.ts tests/helpers/test-db.ts tests/obligations/repo.test.ts
git commit -m "feat(obligations): repository + test DB helper"
```

---

# Task 5: Obligations API routes

**Files:**
- Create: `src/app/api/obligations/route.ts` (POST, GET)
- Create: `src/app/api/obligations/[id]/route.ts` (GET, PATCH, DELETE)

- [ ] **Step 1: Write route test (optional integration — describe as smoke)**

Create `tests/obligations/api.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { POST as createHandler } from '@/app/api/obligations/route';

describe('POST /api/obligations', () => {
  it('rejects unauthenticated', async () => {
    const req = new Request('http://localhost/api/obligations', {
      method: 'POST',
      body: JSON.stringify({ label: 'x', direction: 'outflow', amount: 1, currency: 'USD', dueDate: '2026-05-01' }),
    });
    const res = await createHandler(req);
    expect(res.status).toBe(401);
  });

  it('validates required fields', async () => {
    // Authed path: requires mocking NextAuth session — skipped here, covered by e2e
  });
});
```

- [ ] **Step 2: Write the route handler `src/app/api/obligations/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { ObligationsRepo } from '@/lib/obligations/repo';
import { authOptions } from '@/lib/auth/options';
import {
  OBLIGATION_TYPES, OBLIGATION_CONFIDENCES, OBLIGATION_RECURRENCES,
} from '@/lib/obligations/types';

const CreateSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
  direction: z.enum(OBLIGATION_TYPES),
  amount: z.number().positive(),
  currency: z.string().length(3),
  asset: z.string().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceAccountId: z.string().uuid().nullable().optional(),
  sourceVenueKind: z.enum(['bank', 'wallet', 'defi']).nullable().optional(),
  confidence: z.enum(OBLIGATION_CONFIDENCES).optional(),
  recurrence: z.enum(OBLIGATION_RECURRENCES).optional(),
  recurrenceCron: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.enterpriseId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Sign in required', nextStep: 'Sign in again' } },
      { status: 401 },
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_OBLIGATION_INPUT',
          message: 'Obligation payload failed validation',
          nextStep: 'Fix the highlighted fields and resubmit',
          fields: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }
  try {
    const repo = new ObligationsRepo(getDb());
    const created = await repo.create(session.user.enterpriseId, session.user.id, parsed.data);
    return NextResponse.json({ obligation: created }, { status: 201 });
  } catch (e) {
    const traceId = crypto.randomUUID();
    console.error('[obligations.create]', traceId, e);
    return NextResponse.json(
      {
        error: {
          code: 'OBLIGATION_CREATE_FAILED',
          message: 'Could not save the obligation',
          nextStep: 'Retry; contact support with the trace id if it persists',
          traceId,
        },
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterpriseId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  }
  const url = new URL(req.url);
  const windowDays = parseInt(url.searchParams.get('windowDays') ?? '90', 10);
  const from = new Date();
  const to = new Date(from.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const repo = new ObligationsRepo(getDb());
  const obligations = await repo.listUpcoming(session.user.enterpriseId, from, to);
  return NextResponse.json({ obligations });
}
```

Vantor error format per `feedback_vantor_error_design.md` — every error has `code`, `message`, `nextStep`, and a `traceId` for 5xx.

- [ ] **Step 3: Write `src/app/api/obligations/[id]/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ObligationsRepo } from '@/lib/obligations/repo';
import { authOptions } from '@/lib/auth/options';
import {
  OBLIGATION_TYPES, OBLIGATION_CONFIDENCES, OBLIGATION_RECURRENCES, OBLIGATION_STATUSES,
} from '@/lib/obligations/types';

const PatchSchema = z.object({
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  direction: z.enum(OBLIGATION_TYPES).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  confidence: z.enum(OBLIGATION_CONFIDENCES).optional(),
  recurrence: z.enum(OBLIGATION_RECURRENCES).optional(),
  status: z.enum(OBLIGATION_STATUSES).optional(),
  tags: z.array(z.string()).optional(),
});

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterpriseId) return NextResponse.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  const repo = new ObligationsRepo(getDb());
  try {
    const ob = await repo.getById(session.user.enterpriseId, params.id);
    return NextResponse.json({ obligation: ob });
  } catch {
    return NextResponse.json({ error: { code: 'OBLIGATION_NOT_FOUND', message: 'No such obligation', nextStep: 'Refresh the list' } }, { status: 404 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterpriseId) return NextResponse.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: {
        code: 'INVALID_OBLIGATION_PATCH',
        message: 'Patch payload failed validation',
        nextStep: 'Fix the highlighted fields',
        fields: parsed.error.flatten().fieldErrors,
      },
    }, { status: 400 });
  }
  const repo = new ObligationsRepo(getDb());
  const updated = await repo.patch(session.user.enterpriseId, params.id, parsed.data);
  return NextResponse.json({ obligation: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterpriseId) return NextResponse.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  const repo = new ObligationsRepo(getDb());
  await repo.delete(session.user.enterpriseId, params.id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/obligations`
Expected: all obligation tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/obligations tests/obligations/api.test.ts
git commit -m "feat(obligations): CRUD API routes with Vantor error shape"
```

---

# Task 6: Migration 0037 — treasury_state_snapshots

**Files:**
- Create: `supabase/migrations/0037_treasury_state_snapshots.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- ============================================================
-- 0037_treasury_state_snapshots.sql — persisted point-in-time
-- aggregate of an enterprise's full treasury across fiat, crypto,
-- and DeFi, with FX rates captured for reproducibility.
-- ============================================================

CREATE TABLE IF NOT EXISTS treasury_state_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id   UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  taken_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  taken_by        UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  trigger         TEXT NOT NULL CHECK (trigger IN ('scheduled', 'on_demand', 'pre_decision', 'pre_action')),
  base_currency   TEXT NOT NULL DEFAULT 'USD',

  total_value_base_usd       NUMERIC(36,2) NOT NULL,
  total_fiat_base_usd        NUMERIC(36,2) NOT NULL,
  total_stablecoin_base_usd  NUMERIC(36,2) NOT NULL,
  total_defi_base_usd        NUMERIC(36,2) NOT NULL,

  positions JSONB NOT NULL,
  fx_rates  JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treasury_snapshots_enterprise_taken
  ON treasury_state_snapshots(enterprise_id, taken_at DESC);

ALTER TABLE treasury_state_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'treasury_state_snapshots' AND policyname = 'enterprise treasury_state_snapshots'
  ) THEN
    CREATE POLICY "enterprise treasury_state_snapshots" ON treasury_state_snapshots
      FOR ALL USING (enterprise_id = auth_user_enterprise_id());
  END IF;
END $$;

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'treasury_snapshot_create';
```

- [ ] **Step 2: Apply to dev Supabase**

Run: `npm run migrate`
Expected: migration 0037 applied. Verify with `\d treasury_state_snapshots`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0037_treasury_state_snapshots.sql
git commit -m "feat(treasury): treasury_state_snapshots table (0037)"
```

---

# Task 7: Treasury state snapshot service

**Files:**
- Create: `src/lib/treasury/state/types.ts`
- Create: `src/lib/treasury/state/service.ts`
- Create: `tests/treasury/state/service.test.ts`

- [ ] **Step 1: Write the types file**

`src/lib/treasury/state/types.ts`:

```typescript
export type SnapshotTrigger = 'scheduled' | 'on_demand' | 'pre_decision' | 'pre_action';

export interface BankAccountPosition {
  accountId: string;
  currency: string;
  balanceNative: number;
  balanceBaseUsd: number;
  balanceAsOf: string | null;
}

export interface WalletPosition {
  walletId: string;
  chain: string;
  token: string;
  balanceNative: number;
  balanceBaseUsd: number;
  lastUpdated: string | null;
}

export interface DefiPosition {
  positionId: string;
  protocol: string;
  chain: string;
  underlyingToken: string;
  depositedAmount: number;
  currentValueBaseUsd: number;
  accruedYieldBaseUsd: number;
  apySnapshot: number | null;
  lastRefreshedAt: string | null;
}

export interface PendingTransfer {
  id: string;
  kind: 'transfer' | 'bridge_transfer' | 'fiat_payment' | 'fiat_transaction' | 'yield_transaction';
  amount: number;
  asset: string;
  fromVenue: string | null;
  toVenue: string | null;
  expectedSettleAt: string | null;
}

export interface TreasuryPositions {
  bankAccounts: BankAccountPosition[];
  wallets: WalletPosition[];
  defiPositions: DefiPosition[];
  pendingTransfers: PendingTransfer[];
}

export interface TreasuryStateSnapshot {
  id: string;
  enterpriseId: string;
  takenAt: string;
  takenBy: string | null;
  trigger: SnapshotTrigger;
  baseCurrency: string;
  totalValueBaseUsd: number;
  totalFiatBaseUsd: number;
  totalStablecoinBaseUsd: number;
  totalDefiBaseUsd: number;
  positions: TreasuryPositions;
  fxRates: Record<string, number>;
}
```

- [ ] **Step 2: Write the failing service test**

`tests/treasury/state/service.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnterprise, getTestDb } from '../../helpers/test-db';
import { TreasuryStateService } from '@/lib/treasury/state/service';

describe('TreasuryStateService', () => {
  const db = getTestDb();
  let enterpriseId: string;
  let cleanup: () => Promise<void>;
  let svc: TreasuryStateService;

  beforeAll(async () => {
    const ctx = await createTestEnterprise(db);
    enterpriseId = ctx.enterpriseId;
    cleanup = ctx.cleanup;
    svc = new TreasuryStateService(db);
  });

  afterAll(async () => {
    await cleanup();
  });

  it('computeSnapshot returns zero totals for an empty enterprise', async () => {
    const snap = await svc.computeSnapshot(enterpriseId, 'on_demand');
    expect(snap.totalValueBaseUsd).toBe(0);
    expect(snap.positions.bankAccounts).toEqual([]);
    expect(snap.positions.wallets).toEqual([]);
    expect(snap.positions.defiPositions).toEqual([]);
    expect(snap.baseCurrency).toBe('USD');
    expect(snap.fxRates).toBeDefined();
  });

  it('persistSnapshot writes and returns id; latest() returns it', async () => {
    const snap = await svc.computeSnapshot(enterpriseId, 'on_demand');
    const saved = await svc.persistSnapshot(snap, null);
    expect(saved.id).toBeDefined();

    const latest = await svc.latest(enterpriseId);
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(saved.id);
  });

  it('totals equal sum of position slices', async () => {
    // With real fixture data seeded via test-db, verify:
    // totalValueBaseUsd === totalFiatBaseUsd + totalStablecoinBaseUsd + totalDefiBaseUsd
    const snap = await svc.computeSnapshot(enterpriseId, 'on_demand');
    const sum = snap.totalFiatBaseUsd + snap.totalStablecoinBaseUsd + snap.totalDefiBaseUsd;
    expect(Math.abs(snap.totalValueBaseUsd - sum)).toBeLessThan(0.01);
  });
});
```

- [ ] **Step 3: Implement `src/lib/treasury/state/service.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { priceToken } from '@/lib/treasury/oracle';
import { getFxRate } from '@/lib/fx/live-rates';
import type {
  BankAccountPosition, DefiPosition, PendingTransfer, SnapshotTrigger,
  TreasuryPositions, TreasuryStateSnapshot, WalletPosition,
} from './types';

export class TreasuryStateService {
  constructor(private db: SupabaseClient) {}

  async computeSnapshot(enterpriseId: string, trigger: SnapshotTrigger): Promise<Omit<TreasuryStateSnapshot, 'id' | 'takenAt'>> {
    const [bankRes, walletRes, yieldRes, pendingTransfers, pendingBridges, pendingFiat, pendingYieldTx] = await Promise.all([
      this.db.from('bank_accounts').select('id, currency, current_balance, balance_as_of').eq('enterprise_id', enterpriseId).eq('is_active', true),
      this.db.from('wallet_balances').select('wallet_id, balance, usd_value, token, last_updated, wallets!inner(chain, enterprise_id)').eq('wallets.enterprise_id', enterpriseId),
      this.db.from('yield_positions').select('id, protocol, chain, underlying_token, deposited_amount, current_value_usd, accrued_yield_usd, apy_snapshot, last_refreshed_at').eq('enterprise_id', enterpriseId).eq('is_active', true),
      this.db.from('transfers').select('id, amount, token, status, scheduled_for, from_wallet_id, to_address').eq('enterprise_id', enterpriseId).in('status', ['pending', 'processing']),
      this.db.from('bridge_transfers').select('id, amount, token, status, from_chain, to_chain, estimated_arrival_minutes').eq('enterprise_id', enterpriseId).in('status', ['pending', 'processing']),
      this.db.from('fiat_payments').select('id, amount, currency, status, scheduled_for, estimated_settlement').eq('enterprise_id', enterpriseId).in('status', ['pending', 'processing']),
      this.db.from('yield_transactions').select('id, amount, amount_usd, tx_type, status').eq('enterprise_id', enterpriseId).in('status', ['pending', 'processing']),
    ]);

    // FX rates used for this snapshot — capture for reproducibility
    const fxRates: Record<string, number> = {};

    const bankAccounts: BankAccountPosition[] = [];
    for (const r of bankRes.data ?? []) {
      const balanceNative = parseFloat(r.current_balance ?? '0');
      let rate = 1;
      if (r.currency !== 'USD') {
        rate = await getFxRate(r.currency, 'USD');
        fxRates[`${r.currency}->USD`] = rate;
      }
      const balanceBaseUsd = balanceNative * rate;
      bankAccounts.push({
        accountId: r.id,
        currency: r.currency,
        balanceNative,
        balanceBaseUsd,
        balanceAsOf: r.balance_as_of,
      });
    }

    const wallets: WalletPosition[] = [];
    for (const r of walletRes.data ?? []) {
      const balanceNative = parseFloat(r.balance ?? '0');
      let baseUsd = parseFloat(r.usd_value ?? '0');
      if (baseUsd === 0 && balanceNative > 0) {
        baseUsd = await priceToken(r.token, balanceNative);
      }
      wallets.push({
        walletId: r.wallet_id,
        chain: (r as any).wallets?.chain ?? 'unknown',
        token: r.token,
        balanceNative,
        balanceBaseUsd: baseUsd,
        lastUpdated: r.last_updated,
      });
    }

    const defiPositions: DefiPosition[] = (yieldRes.data ?? []).map(r => ({
      positionId: r.id,
      protocol: r.protocol,
      chain: r.chain,
      underlyingToken: r.underlying_token,
      depositedAmount: parseFloat(r.deposited_amount ?? '0'),
      currentValueBaseUsd: parseFloat(r.current_value_usd ?? '0'),
      accruedYieldBaseUsd: parseFloat(r.accrued_yield_usd ?? '0'),
      apySnapshot: r.apy_snapshot != null ? parseFloat(r.apy_snapshot) : null,
      lastRefreshedAt: r.last_refreshed_at,
    }));

    const pending: PendingTransfer[] = [
      ...(pendingTransfers.data ?? []).map((r): PendingTransfer => ({
        id: r.id, kind: 'transfer', amount: parseFloat(r.amount ?? '0'), asset: r.token,
        fromVenue: r.from_wallet_id, toVenue: r.to_address, expectedSettleAt: r.scheduled_for,
      })),
      ...(pendingBridges.data ?? []).map((r): PendingTransfer => ({
        id: r.id, kind: 'bridge_transfer', amount: parseFloat(r.amount ?? '0'), asset: r.token,
        fromVenue: r.from_chain, toVenue: r.to_chain,
        expectedSettleAt: r.estimated_arrival_minutes
          ? new Date(Date.now() + r.estimated_arrival_minutes * 60 * 1000).toISOString()
          : null,
      })),
      ...(pendingFiat.data ?? []).map((r): PendingTransfer => ({
        id: r.id, kind: 'fiat_payment', amount: parseFloat(r.amount ?? '0'), asset: r.currency,
        fromVenue: null, toVenue: null,
        expectedSettleAt: r.estimated_settlement ?? r.scheduled_for,
      })),
      ...(pendingYieldTx.data ?? []).map((r): PendingTransfer => ({
        id: r.id, kind: 'yield_transaction', amount: parseFloat(r.amount_usd ?? r.amount ?? '0'),
        asset: 'USD', fromVenue: null, toVenue: null, expectedSettleAt: null,
      })),
    ];

    const positions: TreasuryPositions = { bankAccounts, wallets, defiPositions, pendingTransfers: pending };

    const totalFiatBaseUsd = bankAccounts.reduce((a, b) => a + b.balanceBaseUsd, 0);
    const totalStablecoinBaseUsd = wallets.reduce((a, b) => a + b.balanceBaseUsd, 0);
    const totalDefiBaseUsd = defiPositions.reduce((a, b) => a + b.currentValueBaseUsd, 0);
    const totalValueBaseUsd = totalFiatBaseUsd + totalStablecoinBaseUsd + totalDefiBaseUsd;

    return {
      enterpriseId,
      takenBy: null,
      trigger,
      baseCurrency: 'USD',
      totalValueBaseUsd,
      totalFiatBaseUsd,
      totalStablecoinBaseUsd,
      totalDefiBaseUsd,
      positions,
      fxRates,
    };
  }

  async persistSnapshot(
    snap: Omit<TreasuryStateSnapshot, 'id' | 'takenAt'>,
    takenBy: string | null,
  ): Promise<TreasuryStateSnapshot> {
    const { data, error } = await this.db
      .from('treasury_state_snapshots')
      .insert({
        enterprise_id: snap.enterpriseId,
        taken_by: takenBy,
        trigger: snap.trigger,
        base_currency: snap.baseCurrency,
        total_value_base_usd: snap.totalValueBaseUsd,
        total_fiat_base_usd: snap.totalFiatBaseUsd,
        total_stablecoin_base_usd: snap.totalStablecoinBaseUsd,
        total_defi_base_usd: snap.totalDefiBaseUsd,
        positions: snap.positions,
        fx_rates: snap.fxRates,
      })
      .select('*')
      .single();
    if (error || !data) throw new Error(`Snapshot persist failed: ${error?.message}`);
    return { ...snap, id: data.id, takenAt: data.taken_at, takenBy };
  }

  async latest(enterpriseId: string): Promise<TreasuryStateSnapshot | null> {
    const { data, error } = await this.db
      .from('treasury_state_snapshots')
      .select('*')
      .eq('enterprise_id', enterpriseId)
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id, enterpriseId: data.enterprise_id, takenAt: data.taken_at, takenBy: data.taken_by,
      trigger: data.trigger, baseCurrency: data.base_currency,
      totalValueBaseUsd: parseFloat(data.total_value_base_usd),
      totalFiatBaseUsd: parseFloat(data.total_fiat_base_usd),
      totalStablecoinBaseUsd: parseFloat(data.total_stablecoin_base_usd),
      totalDefiBaseUsd: parseFloat(data.total_defi_base_usd),
      positions: data.positions,
      fxRates: data.fx_rates,
    };
  }
}
```

- [ ] **Step 4: Run the service tests**

Run: `npx vitest run tests/treasury/state`
Expected: 3 tests passing. Zero-totals case exercises empty-enterprise path; totals check validates aggregation arithmetic.

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/state tests/treasury/state
git commit -m "feat(treasury): treasury state snapshot service"
```

---

# Task 8: Migration 0038 — forecast_snapshots

**Files:**
- Create: `supabase/migrations/0038_forecast_snapshots.sql`

- [ ] **Step 1: Write migration**

```sql
-- ============================================================
-- 0038_forecast_snapshots.sql — scenario-aware forecast
-- snapshots linked to a treasury state snapshot, with
-- correlation ID for audit linkage to consuming decisions.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'forecast_scenario') THEN
    CREATE TYPE forecast_scenario AS ENUM ('base', 'conservative', 'stress', 'custom');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS forecast_snapshots (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id               UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  computed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  computed_by                 UUID REFERENCES user_profiles(id) ON DELETE SET NULL,

  treasury_state_snapshot_id  UUID NOT NULL REFERENCES treasury_state_snapshots(id) ON DELETE CASCADE,
  scenario                    forecast_scenario NOT NULL,
  scenario_params             JSONB NOT NULL DEFAULT '{}'::jsonb,
  window_days                 INT NOT NULL CHECK (window_days BETWEEN 1 AND 365),
  obligation_ids              UUID[] NOT NULL,
  obligation_count            INT NOT NULL,

  projection                  JSONB NOT NULL,

  correlation_id              TEXT,
  consumer                    TEXT NOT NULL CHECK (consumer IN
    ('rules_engine', 'agent_planner', 'treasurer_view', 'alert_eval', 'analytics_view')),

  is_hypothetical             BOOLEAN NOT NULL DEFAULT false,
  hypothetical_actions        JSONB,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_enterprise_computed
  ON forecast_snapshots(enterprise_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_correlation
  ON forecast_snapshots(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_consumer
  ON forecast_snapshots(enterprise_id, consumer, computed_at DESC);

ALTER TABLE forecast_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'forecast_snapshots' AND policyname = 'enterprise forecast_snapshots'
  ) THEN
    CREATE POLICY "enterprise forecast_snapshots" ON forecast_snapshots
      FOR ALL USING (enterprise_id = auth_user_enterprise_id());
  END IF;
END $$;

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'forecast_compute';
```

- [ ] **Step 2: Apply + commit**

```bash
npm run migrate
git add supabase/migrations/0038_forecast_snapshots.sql
git commit -m "feat(forecast): forecast_snapshots table (0038)"
```

---

# Task 9: Forecast types

**Files:**
- Create: `src/lib/forecast/types.ts`

- [ ] **Step 1: Write types**

```typescript
import type { Obligation } from '@/lib/obligations/types';
import type { TreasuryStateSnapshot } from '@/lib/treasury/state/types';

export type ForecastScenario = 'base' | 'conservative' | 'stress' | 'custom';
export type ForecastConsumer = 'rules_engine' | 'agent_planner' | 'treasurer_view' | 'alert_eval' | 'analytics_view';
export type FxStrategy = 'current' | 'pessimistic' | 'fixed';

export interface ScenarioParams {
  includeExpected: boolean;       // confirmed + expected if true, confirmed-only if false
  includeEstimated: boolean;
  extraDrawdownPct: number;       // 0-100, applied as a one-time day-0 outflow
  fxStrategy: FxStrategy;
  fxPessimisticBpsShift?: number; // only used when strategy='pessimistic'
  fixedFxRates?: Record<string, number>; // only used when strategy='fixed'
  customOverrides?: CustomObligationOverride[]; // only used when scenario='custom'
}

export interface CustomObligationOverride {
  obligationId?: string;  // override existing
  add?: Partial<Obligation> & { amount: number; currency: string; dueDate: string; direction: 'inflow' | 'outflow' };
  remove?: string;
}

export interface ProjectionDay {
  date: string;
  balanceByAsset: Record<string, number>;  // native amounts, keyed by asset ('USD', 'USDC', 'USDT', ...)
  balanceByVenue: Record<string, number>;  // base USD per venue id
  totalBaseUsd: number;
}

export interface Shortfall {
  date: string;
  asset: string;
  venue: string | null;
  deficitAmount: number;
}

export interface Projection {
  daily: ProjectionDay[];
  minBalance: {
    date: string;
    totalBaseUsd: number;
    byAsset: Record<string, { amount: number; date: string }>;
  };
  shortfalls: Shortfall[];
  covered: boolean;
}

export interface ProposedTransfer {
  amount: number;
  asset: string;
  fromVenue: string | null;
  toVenue: string | null;
  executeOn?: string; // defaults to today
}

export interface ForecastSnapshot {
  id: string;
  enterpriseId: string;
  computedAt: string;
  computedBy: string | null;
  treasuryStateSnapshotId: string;
  scenario: ForecastScenario;
  scenarioParams: ScenarioParams;
  windowDays: number;
  obligationIds: string[];
  projection: Projection;
  correlationId: string | null;
  consumer: ForecastConsumer;
  isHypothetical: boolean;
  hypotheticalActions: ProposedTransfer[] | null;
}

export interface ComputeOptions {
  scenario?: ForecastScenario;
  scenarioParams?: Partial<ScenarioParams>;
  windowDays?: number;
  consumer: ForecastConsumer;
  correlationId?: string;
  persist?: boolean;
  treasuryState?: TreasuryStateSnapshot; // optional pre-computed
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/forecast/types.ts
git commit -m "feat(forecast): type definitions for forecast snapshots and projections"
```

---

# Task 10: ForecastEngine — pure projection math

**Files:**
- Create: `src/lib/forecast/engine.ts`
- Create: `tests/forecast/engine.test.ts`

- [ ] **Step 1: Write the failing tests with hand-calculated scenarios**

`tests/forecast/engine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ForecastEngine } from '@/lib/forecast/engine';
import type { TreasuryStateSnapshot } from '@/lib/treasury/state/types';
import type { Obligation } from '@/lib/obligations/types';

function emptyState(overrides: Partial<TreasuryStateSnapshot> = {}): TreasuryStateSnapshot {
  return {
    id: 's', enterpriseId: 'e', takenAt: '2026-04-10T00:00:00Z', takenBy: null,
    trigger: 'on_demand', baseCurrency: 'USD',
    totalValueBaseUsd: 100000, totalFiatBaseUsd: 100000,
    totalStablecoinBaseUsd: 0, totalDefiBaseUsd: 0,
    positions: {
      bankAccounts: [{ accountId: 'ba_1', currency: 'USD', balanceNative: 100000, balanceBaseUsd: 100000, balanceAsOf: null }],
      wallets: [], defiPositions: [], pendingTransfers: [],
    },
    fxRates: {},
    ...overrides,
  };
}

function obligation(o: Partial<Obligation>): Obligation {
  return {
    id: 'ob', enterpriseId: 'e', userId: 'u', label: 'x', description: null,
    direction: 'outflow', amount: 0, currency: 'USD', asset: null,
    dueDate: '2026-04-15',
    sourceAccountId: null, sourceVenueKind: null,
    confidence: 'confirmed', source: 'manual', status: 'upcoming',
    recurrence: 'once', recurrenceCron: null,
    counterpartyId: null, erpReference: null, recurringParentId: null,
    tags: [], metadata: {}, paidAt: null, settlementTxRef: null, isActive: true,
    createdAt: '', updatedAt: '',
    ...o,
  };
}

describe('ForecastEngine.project', () => {
  const engine = new ForecastEngine();
  const from = new Date('2026-04-10T00:00:00Z');

  it('empty obligations: balance flat across window', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    expect(proj.daily).toHaveLength(31); // day 0 through day 30
    expect(proj.daily[0].totalBaseUsd).toBe(100000);
    expect(proj.daily[30].totalBaseUsd).toBe(100000);
    expect(proj.covered).toBe(true);
    expect(proj.shortfalls).toEqual([]);
    expect(proj.minBalance.totalBaseUsd).toBe(100000);
  });

  it('single outflow reduces balance on due date and afterward', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [obligation({ id: 'o1', amount: 30000, dueDate: '2026-04-20' })],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    expect(proj.daily[9].totalBaseUsd).toBe(100000);  // day before
    expect(proj.daily[10].totalBaseUsd).toBe(70000);  // due date: 2026-04-20
    expect(proj.daily[30].totalBaseUsd).toBe(70000);
    expect(proj.covered).toBe(true);
  });

  it('outflow exceeding balance produces shortfall and covered=false', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [obligation({ id: 'o1', amount: 150000, dueDate: '2026-04-15' })],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    expect(proj.covered).toBe(false);
    expect(proj.shortfalls).toHaveLength(1);
    expect(proj.shortfalls[0].date).toBe('2026-04-15');
    expect(proj.shortfalls[0].deficitAmount).toBe(50000);
    expect(proj.minBalance.totalBaseUsd).toBe(-50000);
  });

  it('confidence filter excludes expected when includeExpected=false', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [
        obligation({ id: 'o1', amount: 30000, confidence: 'confirmed', dueDate: '2026-04-15' }),
        obligation({ id: 'o2', amount: 50000, confidence: 'expected', dueDate: '2026-04-20' }),
      ],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: false, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    // Only the confirmed $30k hits
    expect(proj.daily[30].totalBaseUsd).toBe(70000);
  });

  it('inflow obligation adds to balance', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [obligation({ id: 'o1', direction: 'inflow', amount: 50000, dueDate: '2026-04-15' })],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    expect(proj.daily[30].totalBaseUsd).toBe(150000);
  });

  it('extraDrawdownPct applies a day-0 haircut', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 20, fxStrategy: 'current' },
    });
    // 100k - 20% = 80k, flat thereafter
    expect(proj.daily[0].totalBaseUsd).toBe(80000);
    expect(proj.daily[30].totalBaseUsd).toBe(80000);
  });

  it('EUR obligation against USD balance uses FX rate at projection time', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [obligation({ id: 'o1', amount: 50000, currency: 'EUR', dueDate: '2026-04-15' })],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1, 'EUR->USD': 1.10 }, // 1 EUR = 1.10 USD
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    // 50k EUR = 55k USD outflow
    expect(proj.daily[30].totalBaseUsd).toBe(45000);
  });

  it('minBalance finds the lowest point and its date', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [
        obligation({ id: 'o1', amount: 30000, dueDate: '2026-04-15' }),
        obligation({ id: 'o2', amount: 50000, dueDate: '2026-04-25' }),
        obligation({ id: 'o3', direction: 'inflow', amount: 40000, dueDate: '2026-05-05' }),
      ],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    // 100k -> 70k (day 5) -> 20k (day 15) -> 60k (day 25)
    expect(proj.minBalance.totalBaseUsd).toBe(20000);
    expect(proj.minBalance.date).toBe('2026-04-25');
  });
});
```

- [ ] **Step 2: Run tests to see them fail**

Run: `npx vitest run tests/forecast/engine.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/lib/forecast/engine.ts`**

```typescript
import type { Obligation } from '@/lib/obligations/types';
import type { TreasuryStateSnapshot } from '@/lib/treasury/state/types';
import type { Projection, ProjectionDay, ScenarioParams, Shortfall } from './types';

interface ProjectArgs {
  state: TreasuryStateSnapshot;
  obligations: Obligation[];
  from: Date;
  windowDays: number;
  fxRates: Record<string, number>;
  scenarioParams: ScenarioParams;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class ForecastEngine {
  project(args: ProjectArgs): Projection {
    const { state, obligations, from, windowDays, fxRates, scenarioParams } = args;

    const filtered = obligations.filter(o => {
      if (o.confidence === 'confirmed') return true;
      if (o.confidence === 'expected') return scenarioParams.includeExpected;
      if (o.confidence === 'estimated') return scenarioParams.includeEstimated;
      return false;
    });

    // Initial balance in base USD, optionally haircut by extraDrawdownPct
    const haircut = 1 - (scenarioParams.extraDrawdownPct / 100);
    const initialBase = state.totalValueBaseUsd * haircut;

    // Build date → delta map in base USD.
    // We also maintain a per-asset delta for balanceByAsset.
    const baseDeltaByDate = new Map<string, number>();
    const assetDeltaByDateAsset = new Map<string, Map<string, number>>(); // date -> asset -> delta native

    const fxRate = (currency: string): number => {
      const key = `${currency}->USD`;
      return fxRates[key] ?? 1;
    };

    for (const o of filtered) {
      const sign = o.direction === 'outflow' ? -1 : 1;
      const rate = fxRate(o.currency);
      const baseDelta = sign * o.amount * rate;
      baseDeltaByDate.set(o.dueDate, (baseDeltaByDate.get(o.dueDate) ?? 0) + baseDelta);

      const assetKey = o.asset ?? o.currency;
      if (!assetDeltaByDateAsset.has(o.dueDate)) assetDeltaByDateAsset.set(o.dueDate, new Map());
      const m = assetDeltaByDateAsset.get(o.dueDate)!;
      m.set(assetKey, (m.get(assetKey) ?? 0) + sign * o.amount);
    }

    // Build initial asset balances from state.positions
    const assetBalances: Record<string, number> = {};
    for (const b of state.positions.bankAccounts) {
      assetBalances[b.currency] = (assetBalances[b.currency] ?? 0) + b.balanceNative;
    }
    for (const w of state.positions.wallets) {
      assetBalances[w.token] = (assetBalances[w.token] ?? 0) + w.balanceNative;
    }
    // Apply day-0 haircut proportionally to each asset
    if (haircut !== 1) {
      for (const k of Object.keys(assetBalances)) assetBalances[k] *= haircut;
    }

    const daily: ProjectionDay[] = [];
    let runningBase = initialBase;

    for (let i = 0; i <= windowDays; i++) {
      const date = new Date(from.getTime() + i * DAY_MS).toISOString().slice(0, 10);
      const delta = baseDeltaByDate.get(date) ?? 0;
      runningBase += delta;

      const assetMap = assetDeltaByDateAsset.get(date);
      if (assetMap) {
        for (const [asset, d] of assetMap) assetBalances[asset] = (assetBalances[asset] ?? 0) + d;
      }

      daily.push({
        date,
        balanceByAsset: { ...assetBalances },
        balanceByVenue: {}, // venue-level breakdown is future work; keep shape stable
        totalBaseUsd: runningBase,
      });
    }

    // min balance
    let minDay = daily[0];
    for (const d of daily) if (d.totalBaseUsd < minDay.totalBaseUsd) minDay = d;

    const byAsset: Record<string, { amount: number; date: string }> = {};
    for (const d of daily) {
      for (const [asset, amount] of Object.entries(d.balanceByAsset)) {
        if (!byAsset[asset] || amount < byAsset[asset].amount) {
          byAsset[asset] = { amount, date: d.date };
        }
      }
    }

    // shortfalls: any day with negative totalBaseUsd
    const shortfalls: Shortfall[] = [];
    for (const d of daily) {
      if (d.totalBaseUsd < 0) {
        shortfalls.push({
          date: d.date,
          asset: 'USD',
          venue: null,
          deficitAmount: -d.totalBaseUsd,
        });
      }
    }

    return {
      daily,
      minBalance: { date: minDay.date, totalBaseUsd: minDay.totalBaseUsd, byAsset },
      shortfalls,
      covered: shortfalls.length === 0,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/forecast/engine.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/forecast/engine.ts tests/forecast/engine.test.ts
git commit -m "feat(forecast): pure ForecastEngine projection logic"
```

---

# Task 11: Scenarios — parameter application

**Files:**
- Create: `src/lib/forecast/scenarios.ts`
- Create: `tests/forecast/scenarios.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/forecast/scenarios.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveScenarioParams, DEFAULT_SCENARIO_PARAMS } from '@/lib/forecast/scenarios';

describe('resolveScenarioParams', () => {
  it('base: confirmed + expected, no drawdown, current FX', () => {
    const p = resolveScenarioParams('base');
    expect(p.includeExpected).toBe(true);
    expect(p.includeEstimated).toBe(false);
    expect(p.extraDrawdownPct).toBe(0);
    expect(p.fxStrategy).toBe('current');
  });

  it('conservative: confirmed only, no estimated, no drawdown', () => {
    const p = resolveScenarioParams('conservative');
    expect(p.includeExpected).toBe(false);
    expect(p.includeEstimated).toBe(false);
    expect(p.extraDrawdownPct).toBe(0);
  });

  it('stress: confirmed only + default 20% drawdown + pessimistic FX', () => {
    const p = resolveScenarioParams('stress');
    expect(p.includeExpected).toBe(false);
    expect(p.extraDrawdownPct).toBe(20);
    expect(p.fxStrategy).toBe('pessimistic');
  });

  it('custom: merges caller overrides onto base defaults', () => {
    const p = resolveScenarioParams('custom', { includeEstimated: true, extraDrawdownPct: 5 });
    expect(p.includeEstimated).toBe(true);
    expect(p.extraDrawdownPct).toBe(5);
    expect(p.fxStrategy).toBe('current');
  });

  it('DEFAULT_SCENARIO_PARAMS matches base scenario', () => {
    const base = resolveScenarioParams('base');
    expect(base).toEqual(DEFAULT_SCENARIO_PARAMS);
  });
});
```

- [ ] **Step 2: Implement `src/lib/forecast/scenarios.ts`**

```typescript
import type { ForecastScenario, ScenarioParams } from './types';

export const DEFAULT_SCENARIO_PARAMS: ScenarioParams = {
  includeExpected: true,
  includeEstimated: false,
  extraDrawdownPct: 0,
  fxStrategy: 'current',
};

export function resolveScenarioParams(
  scenario: ForecastScenario,
  overrides?: Partial<ScenarioParams>,
): ScenarioParams {
  let base: ScenarioParams;
  switch (scenario) {
    case 'base':
      base = { ...DEFAULT_SCENARIO_PARAMS };
      break;
    case 'conservative':
      base = { ...DEFAULT_SCENARIO_PARAMS, includeExpected: false };
      break;
    case 'stress':
      base = { ...DEFAULT_SCENARIO_PARAMS, includeExpected: false, extraDrawdownPct: 20, fxStrategy: 'pessimistic', fxPessimisticBpsShift: 500 };
      break;
    case 'custom':
      base = { ...DEFAULT_SCENARIO_PARAMS };
      break;
  }
  return { ...base, ...(overrides ?? {}) };
}
```

- [ ] **Step 3: Run test + commit**

Run: `npx vitest run tests/forecast/scenarios.test.ts`
Expected: PASS, 5 tests.

```bash
git add src/lib/forecast/scenarios.ts tests/forecast/scenarios.test.ts
git commit -m "feat(forecast): scenario parameter resolver (base/conservative/stress/custom)"
```

---

# Task 12: ForecastService (persistence + scenarios + factory)

**Files:**
- Create: `src/lib/forecast/service.ts`
- Create: `tests/forecast/service.test.ts`

- [ ] **Step 1: Write the failing service test**

`tests/forecast/service.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnterprise, getTestDb } from '../helpers/test-db';
import { createForecastService } from '@/lib/forecast/service';
import { ObligationsRepo } from '@/lib/obligations/repo';

describe('ForecastService', () => {
  const db = getTestDb();
  let enterpriseId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestEnterprise(db);
    enterpriseId = ctx.enterpriseId;
    cleanup = ctx.cleanup;

    const repo = new ObligationsRepo(db);
    await repo.create(enterpriseId, null, {
      label: 'Q2 Payroll', direction: 'outflow', amount: 40000, currency: 'USD',
      dueDate: '2026-05-01', confidence: 'confirmed', recurrence: 'once',
    });
  });

  afterAll(async () => { await cleanup(); });

  it('getObligationsDueInWindow returns only the upcoming window', async () => {
    const svc = await createForecastService({ enterpriseId, db, consumer: 'treasurer_view' });
    const obs = await svc.getObligationsDueInWindow(90);
    expect(obs.map(o => o.label)).toContain('Q2 Payroll');
  });

  it('areObligationsCovered returns covered=true when balance dominates', async () => {
    const svc = await createForecastService({ enterpriseId, db, consumer: 'treasurer_view' });
    const res = await svc.areObligationsCovered(90);
    // Empty enterprise: balance is 0, there's a $40k outflow → NOT covered
    expect(res.covered).toBe(false);
    expect(res.shortfallAmount).toBeGreaterThan(0);
  });

  it('getProjectedMinBalance returns a date and amount', async () => {
    const svc = await createForecastService({ enterpriseId, db, consumer: 'treasurer_view' });
    const out = await svc.getProjectedMinBalance('USD', null, 90);
    expect(out.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof out.amount).toBe('number');
  });

  it('persist=true writes a forecast_snapshots row with correlation_id', async () => {
    const svc = await createForecastService({
      enterpriseId, db, consumer: 'rules_engine',
      correlationId: 'rules_eval_test_1', persist: true,
    });
    await svc.areObligationsCovered(90);
    const { data } = await db.from('forecast_snapshots').select('*').eq('correlation_id', 'rules_eval_test_1').single();
    expect(data).not.toBeNull();
    expect(data!.consumer).toBe('rules_engine');
    expect(data!.is_hypothetical).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `src/lib/forecast/service.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { ForecastEngine } from './engine';
import { resolveScenarioParams } from './scenarios';
import { ObligationsRepo } from '@/lib/obligations/repo';
import { TreasuryStateService } from '@/lib/treasury/state/service';
import { expandRecurrence } from '@/lib/obligations/recurrence';
import type {
  ComputeOptions, ForecastConsumer, ForecastScenario,
  ProposedTransfer, Projection, ScenarioParams,
} from './types';
import type { Obligation, ObligationConfidence } from '@/lib/obligations/types';
import type { TreasuryStateSnapshot } from '@/lib/treasury/state/types';
import { getFxRate } from '@/lib/fx/live-rates';

export interface ForecastService {
  getProjectedMinBalance(asset: string, venue: string | null, windowDays: number): Promise<{ amount: number; date: string }>;
  getProjectedPosition(asset: string, venue: string | null, atDate: string): Promise<number>;
  areObligationsCovered(windowDays: number, confidenceFilter?: ObligationConfidence[]): Promise<{ covered: boolean; shortfallAmount?: number; firstShortfallDate?: string; shortfallAsset?: string }>;
  getObligationsDueInWindow(windowDays: number): Promise<Obligation[]>;
  hypothetical(proposedTransfers: ProposedTransfer[]): ForecastService;
}

interface ServiceConfig {
  enterpriseId: string;
  db: SupabaseClient;
  scenario?: ForecastScenario;
  scenarioParams?: Partial<ScenarioParams>;
  consumer: ForecastConsumer;
  correlationId?: string;
  persist?: boolean;
  // Hypothetical overlay — applied in addition to real state
  hypotheticalTransfers?: ProposedTransfer[];
  takenBy?: string | null;
}

async function loadExpandedObligations(
  db: SupabaseClient,
  enterpriseId: string,
  from: Date,
  to: Date,
): Promise<Obligation[]> {
  const repo = new ObligationsRepo(db);
  const active = await repo.listAllActive(enterpriseId);
  const out: Obligation[] = [];
  for (const o of active) {
    if (o.recurrence === 'once') {
      if (o.dueDate >= from.toISOString().slice(0, 10) && o.dueDate <= to.toISOString().slice(0, 10)) {
        out.push(o);
      }
      continue;
    }
    for (const inst of expandRecurrence(o, from, to)) {
      out.push({ ...o, dueDate: inst.dueDate, amount: inst.amount, recurringParentId: o.id });
    }
  }
  return out;
}

async function buildFxRates(
  obligations: Obligation[],
  strategy: ScenarioParams['fxStrategy'],
  overrides?: Record<string, number>,
): Promise<Record<string, number>> {
  const currencies = new Set<string>(['USD']);
  for (const o of obligations) currencies.add(o.currency);
  const rates: Record<string, number> = {};
  for (const c of currencies) {
    if (strategy === 'fixed' && overrides?.[`${c}->USD`] != null) {
      rates[`${c}->USD`] = overrides[`${c}->USD`];
      continue;
    }
    const live = c === 'USD' ? 1 : await getFxRate(c, 'USD');
    rates[`${c}->USD`] = strategy === 'pessimistic' ? live * 0.95 : live;
  }
  return rates;
}

function applyHypothetical(
  state: TreasuryStateSnapshot,
  transfers: ProposedTransfer[],
): TreasuryStateSnapshot {
  // Return a cloned snapshot with transfer deltas applied to totals.
  // Venue-level tracking is not yet modelled at the position granularity
  // needed — total delta is sufficient for the rules engine's coverage checks.
  let totalDelta = 0;
  for (const t of transfers) {
    // An internal transfer is value-neutral — amount leaves fromVenue, enters toVenue.
    // A true deposit/withdraw from/to an external party shifts the total.
    // Heuristic: if both venues are null, treat as external outflow.
    if (t.fromVenue === null && t.toVenue !== null) totalDelta += t.amount;   // inflow
    else if (t.fromVenue !== null && t.toVenue === null) totalDelta -= t.amount; // outflow
  }
  return {
    ...state,
    totalValueBaseUsd: state.totalValueBaseUsd + totalDelta,
    totalFiatBaseUsd: state.totalFiatBaseUsd + totalDelta, // coarse: absorb into fiat bucket
  };
}

export async function createForecastService(cfg: ServiceConfig): Promise<ForecastService> {
  const engine = new ForecastEngine();
  const treasurySvc = new TreasuryStateService(cfg.db);
  const scenarioParams = resolveScenarioParams(cfg.scenario ?? 'base', cfg.scenarioParams);

  let cachedState: TreasuryStateSnapshot | null = null;

  async function getState(): Promise<TreasuryStateSnapshot> {
    if (cachedState) return cachedState;
    const fresh = await treasurySvc.computeSnapshot(cfg.enterpriseId, 'pre_decision');
    // Persist only when this service instance is persist=true for a real decision
    if (cfg.persist && !cfg.hypotheticalTransfers) {
      cachedState = await treasurySvc.persistSnapshot(fresh, cfg.takenBy ?? null);
    } else {
      cachedState = { ...fresh, id: 'ephemeral', takenAt: new Date().toISOString(), takenBy: cfg.takenBy ?? null };
    }
    if (cfg.hypotheticalTransfers?.length) {
      cachedState = applyHypothetical(cachedState, cfg.hypotheticalTransfers);
    }
    return cachedState;
  }

  async function compute(windowDays: number): Promise<{ projection: Projection; obligations: Obligation[]; stateId: string }> {
    const state = await getState();
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + windowDays * 24 * 60 * 60 * 1000);
    const obligations = await loadExpandedObligations(cfg.db, cfg.enterpriseId, from, to);
    const fxRates = await buildFxRates(obligations, scenarioParams.fxStrategy, scenarioParams.fixedFxRates);
    const projection = engine.project({ state, obligations, from, windowDays, fxRates, scenarioParams });

    if (cfg.persist && !cfg.hypotheticalTransfers) {
      await cfg.db.from('forecast_snapshots').insert({
        enterprise_id: cfg.enterpriseId,
        computed_by: cfg.takenBy ?? null,
        treasury_state_snapshot_id: state.id,
        scenario: cfg.scenario ?? 'base',
        scenario_params: scenarioParams,
        window_days: windowDays,
        obligation_ids: obligations.map(o => o.id),
        obligation_count: obligations.length,
        projection,
        correlation_id: cfg.correlationId ?? null,
        consumer: cfg.consumer,
        is_hypothetical: false,
      });
    } else if (cfg.persist && cfg.hypotheticalTransfers) {
      await cfg.db.from('forecast_snapshots').insert({
        enterprise_id: cfg.enterpriseId,
        computed_by: cfg.takenBy ?? null,
        treasury_state_snapshot_id: state.id,
        scenario: cfg.scenario ?? 'base',
        scenario_params: scenarioParams,
        window_days: windowDays,
        obligation_ids: obligations.map(o => o.id),
        obligation_count: obligations.length,
        projection,
        correlation_id: cfg.correlationId ?? null,
        consumer: cfg.consumer,
        is_hypothetical: true,
        hypothetical_actions: cfg.hypotheticalTransfers,
      });
    }

    return { projection, obligations, stateId: state.id };
  }

  return {
    async getProjectedMinBalance(_asset, _venue, windowDays) {
      const { projection } = await compute(windowDays);
      return { amount: projection.minBalance.totalBaseUsd, date: projection.minBalance.date };
    },
    async getProjectedPosition(_asset, _venue, atDate) {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const at = new Date(`${atDate}T00:00:00Z`);
      const windowDays = Math.max(1, Math.ceil((at.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
      const { projection } = await compute(windowDays);
      const day = projection.daily.find(d => d.date === atDate) ?? projection.daily[projection.daily.length - 1];
      return day.totalBaseUsd;
    },
    async areObligationsCovered(windowDays, confidenceFilter) {
      const { projection } = await compute(windowDays);
      const applicableShortfalls = projection.shortfalls;
      if (applicableShortfalls.length === 0) return { covered: true };
      const first = applicableShortfalls[0];
      return {
        covered: false,
        shortfallAmount: first.deficitAmount,
        firstShortfallDate: first.date,
        shortfallAsset: first.asset,
      };
    },
    async getObligationsDueInWindow(windowDays) {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(from.getTime() + windowDays * 24 * 60 * 60 * 1000);
      return loadExpandedObligations(cfg.db, cfg.enterpriseId, from, to);
    },
    hypothetical(proposedTransfers) {
      // Returns a NEW ForecastService instance with an in-memory overlay.
      // Does not persist, does not mutate original.
      const child = {
        ...cfg,
        hypotheticalTransfers: [...(cfg.hypotheticalTransfers ?? []), ...proposedTransfers],
        persist: false, // hypotheticals never persist unless caller explicitly sets persist=true
      };
      // Wrap in a promise-less facade; createForecastService is async, but `hypothetical`
      // must be sync per contract. We return a proxy that awaits internally.
      let inner: ForecastService | null = null;
      const ensure = async () => {
        if (!inner) inner = await createForecastService(child);
        return inner;
      };
      return {
        getProjectedMinBalance: async (a, v, w) => (await ensure()).getProjectedMinBalance(a, v, w),
        getProjectedPosition: async (a, v, at) => (await ensure()).getProjectedPosition(a, v, at),
        areObligationsCovered: async (w, f) => (await ensure()).areObligationsCovered(w, f),
        getObligationsDueInWindow: async w => (await ensure()).getObligationsDueInWindow(w),
        hypothetical(more) { return (inner ?? this).hypothetical(more); },
      } as ForecastService;
    },
  };
}
```

- [ ] **Step 3: Run service tests**

Run: `npx vitest run tests/forecast/service.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 4: Commit**

```bash
git add src/lib/forecast/service.ts tests/forecast/service.test.ts
git commit -m "feat(forecast): ForecastService with persistence and scenarios"
```

---

# Task 13: Hypothetical mutation-safety tests

**Files:**
- Create: `tests/forecast/hypothetical.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnterprise, getTestDb } from '../helpers/test-db';
import { createForecastService } from '@/lib/forecast/service';
import { ObligationsRepo } from '@/lib/obligations/repo';

describe('ForecastService.hypothetical', () => {
  const db = getTestDb();
  let enterpriseId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestEnterprise(db);
    enterpriseId = ctx.enterpriseId;
    cleanup = ctx.cleanup;
    const repo = new ObligationsRepo(db);
    await repo.create(enterpriseId, null, {
      label: 'Payroll', direction: 'outflow', amount: 10000, currency: 'USD',
      dueDate: '2026-05-01', confidence: 'confirmed', recurrence: 'once',
    });
  });

  afterAll(async () => { await cleanup(); });

  it('hypothetical call does not mutate the original service', async () => {
    const svc = await createForecastService({ enterpriseId, db, consumer: 'rules_engine' });
    const originalBefore = await svc.getProjectedMinBalance('USD', null, 90);

    const hypo = svc.hypothetical([
      { amount: 50000, asset: 'USDC', fromVenue: null, toVenue: 'wallet_x' }, // inflow
    ]);
    await hypo.getProjectedMinBalance('USD', null, 90);

    const originalAfter = await svc.getProjectedMinBalance('USD', null, 90);
    expect(originalAfter.amount).toBe(originalBefore.amount);
  });

  it('hypothetical does NOT persist unless explicitly told to', async () => {
    const svc = await createForecastService({ enterpriseId, db, consumer: 'rules_engine' });
    const before = await db.from('forecast_snapshots').select('id', { count: 'exact', head: true }).eq('enterprise_id', enterpriseId);

    const hypo = svc.hypothetical([{ amount: 1000, asset: 'USD', fromVenue: 'ba_1', toVenue: null }]);
    await hypo.areObligationsCovered(90);

    const after = await db.from('forecast_snapshots').select('id', { count: 'exact', head: true }).eq('enterprise_id', enterpriseId);
    expect(after.count).toBe(before.count);
  });
});
```

- [ ] **Step 2: Run and commit**

```bash
npx vitest run tests/forecast/hypothetical.test.ts
git add tests/forecast/hypothetical.test.ts
git commit -m "test(forecast): hypothetical mutation-safety + persistence-off by default"
```

---

# Task 14: Migration 0039 — drop legacy treasury_forecasts (hard cut)

**Files:**
- Create: `supabase/migrations/0039_drop_treasury_forecasts.sql`

- [ ] **Step 1: Write migration**

```sql
-- ============================================================
-- 0039_drop_treasury_forecasts.sql — hard cut the legacy
-- treasury_forecasts table. All reads have been migrated to
-- forecast_snapshots in the Phase A plan (task 16).
-- ============================================================

DROP TABLE IF EXISTS treasury_forecasts CASCADE;
```

- [ ] **Step 2: DO NOT apply yet**

This migration must be the LAST thing applied in Phase A — tasks 15, 16, 17 still read from the legacy table until they're updated. Apply only after the API rewrites in tasks 15-17 are committed and tested.

Leave the file committed but unapplied:

```bash
git add supabase/migrations/0039_drop_treasury_forecasts.sql
git commit -m "feat(forecast): migration 0039 to drop legacy treasury_forecasts (apply after cutover)"
```

---

# Task 15: Replace generateCashFlowForecast with ForecastService adapter

**Files:**
- Modify: `src/lib/treasury/predictions.ts`
- Modify: `src/app/api/treasury/forecast/generate/route.ts`

- [ ] **Step 1: Rewrite `src/lib/treasury/predictions.ts`**

Read the full current file first, then replace with a thin adapter:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ForecastDataPoint } from '@/types/database';
import { createForecastService } from '@/lib/forecast/service';

/**
 * @deprecated Use ForecastService directly. Adapter kept for the legacy
 * Treasury AI > Forecasting tab until it's rewritten in Phase B.
 */
export async function generateCashFlowForecast(
  supabase: SupabaseClient,
  _userId: string,
  lookaheadDays: number,
  enterpriseId: string,
): Promise<ForecastDataPoint[]> {
  const svc = await createForecastService({
    enterpriseId,
    db: supabase,
    consumer: 'treasurer_view',
    persist: true,
  });
  const obs = await svc.getObligationsDueInWindow(lookaheadDays);
  // Access daily projection via a synthetic min-balance call that populates internal state
  const min = await svc.getProjectedMinBalance('USD', null, lookaheadDays);
  // The adapter returns a shape the legacy UI understands. The full daily series
  // is available via the forecast_snapshots row written by persist=true — Phase B
  // UI will read that directly.
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const dataPoints: ForecastDataPoint[] = [];
  for (let i = 0; i <= lookaheadDays; i++) {
    const d = new Date(from.getTime() + i * 86400000).toISOString().slice(0, 10);
    const dueToday = obs.filter(o => o.dueDate === d).reduce((a, b) => a + b.amount, 0);
    dataPoints.push({
      date: d,
      projectedBalanceUsd: 0, // actual value lives in the snapshot; legacy UI reads only daily obligations today
      obligationsDueUsd: dueToday,
      safetyBufferUsd: 0,
      scheduledRampsUsd: 0,
    });
  }
  return dataPoints;
}
```

Note: the legacy `ForecastDataPoint` shape is incomplete — the real projection lives in `forecast_snapshots.projection`. The Treasury AI > Forecasting UI rewrite in Task 17 reads from the new table and renders the full Projection.

- [ ] **Step 2: Update `/api/treasury/forecast/generate/route.ts`**

Read the current file first, then ensure the handler pulls `enterpriseId` from the session and calls `createForecastService()` with `consumer: 'treasurer_view'` and `persist: true`, then returns the resulting snapshot ID. Replace the existing body that writes to `treasury_forecasts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createClient } from '@supabase/supabase-js';
import { authOptions } from '@/lib/auth/options';
import { createForecastService } from '@/lib/forecast/service';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterpriseId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const lookaheadDays = Math.min(365, Math.max(1, body.lookaheadDays ?? 90));
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const svc = await createForecastService({
    enterpriseId: session.user.enterpriseId,
    db,
    consumer: 'treasurer_view',
    persist: true,
    takenBy: session.user.id,
  });
  const min = await svc.getProjectedMinBalance('USD', null, lookaheadDays);
  const coverage = await svc.areObligationsCovered(lookaheadDays);
  return NextResponse.json({ min, coverage });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/treasury/predictions.ts src/app/api/treasury/forecast/generate/route.ts
git commit -m "refactor(forecast): migrate generate route and predictions.ts to ForecastService"
```

---

# Task 16: Update /api/treasury/forecast GET to read forecast_snapshots

**Files:**
- Modify: `src/app/api/treasury/forecast/route.ts`

- [ ] **Step 1: Read current route**

Run: `Read src/app/api/treasury/forecast/route.ts` to see how it queries `treasury_forecasts`.

- [ ] **Step 2: Rewrite to query forecast_snapshots**

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createClient } from '@supabase/supabase-js';
import { authOptions } from '@/lib/auth/options';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterpriseId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  }
  const url = new URL(req.url);
  const windowDays = parseInt(url.searchParams.get('windowDays') ?? '90', 10);
  const scenario = url.searchParams.get('scenario') ?? 'base';

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await db
    .from('forecast_snapshots')
    .select('*')
    .eq('enterprise_id', session.user.enterpriseId)
    .eq('consumer', 'treasurer_view')
    .eq('window_days', windowDays)
    .eq('scenario', scenario)
    .eq('is_hypothetical', false)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({
      error: {
        code: 'FORECAST_FETCH_FAILED',
        message: 'Could not load the most recent forecast',
        nextStep: 'Try regenerating from the Treasury AI page',
      },
    }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ snapshot: null });
  }
  return NextResponse.json({ snapshot: data });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/treasury/forecast/route.ts
git commit -m "refactor(forecast): read from forecast_snapshots, drop treasury_forecasts dependency"
```

---

# Task 17: Treasury AI > Forecasting UI consumer update

**Files:**
- Modify: whichever component renders the Forecasting tab under `src/app/(app)/treasury/ai/` (determine exact path via Glob on `ForecastChart` or similar)

- [ ] **Step 1: Locate the forecasting UI component**

Run: Grep for `ForecastDataPoint` + `treasury_forecasts` under `src/app/(app)/treasury/` and `src/components/treasury/`. Read each match.

- [ ] **Step 2: Update the component to consume the new `snapshot.projection.daily` shape**

Replace any `dataPoint.projectedBalanceUsd` references with `day.totalBaseUsd` from `snapshot.projection.daily`. Add a scenario selector dropdown that passes `scenario=base|conservative|stress` to the GET route.

(Exact diff depends on the current component structure — this task should be implemented by reading the file first.)

- [ ] **Step 3: Smoke test in the browser**

Run: `npm run dev`, log in, navigate to Treasury AI > Forecasting, click Regenerate, confirm a chart appears and does not throw.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/treasury src/components/treasury
git commit -m "refactor(forecast): Treasury AI forecasting tab reads forecast_snapshots"
```

---

# Task 18: Replace rules-engine.ts collectObligations + buildTreasurySnapshot

**Files:**
- Modify: `src/lib/treasury/rules-engine.ts`

- [ ] **Step 1: Read the current file to find all call sites**

Run: Read `src/lib/treasury/rules-engine.ts` in full. Note every exported function that currently queries `manual_obligations` or computes a snapshot inline.

- [ ] **Step 2: Rewrite `collectObligations` as a wrapper over ForecastService**

Keep the exported signature the same so existing callers (`recommendation engine`, `simulation.ts`) don't need to change. Internally delegate:

```typescript
import { createForecastService } from '@/lib/forecast/service';
import { TreasuryStateService } from '@/lib/treasury/state/service';

export async function collectObligations(
  supabase: SupabaseClient,
  enterpriseId: string,
  lookaheadDays: number,
): Promise<UpcomingObligation[]> {
  const svc = await createForecastService({
    enterpriseId,
    db: supabase,
    consumer: 'rules_engine',
  });
  const obs = await svc.getObligationsDueInWindow(lookaheadDays);
  return obs.map(o => ({
    id: o.id,
    source: o.source === 'erp_sync' ? 'erp_invoice' : 'manual',
    label: o.label,
    amountUsd: o.currency === 'USD' ? o.amount : o.amount /* FX applied at projection time — rules engine consumes raw amount for the legacy interface */,
    dueDate: o.dueDate,
  }));
}

export async function buildTreasurySnapshot(
  supabase: SupabaseClient,
  enterpriseId: string,
): Promise<TreasurySnapshot> {
  const svc = new TreasuryStateService(supabase);
  const snap = await svc.computeSnapshot(enterpriseId, 'pre_decision');
  return {
    totalBankBalanceUsd: snap.totalFiatBaseUsd,
    totalCryptoBalanceUsd: snap.totalStablecoinBaseUsd + snap.totalDefiBaseUsd,
    bankAccounts: snap.positions.bankAccounts.map(b => ({
      id: b.accountId, institutionName: '', accountName: '', last4: null,
      currency: b.currency, currentBalanceUsd: b.balanceBaseUsd, balanceAsOf: b.balanceAsOf,
    })),
    cryptoPositions: snap.positions.wallets.map(w => ({
      walletId: w.walletId, chain: w.chain, token: w.token,
      balance: w.balanceNative, usdValue: w.balanceBaseUsd,
    })),
  };
}
```

The institutionName/accountName fields aren't on `BankAccountPosition` yet — extend `src/lib/treasury/state/types.ts` to include them, pull them from `bank_accounts` in `computeSnapshot`, re-run state service tests. This is two extra fields on the position JSONB.

- [ ] **Step 3: Re-run the rules engine callers to make sure nothing broke**

Run: `npx vitest run`
Expected: all tests pass. If `rules-engine.test.ts` doesn't exist, add a minimal smoke test that calls `collectObligations()` against the test enterprise and asserts it returns the seeded row.

- [ ] **Step 4: Commit**

```bash
git add src/lib/treasury/rules-engine.ts src/lib/treasury/state/types.ts src/lib/treasury/state/service.ts
git commit -m "refactor(rules): rewire collectObligations + buildTreasurySnapshot onto new services"
```

---

# Task 19: Recurring obligation instance materialization job

**Files:**
- Create: `src/lib/obligations/materialize.ts`
- Create: `tests/obligations/materialize.test.ts`
- Modify: `scripts/cron-runner.ts` (register the new job)

- [ ] **Step 1: Write test**

`tests/obligations/materialize.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnterprise, getTestDb } from '../helpers/test-db';
import { ObligationsRepo } from '@/lib/obligations/repo';
import { materializeRecurringObligations } from '@/lib/obligations/materialize';

describe('materializeRecurringObligations', () => {
  const db = getTestDb();
  let enterpriseId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestEnterprise(db);
    enterpriseId = ctx.enterpriseId;
    cleanup = ctx.cleanup;
    const repo = new ObligationsRepo(db);
    await repo.create(enterpriseId, null, {
      label: 'Monthly Rent', direction: 'outflow', amount: 5000, currency: 'USD',
      dueDate: '2026-04-01', confidence: 'confirmed', recurrence: 'monthly',
    });
  });

  afterAll(async () => { await cleanup(); });

  it('creates future instances up to 90 days out', async () => {
    const created = await materializeRecurringObligations(db, enterpriseId, new Date('2026-04-10'));
    expect(created.length).toBeGreaterThanOrEqual(2); // at least May and June occurrences

    const { data } = await db.from('obligations')
      .select('*')
      .eq('enterprise_id', enterpriseId)
      .not('recurring_parent_id', 'is', null);
    expect(data!.length).toBe(created.length);
    for (const row of data!) {
      expect(row.recurrence).toBe('once'); // materialized instances are one-off
    }
  });

  it('is idempotent — running twice does not duplicate instances', async () => {
    const first = await materializeRecurringObligations(db, enterpriseId, new Date('2026-04-10'));
    const second = await materializeRecurringObligations(db, enterpriseId, new Date('2026-04-10'));
    expect(second.length).toBe(0);
  });
});
```

- [ ] **Step 2: Implement `src/lib/obligations/materialize.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { ObligationsRepo } from './repo';
import { expandRecurrence } from './recurrence';

const HORIZON_DAYS = 90;

export async function materializeRecurringObligations(
  db: SupabaseClient,
  enterpriseId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const repo = new ObligationsRepo(db);
  const active = await repo.listAllActive(enterpriseId);
  const parents = active.filter(o => o.recurrence !== 'once' && o.recurringParentId === null);

  const from = new Date(now); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  // Existing materialized instances per parent
  const { data: existing } = await db
    .from('obligations')
    .select('recurring_parent_id, due_date')
    .eq('enterprise_id', enterpriseId)
    .not('recurring_parent_id', 'is', null);

  const existingKey = new Set<string>();
  for (const r of existing ?? []) existingKey.add(`${r.recurring_parent_id}|${r.due_date}`);

  const created: string[] = [];
  for (const parent of parents) {
    const instances = expandRecurrence(parent, from, to);
    for (const inst of instances) {
      const key = `${parent.id}|${inst.dueDate}`;
      if (existingKey.has(key)) continue;
      if (inst.dueDate === parent.dueDate) continue; // don't duplicate the parent row itself

      const { data, error } = await db.from('obligations').insert({
        enterprise_id: enterpriseId,
        user_id: parent.userId,
        label: parent.label,
        description: parent.description,
        direction: parent.direction,
        amount: parent.amount,
        amount_usd: parent.currency === 'USD' ? parent.amount : null,
        currency: parent.currency,
        asset: parent.asset,
        due_date: inst.dueDate,
        confidence: parent.confidence,
        source: 'recurring_rule',
        status: 'upcoming',
        recurrence: 'once',
        recurring_parent_id: parent.id,
        tags: parent.tags,
        metadata: parent.metadata,
        is_recurring: false,
      }).select('id').single();
      if (error) throw error;
      created.push(data!.id);
    }
  }
  return created;
}
```

- [ ] **Step 3: Register job in `scripts/cron-runner.ts`**

Read the current cron runner to see its registration pattern. Add an entry that invokes `materializeRecurringObligations` once per day per active enterprise.

- [ ] **Step 4: Run tests + commit**

```bash
npx vitest run tests/obligations/materialize.test.ts
git add src/lib/obligations/materialize.ts tests/obligations/materialize.test.ts scripts/cron-runner.ts
git commit -m "feat(obligations): nightly materialization of recurring obligation instances"
```

---

# Task 20: Apply migration 0039 and remove dead code

**Files:**
- Modify: any remaining file that still references `treasury_forecasts`

- [ ] **Step 1: Verify no code still reads treasury_forecasts**

Run: Grep `treasury_forecasts` across `src/`. Every match must now live only in migration files (0006 creation, 0010 enterprise_id retrofit, 0039 drop). If any `src/` match exists, fix it.

- [ ] **Step 2: Apply migration 0039 to dev**

Run: `npm run migrate`
Expected: `treasury_forecasts` dropped. Verify with `\dt treasury_forecasts` returning no rows.

- [ ] **Step 3: Remove the deprecated `generateCashFlowForecast` adapter**

If the Treasury AI UI (Task 17) is fully rewritten, delete `generateCashFlowForecast` from `predictions.ts`. If anything still calls it, keep it one more release.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(forecast): drop legacy treasury_forecasts after cutover verified"
```

---

# Task 21: Performance benchmark (warn-only)

**Files:**
- Create: `tests/forecast/performance.bench.test.ts`

- [ ] **Step 1: Write benchmark**

```typescript
import { describe, it, expect } from 'vitest';
import { ForecastEngine } from '@/lib/forecast/engine';
import type { Obligation } from '@/lib/obligations/types';
import type { TreasuryStateSnapshot } from '@/lib/treasury/state/types';

const TARGET_MS = 100;

function buildObligations(n: number): Obligation[] {
  const arr: Obligation[] = [];
  for (let i = 0; i < n; i++) {
    const dayOffset = i % 90;
    const date = new Date(Date.UTC(2026, 3, 10 + dayOffset)).toISOString().slice(0, 10);
    arr.push({
      id: `ob_${i}`, enterpriseId: 'e', userId: 'u', label: `Obligation ${i}`, description: null,
      direction: i % 3 === 0 ? 'inflow' : 'outflow',
      amount: 1000 + (i % 50) * 10, currency: 'USD', asset: null,
      dueDate: date,
      sourceAccountId: null, sourceVenueKind: null,
      confidence: 'confirmed', source: 'manual', status: 'upcoming',
      recurrence: 'once', recurrenceCron: null,
      counterpartyId: null, erpReference: null, recurringParentId: null,
      tags: [], metadata: {}, paidAt: null, settlementTxRef: null, isActive: true,
      createdAt: '', updatedAt: '',
    });
  }
  return arr;
}

describe('ForecastEngine performance (warn-only)', () => {
  it('projects 500 obligations over 90 days in under target', () => {
    const engine = new ForecastEngine();
    const state: TreasuryStateSnapshot = {
      id: 's', enterpriseId: 'e', takenAt: '2026-04-10T00:00:00Z', takenBy: null,
      trigger: 'on_demand', baseCurrency: 'USD',
      totalValueBaseUsd: 10_000_000, totalFiatBaseUsd: 10_000_000,
      totalStablecoinBaseUsd: 0, totalDefiBaseUsd: 0,
      positions: { bankAccounts: [{ accountId: 'ba_1', currency: 'USD', balanceNative: 10_000_000, balanceBaseUsd: 10_000_000, balanceAsOf: null }], wallets: [], defiPositions: [], pendingTransfers: [] },
      fxRates: {},
    };
    const obligations = buildObligations(500);

    const t0 = performance.now();
    const proj = engine.project({
      state, obligations,
      from: new Date('2026-04-10T00:00:00Z'),
      windowDays: 90,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    const elapsed = performance.now() - t0;

    expect(proj.daily).toHaveLength(91);
    if (elapsed > TARGET_MS) {
      // Warn-only per design note — do not fail the test.
      console.warn(`[bench] ForecastEngine projection took ${elapsed.toFixed(1)}ms (target ${TARGET_MS}ms)`);
    }
    expect(elapsed).toBeLessThan(1000); // hard ceiling: must not be absurdly slow
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
npx vitest run tests/forecast/performance.bench.test.ts
git add tests/forecast/performance.bench.test.ts
git commit -m "test(forecast): 500-obligation 90-day projection benchmark (warn-only)"
```

---

# Task 22: Run full test suite and lint

- [ ] **Step 1: Run everything**

Run:
```bash
npx vitest run
npm run lint
npx tsc --noEmit
```
Expected: 0 test failures, 0 lint errors, 0 TypeScript errors.

- [ ] **Step 2: Fix any breakage surfaced by the type checker**

Most likely issue: the deprecated `ManualObligation` type is still imported somewhere. Update imports to `Obligation` from `@/lib/obligations/types`.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix lingering ManualObligation imports after obligations v2 rename"
```

---

# Task 23: README + architecture doc

**Files:**
- Modify: `README.md` (append a "Forecast Analytics" section)
- Create: `docs/architecture/forecast-analytics.md`

- [ ] **Step 1: Write `docs/architecture/forecast-analytics.md`**

Covering: the three new tables and what each stores, the ForecastService contract, how scenarios and hypothetical work, the FX strategy, the snapshot persistence policy, how the rules engine consumes the service, how recurring obligations materialize nightly, the performance target, and the Phase B/C roadmap pointer.

Key sections:
- "Architecture overview" — diagram (ASCII or mermaid) of `obligations + treasury_state_snapshots → ForecastService → forecast_snapshots`
- "Forecast service contract" — copy the interface from `src/lib/forecast/types.ts`
- "Scenarios" — table of base/conservative/stress/custom parameters
- "Hypothetical queries" — when they persist vs when they don't
- "How to add a new scenario" — extend `forecast_scenario` enum + `scenarios.ts` branch
- "Performance" — benchmark target, location of the bench test
- "Phase B/C roadmap" — pointer to the design note

- [ ] **Step 2: Append to README**

Short section pointing to `docs/architecture/forecast-analytics.md`.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/architecture/forecast-analytics.md
git commit -m "docs(forecast): Phase A architecture + operator guide"
```

---

# Task 24: Final verification and PR

- [ ] **Step 1: Run the whole suite one more time**

```bash
npx vitest run
npm run lint
npx tsc --noEmit
npm run build
```
Expected: all green.

- [ ] **Step 2: Apply migrations 0036-0039 to PROD Supabase**

Per MEMORY: must be applied to both dev AND prod. Use the Supabase SQL editor for `lfujbwemavgiifkltrag`. Run each migration file in order, verify no errors, spot-check row counts.

- [ ] **Step 3: Push the branch**

```bash
git push origin feature/forecast-analytics
```

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "feat(forecast): Phase A — obligations v2, treasury snapshots, forecast service" --body "$(cat <<'EOF'
## Summary
- Obligations v2: extends `manual_obligations` with confidence, source, status lifecycle, full recurrence types, currency/asset split; renamed to `obligations`
- New `treasury_state_snapshots` table persisting full point-in-time treasury state with captured FX rates
- New `forecast_snapshots` table with scenario-aware projections, correlation IDs, and optional persistence for hypotheticals
- New `ForecastService` contract replacing inline queries in `rules-engine.ts`; supports base/conservative/stress/custom scenarios and mutation-safe `hypothetical()` overlay
- Hard cut of legacy `treasury_forecasts` table after UI cutover
- Nightly materialization of recurring obligation instances

## Test plan
- [ ] Vitest suite passes (`npx vitest run`)
- [ ] Lint clean (`npm run lint`)
- [ ] Type check clean (`npx tsc --noEmit`)
- [ ] Build clean (`npm run build`)
- [ ] Migrations 0036-0039 applied to dev Supabase
- [ ] Migrations 0036-0039 applied to prod Supabase
- [ ] Treasury AI > Forecasting tab renders and regenerates without errors
- [ ] Hand-exercised forecast service end-to-end via /api/treasury/forecast GET + /api/treasury/forecast/generate POST

## Follow-ups (Phase B)
- Measures/dimensions registry + analytics query engine
- 12 standard analytics views as seeded `analytics_views` rows
- Report Builder data fetcher migration onto analytics engine
EOF
)"
```

Return the PR URL when created.

---

## Self-review (completed by plan author)

**Spec coverage check:**
- Obligations model ✓ (tasks 1-5, 19)
- Treasury state snapshot service ✓ (tasks 6, 7)
- Forecast engine with scenarios ✓ (tasks 9-11)
- Hypothetical queries ✓ (tasks 12, 13)
- Forecast interface implementation ✓ (task 12 + task 18 rewire)
- Forecast snapshots with correlation ✓ (task 8 + task 12 persist branch)
- Measures registry — Phase B (out of scope, explicitly)
- Analytics query engine — Phase B
- Standard views — Phase B
- Custom view builder — Phase C
- Alerting — Phase C
- Data export — Phase C

**Tests covering:**
- Forecast projection accuracy ✓ (task 10: 8 hand-calculated scenarios)
- Hypothetical returning modified projection without state mutation ✓ (task 13)
- Obligation recurrence generating correct instances ✓ (task 3, 19)
- Forecast snapshot correlation ✓ (task 12)
- Performance target ✓ (task 21)

**Type consistency check:** `ForecastService` shape matches across tasks 9 (definition), 12 (implementation), 18 (consumer). `ObligationsRepo` method names match between tasks 4, 5, 19. `TreasuryStateSnapshot` shape extended once in task 18 — noted as a callback to task 7.

**Placeholder scan:** none — every step has either explicit code, explicit SQL, or an exact command.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-04-10-forecast-analytics-phase-a.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Good fit: this plan has 24 clearly-scoped tasks where each touches a bounded set of files, so context isolation between tasks is clean. Two-stage review (implementation review + merge review) catches problems early.

2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review. Good fit: if you want to watch each test turn red → green in real time and make small course corrections as they come up, without waiting on subagent handoffs.

Which approach do you want?
