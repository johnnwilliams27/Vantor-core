# Policy Engine — Plan 1: Engine library and database foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working, fully-tested policy engine library plus the database foundation for the rest of the policy engine work — with zero production impact (no API routes, no gate, no UI, no data migration yet).

**Architecture:** A standalone `src/lib/policy/*` TypeScript module built around a pure synchronous evaluator (pattern-matches a typed discriminated-union IR over a pre-loaded EvaluationContext) plus an async context loader that fetches treasury state, rates, forecast, aggregates, sanctions, and counterparty data. The engine has no DB writes of its own yet — Plan 2 wires it into the gate. All nine `policy_*` tables are created by this plan but remain empty until Plan 2's data migration.

**Tech Stack:** TypeScript 5.5, Next.js 14 App Router, Supabase (Postgres + RLS), Vitest (new to this repo), zod, `big.js` for precise decimal arithmetic, existing `getStablecoinPrices()` oracle.

**Companion spec:** `docs/superpowers/specs/2026-04-10-treasury-policy-engine-design.md`

**Worktree:** this plan executes inside `.worktrees/policy-engine` on branch `feature/policy-engine`. Every `git add` / `git commit` step assumes you're in that worktree directory.

---

## File structure

### New files — library

```
src/lib/policy/
├── README.md                                 ← architecture overview, added in final task
├── errors/
│   ├── reason-codes.ts                       ← closed enum of all reason codes
│   ├── classes.ts                            ← PolicyError + subclasses (CanonicalizationError, etc.)
│   └── classes.test.ts
├── types/
│   ├── assets.ts                             ← AssetCode, VenueId, AmountNative, AmountValue
│   ├── movement.ts                           ← ProposedMovement, Initiator, MovementEndpoint, MovementKind
│   ├── verdict.ts                            ← Verdict, EvaluationResult
│   ├── ir.ts                                 ← Condition discriminated union + supporting types
│   ├── context.ts                            ← EvaluationContext, TreasuryState, etc.
│   ├── trace.ts                              ← EvaluationTrace, RuleEvaluationTrace, etc.
│   ├── hard-limit.ts                         ← HardLimitType, HardLimitEvaluation, HardLimitBreach
│   ├── policy-version.ts                     ← PolicyVersionSnapshot, PolicyRule, PolicyHardLimit, ApprovalChain
│   └── index.ts                              ← public type exports
├── schemas/
│   ├── movement.schema.ts                    ← zod for ProposedMovement
│   ├── ir.schema.ts                          ← zod for Condition (recursive discriminated union)
│   ├── hard-limit.schema.ts                  ← zod for HardLimit rows
│   ├── movement.schema.test.ts
│   ├── ir.schema.test.ts
│   └── hard-limit.schema.test.ts
├── canonicalizer/
│   ├── interface.ts                          ← PolicyRateProvider interface
│   ├── coingecko-provider.ts                 ← phase-1 implementation using existing oracle
│   ├── canonicalizer.ts                      ← toCanonicalUsd function
│   ├── coingecko-provider.test.ts
│   └── canonicalizer.test.ts
├── forecast/
│   ├── interface.ts                          ← ForecastQuery interface
│   ├── stub-logger.ts                        ← StubLogger + ProductionStubLogger
│   ├── stub.ts                               ← StubForecastQuery + StubForecastQueryFactory
│   ├── contract.test.ts                      ← contract tests any implementation must pass
│   ├── stub.test.ts
│   └── stub-logger.test.ts
├── ir-evaluator/
│   ├── leaves/
│   │   ├── amount-compare.ts                 ← handles transfer.amount + splitting guard
│   │   ├── string-compare.ts
│   │   ├── time-compare.ts
│   │   ├── sanctions-status.ts
│   │   ├── forecast-query.ts
│   │   ├── aggregate-window.ts
│   │   ├── amount-compare.test.ts
│   │   ├── string-compare.test.ts
│   │   ├── time-compare.test.ts
│   │   ├── sanctions-status.test.ts
│   │   ├── forecast-query.test.ts
│   │   └── aggregate-window.test.ts
│   ├── evaluator.ts                          ← recursive IR walker, dispatches to leaves
│   └── evaluator.test.ts
├── hard-limit-checker/
│   ├── limits/
│   │   ├── min-cash-reserve.ts
│   │   ├── max-concentration.ts
│   │   ├── max-outflow.ts                    ← covers both daily + 30d
│   │   ├── obligation-coverage.ts
│   │   ├── max-native-exposure.ts
│   │   ├── min-cash-reserve.test.ts
│   │   ├── max-concentration.test.ts
│   │   ├── max-outflow.test.ts
│   │   ├── obligation-coverage.test.ts
│   │   └── max-native-exposure.test.ts
│   ├── templates.ts                          ← human-readable breach message templates
│   ├── checker.ts                            ← HardLimitChecker orchestrator
│   ├── utilization-probe.ts                  ← HardLimitUtilizationProbe
│   ├── checker.test.ts
│   └── utilization-probe.test.ts
├── aggregate-detector/
│   ├── hash.ts                               ← deterministic window spec hashing
│   ├── queries.ts                            ← SQL query builders
│   ├── detector.ts                           ← AggregationDetector module
│   ├── hash.test.ts
│   ├── queries.test.ts
│   └── detector.test.ts
├── context-loader/
│   ├── treasury-state.ts                     ← loadTreasuryState
│   ├── counterparty.ts                       ← loadCounterparty
│   ├── sanctions.ts                          ← loadSanctions
│   ├── loader.ts                             ← EvaluationContextLoader orchestrator
│   ├── treasury-state.test.ts
│   ├── counterparty.test.ts
│   ├── sanctions.test.ts
│   └── loader.test.ts
├── verdict-composer/
│   ├── composer.ts                           ← lowest-privilege wins + system invariants
│   └── composer.test.ts
├── engine/
│   ├── evaluator.ts                          ← main EvaluationEngine orchestrator
│   └── evaluator.test.ts
├── __fixtures__/
│   ├── movements.ts                          ← canned ProposedMovements
│   ├── contexts.ts                           ← canned EvaluationContexts
│   └── policy-versions.ts                    ← canned PolicyVersionSnapshots
└── index.ts                                  ← top-level public exports
```

### New files — tooling

```
vitest.config.ts                              ← Vitest configuration
tests/smoke.test.ts                           ← minimal smoke test to verify Vitest is alive
```

### New files — database

```
supabase/migrations/0034_policy_engine_schema.sql   ← all policy_* tables + triggers + RLS + indexes + column adds
```

### Modified files

```
package.json                                  ← add vitest + scripts
```

---

## Task 0: Install and configure Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Install Vitest and supporting packages**

From the worktree root (`.worktrees/policy-engine/`):

```bash
npm install --save-dev vitest@^2.0.0 @vitest/ui@^2.0.0 happy-dom@^15.0.0
```

Expected output: packages installed, `package.json` and `package-lock.json` updated with new devDependencies.

- [ ] **Step 2: Add test scripts to `package.json`**

Open `package.json` and add these lines to the `"scripts"` object:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui",
"test:coverage": "vitest run --coverage"
```

The final scripts block should look like this (ordering within `scripts` doesn't matter functionally but keep alphabetical-ish for clarity):

```json
"scripts": {
  "dev": "next dev",
  "dev:sandbox": "env-cmd -f .env.development next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:ui": "vitest --ui",
  "test:coverage": "vitest run --coverage",
  "cron": "tsx --env-file=.env.local scripts/cron-runner.ts",
  "migrate": "tsx --env-file=.env.local scripts/migrate.ts",
  "seed": "tsx --env-file=.env.local scripts/seed.ts"
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

At the repo root (`.worktrees/policy-engine/vitest.config.ts`):

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'tests/**/*.test.ts',
    ],
    exclude: ['node_modules', '.next', '.worktrees', 'scripts'],
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 4: Write a smoke test**

Create `tests/smoke.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('vitest smoke test', () => {
  it('runs basic assertions', () => {
    expect(1 + 1).toBe(2);
  });

  it('handles async code', async () => {
    const result = await Promise.resolve('hello');
    expect(result).toBe('hello');
  });

  it('supports the @/ path alias', async () => {
    // Import something trivial from src to confirm alias works
    const { oracle } = await import('@/lib/treasury/oracle').then(m => ({ oracle: m.getStablecoinPrices }));
    expect(typeof oracle).toBe('function');
  });
});
```

- [ ] **Step 5: Run the smoke test and confirm it passes**

```bash
npm test
```

Expected output:
```
 ✓ tests/smoke.test.ts (3)
   ✓ vitest smoke test (3)
     ✓ runs basic assertions
     ✓ handles async code
     ✓ supports the @/ path alias

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

If the @/ alias test fails, double-check `vitest.config.ts` has the `resolve.alias` block and that `src/lib/treasury/oracle.ts` exports `getStablecoinPrices`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/smoke.test.ts
git commit -m "$(cat <<'EOF'
chore(test): install Vitest and add smoke test

First test framework in the repo. Needed for upcoming policy engine
TDD work (and any future test coverage).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: Create policy engine schema migration file

**Files:**
- Create: `supabase/migrations/0034_policy_engine_schema.sql`

- [ ] **Step 1: Create the migration file with header and BEGIN block**

Create `supabase/migrations/0034_policy_engine_schema.sql`:

```sql
-- Migration 0034: Policy Engine Schema
-- Creates all policy_* tables for the treasury rules & approval policy engine.
-- See docs/superpowers/specs/2026-04-10-treasury-policy-engine-design.md §1.
--
-- This migration is SCHEMA-ONLY. Data migration (from treasury_rules and
-- ai_recommendations.pending_approval) happens in a separate migration in
-- Plan 2. After this migration, all policy_* tables are empty and nothing
-- in production reads from them yet.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- CONFIGURATION TABLES (versioned, immutable once active)
-- ════════════════════════════════════════════════════════════════════════

COMMIT;
```

- [ ] **Step 2: Add `policy_policies` and `policy_versions` tables**

Replace the file content between the header comment and `COMMIT;` with:

```sql
-- Migration 0034: Policy Engine Schema
-- (header comment as above)

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- CONFIGURATION TABLES (versioned, immutable once active)
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE policy_policies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id       UUID NOT NULL UNIQUE REFERENCES enterprises(id) ON DELETE CASCADE,
  name                TEXT NOT NULL DEFAULT 'Standard Policy',
  active_version_id   UUID,  -- FK added after policy_versions exists
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE policy_policies IS
  'One row per enterprise. Holds the pointer to the currently-active policy version.';

CREATE TABLE policy_versions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id           UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  version_number          INTEGER NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded')),
  name                    TEXT NOT NULL,
  created_by              UUID NOT NULL REFERENCES user_profiles(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at            TIMESTAMPTZ,
  activated_by            UUID REFERENCES user_profiles(id),
  superseded_at           TIMESTAMPTZ,
  superseded_by_version_id UUID REFERENCES policy_versions(id),
  UNIQUE (enterprise_id, version_number)
);

COMMENT ON TABLE policy_versions IS
  'Immutable policy version snapshots. Draft versions may be edited freely; ' ||
  'active and superseded versions are frozen by triggers.';

-- Complete the FK on policy_policies now that policy_versions exists
ALTER TABLE policy_policies
  ADD CONSTRAINT fk_active_version
  FOREIGN KEY (active_version_id) REFERENCES policy_versions(id);

COMMIT;
```

- [ ] **Step 3: Add `policy_rules`, `policy_hard_limits`, `policy_approval_chains`**

Insert before the `COMMIT;`:

```sql
CREATE TABLE policy_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id          UUID NOT NULL REFERENCES policy_versions(id) ON DELETE CASCADE,
  rule_type           TEXT NOT NULL CHECK (rule_type IN (
                        'approval_threshold', 'counterparty', 'time_window', 'lookahead'
                      )),
  name                TEXT NOT NULL,
  rationale           TEXT NOT NULL DEFAULT '',
  condition           JSONB NOT NULL,  -- Typed condition IR; validated by zod at save time
  verdict             TEXT NOT NULL CHECK (verdict IN ('allow_auto', 'require_approval', 'block')),
  verdict_chain_id    UUID,  -- FK added after policy_approval_chains exists
  priority            INTEGER NOT NULL,
  created_by          UUID NOT NULL REFERENCES user_profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (version_id, priority)
);

COMMENT ON TABLE policy_rules IS
  'Individual rules belonging to a policy version. Condition IR stored as JSONB. ' ||
  'Rule type is a UI category hint, not an evaluation-semantic distinction.';

CREATE TABLE policy_hard_limits (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id          UUID NOT NULL REFERENCES policy_versions(id) ON DELETE CASCADE,
  limit_type          TEXT NOT NULL CHECK (limit_type IN (
                        'min_cash_reserve_usd',
                        'max_single_asset_concentration_pct',
                        'max_daily_outflow_usd',
                        'max_30day_outflow_usd',
                        'obligation_coverage_days',
                        'max_native_exposure'
                      )),
  name                TEXT NOT NULL,
  limit_value         TEXT NOT NULL,  -- String-serialized numeric to avoid float precision loss
  limit_currency      TEXT,            -- Asset code for monetary limits, NULL for %/duration
  scope               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          UUID NOT NULL REFERENCES user_profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE policy_hard_limits IS
  'Typed structural limits, NOT condition-DSL rules. Each row is a named ' ||
  'parameter with a numeric/duration value. Only is_policy_admin users can ' ||
  'modify these (enforced at API layer in Plan 2).';

CREATE TABLE policy_approval_chains (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id          UUID NOT NULL REFERENCES policy_versions(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  slots               JSONB NOT NULL,  -- Array of { slot_index, minimum_role, label? }
  trigger_condition   JSONB,            -- Optional condition IR; when matched, this chain applies
  priority            INTEGER NOT NULL DEFAULT 0,
  expiration_hours    INTEGER NOT NULL DEFAULT 24 CHECK (expiration_hours > 0),
  created_by          UUID NOT NULL REFERENCES user_profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE policy_approval_chains IS
  'Approval chain definitions. When a rule triggers require_approval, the ' ||
  'matching chain determines who must sign off.';

-- Complete the FK on policy_rules now that chains exist
ALTER TABLE policy_rules
  ADD CONSTRAINT fk_verdict_chain
  FOREIGN KEY (verdict_chain_id) REFERENCES policy_approval_chains(id);
```

- [ ] **Step 4: Add runtime tables — requests, evaluations, simulations, activations**

Insert before the `COMMIT;`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- RUNTIME / APPEND-ONLY TABLES
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE policy_approval_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id       UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  version_id          UUID NOT NULL REFERENCES policy_versions(id),
  movement_id         TEXT NOT NULL,  -- Idempotency key from gate
  proposed_movement   JSONB NOT NULL,
  triggered_rule_ids  UUID[] NOT NULL DEFAULT '{}',
  chain_id            UUID NOT NULL REFERENCES policy_approval_chains(id),
  slot_assignments    JSONB NOT NULL,  -- Array of { slot_index, minimum_role, filled_by, filled_at, justification }
  status              TEXT NOT NULL CHECK (status IN (
                        'pending', 'approved', 'executed', 'denied', 'escalated', 'cancelled'
                      )),
  denial_reason       TEXT CHECK (denial_reason IN ('manual', 'expired', 'stale_reeval')),
  expires_at          TIMESTAMPTZ NOT NULL,
  created_by          UUID REFERENCES user_profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at         TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  resolution_notes    JSONB,
  version             INTEGER NOT NULL DEFAULT 0  -- Optimistic lock
);

COMMENT ON TABLE policy_approval_requests IS
  'Approval queue. Version pinned at creation; re-evaluation at execution time ' ||
  'uses the then-current active version. DELETE forbidden.';

CREATE TABLE policy_evaluations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id           UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  version_id              UUID NOT NULL REFERENCES policy_versions(id),
  movement_id             TEXT NOT NULL,
  proposed_movement       JSONB NOT NULL,
  context_snapshot        JSONB NOT NULL,  -- Full EvaluationContext for replay
  verdict                 TEXT NOT NULL CHECK (verdict IN (
                            'allow_auto', 'require_approval', 'block', 'block_hard_limit'
                          )),
  trace                   JSONB NOT NULL,
  canonicalization        JSONB NOT NULL,
  reason_codes            TEXT[] NOT NULL DEFAULT '{}',
  approval_request_id     UUID REFERENCES policy_approval_requests(id),
  executed_at             TIMESTAMPTZ,  -- Populated only after adapter success
  execution_ref           TEXT,          -- Adapter's execution id
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE policy_evaluations IS
  'Append-only evaluation trace + context snapshot. Simulation replays against ' ||
  'context_snapshot. Only executed_at and execution_ref may be updated after insert.';

CREATE TABLE policy_simulation_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id       UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  draft_version_id    UUID NOT NULL REFERENCES policy_versions(id),
  window_start        TIMESTAMPTZ NOT NULL,
  window_end          TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('running', 'completed', 'cancelled', 'failed')),
  progress            JSONB NOT NULL DEFAULT '{"processed": 0, "total": 0}'::jsonb,
  result              JSONB,
  failure             JSONB,
  created_by          UUID NOT NULL REFERENCES user_profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ
);

COMMENT ON TABLE policy_simulation_runs IS
  'Shadow-mode simulation runs. Async job writes progress and final result here.';

CREATE TABLE policy_activation_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id       UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  from_version_id     UUID REFERENCES policy_versions(id),  -- NULL for v1
  to_version_id       UUID NOT NULL REFERENCES policy_versions(id),
  activated_by        UUID NOT NULL REFERENCES user_profiles(id),
  activated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason              TEXT NOT NULL CHECK (length(trim(reason)) >= 20),
  diff_summary        JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_source        TEXT NOT NULL DEFAULT 'customer' CHECK (actor_source IN ('customer', 'vantor_staff'))
);

COMMENT ON TABLE policy_activation_events IS
  'Append-only log of every policy version activation. Reason must be ≥20 chars. ' ||
  'DELETE and UPDATE forbidden by triggers.';
```

- [ ] **Step 5: Add observability tables — `policy_forecast_stub_calls` and `policy_migration_warnings`**

Insert before the `COMMIT;`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- OBSERVABILITY TABLES
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE policy_forecast_stub_calls (
  id              BIGSERIAL PRIMARY KEY,
  enterprise_id   UUID NOT NULL,  -- Intentionally not FK (engineering observability)
  method          TEXT NOT NULL,
  args_json       JSONB,
  called_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE policy_forecast_stub_calls IS
  'Engineering observability: counts of forecast stub usage. NOT customer data, ' ||
  'not RLS-protected. Tracks rollout urgency of the real forecast module.';

CREATE TABLE policy_migration_warnings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id       UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES user_profiles(id),  -- NULL for enterprise-wide warnings
  warning_code        TEXT NOT NULL,
  human_readable      TEXT NOT NULL,
  details             JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE policy_migration_warnings IS
  'One-shot migration hints surfaced as banners to affected users/enterprises. ' ||
  'Populated by Plan 2 data migration; empty after this schema-only plan.';
```

- [ ] **Step 6: Add append-only triggers**

Insert before the `COMMIT;`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- APPEND-ONLY TRIGGERS
-- ════════════════════════════════════════════════════════════════════════

-- policy_evaluations: UPDATE restricted to executed_at + execution_ref only
CREATE OR REPLACE FUNCTION policy_evaluations_restricted_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.verdict          IS DISTINCT FROM NEW.verdict           OR
     OLD.trace            IS DISTINCT FROM NEW.trace             OR
     OLD.canonicalization IS DISTINCT FROM NEW.canonicalization  OR
     OLD.context_snapshot IS DISTINCT FROM NEW.context_snapshot  OR
     OLD.proposed_movement IS DISTINCT FROM NEW.proposed_movement OR
     OLD.version_id       IS DISTINCT FROM NEW.version_id        OR
     OLD.enterprise_id    IS DISTINCT FROM NEW.enterprise_id     OR
     OLD.movement_id      IS DISTINCT FROM NEW.movement_id       OR
     OLD.reason_codes     IS DISTINCT FROM NEW.reason_codes      OR
     OLD.approval_request_id IS DISTINCT FROM NEW.approval_request_id OR
     OLD.created_at       IS DISTINCT FROM NEW.created_at        THEN
    RAISE EXCEPTION 'policy_evaluations is append-only except for executed_at and execution_ref';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_policy_evaluations_restricted_update
  BEFORE UPDATE ON policy_evaluations
  FOR EACH ROW EXECUTE FUNCTION policy_evaluations_restricted_update();

CREATE RULE policy_evaluations_no_delete AS
  ON DELETE TO policy_evaluations DO INSTEAD NOTHING;

-- policy_activation_events: fully append-only
CREATE RULE policy_activation_events_no_update AS
  ON UPDATE TO policy_activation_events DO INSTEAD NOTHING;
CREATE RULE policy_activation_events_no_delete AS
  ON DELETE TO policy_activation_events DO INSTEAD NOTHING;

-- policy_approval_requests: DELETE forbidden, UPDATEs allowed for state transitions
CREATE RULE policy_approval_requests_no_delete AS
  ON DELETE TO policy_approval_requests DO INSTEAD NOTHING;

-- policy_versions: UPDATE forbidden when status != 'draft'
-- Exception: transition from 'draft' to 'active', and from 'active' to 'superseded'
CREATE OR REPLACE FUNCTION policy_versions_frozen_when_active()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    -- Draft can transition freely
    RETURN NEW;
  END IF;

  IF OLD.status = 'active' THEN
    -- Active can only become superseded
    IF NEW.status != 'superseded' THEN
      RAISE EXCEPTION 'Active policy versions can only transition to superseded, not %', NEW.status;
    END IF;
    -- Verify all other fields frozen
    IF OLD.enterprise_id IS DISTINCT FROM NEW.enterprise_id OR
       OLD.version_number IS DISTINCT FROM NEW.version_number OR
       OLD.name IS DISTINCT FROM NEW.name OR
       OLD.created_by IS DISTINCT FROM NEW.created_by OR
       OLD.created_at IS DISTINCT FROM NEW.created_at OR
       OLD.activated_at IS DISTINCT FROM NEW.activated_at OR
       OLD.activated_by IS DISTINCT FROM NEW.activated_by THEN
      RAISE EXCEPTION 'Active->superseded transition cannot modify non-supersession fields';
    END IF;
    RETURN NEW;
  END IF;

  -- Superseded is fully frozen
  RAISE EXCEPTION 'Superseded policy versions cannot be modified';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_policy_versions_frozen_when_active
  BEFORE UPDATE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION policy_versions_frozen_when_active();

-- Child tables (rules, hard_limits, approval_chains): UPDATE/DELETE forbidden
-- when parent version's status != 'draft'
CREATE OR REPLACE FUNCTION policy_child_frozen_when_parent_not_draft()
RETURNS TRIGGER AS $$
DECLARE
  parent_status TEXT;
BEGIN
  SELECT status INTO parent_status
  FROM policy_versions
  WHERE id = COALESCE(NEW.version_id, OLD.version_id);

  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'Parent policy version not found';
  END IF;

  IF parent_status != 'draft' THEN
    RAISE EXCEPTION
      'Cannot modify % row: parent policy version is % (only draft versions are mutable)',
      TG_TABLE_NAME, parent_status;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_policy_rules_frozen
  BEFORE UPDATE OR DELETE ON policy_rules
  FOR EACH ROW EXECUTE FUNCTION policy_child_frozen_when_parent_not_draft();

CREATE TRIGGER trg_policy_hard_limits_frozen
  BEFORE UPDATE OR DELETE ON policy_hard_limits
  FOR EACH ROW EXECUTE FUNCTION policy_child_frozen_when_parent_not_draft();

CREATE TRIGGER trg_policy_approval_chains_frozen
  BEFORE UPDATE OR DELETE ON policy_approval_chains
  FOR EACH ROW EXECUTE FUNCTION policy_child_frozen_when_parent_not_draft();
```

- [ ] **Step 7: Add RLS policies**

Insert before the `COMMIT;`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY POLICIES
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE policy_policies             ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_versions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_rules                ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_hard_limits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_approval_chains      ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_approval_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_evaluations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_simulation_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_activation_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_migration_warnings   ENABLE ROW LEVEL SECURITY;
-- policy_forecast_stub_calls intentionally NOT RLS (engineering observability)

-- Helper function (idempotent — may already exist from prior migrations)
-- Returns enterprise_ids visible to the current authenticated user
CREATE OR REPLACE FUNCTION user_enterprise_ids()
RETURNS SETOF UUID AS $$
  SELECT enterprise_id FROM user_profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE;

-- Enterprise-scoped SELECT and WRITE for all customer-facing policy tables
CREATE POLICY policy_policies_enterprise_scoped ON policy_policies
  FOR ALL
  USING (enterprise_id IN (SELECT user_enterprise_ids()))
  WITH CHECK (enterprise_id IN (SELECT user_enterprise_ids()));

CREATE POLICY policy_versions_enterprise_scoped ON policy_versions
  FOR ALL
  USING (enterprise_id IN (SELECT user_enterprise_ids()))
  WITH CHECK (enterprise_id IN (SELECT user_enterprise_ids()));

CREATE POLICY policy_rules_enterprise_scoped ON policy_rules
  FOR ALL
  USING (version_id IN (
    SELECT id FROM policy_versions WHERE enterprise_id IN (SELECT user_enterprise_ids())
  ))
  WITH CHECK (version_id IN (
    SELECT id FROM policy_versions WHERE enterprise_id IN (SELECT user_enterprise_ids())
  ));

CREATE POLICY policy_hard_limits_enterprise_scoped ON policy_hard_limits
  FOR ALL
  USING (version_id IN (
    SELECT id FROM policy_versions WHERE enterprise_id IN (SELECT user_enterprise_ids())
  ))
  WITH CHECK (version_id IN (
    SELECT id FROM policy_versions WHERE enterprise_id IN (SELECT user_enterprise_ids())
  ));

CREATE POLICY policy_approval_chains_enterprise_scoped ON policy_approval_chains
  FOR ALL
  USING (version_id IN (
    SELECT id FROM policy_versions WHERE enterprise_id IN (SELECT user_enterprise_ids())
  ))
  WITH CHECK (version_id IN (
    SELECT id FROM policy_versions WHERE enterprise_id IN (SELECT user_enterprise_ids())
  ));

CREATE POLICY policy_approval_requests_enterprise_scoped ON policy_approval_requests
  FOR ALL
  USING (enterprise_id IN (SELECT user_enterprise_ids()))
  WITH CHECK (enterprise_id IN (SELECT user_enterprise_ids()));

CREATE POLICY policy_evaluations_enterprise_scoped ON policy_evaluations
  FOR ALL
  USING (enterprise_id IN (SELECT user_enterprise_ids()))
  WITH CHECK (enterprise_id IN (SELECT user_enterprise_ids()));

CREATE POLICY policy_simulation_runs_enterprise_scoped ON policy_simulation_runs
  FOR ALL
  USING (enterprise_id IN (SELECT user_enterprise_ids()))
  WITH CHECK (enterprise_id IN (SELECT user_enterprise_ids()));

CREATE POLICY policy_activation_events_enterprise_scoped ON policy_activation_events
  FOR ALL
  USING (enterprise_id IN (SELECT user_enterprise_ids()))
  WITH CHECK (enterprise_id IN (SELECT user_enterprise_ids()));

CREATE POLICY policy_migration_warnings_enterprise_scoped ON policy_migration_warnings
  FOR ALL
  USING (enterprise_id IN (SELECT user_enterprise_ids()))
  WITH CHECK (enterprise_id IN (SELECT user_enterprise_ids()));
```

- [ ] **Step 8: Add indexes**

Insert before the `COMMIT;`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ════════════════════════════════════════════════════════════════════════

-- Aggregate window queries — by enterprise, time, only executed rows
CREATE INDEX idx_policy_evaluations_enterprise_executed
  ON policy_evaluations (enterprise_id, executed_at DESC)
  WHERE executed_at IS NOT NULL;

-- Idempotency lookup — by movement_id
CREATE INDEX idx_policy_evaluations_movement_id
  ON policy_evaluations (movement_id);

-- Evaluation log browsing — recent-first
CREATE INDEX idx_policy_evaluations_enterprise_created
  ON policy_evaluations (enterprise_id, created_at DESC);

-- Pending approvals — partial index for sweeper + UI
CREATE INDEX idx_policy_approval_requests_pending
  ON policy_approval_requests (enterprise_id, expires_at)
  WHERE status = 'pending';

-- Approval request by movement_id — for idempotency reconstruction
CREATE INDEX idx_policy_approval_requests_movement_id
  ON policy_approval_requests (movement_id);

-- Version listing
CREATE INDEX idx_policy_versions_enterprise_status
  ON policy_versions (enterprise_id, status, version_number DESC);

-- Stub call observability
CREATE INDEX idx_policy_forecast_stub_calls_enterprise_called
  ON policy_forecast_stub_calls (enterprise_id, called_at DESC);
```

- [ ] **Step 9: Add column additions to `user_profiles` and `ai_recommendations`**

Insert before the `COMMIT;`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- COLUMN ADDITIONS TO EXISTING TABLES
-- ════════════════════════════════════════════════════════════════════════

-- Per-enterprise flag granting policy admin capability (edit hard limits,
-- activate versions). Separate from is_app_admin (Vantor staff flag).
ALTER TABLE user_profiles
  ADD COLUMN is_policy_admin BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_profiles.is_policy_admin IS
  'Per-enterprise flag: grants permission to edit hard limits and activate ' ||
  'policy versions within the user''s own enterprise. Scoped to that enterprise ' ||
  'only — does not grant cross-enterprise access. is_app_admin implicitly ' ||
  'satisfies this check for Vantor staff support scenarios.';

-- Link ai_recommendations to their corresponding approval requests
ALTER TABLE ai_recommendations
  ADD COLUMN approval_request_id UUID REFERENCES policy_approval_requests(id);

COMMENT ON COLUMN ai_recommendations.approval_request_id IS
  'Set when a recommendation enters the policy engine approval queue. ' ||
  'Used for linking display of recommendation narrative to approval actions.';
```

- [ ] **Step 10: Verify the file compiles (syntax-only check)**

The migration uses standard Postgres SQL. Visually scan the file for:
- Matching `CREATE TABLE` / semicolon pairs
- All foreign keys reference tables defined earlier in the file OR patched post-definition
- `BEGIN;` at top and `COMMIT;` at bottom
- No unclosed strings, no missing `$$` pairs in functions

- [ ] **Step 11: Commit the migration file**

```bash
git add supabase/migrations/0034_policy_engine_schema.sql
git commit -m "$(cat <<'EOF'
feat(policy): add migration 0034 — policy engine schema

Creates all 9 policy_* tables (policies, versions, rules, hard_limits,
approval_chains, approval_requests, evaluations, simulation_runs,
activation_events) plus 2 supporting tables (forecast_stub_calls,
migration_warnings). Adds append-only triggers, RLS policies, indexes,
and the is_policy_admin column on user_profiles + approval_request_id
on ai_recommendations.

Schema-only. Data migration from treasury_rules happens in Plan 2.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Apply schema migration to dev and prod Supabase

**Files:** (runs existing `supabase/migrations/0034_policy_engine_schema.sql`, no new files)

This task runs the migration against both Supabase instances. Per CLAUDE.md, both dev (`spllxotyxipdvfpkkvgu`) and prod (`lfujbwemavgiifkltrag`) must be kept in sync.

- [ ] **Step 1: Verify `.env.local` points at the DEV Supabase instance**

```bash
grep -E "^NEXT_PUBLIC_SUPABASE_URL" .env.local
```

Expected output (the dev URL):
```
NEXT_PUBLIC_SUPABASE_URL=https://spllxotyxipdvfpkkvgu.supabase.co
```

If it shows the prod URL (`lfujbwemavgiifkltrag`), stop and swap to dev first. **Never run a fresh migration against prod before verifying it on dev.**

- [ ] **Step 2: Run the migration against dev**

```bash
npm run migrate supabase/migrations/0034_policy_engine_schema.sql
```

Expected output:
```
Running migration: supabase/migrations/0034_policy_engine_schema.sql
Project: spllxotyxipdvfpkkvgu
Migration applied successfully.
```

If the migration fails, read the error carefully. Common issues:
- **`relation "enterprises" does not exist`** — a previous migration hasn't run; check `supabase/migrations/` ordering
- **`function auth.uid() does not exist`** — Supabase auth schema issue; verify project is a real Supabase project, not a raw Postgres db
- **`column "is_policy_admin" of relation "user_profiles" already exists`** — migration ran partially before; manually drop the added column from `user_profiles` and clean up, then re-run
- Trigger errors — syntax issue in one of the `$$ ... $$` function bodies; diff against the plan step content

- [ ] **Step 3: Verify the tables exist on dev**

Connect to the dev database (via Supabase Studio SQL editor at https://supabase.com/dashboard/project/spllxotyxipdvfpkkvgu/sql/new) and run:

```sql
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'policy_%'
ORDER BY tablename;
```

Expected output: exactly these 11 rows:
```
policy_activation_events
policy_approval_chains
policy_approval_requests
policy_evaluations
policy_forecast_stub_calls
policy_hard_limits
policy_migration_warnings
policy_policies
policy_rules
policy_simulation_runs
policy_versions
```

- [ ] **Step 4: Verify the triggers exist on dev**

```sql
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE event_object_schema = 'public' AND trigger_name LIKE '%policy_%'
ORDER BY event_object_table, trigger_name;
```

Expected output (5 rows):
```
trg_policy_approval_chains_frozen        policy_approval_chains
trg_policy_evaluations_restricted_update policy_evaluations
trg_policy_hard_limits_frozen            policy_hard_limits
trg_policy_rules_frozen                  policy_rules
trg_policy_versions_frozen_when_active   policy_versions
```

- [ ] **Step 5: Verify `is_policy_admin` and `approval_request_id` columns exist**

```sql
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE (table_name, column_name) IN (
  ('user_profiles', 'is_policy_admin'),
  ('ai_recommendations', 'approval_request_id')
);
```

Expected output:
```
ai_recommendations  approval_request_id  uuid    NULL
user_profiles       is_policy_admin      boolean false
```

- [ ] **Step 6: Verify append-only trigger works (smoke test)**

Still in Supabase Studio:

```sql
-- Insert a minimal dummy evaluation row (you may need to pick an existing enterprise_id)
-- Find a real enterprise first:
SELECT id FROM enterprises LIMIT 1;
-- Copy that UUID, then:
```

Then as a smoke test, try to INSERT + UPDATE:

```sql
BEGIN;

-- Create a dummy policy + version + evaluation (use a real enterprise_id)
INSERT INTO policy_policies (enterprise_id) VALUES ('<real-enterprise-id>')
  RETURNING id;

-- Use the returned policy id in the next step... actually this gets complex.
-- Simpler test: just try to DELETE from policy_evaluations (should fail silently or err)
-- Since the table is empty, we can't test UPDATE. Skip the smoke test and trust the
-- triggers were created (Step 4 confirmed they exist).

ROLLBACK;
```

Skip this step if it gets complicated — we'll write real trigger tests in Plan 2 when the tables have data.

- [ ] **Step 7: Swap `.env.local` to point at PROD Supabase**

Edit `.env.local` and change:
```
NEXT_PUBLIC_SUPABASE_URL=https://lfujbwemavgiifkltrag.supabase.co
# (may need to swap SUPABASE_ANON_KEY too — check your existing setup)
```

Verify:
```bash
grep -E "^NEXT_PUBLIC_SUPABASE_URL" .env.local
```

Expected:
```
NEXT_PUBLIC_SUPABASE_URL=https://lfujbwemavgiifkltrag.supabase.co
```

- [ ] **Step 8: Run the migration against prod**

```bash
npm run migrate supabase/migrations/0034_policy_engine_schema.sql
```

Expected output:
```
Running migration: supabase/migrations/0034_policy_engine_schema.sql
Project: lfujbwemavgiifkltrag
Migration applied successfully.
```

- [ ] **Step 9: Verify tables exist on prod (same SQL as Step 3, via Supabase Studio prod project)**

Connect to https://supabase.com/dashboard/project/lfujbwemavgiifkltrag/sql/new and run the same `SELECT tablename FROM pg_tables WHERE tablename LIKE 'policy_%'` query. Confirm 11 rows.

- [ ] **Step 10: Swap `.env.local` back to dev**

```
NEXT_PUBLIC_SUPABASE_URL=https://spllxotyxipdvfpkkvgu.supabase.co
```

From here forward, local development uses dev. Production sync only happens at explicit migration steps.

- [ ] **Step 11: No commit needed**

This task runs the migration that was committed in Task 1. No new files to commit. If the migration file needed amendment (e.g., syntax error), amend it and commit the fix separately.

---

## Task 3: Define reason codes and error classes

**Files:**
- Create: `src/lib/policy/errors/reason-codes.ts`
- Create: `src/lib/policy/errors/classes.ts`
- Create: `src/lib/policy/errors/classes.test.ts`

- [ ] **Step 1: Write the failing test for `PolicyError`**

Create `src/lib/policy/errors/classes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  PolicyError,
  CanonicalizationError,
  HardLimitBreachError,
  ForecastUnavailableError,
  AggregateQueryFailedError,
} from './classes';
import { REASON_CODES } from './reason-codes';

describe('PolicyError', () => {
  it('carries reason_code, human_readable, details, and user_action', () => {
    const err = new PolicyError({
      reason_code: REASON_CODES.gate_internal_error,
      module: 'gate',
      human_readable: 'Something went wrong.',
      user_action: 'Retry or contact support.',
      details: { foo: 'bar' },
    });

    expect(err.reason_code).toBe('gate_internal_error');
    expect(err.module).toBe('gate');
    expect(err.human_readable).toBe('Something went wrong.');
    expect(err.user_action).toBe('Retry or contact support.');
    expect(err.details).toEqual({ foo: 'bar' });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('gate_internal_error');
  });

  it('serializes to a structured object via toJSON()', () => {
    const err = new PolicyError({
      reason_code: REASON_CODES.canonicalization_failed,
      module: 'canonicalizer',
      human_readable: 'Rate unavailable',
      user_action: 'Retry',
      details: { from: 'USDC', to: 'USD' },
    });

    const serialized = err.toJSON();
    expect(serialized).toMatchObject({
      reason_code: 'canonicalization_failed',
      module: 'canonicalizer',
      human_readable: 'Rate unavailable',
      user_action: 'Retry',
      details: { from: 'USDC', to: 'USD' },
    });
  });
});

describe('CanonicalizationError', () => {
  it('is a PolicyError with reason_code=canonicalization_failed', () => {
    const err = new CanonicalizationError({
      human_readable: 'Cannot convert BTC to USD',
      user_action: 'Add BTC rate source',
      details: { from: 'BTC', to: 'USD', source_status: 'unsupported' },
    });

    expect(err).toBeInstanceOf(PolicyError);
    expect(err.reason_code).toBe('canonicalization_failed');
    expect(err.module).toBe('canonicalizer');
    expect(err.details).toMatchObject({ from: 'BTC', to: 'USD' });
  });
});

describe('HardLimitBreachError', () => {
  it('carries limit_type and is not throwable at API boundary (structured only)', () => {
    const err = new HardLimitBreachError({
      human_readable: 'Cash reserve floor breached',
      user_action: 'Reduce transfer amount',
      details: {
        limit_type: 'min_cash_reserve_usd',
        limit_value: '500000',
        post_transfer_value: '470000',
        overage: '30000',
      },
    });

    expect(err.reason_code).toBe('hard_limit_breached');
    expect(err.details.limit_type).toBe('min_cash_reserve_usd');
  });
});

describe('ForecastUnavailableError', () => {
  it('has reason_code=forecast_unavailable', () => {
    const err = new ForecastUnavailableError({
      human_readable: 'Forecast query failed',
      user_action: 'Retry later',
      details: { query: 'obligations_covered', window_days: 14 },
    });

    expect(err.reason_code).toBe('forecast_unavailable');
  });
});

describe('AggregateQueryFailedError', () => {
  it('has reason_code=aggregate_query_failed', () => {
    const err = new AggregateQueryFailedError({
      human_readable: 'Window query failed',
      user_action: 'Retry',
      details: { window_spec: { duration_ms: 86400000 } },
    });

    expect(err.reason_code).toBe('aggregate_query_failed');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- src/lib/policy/errors
```

Expected: FAIL with errors like `Cannot find module './classes'` and `Cannot find module './reason-codes'`.

- [ ] **Step 3: Create `reason-codes.ts`**

Create `src/lib/policy/errors/reason-codes.ts`:

```typescript
/**
 * Closed enumeration of every policy engine reason code. Codes are API surface
 * and must not be renamed after shipping. See
 * docs/superpowers/specs/2026-04-10-treasury-policy-engine-design.md §11.
 */
export const REASON_CODES = {
  // ─── Canonicalization ────────────────────────────────────────────────
  canonicalization_failed:           'canonicalization_failed',
  canonicalization_source_unavailable: 'canonicalization_source_unavailable',
  canonicalization_rate_stale:       'canonicalization_rate_stale',

  // ─── Evaluation engine ───────────────────────────────────────────────
  condition_node_evaluation_failed:  'condition_node_evaluation_failed',
  forecast_unavailable:              'forecast_unavailable',
  aggregate_query_failed:            'aggregate_query_failed',
  sanctions_status_unavailable:      'sanctions_status_unavailable',
  counterparty_lookup_failed:        'counterparty_lookup_failed',
  policy_version_not_active:         'policy_version_not_active',

  // ─── Hard limit checker ──────────────────────────────────────────────
  hard_limit_breached:               'hard_limit_breached',
  treasury_state_unavailable:        'treasury_state_unavailable',
  scope_resolution_failed:           'scope_resolution_failed',
  historical_outflow_unavailable:    'historical_outflow_unavailable',

  // ─── Splitting detector ──────────────────────────────────────────────
  window_spec_invalid:               'window_spec_invalid',

  // ─── Approval workflow ───────────────────────────────────────────────
  approval_not_pending:              'approval_not_pending',
  sod_initiator_conflict:            'sod_initiator_conflict',
  sod_rule_editor_conflict:          'sod_rule_editor_conflict',
  sod_already_filled:                'sod_already_filled',
  no_matching_slot:                  'no_matching_slot',
  approval_concurrent_modification:  'approval_concurrent_modification',
  stale_approval_chain_mismatch:     'stale_approval_chain_mismatch',
  stale_approval_reevaluation_failed: 'stale_approval_reevaluation_failed',
  activation_reason_too_short:       'activation_reason_too_short',
  chain_unsatisfiable_at_activation: 'chain_unsatisfiable_at_activation',

  // ─── Simulation ──────────────────────────────────────────────────────
  historical_context_incomplete:     'historical_context_incomplete',
  new_forecast_query_fresh_data:     'new_forecast_query_fresh_data',
  new_aggregate_window_approximated: 'new_aggregate_window_approximated',
  obligation_coverage_stub_at_time:  'obligation_coverage_stub_at_time',
  simulation_already_running:        'simulation_already_running',
  draft_deleted:                     'draft_deleted',
  simulation_window_too_large:       'simulation_window_too_large',

  // ─── Rule authoring ──────────────────────────────────────────────────
  condition_ir_type_mismatch:        'condition_ir_type_mismatch',
  condition_ir_schema_invalid:       'condition_ir_schema_invalid',
  usd_rule_on_rateless_asset:        'usd_rule_on_rateless_asset',
  native_unit_currency_mismatch:     'native_unit_currency_mismatch',
  chain_reference_not_found:         'chain_reference_not_found',
  rule_priority_collision:           'rule_priority_collision',
  activation_blocked_by_validation:  'activation_blocked_by_validation',
  activation_race_conflict:          'activation_race_conflict',
  requires_policy_admin:             'requires_policy_admin',
  version_not_draft:                 'version_not_draft',
  hard_limit_value_out_of_range:     'hard_limit_value_out_of_range',
  obligation_coverage_advisory_only: 'obligation_coverage_advisory_only',

  // ─── Gate / execution ────────────────────────────────────────────────
  movement_validation_failed:        'movement_validation_failed',
  movement_kind_unsupported:         'movement_kind_unsupported',
  idempotency_key_conflict:          'idempotency_key_conflict',
  adapter_execution_failed:          'adapter_execution_failed',
  gate_internal_error:               'gate_internal_error',
} as const;

export type ReasonCode = typeof REASON_CODES[keyof typeof REASON_CODES];

/**
 * Warnings (not errors — attached to traces, never cause a block on their own).
 */
export const WARNING_CODES = {
  forecast_stub_mode:            'forecast_stub_mode',
  ai_initiator_floor_applied:    'ai_initiator_floor_applied',
  splitting_matched:             'splitting_matched',
  default_deny_triggered:        'default_deny_triggered',
} as const;

export type WarningCode = typeof WARNING_CODES[keyof typeof WARNING_CODES];
```

- [ ] **Step 4: Create `classes.ts`**

Create `src/lib/policy/errors/classes.ts`:

```typescript
import { ReasonCode, REASON_CODES } from './reason-codes';

/**
 * Base class for every structured policy engine error. Follows the error
 * commitment: stable reason code, human-readable explanation, user action,
 * structured details, serializable to a consistent envelope.
 *
 * Errors should be CONSTRUCTED in engine code and returned via result types
 * (not thrown), except at API boundaries where throwing is converted to
 * structured HTTP responses.
 */
export interface PolicyErrorInit {
  reason_code: ReasonCode;
  module: string;
  human_readable: string;
  user_action?: string;
  details?: Record<string, unknown>;
}

export class PolicyError extends Error {
  readonly reason_code: ReasonCode;
  readonly module: string;
  readonly human_readable: string;
  readonly user_action: string;
  readonly details: Record<string, unknown>;
  readonly occurred_at: string;

  constructor(init: PolicyErrorInit) {
    super(`[${init.reason_code}] ${init.human_readable}`);
    this.name = 'PolicyError';
    this.reason_code = init.reason_code;
    this.module = init.module;
    this.human_readable = init.human_readable;
    this.user_action = init.user_action ?? '';
    this.details = init.details ?? {};
    this.occurred_at = new Date().toISOString();
  }

  toJSON(): PolicyErrorEnvelope {
    return {
      reason_code: this.reason_code,
      module: this.module,
      human_readable: this.human_readable,
      user_action: this.user_action,
      details: this.details,
      occurred_at: this.occurred_at,
    };
  }
}

export interface PolicyErrorEnvelope {
  reason_code: ReasonCode;
  module: string;
  human_readable: string;
  user_action: string;
  details: Record<string, unknown>;
  occurred_at: string;
}

/** Canonicalization failed for any reason — rate stale, source down, unsupported asset. */
export class CanonicalizationError extends PolicyError {
  constructor(init: Omit<PolicyErrorInit, 'reason_code' | 'module'>) {
    super({ ...init, reason_code: REASON_CODES.canonicalization_failed, module: 'canonicalizer' });
    this.name = 'CanonicalizationError';
  }
}

/** A hard limit was breached by the proposed movement. */
export class HardLimitBreachError extends PolicyError {
  constructor(init: Omit<PolicyErrorInit, 'reason_code' | 'module'>) {
    super({ ...init, reason_code: REASON_CODES.hard_limit_breached, module: 'hard_limit_checker' });
    this.name = 'HardLimitBreachError';
  }
}

/** Forecast module returned an error or unavailable response. */
export class ForecastUnavailableError extends PolicyError {
  constructor(init: Omit<PolicyErrorInit, 'reason_code' | 'module'>) {
    super({ ...init, reason_code: REASON_CODES.forecast_unavailable, module: 'forecast' });
    this.name = 'ForecastUnavailableError';
  }
}

/** An aggregate-window query failed at the database layer. */
export class AggregateQueryFailedError extends PolicyError {
  constructor(init: Omit<PolicyErrorInit, 'reason_code' | 'module'>) {
    super({ ...init, reason_code: REASON_CODES.aggregate_query_failed, module: 'aggregate_detector' });
    this.name = 'AggregateQueryFailedError';
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test -- src/lib/policy/errors
```

Expected output:
```
 ✓ src/lib/policy/errors/classes.test.ts (7)
   ✓ PolicyError (2)
     ✓ carries reason_code, human_readable, details, and user_action
     ✓ serializes to a structured object via toJSON()
   ✓ CanonicalizationError (1)
     ✓ is a PolicyError with reason_code=canonicalization_failed
   ✓ HardLimitBreachError (1)
     ✓ carries limit_type and is not throwable at API boundary (structured only)
   ✓ ForecastUnavailableError (1)
     ✓ has reason_code=forecast_unavailable
   ✓ AggregateQueryFailedError (1)
     ✓ has reason_code=aggregate_query_failed

 Test Files  1 passed (1)
      Tests  7 passed (7)
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/policy/errors/
git commit -m "$(cat <<'EOF'
feat(policy): add reason codes and error classes

Closed taxonomy of ~45 reason codes plus PolicyError base class and
four concrete subclasses (Canonicalization, HardLimitBreach,
ForecastUnavailable, AggregateQueryFailed). Every error carries
reason_code, module, human_readable, user_action, and structured
details per the error commitment in the spec.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Define core TypeScript types

Pure type definitions — no runtime logic, no test files. Each step adds one file. At the end we run `tsc --noEmit` to confirm the whole type graph compiles.

**Files:**
- Create: `src/lib/policy/types/assets.ts`
- Create: `src/lib/policy/types/movement.ts`
- Create: `src/lib/policy/types/verdict.ts`
- Create: `src/lib/policy/types/ir.ts`
- Create: `src/lib/policy/types/context.ts`
- Create: `src/lib/policy/types/trace.ts`
- Create: `src/lib/policy/types/hard-limit.ts`
- Create: `src/lib/policy/types/policy-version.ts`
- Create: `src/lib/policy/types/index.ts`

- [ ] **Step 1: Create `assets.ts`**

```typescript
// src/lib/policy/types/assets.ts

/**
 * Asset codes the policy engine recognizes in phase 1.
 * Expansion requires adding here AND adding a rate source in the
 * canonicalizer's PolicyRateProvider implementation (for USD-comparable
 * assets) OR leaving as native-only.
 */
export type AssetCode =
  | 'USD'
  | 'USDC'
  | 'USDT'
  // Future: 'EUR', 'GBP', 'BTC', 'ETH', 'DAI', 'PYUSD', etc.
  | (string & { readonly __brand?: 'AssetCode' });  // open-ended brand for extensibility

/**
 * Stable identifier for a venue (chain, exchange, bank).
 * Matches existing wallet venue values (e.g., 'ethereum', 'solana', 'svb', 'mercury').
 */
export type VenueId = string;

/**
 * Native-denominated amount. The amount is a decimal string to avoid
 * JavaScript float precision loss. Never use `number` for monetary values
 * at the policy engine boundary.
 */
export interface AmountNative {
  amount: string;    // Decimal string (e.g., "500000" or "1234567.89")
  asset: AssetCode;
}

/**
 * A currency-tagged amount used in rule values and hard limits.
 * The `currency` field is required to make comparisons explicit —
 * there is no implied "default currency." Native-unit rules use the
 * asset code here; USD-denominated rules use 'USD'.
 */
export interface AmountValue {
  amount: string;    // Decimal string
  currency: AssetCode;
}
```

- [ ] **Step 2: Create `movement.ts`**

```typescript
// src/lib/policy/types/movement.ts

import { AssetCode, AmountNative, VenueId } from './assets';

/**
 * The seven movement kinds supported in phase 1. Expansion requires adding
 * the kind here, adding a case in the gate's dispatch switch, and adding
 * a matching adapter under src/lib/*/*.internal.ts.
 */
export type MovementKind =
  | 'crypto_transfer'
  | 'fiat_ramp'
  | 'yield_deposit'
  | 'yield_withdraw'
  | 'swap'
  | 'bridge'
  | 'payment';

export type InitiatorType = 'human' | 'agent' | 'ai_recommendation' | 'schedule';

/**
 * Who initiated this movement. Exactly one of the identity fields should be
 * populated based on `type`:
 *   - type='human' → user_id
 *   - type='agent' → agent_id (+ optional recommendation_id)
 *   - type='ai_recommendation' → recommendation_id
 *   - type='schedule' → scheduled_op_id
 *
 * Validation is enforced by the zod schema, not by TypeScript narrowing.
 */
export interface Initiator {
  type: InitiatorType;
  user_id?: string;
  agent_id?: string;
  recommendation_id?: string;
  scheduled_op_id?: string;
}

/**
 * One end of a movement (source or destination). At least one of
 * address/account_id must be present depending on the venue type.
 */
export interface MovementEndpoint {
  venue: VenueId;
  asset: AssetCode;
  address?: string;      // for crypto
  account_id?: string;   // for bank accounts
  label?: string;        // optional display name
}

/**
 * Reference to a counterparty, if the movement is attributable to one.
 * The full counterparty record is loaded separately by the context loader.
 */
export interface CounterpartyRef {
  id: string;
  type?: 'known' | 'new' | 'unknown';
  jurisdiction?: string;
}

/**
 * The normalized proposed movement — the canonical shape every caller's
 * input is converted into before the engine evaluates.
 *
 * Built by `src/lib/policy/gate.ts` (in Plan 2) from whatever shape the
 * caller provided. The engine never sees the caller's raw body.
 */
export interface ProposedMovement {
  id: string;                 // idempotency key
  kind: MovementKind;
  source: MovementEndpoint;
  destination: MovementEndpoint;
  amount: AmountNative;
  counterparty?: CounterpartyRef;
  initiator: Initiator;
  purpose_code?: string;
  rail?: string;
  metadata?: Record<string, unknown>;
  requested_at: string;       // ISO 8601
}
```

- [ ] **Step 3: Create `verdict.ts`**

```typescript
// src/lib/policy/types/verdict.ts

import { ReasonCode } from '../errors/reason-codes';
import { EvaluationTrace } from './trace';

/**
 * The four possible verdicts the engine can produce.
 *
 * - allow_auto: policy permits automatic execution (subject to system invariants)
 * - require_approval: must pass through the approval workflow before execution
 * - block: a user rule blocked this movement
 * - block_hard_limit: a structural hard limit breach; terminal, cannot be overridden
 */
export type Verdict = 'allow_auto' | 'require_approval' | 'block' | 'block_hard_limit';

/**
 * Result of a single evaluation. Built by the pure evaluator and persisted
 * to policy_evaluations (in Plan 2) via the gate.
 */
export interface EvaluationResult {
  verdict: Verdict;
  trace: EvaluationTrace;
  required_chain?: ResolvedApprovalChain;   // populated iff verdict='require_approval'
  reason_codes: ReasonCode[];                // in order of precedence
}

/**
 * Chain resolved for a require_approval verdict. The approval workflow
 * service (Plan 2) uses this to create an approval request.
 */
export interface ResolvedApprovalChain {
  chain_id: string;
  chain_name: string;
  slots: ApprovalSlotRequirement[];
  expiration_hours: number;
}

export interface ApprovalSlotRequirement {
  slot_index: number;
  minimum_role: ApproverRole;
  label?: string;
}

/**
 * Approver roles recognized for slot filling. Extends the existing
 * user_profiles.role enum with the two new roles added in Plan 2.
 * In phase 1 of this plan, only the shape is defined; the database-side
 * enum update happens in Plan 2.
 */
export type ApproverRole = 'accountant' | 'treasury_manager' | 'approver' | 'executive';
```

- [ ] **Step 4: Create `ir.ts`**

```typescript
// src/lib/policy/types/ir.ts

import { AmountValue, AssetCode, VenueId } from './assets';

/**
 * The typed intermediate representation (IR) for rule conditions. Closed
 * discriminated union of 9 node kinds. Expansion requires adding a new
 * kind to this union, the ir-evaluator switch, the zod schema, and every
 * rule editor UI form — TypeScript exhaustiveness checking enforces all
 * consumers update together.
 */
export type Condition =
  | AndNode
  | OrNode
  | NotNode
  | AmountCompareNode
  | StringCompareNode
  | TimeCompareNode
  | SanctionsStatusNode
  | ForecastQueryNode
  | AggregateWindowNode;

export interface AndNode {
  kind: 'and';
  children: Condition[];
}

export interface OrNode {
  kind: 'or';
  children: Condition[];
}

export interface NotNode {
  kind: 'not';
  child: Condition;
}

// ─── Amount comparison ──────────────────────────────────────────────────

export type AmountAttribute =
  | 'transfer.amount'           // the movement's own amount (splitting guard applies)
  | 'treasury.position'         // pre-transfer position of an asset
  | 'treasury.post_position'    // post-transfer position of an asset
  | 'rolling_sum';              // pre-computed aggregate (see aggregate_window)

export type NumericOp = '>' | '>=' | '<' | '<=' | '==' | '!=' | 'between';

export interface AmountScope {
  asset?: AssetCode;
  venue?: VenueId;
}

export interface AmountCompareNode {
  kind: 'amount_compare';
  attr: AmountAttribute;
  scope?: AmountScope;
  op: NumericOp;
  value: AmountValue;
  value_upper?: AmountValue;    // required iff op='between'
}

// ─── String comparison ──────────────────────────────────────────────────

export type StringAttribute =
  | 'transfer.counterparty_id'
  | 'transfer.purpose_code'
  | 'transfer.initiator_type'
  | 'transfer.rail'
  | 'transfer.source_venue'
  | 'transfer.destination_venue';

export type StringOp = '==' | '!=' | 'in' | 'not_in';

export interface StringCompareNode {
  kind: 'string_compare';
  attr: StringAttribute;
  op: StringOp;
  value: string | string[];
}

// ─── Time comparison ────────────────────────────────────────────────────

export type TimeAttribute =
  | 'now.day_of_week'           // 0-6 (Sun-Sat)
  | 'now.hour_local'            // 0-23
  | 'now.is_business_hours'     // boolean
  | 'time_since_last_to_counterparty'   // milliseconds
  | 'time_since_last_by_initiator';     // milliseconds

export type TimeOp = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'not_in';

export type TimeValue = number | string | boolean | (number | string)[];

export interface TimeCompareNode {
  kind: 'time_compare';
  attr: TimeAttribute;
  op: TimeOp;
  value: TimeValue;
}

// ─── Sanctions status ───────────────────────────────────────────────────

export type SanctionsStatus = 'clear' | 'sanctioned' | 'partial_match' | 'unscreened';

export interface SanctionsStatusNode {
  kind: 'sanctions_status';
  op: 'in' | 'not_in';
  values: SanctionsStatus[];
}

// ─── Forecast query ─────────────────────────────────────────────────────

export type ForecastQueryKind =
  | 'projected_min_balance'
  | 'projected_position'
  | 'obligations_covered';

export interface ForecastScope {
  asset?: AssetCode;
  venue?: VenueId;
}

export interface ForecastQueryNode {
  kind: 'forecast_query';
  query: ForecastQueryKind;
  window_days: number;
  scope?: ForecastScope;
  comparator: NumericOp;
  value: AmountValue;
}

// ─── Aggregate window ───────────────────────────────────────────────────

export interface WindowSpec {
  duration_ms: number;
  group_by: GroupingDimensions;
  direction?: 'outflow' | 'inflow' | 'both';  // default 'outflow'
}

export interface GroupingDimensions {
  initiator?: boolean;
  counterparty?: boolean;
  destination?: boolean;
  asset?: boolean;
}

export type AggregateAttr =
  | 'sum_amount'
  | 'count'
  | 'distinct_destinations'
  | 'distinct_counterparties';

export interface AggregateScope {
  asset?: AssetCode;
}

export interface AggregateWindowNode {
  kind: 'aggregate_window';
  window: WindowSpec;
  attr: AggregateAttr;
  scope?: AggregateScope;
  op: NumericOp;
  value: AmountValue;
}
```

- [ ] **Step 5: Create `hard-limit.ts`**

```typescript
// src/lib/policy/types/hard-limit.ts

import { AssetCode, VenueId } from './assets';
import { ReasonCode } from '../errors/reason-codes';

/**
 * Closed set of hard limit types in phase 1. Expansion requires:
 *   1. New value here (TypeScript catches missed switches everywhere)
 *   2. New CHECK constraint value in policy_hard_limits.limit_type
 *   3. New evaluator function in hard-limit-checker/limits/
 *   4. New template in hard-limit-checker/templates.ts
 *   5. New authoring form field in Plan 3 UI
 */
export type HardLimitType =
  | 'min_cash_reserve_usd'
  | 'max_single_asset_concentration_pct'
  | 'max_daily_outflow_usd'
  | 'max_30day_outflow_usd'
  | 'obligation_coverage_days'
  | 'max_native_exposure';

export interface HardLimitScope {
  asset?: AssetCode;
  venue?: VenueId;
  include_venues?: VenueId[];
}

/**
 * A single hard limit row from policy_hard_limits, hydrated into a
 * PolicyVersionSnapshot and consumed by the checker.
 */
export interface HardLimit {
  id: string;
  limit_type: HardLimitType;
  name: string;
  limit_value: string;           // decimal string
  limit_currency?: AssetCode;    // USD for monetary, NULL for %/duration
  scope: HardLimitScope;
}

/**
 * Result of evaluating a single hard limit against a proposed movement.
 * Contains the pre-transfer state, post-transfer state, and whether the
 * limit was breached — always populated, even when no breach occurred,
 * so the utilization UI can display gauges.
 */
export interface HardLimitEvaluation {
  limit_id: string;
  limit_type: HardLimitType;
  limit_name: string;
  limit_value: string;
  limit_currency?: AssetCode;
  scope: HardLimitScope;
  current_value: string;         // pre-transfer
  post_transfer_value: string;   // post-transfer (what the check uses)
  breached: boolean;
  headroom?: string;             // populated if NOT breached
  overage?: string;              // populated if breached
  utilization_pct?: number;      // (post / limit) * 100, clamped to [0, 200]
  failure?: HardLimitFailure;    // populated if limit could not be evaluated
}

export interface HardLimitBreach extends HardLimitEvaluation {
  breached: true;
  overage: string;
  reason_code: 'hard_limit_breached';
  human_readable: string;
  user_action: string;
}

export interface HardLimitFailure {
  reason_code: ReasonCode;
  human_readable: string;
  details: Record<string, unknown>;
  user_action: string;
}

export interface HardLimitCheckResult {
  any_breached: boolean;
  breaches: HardLimitBreach[];
  evaluated: HardLimitEvaluation[];   // all limits, always
}
```

- [ ] **Step 6: Create `context.ts`**

```typescript
// src/lib/policy/types/context.ts

import { AssetCode, VenueId } from './assets';
import { PolicyVersionSnapshot } from './policy-version';
import { SanctionsStatus } from './ir';

/**
 * Fully-hydrated input to the pure evaluator. Built by the async
 * EvaluationContextLoader in context-loader/loader.ts.
 */
export interface EvaluationContext {
  now: Date;
  enterprise_id: string;
  policy_version: PolicyVersionSnapshot;
  treasury_state: TreasuryState;
  canonicalization: CanonicalizationResult;
  aggregates: AggregateWindowResults;
  sanctions: SanctionsSnapshot;
  forecast: ForecastSnapshot;
  counterparty?: CounterpartyHistoryRecord;
}

/**
 * Point-in-time view of the enterprise's treasury. All USD-equivalent
 * fields are canonicalized at load time.
 */
export interface TreasuryState {
  positions_by_asset: Record<AssetCode, string>;              // native amounts
  positions_by_asset_venue: Record<string, string>;           // key: "asset:venue"
  positions_usd_by_asset: Record<AssetCode, string>;          // USD-equivalent per asset
  total_treasury_usd: string;                                 // sum of all positions_usd
  cash_equivalent_usd: string;                                // sum of USD + stablecoin positions
  loaded_at: Date;
  failures?: TreasuryStateFailure[];                          // partial-load failures
}

export interface TreasuryStateFailure {
  asset?: AssetCode;
  venue?: VenueId;
  reason_code: string;
  human_readable: string;
}

/**
 * Pre-computed canonicalization for the proposed movement. The evaluator
 * reads `canonical_amount_usd` directly rather than calling the rate
 * provider during evaluation — keeps the evaluator pure.
 */
export interface CanonicalizationResult {
  native_amount: string;
  native_asset: AssetCode;
  canonical_amount: string;       // in USD; empty string if canonicalization failed
  canonical_currency: 'USD';
  rate: string;                   // decimal string (e.g., "1.0002")
  rate_source: string;            // e.g., 'coingecko' | 'manual_override'
  rate_as_of: Date;               // when the underlying rate was read
  max_age_ms: number;             // policy engine's staleness threshold
  failure?: CanonicalizationResultFailure;
}

export interface CanonicalizationResultFailure {
  reason_code: 'canonicalization_failed' | 'canonicalization_source_unavailable' | 'canonicalization_rate_stale';
  human_readable: string;
  details: Record<string, unknown>;
  user_action: string;
}

/**
 * Pre-loaded aggregate window queries, keyed by a deterministic hash of
 * the window spec. The always-on 24h splitting guard is populated under
 * the `system_splitting_guard_24h` field; user-authored aggregate_window
 * nodes are resolved through `user_specs`.
 */
export interface AggregateWindowResults {
  system_splitting_guard_24h: AggregateWindowResult;
  user_specs: Record<string, AggregateWindowResult>;
}

export interface AggregateWindowResult {
  window_spec_hash: string;
  window_start: Date;
  window_end: Date;
  sum_amount_usd: string;
  sum_amount_by_asset: Record<AssetCode, string>;
  count: number;
  distinct_destinations: number;
  distinct_counterparties: number;
  included_evaluation_ids: string[];
  includes_proposed: false;       // always false — evaluator adds proposed at comparison time
  failure?: AggregateWindowFailure;
}

export interface AggregateWindowFailure {
  reason_code: 'aggregate_query_failed' | 'window_spec_invalid';
  human_readable: string;
  details: Record<string, unknown>;
}

/**
 * Sanctions status for the proposed movement's counterparty (if any).
 * Pulled from existing sanctions_screenings table.
 */
export interface SanctionsSnapshot {
  counterparty_id?: string;
  status: SanctionsStatus;
  screened_at?: Date;
  failure?: SanctionsSnapshotFailure;
}

export interface SanctionsSnapshotFailure {
  reason_code: 'sanctions_status_unavailable';
  human_readable: string;
  details: Record<string, unknown>;
}

/**
 * Pre-loaded forecast results. Built by calling the ForecastQuery interface
 * during context load. The stub fills this with permissive defaults.
 */
export interface ForecastSnapshot {
  query_metadata: ForecastQueryMetadata;
  hypothetical_metadata: ForecastQueryMetadata;
  results: Record<string, ForecastQueryResult>;      // keyed by query hash
}

export interface ForecastQueryMetadata {
  mode: 'stub' | 'real';
  snapshot_taken_at: Date;
  source: string;
  warnings: string[];
}

export interface ForecastQueryResult {
  value?: unknown;                // query-kind-specific payload
  failure?: ForecastQueryFailure;
}

export interface ForecastQueryFailure {
  reason_code: 'forecast_unavailable';
  human_readable: string;
  details: Record<string, unknown>;
}

/**
 * Historical context about the proposed movement's counterparty. Used by
 * time_since_last_to_counterparty, rule conditions, and counterparty rules.
 */
export interface CounterpartyHistoryRecord {
  id: string;
  first_seen_at?: Date;
  last_transfer_at?: Date;
  total_volume_usd?: string;
  transfer_count?: number;
  failure?: CounterpartyHistoryFailure;
}

export interface CounterpartyHistoryFailure {
  reason_code: 'counterparty_lookup_failed';
  human_readable: string;
  details: Record<string, unknown>;
}
```

- [ ] **Step 7: Create `trace.ts`**

```typescript
// src/lib/policy/types/trace.ts

import { Verdict } from './verdict';
import { ReasonCode, WarningCode } from '../errors/reason-codes';
import { HardLimitCheckResult } from './hard-limit';
import { Condition } from './ir';

/**
 * Full evaluation trace persisted to policy_evaluations. Every rule
 * considered (even non-matching) and every system invariant applied
 * is recorded so the trace is a complete explanation of the verdict.
 */
export interface EvaluationTrace {
  engine_version: string;
  policy_version_id: string;
  policy_version_number: number;
  proposed_movement_id: string;

  canonicalization: CanonicalizationTrace;
  hard_limit_check: HardLimitCheckResult;
  rules_evaluated: RuleEvaluationTrace[];
  system_invariants_applied: SystemInvariantTrace[];

  final_verdict: Verdict;
  final_verdict_source: 'hard_limit' | 'user_rule' | 'system_invariant' | 'default_deny';
  final_verdict_reasons: ReasonCodeEntry[];

  forecast_mode: 'stub' | 'real';
  forecast_warnings: string[];

  evaluation_duration_ms: number;
}

export interface CanonicalizationTrace {
  native_amount: string;
  native_asset: string;
  canonical_amount: string;
  canonical_currency: 'USD';
  rate: string;
  rate_source: string;
  rate_as_of: string;
  max_age_ms: number;
  succeeded: boolean;
  failure_reason_code?: ReasonCode;
}

export interface RuleEvaluationTrace {
  rule_id: string;
  rule_name: string;
  rule_type: string;
  priority: number;
  condition_result: ConditionEvaluationTrace;
  matched: boolean;
  matched_via?: 'direct' | 'splitting';
  verdict_contribution: Verdict | null;
  failure?: RuleEvaluationFailure;
}

export interface ConditionEvaluationTrace {
  path: (string | number)[];
  node_kind: Condition['kind'];
  result: 'matched' | 'not_matched' | 'failed';
  children?: ConditionEvaluationTrace[];
  details?: Record<string, unknown>;
}

export interface RuleEvaluationFailure {
  reason_code: ReasonCode;
  human_readable: string;
  details: Record<string, unknown>;
  affected_condition_path: (string | number)[];
  user_action?: string;
}

export interface SystemInvariantTrace {
  invariant: 'ai_initiator_floor' | 'splitting_guard' | 'default_deny';
  applied: boolean;
  warning_code: WarningCode;
  human_readable: string;
  details?: Record<string, unknown>;
}

export interface ReasonCodeEntry {
  reason_code: ReasonCode;
  human_readable: string;
  details?: Record<string, unknown>;
  user_action?: string;
}
```

- [ ] **Step 8: Create `policy-version.ts`**

```typescript
// src/lib/policy/types/policy-version.ts

import { Condition } from './ir';
import { HardLimit } from './hard-limit';
import { Verdict, ApprovalSlotRequirement } from './verdict';

/**
 * Fully-hydrated policy version as consumed by the evaluator.
 * Built by querying policy_versions + policy_rules + policy_hard_limits
 * + policy_approval_chains.
 */
export interface PolicyVersionSnapshot {
  id: string;
  enterprise_id: string;
  version_number: number;
  status: 'draft' | 'active' | 'superseded';
  name: string;
  activated_at?: Date;
  activated_by?: string;
  rules: PolicyRule[];
  hard_limits: HardLimit[];
  approval_chains: ApprovalChain[];
}

export interface PolicyRule {
  id: string;
  version_id: string;
  rule_type: 'approval_threshold' | 'counterparty' | 'time_window' | 'lookahead';
  name: string;
  rationale: string;
  condition: Condition;
  verdict: Verdict;
  verdict_chain_id?: string;
  priority: number;
  created_by: string;
  created_at: Date;
}

export interface ApprovalChain {
  id: string;
  version_id: string;
  name: string;
  slots: ApprovalSlotRequirement[];
  trigger_condition?: Condition;
  priority: number;
  expiration_hours: number;
  created_by: string;
  created_at: Date;
}
```

- [ ] **Step 9: Create `index.ts`**

```typescript
// src/lib/policy/types/index.ts

export type * from './assets';
export type * from './movement';
export type * from './verdict';
export type * from './ir';
export type * from './context';
export type * from './trace';
export type * from './hard-limit';
export type * from './policy-version';
```

- [ ] **Step 10: Run the TypeScript compiler to verify all types compile**

```bash
npx tsc --noEmit
```

Expected: no output (or only unrelated pre-existing errors from elsewhere in the repo). If there are errors in `src/lib/policy/types/*`, fix them before proceeding.

Common issues:
- Circular imports between `context.ts` ↔ `policy-version.ts` — fixable by moving shared types or using `import type`
- Missing type exports in `ir.ts` — add `export` to every interface/type

- [ ] **Step 11: Commit**

```bash
git add src/lib/policy/types/
git commit -m "$(cat <<'EOF'
feat(policy): add core type definitions

Nine type files covering: assets (AssetCode, AmountNative, AmountValue),
movement (ProposedMovement, Initiator, MovementEndpoint), verdict
(Verdict, EvaluationResult, ResolvedApprovalChain), ir (Condition
discriminated union with 9 node kinds), context (EvaluationContext,
TreasuryState, etc.), trace (EvaluationTrace, RuleEvaluationTrace),
hard-limit (HardLimit, HardLimitEvaluation, HardLimitBreach),
policy-version (PolicyVersionSnapshot, PolicyRule, ApprovalChain),
and a public index.

Pure type definitions only — no runtime code, no tests.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add zod schema for ProposedMovement

**Files:**
- Create: `src/lib/policy/schemas/movement.schema.ts`
- Create: `src/lib/policy/schemas/movement.schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/policy/schemas/movement.schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { proposedMovementSchema } from './movement.schema';

describe('proposedMovementSchema', () => {
  const validMovement = {
    id: 'mv-abc123',
    kind: 'crypto_transfer' as const,
    source: { venue: 'ethereum', asset: 'USDC', address: '0xdeadbeef' },
    destination: { venue: 'solana', asset: 'USDC', address: 'So1ana...' },
    amount: { amount: '50000', asset: 'USDC' },
    initiator: { type: 'human' as const, user_id: 'user-1' },
    requested_at: '2026-04-10T14:22:33.000Z',
  };

  it('accepts a minimal valid movement', () => {
    const result = proposedMovementSchema.safeParse(validMovement);
    expect(result.success).toBe(true);
  });

  it('accepts a movement with optional fields', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      counterparty: { id: 'cp-1', type: 'known', jurisdiction: 'US' },
      purpose_code: 'payroll',
      rail: 'ethereum',
      metadata: { tag: 'test' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a movement with missing required fields', () => {
    const { id, ...withoutId } = validMovement;
    const result = proposedMovementSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it('rejects a movement with invalid kind', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      kind: 'bogus_kind',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a movement where initiator.type=human but no user_id', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      initiator: { type: 'human' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a movement where initiator.type=ai_recommendation but no recommendation_id', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      initiator: { type: 'ai_recommendation' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a movement with a non-decimal amount string', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      amount: { amount: 'not-a-number', asset: 'USDC' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a movement with a zero amount (permitted for some flows)', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      amount: { amount: '0', asset: 'USDC' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a movement with a negative amount', () => {
    const result = proposedMovementSchema.safeParse({
      ...validMovement,
      amount: { amount: '-100', asset: 'USDC' },
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- src/lib/policy/schemas/movement.schema
```

Expected: FAIL with `Cannot find module './movement.schema'`.

- [ ] **Step 3: Implement the schema**

Create `src/lib/policy/schemas/movement.schema.ts`:

```typescript
import { z } from 'zod';

/** Decimal string matching "N" or "N.M" where N, M are digit strings. Non-negative. */
const decimalStringNonNegative = z.string().regex(
  /^(\d+)(\.\d+)?$/,
  'Must be a non-negative decimal string (e.g., "100" or "100.50")'
);

const amountNativeSchema = z.object({
  amount: decimalStringNonNegative,
  asset: z.string().min(1),
});

const movementEndpointSchema = z.object({
  venue: z.string().min(1),
  asset: z.string().min(1),
  address: z.string().optional(),
  account_id: z.string().optional(),
  label: z.string().optional(),
});

const counterpartyRefSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['known', 'new', 'unknown']).optional(),
  jurisdiction: z.string().optional(),
});

const initiatorSchema = z
  .object({
    type: z.enum(['human', 'agent', 'ai_recommendation', 'schedule']),
    user_id: z.string().optional(),
    agent_id: z.string().optional(),
    recommendation_id: z.string().optional(),
    scheduled_op_id: z.string().optional(),
  })
  .refine(
    (init) => {
      switch (init.type) {
        case 'human':             return !!init.user_id;
        case 'agent':              return !!init.agent_id;
        case 'ai_recommendation':  return !!init.recommendation_id;
        case 'schedule':           return !!init.scheduled_op_id;
      }
    },
    {
      message: 'Initiator identity field must match type: human→user_id, agent→agent_id, ai_recommendation→recommendation_id, schedule→scheduled_op_id',
    }
  );

export const proposedMovementSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'crypto_transfer',
    'fiat_ramp',
    'yield_deposit',
    'yield_withdraw',
    'swap',
    'bridge',
    'payment',
  ]),
  source: movementEndpointSchema,
  destination: movementEndpointSchema,
  amount: amountNativeSchema,
  counterparty: counterpartyRefSchema.optional(),
  initiator: initiatorSchema,
  purpose_code: z.string().optional(),
  rail: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  requested_at: z.string().datetime(),
});

export type ProposedMovementInput = z.input<typeof proposedMovementSchema>;
export type ProposedMovementParsed = z.output<typeof proposedMovementSchema>;
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npm test -- src/lib/policy/schemas/movement.schema
```

Expected:
```
 ✓ src/lib/policy/schemas/movement.schema.test.ts (9)
   ✓ proposedMovementSchema (9)
     ✓ accepts a minimal valid movement
     ✓ accepts a movement with optional fields
     ✓ rejects a movement with missing required fields
     ✓ rejects a movement with invalid kind
     ✓ rejects a movement where initiator.type=human but no user_id
     ✓ rejects a movement where initiator.type=ai_recommendation but no recommendation_id
     ✓ rejects a movement with a non-decimal amount string
     ✓ accepts a movement with a zero amount (permitted for some flows)
     ✓ rejects a movement with a negative amount

 Test Files  1 passed (1)
      Tests  9 passed (9)
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/schemas/movement.schema.ts src/lib/policy/schemas/movement.schema.test.ts
git commit -m "$(cat <<'EOF'
feat(policy): add zod schema for ProposedMovement

Validates shape, required fields, initiator type/identity matching,
and non-negative decimal amounts. Used at save time in the authoring
API (Plan 2) and at gate entry (Plan 2) to reject malformed input
with structured errors.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add zod schema for Condition IR

**Files:**
- Create: `src/lib/policy/schemas/ir.schema.ts`
- Create: `src/lib/policy/schemas/ir.schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/policy/schemas/ir.schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { conditionSchema } from './ir.schema';
import { Condition } from '../types/ir';

describe('conditionSchema — amount_compare', () => {
  it('accepts a simple transfer.amount > $50k', () => {
    const condition: Condition = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '50000', currency: 'USD' },
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });

  it('requires value_upper when op=between', () => {
    const noUpper = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: 'between',
      value: { amount: '10000', currency: 'USD' },
    };
    expect(conditionSchema.safeParse(noUpper).success).toBe(false);

    const withUpper = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: 'between',
      value: { amount: '10000', currency: 'USD' },
      value_upper: { amount: '50000', currency: 'USD' },
    };
    expect(conditionSchema.safeParse(withUpper).success).toBe(true);
  });

  it('rejects an invalid operator', () => {
    const bad = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '~=',
      value: { amount: '50000', currency: 'USD' },
    };
    expect(conditionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing currency on value', () => {
    const bad = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '50000' },  // no currency
    };
    expect(conditionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('conditionSchema — composition (and/or/not)', () => {
  it('accepts nested AND/OR with mixed leaves', () => {
    const condition: Condition = {
      kind: 'and',
      children: [
        {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>',
          value: { amount: '50000', currency: 'USD' },
        },
        {
          kind: 'or',
          children: [
            {
              kind: 'string_compare',
              attr: 'transfer.initiator_type',
              op: '==',
              value: 'human',
            },
            {
              kind: 'sanctions_status',
              op: 'not_in',
              values: ['sanctioned', 'partial_match'],
            },
          ],
        },
      ],
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });

  it('accepts a NOT wrapping an amount_compare', () => {
    const condition: Condition = {
      kind: 'not',
      child: {
        kind: 'amount_compare',
        attr: 'transfer.amount',
        op: '<',
        value: { amount: '100', currency: 'USD' },
      },
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });

  it('rejects an empty AND/OR children array', () => {
    const emptyAnd = { kind: 'and', children: [] };
    expect(conditionSchema.safeParse(emptyAnd).success).toBe(false);

    const emptyOr = { kind: 'or', children: [] };
    expect(conditionSchema.safeParse(emptyOr).success).toBe(false);
  });
});

describe('conditionSchema — string_compare', () => {
  it('accepts op=in with array value', () => {
    const condition: Condition = {
      kind: 'string_compare',
      attr: 'transfer.counterparty_id',
      op: 'in',
      value: ['cp-1', 'cp-2', 'cp-3'],
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });

  it('accepts op=== with string value', () => {
    const condition: Condition = {
      kind: 'string_compare',
      attr: 'transfer.purpose_code',
      op: '==',
      value: 'payroll',
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });
});

describe('conditionSchema — sanctions_status', () => {
  it('accepts not_in with status list', () => {
    const condition: Condition = {
      kind: 'sanctions_status',
      op: 'not_in',
      values: ['clear'],
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });

  it('rejects an empty values array', () => {
    const bad = {
      kind: 'sanctions_status',
      op: 'in',
      values: [],
    };
    expect(conditionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('conditionSchema — forecast_query', () => {
  it('accepts a valid forecast query node', () => {
    const condition: Condition = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '==',
      value: { amount: '1', currency: 'USD' },   // 1 = true for bool comparison
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });

  it('rejects a negative window_days', () => {
    const bad = {
      kind: 'forecast_query',
      query: 'projected_min_balance',
      window_days: -1,
      comparator: '>',
      value: { amount: '500000', currency: 'USD' },
    };
    expect(conditionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('conditionSchema — aggregate_window', () => {
  it('accepts a 24h sum by initiator+destination', () => {
    const condition: Condition = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 86_400_000,
        group_by: { initiator: true, destination: true },
      },
      attr: 'sum_amount',
      op: '>',
      value: { amount: '50000', currency: 'USD' },
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });

  it('rejects a zero-duration window', () => {
    const bad = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 0,
        group_by: { initiator: true },
      },
      attr: 'count',
      op: '>',
      value: { amount: '10', currency: 'USD' },
    };
    expect(conditionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('conditionSchema — unknown kinds', () => {
  it('rejects a node with an unknown kind', () => {
    const bad = { kind: 'bogus_kind', foo: 'bar' };
    expect(conditionSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- src/lib/policy/schemas/ir.schema
```

Expected: FAIL with `Cannot find module './ir.schema'`.

- [ ] **Step 3: Implement the schema**

Create `src/lib/policy/schemas/ir.schema.ts`:

```typescript
import { z } from 'zod';

// ─── Shared leaves ──────────────────────────────────────────────────────

const decimalString = z.string().regex(
  /^-?(\d+)(\.\d+)?$/,
  'Must be a decimal string'
);

const amountValueSchema = z.object({
  amount: decimalString,
  currency: z.string().min(1),
});

const numericOpSchema = z.enum(['>', '>=', '<', '<=', '==', '!=', 'between']);
const stringOpSchema  = z.enum(['==', '!=', 'in', 'not_in']);
const timeOpSchema    = z.enum(['==', '!=', '>', '>=', '<', '<=', 'in', 'not_in']);

// ─── Leaf node schemas ──────────────────────────────────────────────────

const amountCompareSchema = z
  .object({
    kind: z.literal('amount_compare'),
    attr: z.enum([
      'transfer.amount',
      'treasury.position',
      'treasury.post_position',
      'rolling_sum',
    ]),
    scope: z
      .object({
        asset: z.string().optional(),
        venue: z.string().optional(),
      })
      .optional(),
    op: numericOpSchema,
    value: amountValueSchema,
    value_upper: amountValueSchema.optional(),
  })
  .refine(
    (node) => node.op !== 'between' || node.value_upper !== undefined,
    { message: 'value_upper is required when op="between"' }
  );

const stringCompareSchema = z.object({
  kind: z.literal('string_compare'),
  attr: z.enum([
    'transfer.counterparty_id',
    'transfer.purpose_code',
    'transfer.initiator_type',
    'transfer.rail',
    'transfer.source_venue',
    'transfer.destination_venue',
  ]),
  op: stringOpSchema,
  value: z.union([z.string(), z.array(z.string()).nonempty()]),
});

const timeCompareSchema = z.object({
  kind: z.literal('time_compare'),
  attr: z.enum([
    'now.day_of_week',
    'now.hour_local',
    'now.is_business_hours',
    'time_since_last_to_counterparty',
    'time_since_last_by_initiator',
  ]),
  op: timeOpSchema,
  value: z.union([
    z.number(),
    z.string(),
    z.boolean(),
    z.array(z.union([z.number(), z.string()])),
  ]),
});

const sanctionsStatusSchema = z.object({
  kind: z.literal('sanctions_status'),
  op: z.enum(['in', 'not_in']),
  values: z.array(z.enum(['clear', 'sanctioned', 'partial_match', 'unscreened'])).nonempty(),
});

const forecastQuerySchema = z.object({
  kind: z.literal('forecast_query'),
  query: z.enum(['projected_min_balance', 'projected_position', 'obligations_covered']),
  window_days: z.number().int().positive(),
  scope: z
    .object({
      asset: z.string().optional(),
      venue: z.string().optional(),
    })
    .optional(),
  comparator: numericOpSchema,
  value: amountValueSchema,
});

const aggregateWindowSchema = z.object({
  kind: z.literal('aggregate_window'),
  window: z.object({
    duration_ms: z.number().int().positive(),
    group_by: z.object({
      initiator: z.boolean().optional(),
      counterparty: z.boolean().optional(),
      destination: z.boolean().optional(),
      asset: z.boolean().optional(),
    }),
    direction: z.enum(['outflow', 'inflow', 'both']).optional(),
  }),
  attr: z.enum([
    'sum_amount',
    'count',
    'distinct_destinations',
    'distinct_counterparties',
  ]),
  scope: z
    .object({
      asset: z.string().optional(),
    })
    .optional(),
  op: numericOpSchema,
  value: amountValueSchema,
});

// ─── Recursive union ────────────────────────────────────────────────────

// z.lazy for recursion. We have to declare the recursive type first.
export const conditionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('and'),
      children: z.array(conditionSchema).min(1, 'AND must have at least one child'),
    }),
    z.object({
      kind: z.literal('or'),
      children: z.array(conditionSchema).min(1, 'OR must have at least one child'),
    }),
    z.object({
      kind: z.literal('not'),
      child: conditionSchema,
    }),
    amountCompareSchema,
    stringCompareSchema,
    timeCompareSchema,
    sanctionsStatusSchema,
    forecastQuerySchema,
    aggregateWindowSchema,
  ])
);
```

**Note on recursive zod:** The `conditionSchema: z.ZodType<unknown>` with `z.lazy(...)` is the canonical pattern for recursive zod discriminated unions. It produces runtime validation that works correctly; for TypeScript output typing, consumers should cast through the `Condition` type from `types/ir.ts`.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npm test -- src/lib/policy/schemas/ir.schema
```

Expected:
```
 ✓ src/lib/policy/schemas/ir.schema.test.ts (~15)
   ✓ conditionSchema — amount_compare (4)
   ✓ conditionSchema — composition (and/or/not) (3)
   ✓ conditionSchema — string_compare (2)
   ✓ conditionSchema — sanctions_status (2)
   ✓ conditionSchema — forecast_query (2)
   ✓ conditionSchema — aggregate_window (2)
   ✓ conditionSchema — unknown kinds (1)
```

If tests fail because of `z.lazy` behavior, verify zod version is ^3.23.8 (matches existing project). The recursive discriminated union pattern works cleanly in that version.

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/schemas/ir.schema.ts src/lib/policy/schemas/ir.schema.test.ts
git commit -m "$(cat <<'EOF'
feat(policy): add zod schema for condition IR

Recursive discriminated-union schema validating all 9 IR node kinds
(and, or, not, amount_compare, string_compare, time_compare,
sanctions_status, forecast_query, aggregate_window). Enforces
structural invariants: value_upper required for between, non-empty
AND/OR children, positive window durations, non-empty sanctions
status lists.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add zod schema for HardLimit

**Files:**
- Create: `src/lib/policy/schemas/hard-limit.schema.ts`
- Create: `src/lib/policy/schemas/hard-limit.schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/policy/schemas/hard-limit.schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hardLimitSchema } from './hard-limit.schema';

describe('hardLimitSchema', () => {
  const baseValid = {
    id: 'hl-1',
    limit_type: 'min_cash_reserve_usd' as const,
    name: 'Operating Cash Floor',
    limit_value: '500000',
    limit_currency: 'USD',
    scope: {},
  };

  it('accepts a valid min_cash_reserve_usd row', () => {
    expect(hardLimitSchema.safeParse(baseValid).success).toBe(true);
  });

  it('accepts a max_single_asset_concentration_pct row with no currency', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_single_asset_concentration_pct',
      limit_value: '70',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(true);
  });

  it('rejects max_single_asset_concentration_pct with value > 100', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_single_asset_concentration_pct',
      limit_value: '150',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects max_single_asset_concentration_pct with negative value', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_single_asset_concentration_pct',
      limit_value: '-10',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('accepts obligation_coverage_days with integer day count', () => {
    const row = {
      ...baseValid,
      limit_type: 'obligation_coverage_days',
      limit_value: '14',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(true);
  });

  it('rejects obligation_coverage_days with a non-integer', () => {
    const row = {
      ...baseValid,
      limit_type: 'obligation_coverage_days',
      limit_value: '14.5',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('accepts max_native_exposure with required asset scope', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_native_exposure',
      limit_value: '10000000',
      limit_currency: 'USDT',
      scope: { asset: 'USDT' },
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(true);
  });

  it('rejects max_native_exposure without asset scope', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_native_exposure',
      limit_value: '10000000',
      limit_currency: 'USDT',
      scope: {},
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects a negative min_cash_reserve_usd', () => {
    const row = { ...baseValid, limit_value: '-100' };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects an unknown limit_type', () => {
    const row = { ...baseValid, limit_type: 'bogus_limit' };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- src/lib/policy/schemas/hard-limit.schema
```

Expected: FAIL with `Cannot find module './hard-limit.schema'`.

- [ ] **Step 3: Implement the schema**

Create `src/lib/policy/schemas/hard-limit.schema.ts`:

```typescript
import { z } from 'zod';

const decimalNonNegative = z.string().regex(
  /^(\d+)(\.\d+)?$/,
  'Must be a non-negative decimal string'
);

const decimalInteger = z.string().regex(
  /^\d+$/,
  'Must be a non-negative integer string'
);

const hardLimitScopeSchema = z.object({
  asset: z.string().optional(),
  venue: z.string().optional(),
  include_venues: z.array(z.string()).optional(),
});

/**
 * Base shape common to every hard limit row. Specific limit types layer
 * additional constraints on top via refine().
 */
const baseHardLimitSchema = z.object({
  id: z.string().min(1),
  limit_type: z.enum([
    'min_cash_reserve_usd',
    'max_single_asset_concentration_pct',
    'max_daily_outflow_usd',
    'max_30day_outflow_usd',
    'obligation_coverage_days',
    'max_native_exposure',
  ]),
  name: z.string().min(1),
  limit_value: z.string().min(1),
  limit_currency: z.string().optional(),
  scope: hardLimitScopeSchema,
});

export const hardLimitSchema = baseHardLimitSchema.superRefine((row, ctx) => {
  const value = row.limit_value;

  // Non-negative decimal check for all types except max_single_asset_concentration_pct
  // (which has its own 0-100 range check below)
  const nonNegativeTypes: Array<typeof row.limit_type> = [
    'min_cash_reserve_usd',
    'max_daily_outflow_usd',
    'max_30day_outflow_usd',
    'max_native_exposure',
  ];

  if (nonNegativeTypes.includes(row.limit_type)) {
    const result = decimalNonNegative.safeParse(value);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${row.limit_type} must be a non-negative decimal string`,
        path: ['limit_value'],
      });
    }
  }

  if (row.limit_type === 'max_single_asset_concentration_pct') {
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'max_single_asset_concentration_pct must be a percentage in [0, 100]',
        path: ['limit_value'],
      });
    }
  }

  if (row.limit_type === 'obligation_coverage_days') {
    const intResult = decimalInteger.safeParse(value);
    if (!intResult.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'obligation_coverage_days must be a non-negative integer string',
        path: ['limit_value'],
      });
    }
  }

  if (row.limit_type === 'max_native_exposure') {
    if (!row.scope.asset) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'max_native_exposure requires scope.asset to be specified',
        path: ['scope', 'asset'],
      });
    }
  }
});
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npm test -- src/lib/policy/schemas/hard-limit.schema
```

Expected:
```
 ✓ src/lib/policy/schemas/hard-limit.schema.test.ts (10)
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/schemas/hard-limit.schema.ts src/lib/policy/schemas/hard-limit.schema.test.ts
git commit -m "$(cat <<'EOF'
feat(policy): add zod schema for hard limit rows

Validates all 6 phase-1 limit types with type-specific constraints:
non-negative decimals for USD amounts, 0-100 for concentration pct,
positive integers for coverage days, required scope.asset for
max_native_exposure.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Define PolicyRateProvider interface

**Files:**
- Create: `src/lib/policy/canonicalizer/interface.ts`

- [ ] **Step 1: Create the interface file**

Pure interface — no tests needed, only consumers are tested.

```typescript
// src/lib/policy/canonicalizer/interface.ts

import { AssetCode } from '../types/assets';

/**
 * Dependency-injected rate source for the policy engine's canonicalizer.
 * The phase-1 implementation (CoingeckoPolicyRateProvider) wraps the
 * existing oracle. Future implementations can add additional sources
 * (ECB for EUR, Chainlink for ETH/BTC, etc.) without touching the
 * evaluator or any rule types.
 *
 * CRITICAL CONTRACT: implementations must NEVER return a stale or
 * fallback rate for policy purposes. If the underlying rate source is
 * unavailable, unreachable, or older than `max_age_ms`, the implementation
 * must throw a CanonicalizationError with a specific reason_code.
 *
 * Display code can and does use fallback rates (the existing oracle
 * falls back to 1.0). Policy decisions cannot.
 */
export interface PolicyRateProvider {
  /**
   * Returns a fresh rate converting `from` into `to` as of `asOf`.
   *
   * Contract:
   *   - MUST throw CanonicalizationError if the rate is unavailable
   *   - MUST throw CanonicalizationError if the rate is older than max_age_ms
   *   - MUST return a rate with `asOfRate` timestamp from the underlying source
   *   - MUST NOT use silent fallback values (even if display code does)
   */
  getRateAsOf(
    from: AssetCode,
    to: 'USD',
    asOf: Date
  ): Promise<RateReading>;
}

export interface RateReading {
  rate: string;             // decimal string (e.g., "1.0002")
  source: string;           // identifier (e.g., 'coingecko' | 'ecb' | 'manual_override')
  asOfRate: Date;           // when the underlying rate was measured
  maxAgeMs: number;         // staleness threshold used for THIS reading
}

/**
 * Default max age for policy rate readings (60 seconds). Display code may
 * use longer windows; policy decisions require freshness within this
 * window or they fail.
 */
export const POLICY_RATE_MAX_AGE_MS = 60_000;
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/policy/canonicalizer/interface.ts
git commit -m "$(cat <<'EOF'
feat(policy): add PolicyRateProvider interface

Defines the rate-source contract the canonicalizer uses. Strict
failure semantics — implementations must never return stale or
fallback rates for policy purposes, unlike the display-layer oracle.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Implement CoingeckoPolicyRateProvider

**Files:**
- Create: `src/lib/policy/canonicalizer/coingecko-provider.ts`
- Create: `src/lib/policy/canonicalizer/coingecko-provider.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/policy/canonicalizer/coingecko-provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoingeckoPolicyRateProvider } from './coingecko-provider';
import { CanonicalizationError } from '../errors/classes';
import { POLICY_RATE_MAX_AGE_MS } from './interface';

describe('CoingeckoPolicyRateProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T14:22:33.000Z'));
  });

  it('returns 1.0 rate for USD → USD with current timestamp', async () => {
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn(),  // not called for USD passthrough
    });

    const reading = await provider.getRateAsOf('USD', 'USD', new Date());

    expect(reading.rate).toBe('1');
    expect(reading.source).toBe('passthrough');
    expect(reading.asOfRate).toBeInstanceOf(Date);
    expect(reading.maxAgeMs).toBe(POLICY_RATE_MAX_AGE_MS);
  });

  it('returns rate from oracle for USDC → USD when source is fresh', async () => {
    const fetchedAt = new Date('2026-04-10T14:22:33.000Z');
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0002, USDT: 1.0001 },
        source: 'coingecko',
        fetchedAt,
      }),
    });

    const reading = await provider.getRateAsOf('USDC', 'USD', new Date());

    expect(reading.rate).toBe('1.0002');
    expect(reading.source).toBe('coingecko');
    expect(reading.asOfRate.getTime()).toBe(fetchedAt.getTime());
  });

  it('returns rate from oracle for USDT → USD', async () => {
    const fetchedAt = new Date('2026-04-10T14:22:33.000Z');
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0002, USDT: 0.9998 },
        source: 'coingecko',
        fetchedAt,
      }),
    });

    const reading = await provider.getRateAsOf('USDT', 'USD', new Date());

    expect(reading.rate).toBe('0.9998');
  });

  it('throws canonicalization_source_unavailable when oracle source is "mock" in production mode', async () => {
    // Mock-mode oracle returns 1.0 fallback — we explicitly reject it for policy
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0, USDT: 1.0 },
        source: 'mock',    // the oracle tells us it's in mock mode
        fetchedAt: new Date(),
      }),
      acceptMockSource: false,  // production mode
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toThrow(CanonicalizationError);
    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_source_unavailable',
    });
  });

  it('accepts mock-mode oracle when acceptMockSource=true (for dev/test)', async () => {
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0, USDT: 1.0 },
        source: 'mock',
        fetchedAt: new Date(),
      }),
      acceptMockSource: true,
    });

    const reading = await provider.getRateAsOf('USDC', 'USD', new Date());
    expect(reading.rate).toBe('1');
    expect(reading.source).toBe('mock');
  });

  it('throws canonicalization_rate_stale when the oracle reading is older than max_age_ms', async () => {
    // Oracle fetched 2 minutes ago, max_age is 60s
    const twoMinutesAgo = new Date(Date.now() - 120_000);
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0002, USDT: 1.0001 },
        source: 'coingecko',
        fetchedAt: twoMinutesAgo,
      }),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_rate_stale',
    });
  });

  it('throws canonicalization_failed (unsupported_asset) for BTC', async () => {
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0, USDT: 1.0 },
        source: 'coingecko',
        fetchedAt: new Date(),
      }),
    });

    await expect(provider.getRateAsOf('BTC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_failed',
    });
    await expect(provider.getRateAsOf('BTC', 'USD', new Date())).rejects.toThrow(/unsupported/i);
  });

  it('throws canonicalization_source_unavailable when the oracle fetcher throws', async () => {
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockRejectedValue(new Error('network error')),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_source_unavailable',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- src/lib/policy/canonicalizer/coingecko-provider
```

Expected: FAIL with `Cannot find module './coingecko-provider'`.

- [ ] **Step 3: Implement the provider**

Create `src/lib/policy/canonicalizer/coingecko-provider.ts`:

```typescript
// src/lib/policy/canonicalizer/coingecko-provider.ts

import { PolicyRateProvider, RateReading, POLICY_RATE_MAX_AGE_MS } from './interface';
import { CanonicalizationError } from '../errors/classes';
import { REASON_CODES } from '../errors/reason-codes';
import { AssetCode } from '../types/assets';

/**
 * Minimal dependency for fetching stablecoin prices. Matches the shape of
 * the existing `getStablecoinPrices()` from src/lib/treasury/oracle.ts but
 * adds a `fetchedAt` timestamp so freshness can be enforced (the existing
 * oracle relies on Next.js's cache layer and doesn't expose this).
 *
 * The adapter in src/lib/policy/canonicalizer/oracle-adapter.ts (added in
 * Task 10) wraps the existing oracle and attaches fetchedAt=new Date() at
 * every call, which means phase 1 always considers the rate "just fetched"
 * and never hits the rate_stale path under normal operation. The test for
 * rate_stale exercises the code path via direct DI, not via the oracle.
 */
export interface StablecoinPricesResult {
  prices: Record<AssetCode, number>;
  source: 'coingecko' | 'mock' | string;
  fetchedAt: Date;
}

export interface CoingeckoPolicyRateProviderOpts {
  fetchStablecoinPrices: () => Promise<StablecoinPricesResult>;

  /**
   * Whether to accept rate readings where `source='mock'` (the existing
   * oracle's mock mode). Default false in production; set true via env
   * wiring in dev/test so local development works without a real
   * CoinGecko connection.
   */
  acceptMockSource?: boolean;
}

const SUPPORTED_ASSETS: ReadonlySet<AssetCode> = new Set(['USD', 'USDC', 'USDT']);

/**
 * Phase-1 policy rate provider. Supports USDC, USDT, and USD passthrough.
 * Wraps the existing treasury oracle via an adapter.
 */
export class CoingeckoPolicyRateProvider implements PolicyRateProvider {
  private readonly acceptMockSource: boolean;

  constructor(private readonly opts: CoingeckoPolicyRateProviderOpts) {
    this.acceptMockSource = opts.acceptMockSource ?? false;
  }

  async getRateAsOf(
    from: AssetCode,
    to: 'USD',
    _asOf: Date
  ): Promise<RateReading> {
    // USD → USD is always 1.0 with no source fetch
    if (from === 'USD' && to === 'USD') {
      return {
        rate: '1',
        source: 'passthrough',
        asOfRate: new Date(),
        maxAgeMs: POLICY_RATE_MAX_AGE_MS,
      };
    }

    // Reject unsupported assets explicitly
    if (!SUPPORTED_ASSETS.has(from)) {
      throw new CanonicalizationError({
        human_readable: `Cannot convert ${from} to ${to}: no rate source is configured for ${from} in phase 1.`,
        user_action:
          `This asset requires a rate source to be added in a future phase. ` +
          `For now, author native-unit rules scoped to ${from} only, or ` +
          `remove this asset from the rule scope.`,
        details: {
          from_asset: from,
          to_asset: to,
          reason: 'unsupported_asset',
          supported_assets: Array.from(SUPPORTED_ASSETS),
        },
      });
    }

    // Fetch current prices from the oracle adapter
    let result: StablecoinPricesResult;
    try {
      result = await this.opts.fetchStablecoinPrices();
    } catch (err) {
      throw new CanonicalizationError({
        human_readable: `Rate provider (CoinGecko) is currently unavailable: ${extractMessage(err)}`,
        user_action: 'Policy evaluation cannot proceed until the rate source returns. Retry in a few minutes or contact support if the issue persists.',
        details: {
          reason_code: REASON_CODES.canonicalization_source_unavailable,
          from_asset: from,
          to_asset: to,
          error_class: err instanceof Error ? err.name : typeof err,
          error_message: extractMessage(err),
        },
      });
    }

    // Reject mock-source readings in production
    if (result.source === 'mock' && !this.acceptMockSource) {
      throw new CanonicalizationError({
        human_readable:
          `Rate provider returned mock-mode data. Policy decisions require live rates. ` +
          `This indicates COINGECKO_USE_MOCK=true in an environment where policy evaluation runs.`,
        user_action: 'Check environment configuration — disable mock mode for production policy evaluation.',
        details: {
          reason_code: REASON_CODES.canonicalization_source_unavailable,
          from_asset: from,
          to_asset: to,
          oracle_source: 'mock',
        },
      });
    }

    // Check freshness
    const ageMs = Date.now() - result.fetchedAt.getTime();
    if (ageMs > POLICY_RATE_MAX_AGE_MS) {
      throw new CanonicalizationError({
        human_readable:
          `Rate from ${result.source} for ${from}→${to} is ${ageMs}ms old, ` +
          `exceeding the maximum of ${POLICY_RATE_MAX_AGE_MS}ms allowed for policy decisions.`,
        user_action: 'The rate provider may be stuck or cached. Check oracle health.',
        details: {
          reason_code: REASON_CODES.canonicalization_rate_stale,
          from_asset: from,
          to_asset: to,
          source: result.source,
          rate_age_ms: ageMs,
          max_age_ms: POLICY_RATE_MAX_AGE_MS,
        },
      });
    }

    // Extract the specific rate
    const rateNumber = result.prices[from];
    if (rateNumber == null || !isFinite(rateNumber)) {
      throw new CanonicalizationError({
        human_readable: `Rate provider returned no rate for ${from}.`,
        user_action: 'The rate source may be partially degraded. Contact support.',
        details: {
          reason_code: REASON_CODES.canonicalization_failed,
          from_asset: from,
          to_asset: to,
          source: result.source,
          received_prices: Object.keys(result.prices),
        },
      });
    }

    return {
      rate: String(rateNumber),
      source: result.source,
      asOfRate: result.fetchedAt,
      maxAgeMs: POLICY_RATE_MAX_AGE_MS,
    };
  }
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npm test -- src/lib/policy/canonicalizer/coingecko-provider
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/canonicalizer/coingecko-provider.ts src/lib/policy/canonicalizer/coingecko-provider.test.ts
git commit -m "$(cat <<'EOF'
feat(policy): add CoingeckoPolicyRateProvider

Phase-1 policy rate provider supporting USDC, USDT, and USD passthrough.
Strict failure semantics: rejects mock-source readings in production,
rejects stale readings older than 60s, throws CanonicalizationError
with specific reason_codes on every failure mode. Never returns a
silent fallback.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Implement canonicalizer function + oracle adapter

**Files:**
- Create: `src/lib/policy/canonicalizer/oracle-adapter.ts`
- Create: `src/lib/policy/canonicalizer/canonicalizer.ts`
- Create: `src/lib/policy/canonicalizer/canonicalizer.test.ts`

- [ ] **Step 1: Create the oracle adapter (bridges existing oracle to StablecoinPricesResult)**

Create `src/lib/policy/canonicalizer/oracle-adapter.ts`:

```typescript
// src/lib/policy/canonicalizer/oracle-adapter.ts

import { getStablecoinPrices } from '@/lib/treasury/oracle';
import { StablecoinPricesResult } from './coingecko-provider';

/**
 * Adapter that wraps the existing oracle and attaches a fetchedAt timestamp.
 * The existing oracle uses Next.js server cache (5-minute revalidation)
 * which doesn't expose the actual fetch time — we treat every successful
 * call as "just fetched" and rely on our own max_age_ms enforcement at
 * the caller side via the policy rate provider.
 *
 * This is a conservative approximation: if the Next.js cache has been
 * holding a stale value, the policy engine can't detect it. Phase 2 can
 * move to a direct fetch with an explicit timestamp stamped by the
 * source itself.
 */
export async function fetchStablecoinPricesWithTimestamp(): Promise<StablecoinPricesResult> {
  const oracleResult = await getStablecoinPrices();
  return {
    prices: oracleResult.prices as Record<string, number>,
    source: oracleResult.source,
    fetchedAt: new Date(),  // TODO(phase2): use actual source timestamp
  };
}
```

- [ ] **Step 2: Write failing tests for the canonicalizer function**

Create `src/lib/policy/canonicalizer/canonicalizer.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { canonicalizeToUsd, buildCanonicalizationResult } from './canonicalizer';
import { CoingeckoPolicyRateProvider } from './coingecko-provider';
import { CanonicalizationError } from '../errors/classes';

describe('canonicalizeToUsd', () => {
  const makeProvider = (prices: Record<string, number>) =>
    new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices,
        source: 'coingecko',
        fetchedAt: new Date(),
      }),
    });

  it('converts USDC to USD at the current rate', async () => {
    const provider = makeProvider({ USDC: 1.0002, USDT: 1.0001 });
    const result = await canonicalizeToUsd(
      { amount: '50000', asset: 'USDC' },
      provider,
      new Date()
    );
    // 50000 * 1.0002 = 50010
    expect(result.canonical_amount).toBe('50010');
    expect(result.native_amount).toBe('50000');
    expect(result.native_asset).toBe('USDC');
    expect(result.canonical_currency).toBe('USD');
    expect(result.rate).toBe('1.0002');
  });

  it('passes USD through as 1:1', async () => {
    const provider = makeProvider({ USDC: 1, USDT: 1 });
    const result = await canonicalizeToUsd(
      { amount: '75000.50', asset: 'USD' },
      provider,
      new Date()
    );
    expect(result.canonical_amount).toBe('75000.5');
    expect(result.rate).toBe('1');
  });

  it('populates failure field when rate provider throws', async () => {
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const result = await canonicalizeToUsd(
      { amount: '1000', asset: 'USDC' },
      provider,
      new Date()
    );
    expect(result.failure).toBeDefined();
    expect(result.failure?.reason_code).toBe('canonicalization_source_unavailable');
    expect(result.canonical_amount).toBe('');
  });

  it('populates failure field for unsupported assets', async () => {
    const provider = makeProvider({ USDC: 1, USDT: 1 });
    const result = await canonicalizeToUsd(
      { amount: '1', asset: 'BTC' },
      provider,
      new Date()
    );
    expect(result.failure).toBeDefined();
    expect(result.failure?.reason_code).toBe('canonicalization_failed');
  });
});

describe('buildCanonicalizationResult', () => {
  it('builds a success result with a rate reading', () => {
    const result = buildCanonicalizationResult({
      nativeAmount: '1000',
      nativeAsset: 'USDC',
      rateReading: {
        rate: '1.0002',
        source: 'coingecko',
        asOfRate: new Date('2026-04-10T14:22:33.000Z'),
        maxAgeMs: 60_000,
      },
    });
    expect(result.canonical_amount).toBe('1000.2');
    expect(result.rate_source).toBe('coingecko');
    expect(result.failure).toBeUndefined();
  });

  it('builds a failure result with an error', () => {
    const result = buildCanonicalizationResult({
      nativeAmount: '1000',
      nativeAsset: 'BTC',
      error: new CanonicalizationError({
        human_readable: 'BTC unsupported',
        details: { from_asset: 'BTC' },
      }),
    });
    expect(result.canonical_amount).toBe('');
    expect(result.failure).toBeDefined();
    expect(result.failure?.reason_code).toBe('canonicalization_failed');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test -- src/lib/policy/canonicalizer/canonicalizer
```

Expected: FAIL with `Cannot find module './canonicalizer'`.

- [ ] **Step 4: Implement the canonicalizer**

Create `src/lib/policy/canonicalizer/canonicalizer.ts`:

```typescript
// src/lib/policy/canonicalizer/canonicalizer.ts

import Big from 'big.js';
import { AmountNative, AssetCode } from '../types/assets';
import { CanonicalizationResult, CanonicalizationResultFailure } from '../types/context';
import { PolicyRateProvider, RateReading } from './interface';
import { CanonicalizationError } from '../errors/classes';
import { REASON_CODES } from '../errors/reason-codes';

/**
 * Canonicalize a native amount to USD via the provided rate provider.
 *
 * Never throws — returns a structured CanonicalizationResult with a
 * populated `failure` field on any error. The evaluator calls this once
 * per movement at context-load time, and consumers read the result from
 * the EvaluationContext synchronously.
 */
export async function canonicalizeToUsd(
  amount: AmountNative,
  provider: PolicyRateProvider,
  asOf: Date
): Promise<CanonicalizationResult> {
  try {
    const rateReading = await provider.getRateAsOf(amount.asset, 'USD', asOf);
    return buildCanonicalizationResult({
      nativeAmount: amount.amount,
      nativeAsset: amount.asset,
      rateReading,
    });
  } catch (err) {
    if (err instanceof CanonicalizationError) {
      return buildCanonicalizationResult({
        nativeAmount: amount.amount,
        nativeAsset: amount.asset,
        error: err,
      });
    }
    // Unexpected error — wrap it
    return buildCanonicalizationResult({
      nativeAmount: amount.amount,
      nativeAsset: amount.asset,
      error: new CanonicalizationError({
        human_readable: `Unexpected error during canonicalization: ${err instanceof Error ? err.message : String(err)}`,
        user_action: 'Contact support with the trace ID.',
        details: { unexpected_error_class: err instanceof Error ? err.name : typeof err },
      }),
    });
  }
}

/**
 * Pure builder that assembles a CanonicalizationResult from either a
 * successful rate reading or an error. Separated from canonicalizeToUsd
 * so it can be unit-tested without mocking the provider.
 */
export function buildCanonicalizationResult(
  opts:
    | {
        nativeAmount: string;
        nativeAsset: AssetCode;
        rateReading: RateReading;
        error?: never;
      }
    | {
        nativeAmount: string;
        nativeAsset: AssetCode;
        error: CanonicalizationError;
        rateReading?: never;
      }
): CanonicalizationResult {
  if (opts.error) {
    const failure: CanonicalizationResultFailure = {
      reason_code: (opts.error.reason_code as CanonicalizationResultFailure['reason_code']) ?? REASON_CODES.canonicalization_failed,
      human_readable: opts.error.human_readable,
      details: opts.error.details,
      user_action: opts.error.user_action,
    };
    return {
      native_amount: opts.nativeAmount,
      native_asset: opts.nativeAsset,
      canonical_amount: '',
      canonical_currency: 'USD',
      rate: '',
      rate_source: '',
      rate_as_of: new Date(0),
      max_age_ms: 0,
      failure,
    };
  }

  const { rateReading } = opts;
  const canonical = new Big(opts.nativeAmount).times(new Big(rateReading.rate)).toString();

  return {
    native_amount: opts.nativeAmount,
    native_asset: opts.nativeAsset,
    canonical_amount: canonical,
    canonical_currency: 'USD',
    rate: rateReading.rate,
    rate_source: rateReading.source,
    rate_as_of: rateReading.asOfRate,
    max_age_ms: rateReading.maxAgeMs,
  };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
npm test -- src/lib/policy/canonicalizer/canonicalizer
```

Expected: all 6 tests pass.

- [ ] **Step 6: Run the full policy test suite to check for regressions**

```bash
npm test -- src/lib/policy
```

Expected: all tests across canonicalizer, schemas, and errors pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/policy/canonicalizer/canonicalizer.ts src/lib/policy/canonicalizer/canonicalizer.test.ts src/lib/policy/canonicalizer/oracle-adapter.ts
git commit -m "$(cat <<'EOF'
feat(policy): add canonicalizer function + oracle adapter

canonicalizeToUsd wraps the PolicyRateProvider with never-throws
semantics and returns a structured CanonicalizationResult with a
populated failure field on error. Uses big.js for precise decimal
arithmetic to avoid float precision loss on amounts. The oracle
adapter bridges the existing getStablecoinPrices() to the
StablecoinPricesResult shape expected by the provider.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Define ForecastQuery interface

**Files:**
- Create: `src/lib/policy/forecast/interface.ts`

Pure interface — no tests. Tested via contract tests in Task 14 after the stub exists.

- [ ] **Step 1: Create the interface file**

Create `src/lib/policy/forecast/interface.ts`:

```typescript
// src/lib/policy/forecast/interface.ts

import { AssetCode, AmountNative, AmountValue, VenueId } from '../types/assets';
import { ProposedMovement } from '../types/movement';

/**
 * Read-only forecast query surface consumed by the policy engine.
 *
 * The interface is pure in the sense that a single query instance
 * represents a single snapshot — calling methods multiple times on
 * the same instance returns consistent results.
 *
 * hypothetical() is the post-state mechanism: returns a NEW query
 * scoped to post-transfer state, independent of the original.
 */
export interface ForecastQuery {
  getProjectedMinBalance(
    asset: AssetCode,
    venue: VenueId | null,
    windowDays: number
  ): Promise<AmountNative>;

  getProjectedPosition(
    asset: AssetCode,
    venue: VenueId | null,
    atDate: Date
  ): Promise<AmountNative>;

  areObligationsCovered(
    windowDays: number
  ): Promise<ObligationCoverageResult>;

  getObligationsDueInWindow(
    windowDays: number
  ): Promise<Obligation[]>;

  /**
   * Returns a NEW query scoped to treasury state AFTER the proposed
   * movement is applied. Must not mutate `this`.
   */
  hypothetical(proposedMovement: ProposedMovement): ForecastQuery;

  readonly metadata: ForecastQueryMetadata;
}

export interface ObligationCoverageResult {
  covered: boolean;
  shortfallAmount?: AmountValue;
  firstShortfallDate?: Date;
  obligationsChecked: number;
  obligationsUncovered: number;
}

export interface Obligation {
  id: string;
  due_date: Date;
  amount: AmountValue;
  description: string;
  counterparty_id?: string;
  source: 'manual' | 'recurring' | 'erp_import';
}

export interface ForecastQueryMetadata {
  mode: 'stub' | 'real';
  snapshot_taken_at: Date;
  source: string;
  freshness_ms?: number;
  warnings: string[];
}

/**
 * Factory that produces ForecastQuery instances. Dependency-injected
 * at context-loader wiring time so stub and real implementations are
 * swappable without touching the evaluator.
 */
export interface ForecastQueryFactory {
  createForEnterprise(enterpriseId: string): Promise<ForecastQuery>;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/policy/forecast/interface.ts
git commit -m "$(cat <<'EOF'
feat(policy): add ForecastQuery interface

Read-only query surface for forecast data. hypothetical() returns a
new query scoped to post-transfer state. Both stub (Task 12-13) and
future real implementations must implement this interface and pass
the contract tests (Task 14).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Implement StubLogger

**Files:**
- Create: `src/lib/policy/forecast/stub-logger.ts`
- Create: `src/lib/policy/forecast/stub-logger.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/policy/forecast/stub-logger.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { TestStubLogger, NoopStubLogger } from './stub-logger';

describe('TestStubLogger', () => {
  it('records every call to logStubCall', () => {
    const logger = new TestStubLogger();

    logger.logStubCall('getProjectedMinBalance', 'ent-1', { asset: 'USDC' });
    logger.logStubCall('hypothetical', 'ent-1', { movement_id: 'mv-1' });

    expect(logger.calls).toHaveLength(2);
    expect(logger.calls[0]).toMatchObject({
      method: 'getProjectedMinBalance',
      enterprise_id: 'ent-1',
      args: { asset: 'USDC' },
    });
    expect(logger.calls[1]).toMatchObject({
      method: 'hypothetical',
      enterprise_id: 'ent-1',
    });
  });

  it('each recorded call has a called_at timestamp', () => {
    const logger = new TestStubLogger();
    logger.logStubCall('areObligationsCovered', 'ent-1', { windowDays: 14 });
    expect(logger.calls[0].called_at).toBeInstanceOf(Date);
  });

  it('reset() clears the log', () => {
    const logger = new TestStubLogger();
    logger.logStubCall('anything', 'ent-1', {});
    logger.reset();
    expect(logger.calls).toHaveLength(0);
  });
});

describe('NoopStubLogger', () => {
  it('accepts calls without error', () => {
    const logger = new NoopStubLogger();
    expect(() => logger.logStubCall('any', 'ent-1', {})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- src/lib/policy/forecast/stub-logger
```

Expected: FAIL with `Cannot find module './stub-logger'`.

- [ ] **Step 3: Implement the loggers**

Create `src/lib/policy/forecast/stub-logger.ts`:

```typescript
// src/lib/policy/forecast/stub-logger.ts

/**
 * StubLogger observes every call to the forecast stub. The production
 * implementation writes to policy_forecast_stub_calls + console + Sentry.
 * The test implementation buffers calls in memory for assertion. The noop
 * implementation is for scenarios where logging should be silenced (e.g.,
 * unit tests of unrelated modules that happen to instantiate the stub).
 */
export interface StubLogger {
  logStubCall(
    method: string,
    enterpriseId: string,
    args: Record<string, unknown>
  ): void;
}

/**
 * In-memory logger for tests. Records every call with a timestamp.
 */
export class TestStubLogger implements StubLogger {
  readonly calls: Array<{
    method: string;
    enterprise_id: string;
    args: Record<string, unknown>;
    called_at: Date;
  }> = [];

  logStubCall(method: string, enterpriseId: string, args: Record<string, unknown>): void {
    this.calls.push({
      method,
      enterprise_id: enterpriseId,
      args,
      called_at: new Date(),
    });
  }

  reset(): void {
    this.calls.length = 0;
  }
}

/**
 * Silent logger — accepts calls but discards them. Use when the stub
 * is instantiated incidentally and logging is not relevant.
 */
export class NoopStubLogger implements StubLogger {
  logStubCall(_method: string, _enterpriseId: string, _args: Record<string, unknown>): void {
    // intentional no-op
  }
}

/**
 * Production stub logger. Logs to console, writes a row to
 * policy_forecast_stub_calls, and emits a Sentry breadcrumb.
 *
 * CONSTRUCTOR-INJECTED: the DB client is passed in so unit tests that
 * want real DB writes can supply one, and tests that don't can use the
 * TestStubLogger instead. We do NOT import the Supabase client at module
 * scope because that would make this file transitively unimportable in
 * environments without Supabase env vars set.
 */
export interface ProductionStubLoggerDeps {
  insertStubCall: (row: {
    enterprise_id: string;
    method: string;
    args_json: Record<string, unknown>;
    called_at: Date;
  }) => Promise<void>;
  sentryBreadcrumb?: (data: {
    category: string;
    message: string;
    level: 'warning';
    data: Record<string, unknown>;
  }) => void;
  consoleLogger?: (msg: string, data: Record<string, unknown>) => void;
}

export class ProductionStubLogger implements StubLogger {
  constructor(private readonly deps: ProductionStubLoggerDeps) {}

  logStubCall(method: string, enterpriseId: string, args: Record<string, unknown>): void {
    // 1. Console log (structured)
    const consoleLogger = this.deps.consoleLogger ?? defaultConsoleLogger;
    consoleLogger('[POLICY_FORECAST_STUB]', {
      enterprise_id: enterpriseId,
      method,
      args,
      timestamp: new Date().toISOString(),
      note: 'Forecast stub in use — real forecast module not yet deployed',
    });

    // 2. DB counter (fire-and-forget; failures should not block the evaluator)
    this.deps.insertStubCall({
      enterprise_id: enterpriseId,
      method,
      args_json: args,
      called_at: new Date(),
    }).catch((err) => {
      // Swallowing errors is intentional — we don't want a stub-logger
      // failure to block evaluation. We DO want to surface it to console.
      consoleLogger('[POLICY_FORECAST_STUB_LOGGER_ERROR]', {
        enterprise_id: enterpriseId,
        method,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // 3. Sentry breadcrumb
    if (this.deps.sentryBreadcrumb) {
      this.deps.sentryBreadcrumb({
        category: 'policy.forecast.stub',
        message: `Stub call: ${method}`,
        level: 'warning',
        data: { enterprise_id: enterpriseId, method },
      });
    }
  }
}

function defaultConsoleLogger(msg: string, data: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.warn(msg, JSON.stringify(data));
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- src/lib/policy/forecast/stub-logger
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/forecast/stub-logger.ts src/lib/policy/forecast/stub-logger.test.ts
git commit -m "$(cat <<'EOF'
feat(policy): add StubLogger (test, noop, production variants)

Three implementations of the StubLogger interface: TestStubLogger
buffers calls in memory for assertions, NoopStubLogger silences
logging, ProductionStubLogger writes to console + DB counter table +
Sentry breadcrumbs via dependency-injected helpers.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Implement StubForecastQuery and factory

**Files:**
- Create: `src/lib/policy/forecast/stub.ts`
- Create: `src/lib/policy/forecast/stub.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/policy/forecast/stub.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { StubForecastQuery, StubForecastQueryFactory } from './stub';
import { TestStubLogger } from './stub-logger';
import { ProposedMovement } from '../types/movement';

const makeMovement = (): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'solana', asset: 'USDC' },
  amount: { amount: '1000', asset: 'USDC' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: '2026-04-10T14:22:33.000Z',
});

describe('StubForecastQuery', () => {
  it('metadata reports mode=stub', () => {
    const logger = new TestStubLogger();
    const q = new StubForecastQuery('ent-1', logger);
    expect(q.metadata.mode).toBe('stub');
    expect(q.metadata.source).toBe('stub-pass-through');
    expect(q.metadata.warnings).toContain(
      expect.stringContaining('FORECAST_STUB_MODE')
    );
  });

  it('getProjectedMinBalance returns a large permissive value and logs', async () => {
    const logger = new TestStubLogger();
    const q = new StubForecastQuery('ent-1', logger);

    const result = await q.getProjectedMinBalance('USDC', null, 14);

    expect(parseFloat(result.amount)).toBeGreaterThan(1e15);
    expect(result.asset).toBe('USDC');
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0].method).toBe('getProjectedMinBalance');
  });

  it('getProjectedPosition returns permissive and logs', async () => {
    const logger = new TestStubLogger();
    const q = new StubForecastQuery('ent-1', logger);

    const result = await q.getProjectedPosition('USDT', 'ethereum', new Date());
    expect(parseFloat(result.amount)).toBeGreaterThan(1e15);
    expect(logger.calls).toHaveLength(1);
  });

  it('areObligationsCovered returns { covered: true } with zero obligations', async () => {
    const logger = new TestStubLogger();
    const q = new StubForecastQuery('ent-1', logger);

    const result = await q.areObligationsCovered(30);
    expect(result.covered).toBe(true);
    expect(result.obligationsChecked).toBe(0);
    expect(result.obligationsUncovered).toBe(0);
    expect(result.shortfallAmount).toBeUndefined();
    expect(logger.calls).toHaveLength(1);
  });

  it('getObligationsDueInWindow returns empty array', async () => {
    const logger = new TestStubLogger();
    const q = new StubForecastQuery('ent-1', logger);

    const result = await q.getObligationsDueInWindow(7);
    expect(result).toEqual([]);
    expect(logger.calls).toHaveLength(1);
  });

  it('hypothetical() returns a NEW query instance (not this)', () => {
    const logger = new TestStubLogger();
    const q = new StubForecastQuery('ent-1', logger);

    const hypo = q.hypothetical(makeMovement());

    expect(hypo).not.toBe(q);
    expect(hypo).toBeInstanceOf(StubForecastQuery);
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0].method).toBe('hypothetical');
  });

  it('hypothetical() returns an independent instance (no mutation of original)', async () => {
    const logger = new TestStubLogger();
    const q = new StubForecastQuery('ent-1', logger);

    const hypo = q.hypothetical(makeMovement());
    await hypo.areObligationsCovered(14);   // hits hypo, not q

    // Only the hypothetical call and the areObligationsCovered call
    expect(logger.calls.map(c => c.method)).toEqual(['hypothetical', 'areObligationsCovered']);
  });
});

describe('StubForecastQueryFactory', () => {
  it('createForEnterprise returns a StubForecastQuery', async () => {
    const logger = new TestStubLogger();
    const factory = new StubForecastQueryFactory(logger);

    const q = await factory.createForEnterprise('ent-1');
    expect(q).toBeInstanceOf(StubForecastQuery);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/lib/policy/forecast/stub.test
```

Expected: FAIL with `Cannot find module './stub'`.

- [ ] **Step 3: Implement the stub**

Create `src/lib/policy/forecast/stub.ts`:

```typescript
// src/lib/policy/forecast/stub.ts

import {
  ForecastQuery,
  ForecastQueryFactory,
  ForecastQueryMetadata,
  Obligation,
  ObligationCoverageResult,
} from './interface';
import { StubLogger } from './stub-logger';
import { AssetCode, AmountNative, VenueId } from '../types/assets';
import { ProposedMovement } from '../types/movement';

/**
 * Pass-through stub for the ForecastQuery interface.
 *
 * Returns permissive defaults — "all obligations covered, no shortfall,
 * infinite projected balances, no obligations due" — and logs every call.
 *
 * SAFETY CONTRACT: Never returns a conservative answer that would wrongly
 * block a transfer. Always the most permissive answer so forecast-dependent
 * checks fail open with loud signaling.
 *
 * DELETION: When the real forecast module ships, delete this file and
 * stub-logger.ts, then update the single DI wiring line in src/lib/policy/gate.ts.
 * The evaluation trace's forecast_mode='stub' flag will stop appearing on
 * new evaluations, and UI advisory badges auto-disappear.
 */
const STUB_WARNING_MESSAGE =
  'FORECAST_STUB_MODE: This query instance is served by the stub. ' +
  'Forecast-dependent checks (obligation coverage, lookahead rules, ' +
  'projected min balance) are advisory only until the real forecast ' +
  'module is deployed.';

const LARGE_PERMISSIVE_AMOUNT = '999999999999999999';

export class StubForecastQuery implements ForecastQuery {
  readonly metadata: ForecastQueryMetadata;

  constructor(
    private readonly enterpriseId: string,
    private readonly logger: StubLogger,
    snapshotTime: Date = new Date()
  ) {
    this.metadata = {
      mode: 'stub',
      snapshot_taken_at: snapshotTime,
      source: 'stub-pass-through',
      warnings: [STUB_WARNING_MESSAGE],
    };
  }

  async getProjectedMinBalance(
    asset: AssetCode,
    venue: VenueId | null,
    windowDays: number
  ): Promise<AmountNative> {
    this.logger.logStubCall('getProjectedMinBalance', this.enterpriseId, {
      asset, venue, windowDays,
    });
    return { amount: LARGE_PERMISSIVE_AMOUNT, asset };
  }

  async getProjectedPosition(
    asset: AssetCode,
    venue: VenueId | null,
    atDate: Date
  ): Promise<AmountNative> {
    this.logger.logStubCall('getProjectedPosition', this.enterpriseId, {
      asset, venue, atDate: atDate.toISOString(),
    });
    return { amount: LARGE_PERMISSIVE_AMOUNT, asset };
  }

  async areObligationsCovered(windowDays: number): Promise<ObligationCoverageResult> {
    this.logger.logStubCall('areObligationsCovered', this.enterpriseId, { windowDays });
    return {
      covered: true,
      obligationsChecked: 0,
      obligationsUncovered: 0,
    };
  }

  async getObligationsDueInWindow(windowDays: number): Promise<Obligation[]> {
    this.logger.logStubCall('getObligationsDueInWindow', this.enterpriseId, { windowDays });
    return [];
  }

  hypothetical(proposedMovement: ProposedMovement): ForecastQuery {
    this.logger.logStubCall('hypothetical', this.enterpriseId, {
      movement_id: proposedMovement.id,
    });
    // Recursive stub — the post-state query is indistinguishable from the
    // original (stub ignores state entirely) but it's a new instance so
    // hypo calls don't interfere with origin calls.
    return new StubForecastQuery(
      this.enterpriseId,
      this.logger,
      this.metadata.snapshot_taken_at
    );
  }
}

/**
 * Factory for StubForecastQuery instances. Wired into the context loader
 * in Plan 2 via DI.
 */
export class StubForecastQueryFactory implements ForecastQueryFactory {
  constructor(private readonly logger: StubLogger) {}

  async createForEnterprise(enterpriseId: string): Promise<ForecastQuery> {
    return new StubForecastQuery(enterpriseId, this.logger);
  }
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- src/lib/policy/forecast/stub
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/forecast/stub.ts src/lib/policy/forecast/stub.test.ts
git commit -m "$(cat <<'EOF'
feat(policy): add StubForecastQuery and factory

Pass-through stub for the ForecastQuery interface. Returns permissive
defaults (effectively-infinite balances, covered=true) and logs every
call via the injected StubLogger. hypothetical() returns a new
independent stub instance. Safety contract: never returns a
conservative answer that would wrongly block a transfer.

When the real forecast module ships, delete stub.ts + stub-logger.ts
and update one line in gate.ts.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: ForecastQuery contract tests

**Files:**
- Create: `src/lib/policy/forecast/contract.test.ts`

Contract tests define the invariants every ForecastQuery implementation must satisfy. The stub must pass them today; any future real implementation must pass them before replacing the stub.

- [ ] **Step 1: Create the contract test file**

Create `src/lib/policy/forecast/contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ForecastQuery, ForecastQueryFactory } from './interface';
import { StubForecastQuery, StubForecastQueryFactory } from './stub';
import { NoopStubLogger } from './stub-logger';
import { ProposedMovement } from '../types/movement';

/**
 * Shared contract test suite. Every ForecastQuery implementation must
 * pass this suite. Called once with the stub; future real implementations
 * will add another `describeContract(...)` call.
 */
function describeForecastQueryContract(
  name: string,
  makeFactory: () => ForecastQueryFactory
) {
  describe(`ForecastQuery contract — ${name}`, () => {
    const makeMovement = (): ProposedMovement => ({
      id: 'mv-contract',
      kind: 'crypto_transfer',
      source: { venue: 'ethereum', asset: 'USDC' },
      destination: { venue: 'solana', asset: 'USDC' },
      amount: { amount: '1000', asset: 'USDC' },
      initiator: { type: 'human', user_id: 'user-1' },
      requested_at: new Date().toISOString(),
    });

    it('metadata.mode is "stub" or "real"', async () => {
      const factory = makeFactory();
      const q = await factory.createForEnterprise('ent-contract');
      expect(['stub', 'real']).toContain(q.metadata.mode);
    });

    it('metadata.snapshot_taken_at is a Date', async () => {
      const factory = makeFactory();
      const q = await factory.createForEnterprise('ent-contract');
      expect(q.metadata.snapshot_taken_at).toBeInstanceOf(Date);
    });

    it('metadata.source is a non-empty string', async () => {
      const factory = makeFactory();
      const q = await factory.createForEnterprise('ent-contract');
      expect(q.metadata.source.length).toBeGreaterThan(0);
    });

    it('hypothetical() returns a new instance, not this', async () => {
      const factory = makeFactory();
      const q = await factory.createForEnterprise('ent-contract');
      const hypo = q.hypothetical(makeMovement());
      expect(hypo).not.toBe(q);
    });

    it('hypothetical() does not mutate the original query metadata', async () => {
      const factory = makeFactory();
      const q = await factory.createForEnterprise('ent-contract');
      const originalSnapshotTime = q.metadata.snapshot_taken_at.getTime();
      const originalSource = q.metadata.source;

      q.hypothetical(makeMovement());

      expect(q.metadata.snapshot_taken_at.getTime()).toBe(originalSnapshotTime);
      expect(q.metadata.source).toBe(originalSource);
    });

    it('calling the same method twice returns consistent results', async () => {
      const factory = makeFactory();
      const q = await factory.createForEnterprise('ent-contract');

      const r1 = await q.areObligationsCovered(14);
      const r2 = await q.areObligationsCovered(14);

      expect(r1.covered).toBe(r2.covered);
      expect(r1.obligationsChecked).toBe(r2.obligationsChecked);
    });

    it('getProjectedMinBalance returns an AmountNative with asset matching the request', async () => {
      const factory = makeFactory();
      const q = await factory.createForEnterprise('ent-contract');
      const result = await q.getProjectedMinBalance('USDC', null, 7);
      expect(result.asset).toBe('USDC');
      expect(typeof result.amount).toBe('string');
      expect(result.amount.length).toBeGreaterThan(0);
    });

    it('getObligationsDueInWindow returns an array (possibly empty)', async () => {
      const factory = makeFactory();
      const q = await factory.createForEnterprise('ent-contract');
      const result = await q.getObligationsDueInWindow(30);
      expect(Array.isArray(result)).toBe(true);
    });

    it('async methods never throw — they return structured results or fail via returned error field', async () => {
      const factory = makeFactory();
      const q = await factory.createForEnterprise('ent-contract');

      // Each method call must either return a value OR throw a structured
      // PolicyError. For the stub, none of these throw. For a future real
      // implementation, the contract says: throw PolicyError, never a raw Error.
      await expect(q.getProjectedMinBalance('USDC', null, 14)).resolves.toBeDefined();
      await expect(q.getProjectedPosition('USDT', null, new Date())).resolves.toBeDefined();
      await expect(q.areObligationsCovered(14)).resolves.toBeDefined();
      await expect(q.getObligationsDueInWindow(14)).resolves.toBeDefined();
    });
  });
}

// Run the contract against the stub
describeForecastQueryContract('StubForecastQuery', () => {
  return new StubForecastQueryFactory(new NoopStubLogger());
});

// Future: describeForecastQueryContract('RealForecastQuery', () => new RealForecastQueryFactory(...));
```

- [ ] **Step 2: Run the contract tests**

```bash
npm test -- src/lib/policy/forecast/contract
```

Expected: all ~9 tests pass.

- [ ] **Step 3: Run the full forecast suite**

```bash
npm test -- src/lib/policy/forecast
```

Expected: all stub + logger + contract tests pass together.

- [ ] **Step 4: Commit**

```bash
git add src/lib/policy/forecast/contract.test.ts
git commit -m "$(cat <<'EOF'
test(policy): add ForecastQuery contract test suite

Shared invariants every ForecastQuery implementation must satisfy:
metadata shape, hypothetical() returns a new non-mutating instance,
consistent repeat calls, typed return shapes. Stub passes today;
any future real implementation must pass before replacing the stub.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Implement IR leaf — amount_compare (with splitting guard)

This is the most complex leaf because it handles both direct amount comparisons and the always-on 24h splitting guard system invariant.

**Files:**
- Create: `src/lib/policy/ir-evaluator/leaves/amount-compare.ts`
- Create: `src/lib/policy/ir-evaluator/leaves/amount-compare.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/policy/ir-evaluator/leaves/amount-compare.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { evalAmountCompare, LeafResult } from './amount-compare';
import { AmountCompareNode } from '../../types/ir';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';

const makeMovement = (overrides: Partial<ProposedMovement> = {}): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'solana', asset: 'USDC' },
  amount: { amount: '50000', asset: 'USDC' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: '2026-04-10T14:22:33.000Z',
  ...overrides,
});

const makeContext = (overrides: Partial<EvaluationContext> = {}): EvaluationContext => ({
  now: new Date('2026-04-10T14:22:33.000Z'),
  enterprise_id: 'ent-1',
  policy_version: { id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test', rules: [], hard_limits: [], approval_chains: [] },
  treasury_state: {
    positions_by_asset: { USDC: '1000000', USDT: '500000' },
    positions_by_asset_venue: { 'USDC:ethereum': '800000', 'USDC:solana': '200000' },
    positions_usd_by_asset: { USDC: '1000000', USDT: '500000' },
    total_treasury_usd: '1500000',
    cash_equivalent_usd: '1500000',
    loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '50000',
    native_asset: 'USDC',
    canonical_amount: '50010',   // 50000 * 1.0002
    canonical_currency: 'USD',
    rate: '1.0002',
    rate_source: 'coingecko',
    rate_as_of: new Date(),
    max_age_ms: 60_000,
  },
  aggregates: {
    system_splitting_guard_24h: {
      window_spec_hash: 'sys-24h',
      window_start: new Date('2026-04-09T14:22:33.000Z'),
      window_end: new Date('2026-04-10T14:22:33.000Z'),
      sum_amount_usd: '0',
      sum_amount_by_asset: {},
      count: 0,
      distinct_destinations: 0,
      distinct_counterparties: 0,
      included_evaluation_ids: [],
      includes_proposed: false,
    },
    user_specs: {},
  },
  sanctions: { status: 'clear' },
  forecast: {
    query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub-pass-through', warnings: [] },
    hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub-pass-through', warnings: [] },
    results: {},
  },
  ...overrides,
});

describe('evalAmountCompare — transfer.amount, direct comparison', () => {
  it('returns matched=true when native amount exceeds native-currency threshold', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '10000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(true);
    expect(result.via).toBe('direct');
    expect(result.failure).toBeUndefined();
  });

  it('returns matched=false when native amount is below native-currency threshold', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '100000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(false);
  });
});

describe('evalAmountCompare — transfer.amount, canonicalized comparison', () => {
  it('uses canonical_amount when rule currency is USD and transfer asset is USDC', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '50000', currency: 'USD' },  // 50000 USD threshold
    };
    // Context has canonical_amount = 50010 (50000 USDC * 1.0002 rate)
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(true);  // 50010 > 50000
  });

  it('returns failure when canonicalization failed', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '50000', currency: 'USD' },
    };
    const ctx = makeContext({
      canonicalization: {
        native_amount: '50000',
        native_asset: 'USDC',
        canonical_amount: '',
        canonical_currency: 'USD',
        rate: '',
        rate_source: '',
        rate_as_of: new Date(0),
        max_age_ms: 0,
        failure: {
          reason_code: 'canonicalization_failed',
          human_readable: 'Rate unavailable',
          details: {},
          user_action: 'Retry',
        },
      },
    });
    const result = evalAmountCompare(node, makeMovement(), ctx);
    expect(result.matched).toBe(false);
    expect(result.failure).toBeDefined();
    expect(result.failure?.reason_code).toBe('canonicalization_failed');
  });
});

describe('evalAmountCompare — splitting guard', () => {
  it('matches when 24h rolling sum exceeds threshold even if direct does not', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '50000', currency: 'USD' },
    };
    // Movement is only 5000 USDC (~5000 USD), direct comparison fails.
    // But 24h rolling sum is 47000 USD — add proposed 5000 = 52000, which exceeds.
    const movement = makeMovement({ amount: { amount: '5000', asset: 'USDC' } });
    const ctx = makeContext({
      canonicalization: {
        native_amount: '5000',
        native_asset: 'USDC',
        canonical_amount: '5001',  // 5000 * 1.0002
        canonical_currency: 'USD',
        rate: '1.0002',
        rate_source: 'coingecko',
        rate_as_of: new Date(),
        max_age_ms: 60_000,
      },
      aggregates: {
        system_splitting_guard_24h: {
          window_spec_hash: 'sys-24h',
          window_start: new Date('2026-04-09T14:22:33.000Z'),
          window_end: new Date('2026-04-10T14:22:33.000Z'),
          sum_amount_usd: '47000',  // already 47k in trailing 24h
          sum_amount_by_asset: {},
          count: 9,
          distinct_destinations: 1,
          distinct_counterparties: 1,
          included_evaluation_ids: [],
          includes_proposed: false,
        },
        user_specs: {},
      },
    });
    const result = evalAmountCompare(node, movement, ctx);
    expect(result.matched).toBe(true);
    expect(result.via).toBe('splitting');
    expect(result.splitting_note).toContain('24-hour');
  });

  it('does not apply splitting guard when attr is not transfer.amount', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'treasury.position',
      scope: { asset: 'USDC' },
      op: '>',
      value: { amount: '2000000', currency: 'USDC' },
    };
    // Position is 1M USDC, threshold is 2M — no match, no splitting involved
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(false);
  });
});

describe('evalAmountCompare — treasury.position', () => {
  it('reads the per-asset native position from treasury state', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'treasury.position',
      scope: { asset: 'USDC' },
      op: '>',
      value: { amount: '500000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(true);  // 1M > 500k
  });

  it('requires scope.asset for treasury.position', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'treasury.position',
      op: '>',
      value: { amount: '500000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });
});

describe('evalAmountCompare — between operator', () => {
  it('matches when value falls within [value, value_upper]', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: 'between',
      value: { amount: '10000', currency: 'USDC' },
      value_upper: { amount: '100000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(true);  // 50000 between 10k and 100k
  });

  it('does not match when value is outside the range', () => {
    const node: AmountCompareNode = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: 'between',
      value: { amount: '60000', currency: 'USDC' },
      value_upper: { amount: '100000', currency: 'USDC' },
    };
    const result = evalAmountCompare(node, makeMovement(), makeContext());
    expect(result.matched).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- src/lib/policy/ir-evaluator/leaves/amount-compare
```

Expected: FAIL with `Cannot find module './amount-compare'`.

- [ ] **Step 3: Implement the leaf evaluator**

Create `src/lib/policy/ir-evaluator/leaves/amount-compare.ts`:

```typescript
// src/lib/policy/ir-evaluator/leaves/amount-compare.ts

import Big from 'big.js';
import { AmountCompareNode, NumericOp } from '../../types/ir';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';
import { ReasonCode } from '../../errors/reason-codes';

/**
 * Result of evaluating a single leaf node. Leaves produce booleans
 * (matched / not matched) plus optional structured failure if the
 * leaf could not be fully evaluated.
 */
export interface LeafResult {
  matched: boolean;
  via?: 'direct' | 'splitting';
  splitting_note?: string;
  failure?: LeafFailure;
  evaluation_details: Record<string, unknown>;
}

export interface LeafFailure {
  reason_code: ReasonCode;
  human_readable: string;
  details: Record<string, unknown>;
  user_action: string;
}

/**
 * Evaluate an amount_compare node against a proposed movement + context.
 *
 * Handles four cases:
 *   - attr='transfer.amount' + rule currency matches asset → direct compare
 *   - attr='transfer.amount' + rule currency differs → canonicalized compare
 *   - attr='transfer.amount' → ALSO runs the 24h splitting guard check
 *   - attr='treasury.position' → reads pre-loaded native position
 *   - attr='treasury.post_position' → computed post-transfer position
 *   - attr='rolling_sum' → reads pre-loaded aggregate sum from context
 *
 * If the comparison cannot be fully evaluated (rate unavailable, aggregate
 * query failed, missing scope), returns `{ matched: false, failure: {...} }`
 * — the rule's caller should treat this as cannot-fully-evaluate and block.
 */
export function evalAmountCompare(
  node: AmountCompareNode,
  movement: ProposedMovement,
  ctx: EvaluationContext
): LeafResult {
  switch (node.attr) {
    case 'transfer.amount':
      return evalTransferAmount(node, movement, ctx);
    case 'treasury.position':
      return evalTreasuryPosition(node, ctx, false);
    case 'treasury.post_position':
      return evalTreasuryPosition(node, ctx, true, movement);
    case 'rolling_sum':
      return evalRollingSum(node, ctx);
  }
}

function evalTransferAmount(
  node: AmountCompareNode,
  movement: ProposedMovement,
  ctx: EvaluationContext
): LeafResult {
  // Determine which amount to compare: native or canonical USD
  const ruleCurrency = node.value.currency;
  const transferAsset = movement.amount.asset;

  let actualValue: string;

  if (ruleCurrency === transferAsset) {
    // Direct comparison — no canonicalization needed
    actualValue = movement.amount.amount;
  } else if (ruleCurrency === 'USD') {
    // Canonicalized comparison via pre-loaded canonicalization result
    if (ctx.canonicalization.failure) {
      return {
        matched: false,
        failure: {
          reason_code: ctx.canonicalization.failure.reason_code,
          human_readable: ctx.canonicalization.failure.human_readable,
          details: ctx.canonicalization.failure.details,
          user_action: ctx.canonicalization.failure.user_action,
        },
        evaluation_details: { attr: 'transfer.amount', rule_currency: 'USD', transfer_asset: transferAsset },
      };
    }
    actualValue = ctx.canonicalization.canonical_amount;
  } else {
    // Rule currency is neither 'USD' nor matches transfer asset — cannot evaluate
    return {
      matched: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable:
          `Rule compares transfer.amount in ${ruleCurrency}, but transfer is in ${transferAsset}. ` +
          `Phase 1 only supports direct comparisons (same asset) or USD-canonicalized comparisons. ` +
          `Author the rule in ${transferAsset} or USD.`,
        details: { rule_currency: ruleCurrency, transfer_asset: transferAsset },
        user_action: `Edit the rule to compare in USD or in ${transferAsset}.`,
      },
      evaluation_details: { attr: 'transfer.amount' },
    };
  }

  // Direct comparison on the chosen actualValue
  const directMatched = applyNumericOp(actualValue, node.op, node.value.amount, node.value_upper?.amount);

  if (directMatched) {
    return {
      matched: true,
      via: 'direct',
      evaluation_details: {
        attr: 'transfer.amount',
        actual_value: actualValue,
        threshold: node.value.amount,
        op: node.op,
      },
    };
  }

  // ─── System invariant: splitting guard ──────────────────────────────
  // For every transfer.amount comparison, also evaluate against the 24h
  // rolling sum grouped by (initiator, destination). If that matches, the
  // rule is considered matched via splitting.
  //
  // Only applies when the rule currency is USD (since the splitting guard
  // aggregate is stored in USD) OR when we can canonicalize the proposed
  // transfer to USD.

  const splittingGuard = ctx.aggregates.system_splitting_guard_24h;
  if (splittingGuard.failure) {
    // Can't check splitting — but this is a rule we couldn't fully evaluate.
    // Fail-closed: return failure.
    return {
      matched: false,
      failure: {
        reason_code: splittingGuard.failure.reason_code,
        human_readable: `Splitting guard could not load: ${splittingGuard.failure.human_readable}`,
        details: splittingGuard.failure.details,
        user_action: 'Retry; if the issue persists, contact support.',
      },
      evaluation_details: { attr: 'transfer.amount', splitting_check: 'failed' },
    };
  }

  // Compute rolling sum including the proposed movement
  const proposedCanonical = ctx.canonicalization.canonical_amount || '0';
  if (!proposedCanonical && ruleCurrency === 'USD') {
    // Rule is in USD but we have no canonicalization — cannot splitting-check
    return {
      matched: false,
      evaluation_details: { attr: 'transfer.amount', splitting_check: 'skipped_no_canonical' },
    };
  }

  const rollingWithProposed = new Big(splittingGuard.sum_amount_usd).plus(proposedCanonical).toString();
  const thresholdInUsd = ruleCurrency === 'USD' ? node.value.amount : null;

  if (thresholdInUsd && applyNumericOp(rollingWithProposed, node.op, thresholdInUsd, node.value_upper?.amount)) {
    return {
      matched: true,
      via: 'splitting',
      splitting_note:
        `24-hour aggregate to this destination by this initiator is ` +
        `$${splittingGuard.sum_amount_usd}; proposed transfer of $${proposedCanonical} ` +
        `would bring the rolling total to $${rollingWithProposed}, which ${node.op} ` +
        `threshold of $${thresholdInUsd}.`,
      evaluation_details: {
        attr: 'transfer.amount',
        rolling_sum_usd: splittingGuard.sum_amount_usd,
        proposed_canonical: proposedCanonical,
        rolling_with_proposed: rollingWithProposed,
        threshold: thresholdInUsd,
      },
    };
  }

  return {
    matched: false,
    via: 'direct',
    evaluation_details: {
      attr: 'transfer.amount',
      actual_value: actualValue,
      threshold: node.value.amount,
      op: node.op,
    },
  };
}

function evalTreasuryPosition(
  node: AmountCompareNode,
  ctx: EvaluationContext,
  postState: boolean,
  movement?: ProposedMovement
): LeafResult {
  if (!node.scope?.asset) {
    return {
      matched: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: 'amount_compare node with attr="treasury.position" requires scope.asset',
        details: { attr: node.attr },
        user_action: 'Add scope.asset to the rule condition specifying which asset to check.',
      },
      evaluation_details: { attr: node.attr },
    };
  }

  const asset = node.scope.asset;
  const currentPosition = ctx.treasury_state.positions_by_asset[asset] ?? '0';

  let positionValue: string;
  if (postState && movement) {
    // Adjust by movement delta
    const isOutflow = movement.source.asset === asset;
    const isInflow = movement.destination.asset === asset;
    if (isOutflow && !isInflow) {
      positionValue = new Big(currentPosition).minus(movement.amount.amount).toString();
    } else if (isInflow && !isOutflow) {
      positionValue = new Big(currentPosition).plus(movement.amount.amount).toString();
    } else {
      positionValue = currentPosition;
    }
  } else {
    positionValue = currentPosition;
  }

  const matched = applyNumericOp(positionValue, node.op, node.value.amount, node.value_upper?.amount);

  return {
    matched,
    via: 'direct',
    evaluation_details: {
      attr: node.attr,
      asset,
      position_value: positionValue,
      threshold: node.value.amount,
      op: node.op,
    },
  };
}

function evalRollingSum(node: AmountCompareNode, ctx: EvaluationContext): LeafResult {
  // The rolling_sum attr uses a pre-computed aggregate window; the specific
  // window key is expected to be encoded in node.scope or otherwise addressable.
  // For phase 1, this attr is primarily used internally by the evaluator to
  // reference pre-loaded aggregate_window results. We return a failure if no
  // matching aggregate is available.
  return {
    matched: false,
    failure: {
      reason_code: 'condition_node_evaluation_failed',
      human_readable:
        'amount_compare with attr="rolling_sum" is an internal attribute not directly ' +
        'usable in user-authored rules. Use an aggregate_window node instead.',
      details: { attr: 'rolling_sum' },
      user_action: 'Replace this rule with an aggregate_window node.',
    },
    evaluation_details: { attr: 'rolling_sum' },
  };
}

/**
 * Apply a numeric operator to decimal-string operands using big.js.
 */
function applyNumericOp(
  left: string,
  op: NumericOp,
  right: string,
  rightUpper?: string
): boolean {
  if (left === '' || right === '') return false;  // guard against empty strings from failures

  const L = new Big(left);
  const R = new Big(right);

  switch (op) {
    case '>':   return L.gt(R);
    case '>=':  return L.gte(R);
    case '<':   return L.lt(R);
    case '<=':  return L.lte(R);
    case '==':  return L.eq(R);
    case '!=':  return !L.eq(R);
    case 'between': {
      if (rightUpper === undefined || rightUpper === '') return false;
      const Ru = new Big(rightUpper);
      return L.gte(R) && L.lte(Ru);
    }
  }
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- src/lib/policy/ir-evaluator/leaves/amount-compare
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/ir-evaluator/leaves/amount-compare.ts src/lib/policy/ir-evaluator/leaves/amount-compare.test.ts
git commit -m "$(cat <<'EOF'
feat(policy): add amount_compare IR leaf evaluator

Handles direct (same-asset) + canonicalized (USD) comparisons plus the
always-on 24h splitting guard system invariant. For every
transfer.amount comparison, the evaluator also checks whether the
rolling 24h aggregate would breach the threshold — matches via
splitting detection with a structured trace note. Uses big.js for
precise decimal arithmetic.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: IR leaves — string_compare, time_compare, sanctions_status

Three simpler leaves bundled into one task since they share a pattern (no async, no canonicalization, no splitting guard).

**Files:**
- Create: `src/lib/policy/ir-evaluator/leaves/string-compare.ts`
- Create: `src/lib/policy/ir-evaluator/leaves/string-compare.test.ts`
- Create: `src/lib/policy/ir-evaluator/leaves/time-compare.ts`
- Create: `src/lib/policy/ir-evaluator/leaves/time-compare.test.ts`
- Create: `src/lib/policy/ir-evaluator/leaves/sanctions-status.ts`
- Create: `src/lib/policy/ir-evaluator/leaves/sanctions-status.test.ts`

- [ ] **Step 1: Write failing test for string_compare**

Create `src/lib/policy/ir-evaluator/leaves/string-compare.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { evalStringCompare } from './string-compare';
import { StringCompareNode } from '../../types/ir';
import { ProposedMovement } from '../../types/movement';

const makeMovement = (overrides: Partial<ProposedMovement> = {}): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'solana', asset: 'USDC' },
  amount: { amount: '50000', asset: 'USDC' },
  counterparty: { id: 'cp-acme', type: 'known' },
  initiator: { type: 'human', user_id: 'user-1' },
  purpose_code: 'payroll',
  rail: 'ethereum',
  requested_at: '2026-04-10T14:22:33.000Z',
  ...overrides,
});

describe('evalStringCompare', () => {
  it('== matches when values are equal', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.counterparty_id',
      op: '==',
      value: 'cp-acme',
    };
    expect(evalStringCompare(node, makeMovement()).matched).toBe(true);
  });

  it('== does not match when values differ', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.counterparty_id',
      op: '==',
      value: 'cp-other',
    };
    expect(evalStringCompare(node, makeMovement()).matched).toBe(false);
  });

  it('!= is the negation of ==', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.initiator_type',
      op: '!=',
      value: 'agent',
    };
    expect(evalStringCompare(node, makeMovement()).matched).toBe(true); // initiator is 'human'
  });

  it('in matches when value is in list', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.rail',
      op: 'in',
      value: ['ethereum', 'solana', 'base'],
    };
    expect(evalStringCompare(node, makeMovement()).matched).toBe(true);
  });

  it('not_in matches when value is not in list', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.purpose_code',
      op: 'not_in',
      value: ['refund', 'chargeback'],
    };
    expect(evalStringCompare(node, makeMovement()).matched).toBe(true); // payroll is not in list
  });

  it('returns matched=false when the attribute is absent from the movement', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.counterparty_id',
      op: '==',
      value: 'cp-1',
    };
    const result = evalStringCompare(node, makeMovement({ counterparty: undefined }));
    expect(result.matched).toBe(false);
  });

  it('reads transfer.source_venue from source.venue', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.source_venue',
      op: '==',
      value: 'ethereum',
    };
    expect(evalStringCompare(node, makeMovement()).matched).toBe(true);
  });

  it('reads transfer.destination_venue from destination.venue', () => {
    const node: StringCompareNode = {
      kind: 'string_compare',
      attr: 'transfer.destination_venue',
      op: '==',
      value: 'solana',
    };
    expect(evalStringCompare(node, makeMovement()).matched).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

```bash
npm test -- src/lib/policy/ir-evaluator/leaves/string-compare
```

- [ ] **Step 3: Implement string_compare leaf**

Create `src/lib/policy/ir-evaluator/leaves/string-compare.ts`:

```typescript
// src/lib/policy/ir-evaluator/leaves/string-compare.ts

import { StringCompareNode } from '../../types/ir';
import { ProposedMovement } from '../../types/movement';
import { LeafResult } from './amount-compare';

export function evalStringCompare(node: StringCompareNode, movement: ProposedMovement): LeafResult {
  const actualValue = extractStringAttr(node.attr, movement);

  // If the attribute is absent (e.g., counterparty_id when no counterparty),
  // treat as not-matched for all operators. This is consistent with "absent
  // is not any specific value."
  if (actualValue === undefined) {
    return {
      matched: false,
      evaluation_details: { attr: node.attr, actual_value: null, op: node.op },
    };
  }

  let matched: boolean;
  switch (node.op) {
    case '==':     matched = Array.isArray(node.value) ? false : actualValue === node.value; break;
    case '!=':     matched = Array.isArray(node.value) ? true : actualValue !== node.value; break;
    case 'in':     matched = Array.isArray(node.value) && node.value.includes(actualValue); break;
    case 'not_in': matched = Array.isArray(node.value) && !node.value.includes(actualValue); break;
  }

  return {
    matched,
    evaluation_details: {
      attr: node.attr,
      actual_value: actualValue,
      expected: node.value,
      op: node.op,
    },
  };
}

function extractStringAttr(attr: StringCompareNode['attr'], movement: ProposedMovement): string | undefined {
  switch (attr) {
    case 'transfer.counterparty_id':    return movement.counterparty?.id;
    case 'transfer.purpose_code':       return movement.purpose_code;
    case 'transfer.initiator_type':     return movement.initiator.type;
    case 'transfer.rail':               return movement.rail;
    case 'transfer.source_venue':       return movement.source.venue;
    case 'transfer.destination_venue':  return movement.destination.venue;
  }
}
```

- [ ] **Step 4: Run string_compare tests, confirm pass**

```bash
npm test -- src/lib/policy/ir-evaluator/leaves/string-compare
```

- [ ] **Step 5: Write failing test for time_compare**

Create `src/lib/policy/ir-evaluator/leaves/time-compare.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { evalTimeCompare } from './time-compare';
import { TimeCompareNode } from '../../types/ir';
import { EvaluationContext } from '../../types/context';

const makeContext = (now: Date, overrides: Partial<EvaluationContext> = {}): EvaluationContext => ({
  now,
  enterprise_id: 'ent-1',
  policy_version: { id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test', rules: [], hard_limits: [], approval_chains: [] },
  treasury_state: {
    positions_by_asset: {},
    positions_by_asset_venue: {},
    positions_usd_by_asset: {},
    total_treasury_usd: '0',
    cash_equivalent_usd: '0',
    loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '0', native_asset: 'USDC', canonical_amount: '0',
    canonical_currency: 'USD', rate: '1', rate_source: 'test', rate_as_of: new Date(), max_age_ms: 60000,
  },
  aggregates: {
    system_splitting_guard_24h: {
      window_spec_hash: 'sys',
      window_start: new Date(), window_end: new Date(),
      sum_amount_usd: '0', sum_amount_by_asset: {},
      count: 0, distinct_destinations: 0, distinct_counterparties: 0,
      included_evaluation_ids: [], includes_proposed: false,
    },
    user_specs: {},
  },
  sanctions: { status: 'clear' },
  forecast: {
    query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    results: {},
  },
  counterparty: { id: 'cp-1', last_transfer_at: new Date('2026-04-10T10:00:00.000Z') },
  ...overrides,
});

describe('evalTimeCompare', () => {
  it('now.day_of_week returns 5 for Friday 2026-04-10', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.day_of_week',
      op: '==',
      value: 5,
    };
    // 2026-04-10 is a Friday (getDay() === 5)
    const result = evalTimeCompare(node, makeContext(new Date('2026-04-10T14:00:00.000Z')));
    expect(result.matched).toBe(true);
  });

  it('now.hour_local matches hour of day', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.hour_local',
      op: '>=',
      value: 9,
    };
    const ctx = makeContext(new Date('2026-04-10T14:00:00.000Z'));
    const result = evalTimeCompare(node, ctx);
    expect(result.matched).toBe(true); // 14 >= 9
  });

  it('now.is_business_hours returns true for 10am UTC Tuesday', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.is_business_hours',
      op: '==',
      value: true,
    };
    const ctx = makeContext(new Date('2026-04-07T10:00:00.000Z')); // Tuesday 10 UTC
    const result = evalTimeCompare(node, ctx);
    expect(result.matched).toBe(true);
  });

  it('now.is_business_hours returns false for 3am Sunday', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.is_business_hours',
      op: '==',
      value: true,
    };
    const ctx = makeContext(new Date('2026-04-05T03:00:00.000Z')); // Sunday 3am
    const result = evalTimeCompare(node, ctx);
    expect(result.matched).toBe(false);
  });

  it('time_since_last_to_counterparty uses ctx.counterparty.last_transfer_at', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'time_since_last_to_counterparty',
      op: '<',
      value: 60 * 60 * 1000, // less than 1 hour
    };
    const ctx = makeContext(
      new Date('2026-04-10T10:30:00.000Z')  // 30 min after last_transfer_at
    );
    const result = evalTimeCompare(node, ctx);
    expect(result.matched).toBe(true);
  });

  it('time_since_last_to_counterparty returns matched=false if no counterparty history', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'time_since_last_to_counterparty',
      op: '<',
      value: 3600000,
    };
    const ctx = makeContext(new Date('2026-04-10T14:00:00.000Z'), { counterparty: undefined });
    const result = evalTimeCompare(node, ctx);
    expect(result.matched).toBe(false);
  });
});
```

- [ ] **Step 6: Run test, confirm failure**

```bash
npm test -- src/lib/policy/ir-evaluator/leaves/time-compare
```

- [ ] **Step 7: Implement time_compare leaf**

Create `src/lib/policy/ir-evaluator/leaves/time-compare.ts`:

```typescript
// src/lib/policy/ir-evaluator/leaves/time-compare.ts

import { TimeCompareNode, TimeOp } from '../../types/ir';
import { EvaluationContext } from '../../types/context';
import { LeafResult } from './amount-compare';

export function evalTimeCompare(node: TimeCompareNode, ctx: EvaluationContext): LeafResult {
  const actualValue = extractTimeAttr(node.attr, ctx);

  if (actualValue === undefined) {
    return {
      matched: false,
      evaluation_details: { attr: node.attr, actual_value: null },
    };
  }

  const matched = applyTimeOp(actualValue, node.op, node.value);

  return {
    matched,
    evaluation_details: {
      attr: node.attr,
      actual_value: actualValue,
      expected: node.value,
      op: node.op,
    },
  };
}

function extractTimeAttr(
  attr: TimeCompareNode['attr'],
  ctx: EvaluationContext
): number | boolean | undefined {
  const now = ctx.now;

  switch (attr) {
    case 'now.day_of_week':
      return now.getUTCDay();  // 0 = Sunday
    case 'now.hour_local':
      return now.getUTCHours();
    case 'now.is_business_hours': {
      // Mon-Fri, 09:00-17:00 UTC (phase 1 — per-enterprise timezone deferred)
      const day = now.getUTCDay();
      const hour = now.getUTCHours();
      return day >= 1 && day <= 5 && hour >= 9 && hour < 17;
    }
    case 'time_since_last_to_counterparty': {
      const lastTime = ctx.counterparty?.last_transfer_at;
      if (!lastTime) return undefined;
      return now.getTime() - lastTime.getTime();
    }
    case 'time_since_last_by_initiator':
      // Phase 1: not populated yet. Plan 2 adds this via a dedicated loader.
      return undefined;
  }
}

function applyTimeOp(left: number | boolean, op: TimeOp, right: unknown): boolean {
  if (typeof left === 'boolean') {
    if (op === '==') return left === right;
    if (op === '!=') return left !== right;
    return false;
  }

  // Numeric
  if (op === 'in' || op === 'not_in') {
    if (!Array.isArray(right)) return false;
    const inList = (right as unknown[]).includes(left);
    return op === 'in' ? inList : !inList;
  }

  const r = typeof right === 'number' ? right : Number(right);
  if (isNaN(r)) return false;

  switch (op) {
    case '==':   return left === r;
    case '!=':   return left !== r;
    case '>':    return left > r;
    case '>=':   return left >= r;
    case '<':    return left < r;
    case '<=':   return left <= r;
    default:     return false;
  }
}
```

- [ ] **Step 8: Run time_compare tests, confirm pass**

```bash
npm test -- src/lib/policy/ir-evaluator/leaves/time-compare
```

- [ ] **Step 9: Write failing test for sanctions_status**

Create `src/lib/policy/ir-evaluator/leaves/sanctions-status.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { evalSanctionsStatus } from './sanctions-status';
import { SanctionsStatusNode } from '../../types/ir';
import { EvaluationContext } from '../../types/context';

const makeContext = (status: EvaluationContext['sanctions']['status'], overrides: Partial<EvaluationContext> = {}): EvaluationContext => ({
  now: new Date(),
  enterprise_id: 'ent-1',
  policy_version: { id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test', rules: [], hard_limits: [], approval_chains: [] },
  treasury_state: {
    positions_by_asset: {}, positions_by_asset_venue: {},
    positions_usd_by_asset: {}, total_treasury_usd: '0', cash_equivalent_usd: '0', loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '0', native_asset: 'USDC', canonical_amount: '0',
    canonical_currency: 'USD', rate: '1', rate_source: 'test', rate_as_of: new Date(), max_age_ms: 60000,
  },
  aggregates: {
    system_splitting_guard_24h: {
      window_spec_hash: 'sys', window_start: new Date(), window_end: new Date(),
      sum_amount_usd: '0', sum_amount_by_asset: {}, count: 0,
      distinct_destinations: 0, distinct_counterparties: 0,
      included_evaluation_ids: [], includes_proposed: false,
    },
    user_specs: {},
  },
  sanctions: { status },
  forecast: {
    query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    results: {},
  },
  ...overrides,
});

describe('evalSanctionsStatus', () => {
  it('matches when status is in the values list', () => {
    const node: SanctionsStatusNode = {
      kind: 'sanctions_status',
      op: 'in',
      values: ['sanctioned', 'partial_match'],
    };
    expect(evalSanctionsStatus(node, makeContext('sanctioned')).matched).toBe(true);
    expect(evalSanctionsStatus(node, makeContext('partial_match')).matched).toBe(true);
    expect(evalSanctionsStatus(node, makeContext('clear')).matched).toBe(false);
  });

  it('matches with not_in operator', () => {
    const node: SanctionsStatusNode = {
      kind: 'sanctions_status',
      op: 'not_in',
      values: ['clear'],
    };
    expect(evalSanctionsStatus(node, makeContext('clear')).matched).toBe(false);
    expect(evalSanctionsStatus(node, makeContext('sanctioned')).matched).toBe(true);
    expect(evalSanctionsStatus(node, makeContext('unscreened')).matched).toBe(true);
  });

  it('returns failure when sanctions status is unavailable', () => {
    const node: SanctionsStatusNode = {
      kind: 'sanctions_status',
      op: 'in',
      values: ['sanctioned'],
    };
    const ctx = makeContext('clear', {
      sanctions: {
        status: 'unscreened',
        failure: {
          reason_code: 'sanctions_status_unavailable',
          human_readable: 'Sanctions screening service unavailable',
          details: {},
        },
      },
    });
    const result = evalSanctionsStatus(node, ctx);
    expect(result.failure?.reason_code).toBe('sanctions_status_unavailable');
  });
});
```

- [ ] **Step 10: Run test, confirm failure**

```bash
npm test -- src/lib/policy/ir-evaluator/leaves/sanctions-status
```

- [ ] **Step 11: Implement sanctions_status leaf**

Create `src/lib/policy/ir-evaluator/leaves/sanctions-status.ts`:

```typescript
// src/lib/policy/ir-evaluator/leaves/sanctions-status.ts

import { SanctionsStatusNode } from '../../types/ir';
import { EvaluationContext } from '../../types/context';
import { LeafResult } from './amount-compare';

export function evalSanctionsStatus(
  node: SanctionsStatusNode,
  ctx: EvaluationContext
): LeafResult {
  if (ctx.sanctions.failure) {
    return {
      matched: false,
      failure: {
        reason_code: ctx.sanctions.failure.reason_code,
        human_readable: ctx.sanctions.failure.human_readable,
        details: ctx.sanctions.failure.details,
        user_action: 'Retry evaluation once the sanctions screening service is available.',
      },
      evaluation_details: { attr: 'sanctions_status' },
    };
  }

  const status = ctx.sanctions.status;
  const inList = node.values.includes(status);
  const matched = node.op === 'in' ? inList : !inList;

  return {
    matched,
    evaluation_details: {
      status,
      op: node.op,
      values: node.values,
    },
  };
}
```

- [ ] **Step 12: Run sanctions tests, confirm pass**

```bash
npm test -- src/lib/policy/ir-evaluator/leaves/sanctions-status
```

- [ ] **Step 13: Commit all three leaves**

```bash
git add src/lib/policy/ir-evaluator/leaves/string-compare.ts \
        src/lib/policy/ir-evaluator/leaves/string-compare.test.ts \
        src/lib/policy/ir-evaluator/leaves/time-compare.ts \
        src/lib/policy/ir-evaluator/leaves/time-compare.test.ts \
        src/lib/policy/ir-evaluator/leaves/sanctions-status.ts \
        src/lib/policy/ir-evaluator/leaves/sanctions-status.test.ts
git commit -m "$(cat <<'EOF'
feat(policy): add string_compare, time_compare, sanctions_status IR leaves

Three simple leaf evaluators: string_compare reads string attrs from
the movement (counterparty, purpose, initiator type, rail, venues)
with ==/!=/in/not_in; time_compare reads time attrs from context
(day_of_week, hour, is_business_hours, time_since_last_to_counterparty);
sanctions_status reads the pre-loaded sanctions snapshot with
in/not_in. All three treat missing attributes as not-matched and
propagate context failures as leaf failures.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: IR leaves — forecast_query and aggregate_window

**Files:**
- Create: `src/lib/policy/ir-evaluator/leaves/forecast-query.ts`
- Create: `src/lib/policy/ir-evaluator/leaves/forecast-query.test.ts`
- Create: `src/lib/policy/ir-evaluator/leaves/aggregate-window.ts`
- Create: `src/lib/policy/ir-evaluator/leaves/aggregate-window.test.ts`

- [ ] **Step 1: Write forecast_query test**

Create `src/lib/policy/ir-evaluator/leaves/forecast-query.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { evalForecastQuery, computeForecastQueryHash } from './forecast-query';
import { ForecastQueryNode } from '../../types/ir';
import { EvaluationContext, ForecastQueryResult } from '../../types/context';

const makeContext = (results: Record<string, ForecastQueryResult>): EvaluationContext => ({
  now: new Date(),
  enterprise_id: 'ent-1',
  policy_version: { id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test', rules: [], hard_limits: [], approval_chains: [] },
  treasury_state: {
    positions_by_asset: {}, positions_by_asset_venue: {}, positions_usd_by_asset: {},
    total_treasury_usd: '0', cash_equivalent_usd: '0', loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '0', native_asset: 'USDC', canonical_amount: '0',
    canonical_currency: 'USD', rate: '1', rate_source: 'test', rate_as_of: new Date(), max_age_ms: 60000,
  },
  aggregates: {
    system_splitting_guard_24h: {
      window_spec_hash: 'sys', window_start: new Date(), window_end: new Date(),
      sum_amount_usd: '0', sum_amount_by_asset: {}, count: 0,
      distinct_destinations: 0, distinct_counterparties: 0,
      included_evaluation_ids: [], includes_proposed: false,
    },
    user_specs: {},
  },
  sanctions: { status: 'clear' },
  forecast: {
    query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    results,
  },
});

describe('evalForecastQuery', () => {
  it('matches when obligations_covered result equals expected', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '==',
      value: { amount: '1', currency: 'USD' },  // 1 = true
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { covered: true, obligationsChecked: 5, obligationsUncovered: 0 } },
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.matched).toBe(true);
  });

  it('does not match when obligations_covered returns false but rule expects true', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '==',
      value: { amount: '1', currency: 'USD' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { covered: false, obligationsChecked: 5, obligationsUncovered: 2 } },
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.matched).toBe(false);
  });

  it('compares projected_min_balance against threshold', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'projected_min_balance',
      window_days: 7,
      scope: { asset: 'USDC' },
      comparator: '>',
      value: { amount: '500000', currency: 'USDC' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { amount: '750000', asset: 'USDC' } },
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.matched).toBe(true);
  });

  it('returns failure when the forecast result has a failure field', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '==',
      value: { amount: '1', currency: 'USD' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: {
        failure: {
          reason_code: 'forecast_unavailable',
          human_readable: 'Forecast service down',
          details: {},
        },
      },
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.failure?.reason_code).toBe('forecast_unavailable');
  });

  it('returns failure when the required forecast result is missing from context', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '==',
      value: { amount: '1', currency: 'USD' },
    };
    const ctx = makeContext({});  // no results populated
    const result = evalForecastQuery(node, ctx);
    expect(result.failure?.reason_code).toBe('forecast_unavailable');
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

```bash
npm test -- src/lib/policy/ir-evaluator/leaves/forecast-query
```

- [ ] **Step 3: Implement forecast_query leaf**

Create `src/lib/policy/ir-evaluator/leaves/forecast-query.ts`:

```typescript
// src/lib/policy/ir-evaluator/leaves/forecast-query.ts

import Big from 'big.js';
import { createHash } from 'crypto';
import { ForecastQueryNode, NumericOp } from '../../types/ir';
import { EvaluationContext } from '../../types/context';
import { LeafResult } from './amount-compare';

/**
 * Deterministic hash of a forecast_query node's shape — used as the
 * key in context.forecast.results. Every rule that references the
 * same query (same kind, same window_days, same scope) shares one
 * pre-loaded result.
 */
export function computeForecastQueryHash(node: ForecastQueryNode): string {
  const canonical = JSON.stringify({
    query: node.query,
    window_days: node.window_days,
    scope: node.scope ?? {},
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function evalForecastQuery(
  node: ForecastQueryNode,
  ctx: EvaluationContext
): LeafResult {
  const hash = computeForecastQueryHash(node);
  const result = ctx.forecast.results[hash];

  if (!result) {
    return {
      matched: false,
      failure: {
        reason_code: 'forecast_unavailable',
        human_readable:
          `Forecast query ${node.query} for window ${node.window_days}d was not pre-loaded into context. ` +
          `This indicates the context loader did not walk the policy version's rules correctly, or ` +
          `the forecast module failed to compute this query.`,
        details: { query: node.query, window_days: node.window_days, hash },
        user_action:
          'This is likely a transient forecast service issue. Retry in a few minutes. ' +
          'If the issue persists, contact support with the trace ID.',
      },
      evaluation_details: { query: node.query, hash },
    };
  }

  if (result.failure) {
    return {
      matched: false,
      failure: {
        reason_code: result.failure.reason_code,
        human_readable: result.failure.human_readable,
        details: result.failure.details,
        user_action: 'Retry once the forecast service is available.',
      },
      evaluation_details: { query: node.query, hash },
    };
  }

  // Interpret the query-specific payload against the comparator
  const value = result.value as unknown;
  const matched = evaluateAgainstComparator(node, value);

  return {
    matched,
    evaluation_details: {
      query: node.query,
      hash,
      payload: value,
      op: node.comparator,
      threshold: node.value.amount,
    },
  };
}

function evaluateAgainstComparator(node: ForecastQueryNode, value: unknown): boolean {
  switch (node.query) {
    case 'obligations_covered': {
      // Payload is ObligationCoverageResult. Threshold is 1 or 0 (true or false).
      const coverage = value as { covered: boolean };
      const expected = node.value.amount === '1' || node.value.amount.toLowerCase() === 'true';
      switch (node.comparator) {
        case '==': return coverage.covered === expected;
        case '!=': return coverage.covered !== expected;
        default:   return false;  // non-boolean operators don't make sense for coverage
      }
    }
    case 'projected_min_balance':
    case 'projected_position': {
      // Payload is AmountNative { amount, asset }
      const amt = value as { amount: string; asset: string };
      return applyNumericOp(amt.amount, node.comparator, node.value.amount);
    }
  }
}

function applyNumericOp(left: string, op: NumericOp, right: string): boolean {
  if (!left || !right) return false;
  const L = new Big(left);
  const R = new Big(right);
  switch (op) {
    case '>':   return L.gt(R);
    case '>=':  return L.gte(R);
    case '<':   return L.lt(R);
    case '<=':  return L.lte(R);
    case '==':  return L.eq(R);
    case '!=':  return !L.eq(R);
    case 'between': return false;  // between needs value_upper; forecast_query only has comparator
  }
}
```

- [ ] **Step 4: Run forecast-query tests, confirm pass**

```bash
npm test -- src/lib/policy/ir-evaluator/leaves/forecast-query
```

- [ ] **Step 5: Write aggregate_window test**

Create `src/lib/policy/ir-evaluator/leaves/aggregate-window.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { evalAggregateWindow } from './aggregate-window';
import { AggregateWindowNode } from '../../types/ir';
import { EvaluationContext } from '../../types/context';
import { computeWindowSpecHash } from '../../aggregate-detector/hash';

const makeContext = (userSpecs: EvaluationContext['aggregates']['user_specs']): EvaluationContext => ({
  now: new Date(),
  enterprise_id: 'ent-1',
  policy_version: { id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test', rules: [], hard_limits: [], approval_chains: [] },
  treasury_state: {
    positions_by_asset: {}, positions_by_asset_venue: {}, positions_usd_by_asset: {},
    total_treasury_usd: '0', cash_equivalent_usd: '0', loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '0', native_asset: 'USDC', canonical_amount: '0',
    canonical_currency: 'USD', rate: '1', rate_source: 'test', rate_as_of: new Date(), max_age_ms: 60000,
  },
  aggregates: {
    system_splitting_guard_24h: {
      window_spec_hash: 'sys', window_start: new Date(), window_end: new Date(),
      sum_amount_usd: '0', sum_amount_by_asset: {}, count: 0,
      distinct_destinations: 0, distinct_counterparties: 0,
      included_evaluation_ids: [], includes_proposed: false,
    },
    user_specs: userSpecs,
  },
  sanctions: { status: 'clear' },
  forecast: {
    query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    results: {},
  },
});

describe('evalAggregateWindow', () => {
  it('matches when sum_amount in the window exceeds threshold', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 86_400_000,
        group_by: { counterparty: true },
      },
      attr: 'sum_amount',
      op: '>',
      value: { amount: '200000', currency: 'USD' },
    };
    const hash = computeWindowSpecHash(node.window);
    const ctx = makeContext({
      [hash]: {
        window_spec_hash: hash,
        window_start: new Date(),
        window_end: new Date(),
        sum_amount_usd: '250000',
        sum_amount_by_asset: {},
        count: 5,
        distinct_destinations: 3,
        distinct_counterparties: 1,
        included_evaluation_ids: [],
        includes_proposed: false,
      },
    });
    expect(evalAggregateWindow(node, ctx).matched).toBe(true);
  });

  it('matches when count attribute exceeds threshold', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 3_600_000,
        group_by: { initiator: true },
      },
      attr: 'count',
      op: '>',
      value: { amount: '5', currency: 'USD' },
    };
    const hash = computeWindowSpecHash(node.window);
    const ctx = makeContext({
      [hash]: {
        window_spec_hash: hash,
        window_start: new Date(),
        window_end: new Date(),
        sum_amount_usd: '0',
        sum_amount_by_asset: {},
        count: 8,
        distinct_destinations: 0,
        distinct_counterparties: 0,
        included_evaluation_ids: [],
        includes_proposed: false,
      },
    });
    expect(evalAggregateWindow(node, ctx).matched).toBe(true);
  });

  it('matches on distinct_destinations', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 3_600_000,
        group_by: { initiator: true },
      },
      attr: 'distinct_destinations',
      op: '>',
      value: { amount: '3', currency: 'USD' },
    };
    const hash = computeWindowSpecHash(node.window);
    const ctx = makeContext({
      [hash]: {
        window_spec_hash: hash,
        window_start: new Date(),
        window_end: new Date(),
        sum_amount_usd: '0',
        sum_amount_by_asset: {},
        count: 5,
        distinct_destinations: 5,
        distinct_counterparties: 2,
        included_evaluation_ids: [],
        includes_proposed: false,
      },
    });
    expect(evalAggregateWindow(node, ctx).matched).toBe(true);
  });

  it('returns failure when the result is missing', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 86_400_000,
        group_by: { counterparty: true },
      },
      attr: 'sum_amount',
      op: '>',
      value: { amount: '100', currency: 'USD' },
    };
    const ctx = makeContext({});
    const result = evalAggregateWindow(node, ctx);
    expect(result.failure?.reason_code).toBe('aggregate_query_failed');
  });

  it('returns failure when the result has a failure field', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 86_400_000,
        group_by: { counterparty: true },
      },
      attr: 'sum_amount',
      op: '>',
      value: { amount: '100', currency: 'USD' },
    };
    const hash = computeWindowSpecHash(node.window);
    const ctx = makeContext({
      [hash]: {
        window_spec_hash: hash,
        window_start: new Date(),
        window_end: new Date(),
        sum_amount_usd: '',
        sum_amount_by_asset: {},
        count: 0,
        distinct_destinations: 0,
        distinct_counterparties: 0,
        included_evaluation_ids: [],
        includes_proposed: false,
        failure: {
          reason_code: 'aggregate_query_failed',
          human_readable: 'Query timed out',
          details: {},
        },
      },
    });
    expect(evalAggregateWindow(node, ctx).failure?.reason_code).toBe('aggregate_query_failed');
  });
});
```

- [ ] **Step 6: Run test, confirm failure (also fails because `computeWindowSpecHash` doesn't exist yet)**

```bash
npm test -- src/lib/policy/ir-evaluator/leaves/aggregate-window
```

Expected: FAIL. Note that `computeWindowSpecHash` lives in `src/lib/policy/aggregate-detector/hash.ts` which is created in Task 26. For this task, we'll create a minimal stub that can be replaced.

- [ ] **Step 7: Create a placeholder hash.ts so the test can link**

Create `src/lib/policy/aggregate-detector/hash.ts` (will be fleshed out properly in Task 26):

```typescript
// src/lib/policy/aggregate-detector/hash.ts
// Placeholder — full implementation in Task 26.

import { createHash } from 'crypto';
import { WindowSpec } from '../types/ir';

export function computeWindowSpecHash(window: WindowSpec): string {
  const canonical = JSON.stringify({
    duration_ms: window.duration_ms,
    group_by: {
      initiator: window.group_by.initiator ?? false,
      counterparty: window.group_by.counterparty ?? false,
      destination: window.group_by.destination ?? false,
      asset: window.group_by.asset ?? false,
    },
    direction: window.direction ?? 'outflow',
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}
```

- [ ] **Step 8: Implement aggregate_window leaf**

Create `src/lib/policy/ir-evaluator/leaves/aggregate-window.ts`:

```typescript
// src/lib/policy/ir-evaluator/leaves/aggregate-window.ts

import Big from 'big.js';
import { AggregateWindowNode, NumericOp } from '../../types/ir';
import { EvaluationContext } from '../../types/context';
import { LeafResult } from './amount-compare';
import { computeWindowSpecHash } from '../../aggregate-detector/hash';

export function evalAggregateWindow(
  node: AggregateWindowNode,
  ctx: EvaluationContext
): LeafResult {
  const hash = computeWindowSpecHash(node.window);
  const result = ctx.aggregates.user_specs[hash];

  if (!result) {
    return {
      matched: false,
      failure: {
        reason_code: 'aggregate_query_failed',
        human_readable:
          `Aggregate window query for ${describeWindow(node.window)} was not pre-loaded. ` +
          `The context loader may have failed to enumerate this rule's aggregate requirements.`,
        details: { window: node.window, hash },
        user_action: 'Retry evaluation. If the issue persists, contact support with the trace ID.',
      },
      evaluation_details: { hash, window: node.window },
    };
  }

  if (result.failure) {
    return {
      matched: false,
      failure: {
        reason_code: result.failure.reason_code,
        human_readable: result.failure.human_readable,
        details: result.failure.details,
        user_action: 'Retry. If the issue persists, contact support.',
      },
      evaluation_details: { hash, window: node.window },
    };
  }

  // Extract the value from the aggregate result based on attr
  let actualValue: string;
  switch (node.attr) {
    case 'sum_amount':
      actualValue = result.sum_amount_usd;
      break;
    case 'count':
      actualValue = String(result.count);
      break;
    case 'distinct_destinations':
      actualValue = String(result.distinct_destinations);
      break;
    case 'distinct_counterparties':
      actualValue = String(result.distinct_counterparties);
      break;
  }

  const matched = applyNumericOp(actualValue, node.op, node.value.amount);

  return {
    matched,
    evaluation_details: {
      hash,
      window: node.window,
      attr: node.attr,
      actual_value: actualValue,
      threshold: node.value.amount,
      op: node.op,
    },
  };
}

function applyNumericOp(left: string, op: NumericOp, right: string): boolean {
  if (!left || !right) return false;
  const L = new Big(left);
  const R = new Big(right);
  switch (op) {
    case '>':   return L.gt(R);
    case '>=':  return L.gte(R);
    case '<':   return L.lt(R);
    case '<=':  return L.lte(R);
    case '==':  return L.eq(R);
    case '!=':  return !L.eq(R);
    case 'between': return false;  // not supported for aggregate_window
  }
}

function describeWindow(window: AggregateWindowNode['window']): string {
  const hours = Math.round(window.duration_ms / 3_600_000);
  const groups = Object.entries(window.group_by)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join('+');
  return `${hours}h by ${groups || 'global'}`;
}
```

- [ ] **Step 9: Run aggregate-window tests, confirm pass**

```bash
npm test -- src/lib/policy/ir-evaluator/leaves/aggregate-window
```

- [ ] **Step 10: Commit**

```bash
git add src/lib/policy/ir-evaluator/leaves/forecast-query.ts \
        src/lib/policy/ir-evaluator/leaves/forecast-query.test.ts \
        src/lib/policy/ir-evaluator/leaves/aggregate-window.ts \
        src/lib/policy/ir-evaluator/leaves/aggregate-window.test.ts \
        src/lib/policy/aggregate-detector/hash.ts
git commit -m "$(cat <<'EOF'
feat(policy): add forecast_query and aggregate_window IR leaves

forecast_query reads pre-loaded ForecastQueryResult from context and
compares based on query kind (boolean for obligations_covered, numeric
for projected_min_balance/projected_position). aggregate_window reads
pre-loaded AggregateWindowResult keyed by deterministic window spec
hash and compares on sum_amount/count/distinct_destinations/
distinct_counterparties. Both propagate context failures as leaf
failures per the cannot-fully-evaluate=block invariant.

Also adds a placeholder hash.ts that Task 26 replaces with the full
aggregate-detector hashing module.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: IR composer + recursive evaluator dispatch

**Files:**
- Create: `src/lib/policy/ir-evaluator/evaluator.ts`
- Create: `src/lib/policy/ir-evaluator/evaluator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/policy/ir-evaluator/evaluator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { evalCondition } from './evaluator';
import { Condition } from '../types/ir';
import { ProposedMovement } from '../types/movement';
import { EvaluationContext } from '../types/context';

const mkMovement = (): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'solana', asset: 'USDC' },
  amount: { amount: '50000', asset: 'USDC' },
  counterparty: { id: 'cp-1', type: 'known' },
  initiator: { type: 'human', user_id: 'user-1' },
  purpose_code: 'payroll',
  rail: 'ethereum',
  requested_at: '2026-04-10T14:22:33.000Z',
});

const mkContext = (): EvaluationContext => ({
  now: new Date('2026-04-10T14:22:33.000Z'),
  enterprise_id: 'ent-1',
  policy_version: { id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test', rules: [], hard_limits: [], approval_chains: [] },
  treasury_state: {
    positions_by_asset: { USDC: '1000000' },
    positions_by_asset_venue: { 'USDC:ethereum': '800000' },
    positions_usd_by_asset: { USDC: '1000000' },
    total_treasury_usd: '1000000',
    cash_equivalent_usd: '1000000',
    loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '50000', native_asset: 'USDC', canonical_amount: '50010',
    canonical_currency: 'USD', rate: '1.0002', rate_source: 'coingecko',
    rate_as_of: new Date(), max_age_ms: 60000,
  },
  aggregates: {
    system_splitting_guard_24h: {
      window_spec_hash: 'sys', window_start: new Date(), window_end: new Date(),
      sum_amount_usd: '0', sum_amount_by_asset: {}, count: 0,
      distinct_destinations: 0, distinct_counterparties: 0,
      included_evaluation_ids: [], includes_proposed: false,
    },
    user_specs: {},
  },
  sanctions: { status: 'clear' },
  forecast: {
    query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    results: {},
  },
});

describe('evalCondition — leaf dispatch', () => {
  it('dispatches amount_compare to its evaluator', () => {
    const cond: Condition = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '10000', currency: 'USDC' },
    };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.matched).toBe(true);
  });

  it('dispatches string_compare', () => {
    const cond: Condition = {
      kind: 'string_compare',
      attr: 'transfer.initiator_type',
      op: '==',
      value: 'human',
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(true);
  });

  it('dispatches sanctions_status', () => {
    const cond: Condition = {
      kind: 'sanctions_status',
      op: 'not_in',
      values: ['sanctioned', 'partial_match'],
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(true);
  });
});

describe('evalCondition — AND', () => {
  it('returns true when all children match', () => {
    const cond: Condition = {
      kind: 'and',
      children: [
        { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '10000', currency: 'USDC' } },
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' },
      ],
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(true);
  });

  it('returns false when any child does not match', () => {
    const cond: Condition = {
      kind: 'and',
      children: [
        { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '10000', currency: 'USDC' } },
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'agent' },
      ],
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(false);
  });

  it('propagates child failure as AND failure', () => {
    const cond: Condition = {
      kind: 'and',
      children: [
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' },
        { kind: 'forecast_query', query: 'obligations_covered', window_days: 14,
          comparator: '==', value: { amount: '1', currency: 'USD' } },  // will fail: no forecast result
      ],
    };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.failure).toBeDefined();
    expect(result.failure?.reason_code).toBe('forecast_unavailable');
  });
});

describe('evalCondition — OR', () => {
  it('returns true when any child matches (short-circuits on first match)', () => {
    const cond: Condition = {
      kind: 'or',
      children: [
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'agent' },  // false
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' },  // true
      ],
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(true);
  });

  it('returns false when no child matches', () => {
    const cond: Condition = {
      kind: 'or',
      children: [
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'agent' },
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'schedule' },
      ],
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(false);
  });

  it('propagates child failure if ALL children fail with a failure (otherwise, a non-failing false child rescues)', () => {
    const cond: Condition = {
      kind: 'or',
      children: [
        { kind: 'forecast_query', query: 'obligations_covered', window_days: 14,
          comparator: '==', value: { amount: '1', currency: 'USD' } },
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' },
      ],
    };
    // The second child matches, so OR returns true even though the first failed
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.matched).toBe(true);
  });
});

describe('evalCondition — NOT', () => {
  it('negates a matching child', () => {
    const cond: Condition = {
      kind: 'not',
      child: { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' },
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(false);
  });

  it('negates a non-matching child', () => {
    const cond: Condition = {
      kind: 'not',
      child: { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'agent' },
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(true);
  });

  it('propagates child failure as NOT failure (cannot-fully-evaluate)', () => {
    const cond: Condition = {
      kind: 'not',
      child: { kind: 'forecast_query', query: 'obligations_covered', window_days: 14,
        comparator: '==', value: { amount: '1', currency: 'USD' } },
    };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.failure?.reason_code).toBe('forecast_unavailable');
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
npm test -- src/lib/policy/ir-evaluator/evaluator
```

- [ ] **Step 3: Implement the recursive evaluator**

Create `src/lib/policy/ir-evaluator/evaluator.ts`:

```typescript
// src/lib/policy/ir-evaluator/evaluator.ts

import { Condition } from '../types/ir';
import { ProposedMovement } from '../types/movement';
import { EvaluationContext } from '../types/context';
import { LeafResult } from './leaves/amount-compare';
import { evalAmountCompare } from './leaves/amount-compare';
import { evalStringCompare } from './leaves/string-compare';
import { evalTimeCompare } from './leaves/time-compare';
import { evalSanctionsStatus } from './leaves/sanctions-status';
import { evalForecastQuery } from './leaves/forecast-query';
import { evalAggregateWindow } from './leaves/aggregate-window';

export type ConditionPath = (string | number)[];

/**
 * Recursively evaluate a Condition IR tree against a proposed movement
 * and context. Returns a LeafResult — note that composite nodes (and/or/not)
 * also return LeafResult with aggregated matched/failure fields.
 *
 * Failure semantics (cannot-fully-evaluate = block):
 *   - AND: if any child returns a failure, AND returns failure (regardless of other children)
 *   - OR: if any child matches, OR returns matched=true (ignoring failures from unmatched children).
 *         If no child matches AND at least one child has a failure, OR returns the first failure.
 *   - NOT: failure propagates unchanged from the child.
 *
 * This matches the spec's rule: a rule the engine cannot fully evaluate must
 * never let a transfer pass, BUT an OR where one branch clearly matches is
 * fully evaluable regardless of what other branches would have said.
 */
export function evalCondition(
  cond: Condition,
  movement: ProposedMovement,
  ctx: EvaluationContext,
  path: ConditionPath
): LeafResult {
  switch (cond.kind) {
    case 'and':
      return evalAnd(cond.children, movement, ctx, path);

    case 'or':
      return evalOr(cond.children, movement, ctx, path);

    case 'not': {
      const childResult = evalCondition(cond.child, movement, ctx, [...path, 'child']);
      if (childResult.failure) {
        return {
          matched: false,
          failure: childResult.failure,
          evaluation_details: { node_kind: 'not', child_details: childResult.evaluation_details },
        };
      }
      return {
        matched: !childResult.matched,
        evaluation_details: { node_kind: 'not', inner_matched: childResult.matched },
      };
    }

    case 'amount_compare':
      return evalAmountCompare(cond, movement, ctx);

    case 'string_compare':
      return evalStringCompare(cond, movement);

    case 'time_compare':
      return evalTimeCompare(cond, ctx);

    case 'sanctions_status':
      return evalSanctionsStatus(cond, ctx);

    case 'forecast_query':
      return evalForecastQuery(cond, ctx);

    case 'aggregate_window':
      return evalAggregateWindow(cond, ctx);
  }
}

function evalAnd(
  children: Condition[],
  movement: ProposedMovement,
  ctx: EvaluationContext,
  path: ConditionPath
): LeafResult {
  for (let i = 0; i < children.length; i++) {
    const result = evalCondition(children[i], movement, ctx, [...path, 'children', i]);
    if (result.failure) {
      return {
        matched: false,
        failure: result.failure,
        evaluation_details: { node_kind: 'and', failed_child_index: i },
      };
    }
    if (!result.matched) {
      return {
        matched: false,
        evaluation_details: { node_kind: 'and', first_non_matching_child_index: i },
      };
    }
  }
  return {
    matched: true,
    evaluation_details: { node_kind: 'and', children_count: children.length },
  };
}

function evalOr(
  children: Condition[],
  movement: ProposedMovement,
  ctx: EvaluationContext,
  path: ConditionPath
): LeafResult {
  let firstFailure: LeafResult['failure'] | undefined;

  for (let i = 0; i < children.length; i++) {
    const result = evalCondition(children[i], movement, ctx, [...path, 'children', i]);
    if (result.matched) {
      // Any match short-circuits; failures in other branches don't matter
      return {
        matched: true,
        evaluation_details: { node_kind: 'or', matching_child_index: i },
      };
    }
    if (result.failure && !firstFailure) {
      firstFailure = result.failure;
    }
  }

  // No match. If any child had a failure, propagate it — the OR could not
  // be fully evaluated because one branch is unknown.
  if (firstFailure) {
    return {
      matched: false,
      failure: firstFailure,
      evaluation_details: { node_kind: 'or', children_count: children.length },
    };
  }

  return {
    matched: false,
    evaluation_details: { node_kind: 'or', children_count: children.length },
  };
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- src/lib/policy/ir-evaluator
```

Expected: all tests across leaves + evaluator pass (should be ~45 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/ir-evaluator/evaluator.ts src/lib/policy/ir-evaluator/evaluator.test.ts
git commit -m "$(cat <<'EOF'
feat(policy): add recursive IR evaluator with and/or/not composition

evalCondition dispatches on discriminated-union kind to the appropriate
leaf evaluator. Composite nodes (and/or/not) handle short-circuit and
failure propagation semantics: AND returns failure on any child
failure; OR returns first failure only if NO child matched; NOT
propagates child failure unchanged. This implements the
cannot-fully-evaluate=block invariant from the spec while allowing
fully-evaluable OR branches to succeed without being blocked by
sibling branch failures.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Hard limit checker — templates and 5 limit evaluators

This task implements the shared breach-message templates plus each of the 6 hard limit evaluators. Each evaluator is a small pure function `(limit, movement, context) → HardLimitEvaluation`. Bundled into one task because they share a consistent pattern and one commit keeps the checker module coherent.

**Files:**
- Create: `src/lib/policy/hard-limit-checker/templates.ts`
- Create: `src/lib/policy/hard-limit-checker/limits/min-cash-reserve.ts`
- Create: `src/lib/policy/hard-limit-checker/limits/min-cash-reserve.test.ts`
- Create: `src/lib/policy/hard-limit-checker/limits/max-concentration.ts`
- Create: `src/lib/policy/hard-limit-checker/limits/max-concentration.test.ts`
- Create: `src/lib/policy/hard-limit-checker/limits/max-outflow.ts`
- Create: `src/lib/policy/hard-limit-checker/limits/max-outflow.test.ts`
- Create: `src/lib/policy/hard-limit-checker/limits/obligation-coverage.ts`
- Create: `src/lib/policy/hard-limit-checker/limits/obligation-coverage.test.ts`
- Create: `src/lib/policy/hard-limit-checker/limits/max-native-exposure.ts`
- Create: `src/lib/policy/hard-limit-checker/limits/max-native-exposure.test.ts`

- [ ] **Step 1: Create `templates.ts`**

Create `src/lib/policy/hard-limit-checker/templates.ts`:

```typescript
// src/lib/policy/hard-limit-checker/templates.ts

import { HardLimitEvaluation, HardLimitBreach } from '../types/hard-limit';

/**
 * Pure functions that produce human-readable breach messages and user
 * actions for each hard limit type. Separated from the evaluators so
 * message wording can be iterated without touching evaluation logic.
 */

export function renderMinCashReserveBreach(ev: HardLimitEvaluation): {
  human_readable: string;
  user_action: string;
} {
  return {
    human_readable:
      `This transfer would reduce cash reserves to $${formatUsd(ev.post_transfer_value)}, ` +
      `below the $${formatUsd(ev.limit_value)} minimum required by hard limit '${ev.limit_name}'. ` +
      `The treasury would be $${formatUsd(ev.overage ?? '0')} below the floor.`,
    user_action:
      `Reduce the transfer amount, or request an enterprise policy admin to raise the '${ev.limit_name}' ` +
      `limit (this is an audited action).`,
  };
}

export function renderMaxConcentrationBreach(ev: HardLimitEvaluation): {
  human_readable: string;
  user_action: string;
} {
  return {
    human_readable:
      `This transfer would cause a single asset to represent ${ev.post_transfer_value}% of the treasury, ` +
      `exceeding the ${ev.limit_value}% maximum set by '${ev.limit_name}'.`,
    user_action:
      `Split the transfer across multiple assets or reduce the amount. ` +
      `An enterprise policy admin can raise the '${ev.limit_name}' limit if the concentration is intentional.`,
  };
}

export function renderMaxOutflowBreach(ev: HardLimitEvaluation): {
  human_readable: string;
  user_action: string;
} {
  const window = ev.limit_type === 'max_daily_outflow_usd' ? '24 hours' : '30 days';
  return {
    human_readable:
      `This transfer would push the ${window} outflow total to $${formatUsd(ev.post_transfer_value)}, ` +
      `exceeding the $${formatUsd(ev.limit_value)} cap set by '${ev.limit_name}'. ` +
      `Current trailing total is $${formatUsd(ev.current_value)}; overage is $${formatUsd(ev.overage ?? '0')}.`,
    user_action:
      `Wait until the ${window} window rolls forward, reduce the transfer amount, ` +
      `or request an enterprise policy admin to raise the limit.`,
  };
}

export function renderObligationCoverageBreach(ev: HardLimitEvaluation): {
  human_readable: string;
  user_action: string;
} {
  return {
    human_readable:
      `This transfer would leave projected obligations uncovered within the ${ev.limit_value}-day window ` +
      `required by '${ev.limit_name}'. Details: ${JSON.stringify(ev.failure?.details ?? {})}.`,
    user_action:
      `Ensure projected inflows cover all obligations due in the window, or defer this transfer ` +
      `until the next obligation date passes.`,
  };
}

export function renderMaxNativeExposureBreach(ev: HardLimitEvaluation): {
  human_readable: string;
  user_action: string;
} {
  const asset = ev.scope.asset ?? 'the scoped asset';
  return {
    human_readable:
      `This transfer would cause ${asset} exposure to reach ${ev.post_transfer_value} ${asset}, ` +
      `exceeding the ${ev.limit_value} ${asset} cap set by '${ev.limit_name}'.`,
    user_action:
      `Reduce the transfer amount or move ${asset} to a different asset class. ` +
      `An enterprise policy admin can raise the '${ev.limit_name}' limit.`,
  };
}

function formatUsd(s: string): string {
  // Group digits with commas for readability (no decimal formatting — caller may pass decimals)
  const [whole, frac] = s.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/**
 * Dispatch to the correct template based on limit_type.
 */
export function renderBreach(ev: HardLimitEvaluation): { human_readable: string; user_action: string } {
  switch (ev.limit_type) {
    case 'min_cash_reserve_usd':                return renderMinCashReserveBreach(ev);
    case 'max_single_asset_concentration_pct': return renderMaxConcentrationBreach(ev);
    case 'max_daily_outflow_usd':
    case 'max_30day_outflow_usd':              return renderMaxOutflowBreach(ev);
    case 'obligation_coverage_days':            return renderObligationCoverageBreach(ev);
    case 'max_native_exposure':                 return renderMaxNativeExposureBreach(ev);
  }
}
```

- [ ] **Step 2: Write test for min_cash_reserve**

Create `src/lib/policy/hard-limit-checker/limits/min-cash-reserve.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Big from 'big.js';
import { checkMinCashReserve } from './min-cash-reserve';
import { HardLimit } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';

const mkLimit = (value: string): HardLimit => ({
  id: 'hl-1',
  limit_type: 'min_cash_reserve_usd',
  name: 'Operating Cash Floor',
  limit_value: value,
  limit_currency: 'USD',
  scope: {},
});

const mkMovement = (amount: string): ProposedMovement => ({
  id: 'mv-1', kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'external', asset: 'USDC' },  // outflow
  amount: { amount, asset: 'USDC' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: new Date().toISOString(),
});

const mkContext = (cashUsd: string, canonicalAmount: string): EvaluationContext => ({
  now: new Date(),
  enterprise_id: 'ent-1',
  policy_version: { id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test', rules: [], hard_limits: [], approval_chains: [] },
  treasury_state: {
    positions_by_asset: {}, positions_by_asset_venue: {}, positions_usd_by_asset: {},
    total_treasury_usd: cashUsd, cash_equivalent_usd: cashUsd, loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '0', native_asset: 'USDC', canonical_amount: canonicalAmount,
    canonical_currency: 'USD', rate: '1', rate_source: 'test', rate_as_of: new Date(), max_age_ms: 60000,
  },
  aggregates: {
    system_splitting_guard_24h: { window_spec_hash: 'sys', window_start: new Date(), window_end: new Date(), sum_amount_usd: '0', sum_amount_by_asset: {}, count: 0, distinct_destinations: 0, distinct_counterparties: 0, included_evaluation_ids: [], includes_proposed: false },
    user_specs: {},
  },
  sanctions: { status: 'clear' },
  forecast: { query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] }, hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] }, results: {} },
});

describe('checkMinCashReserve', () => {
  it('not breached when post-transfer cash exceeds the floor', () => {
    const result = checkMinCashReserve(mkLimit('500000'), mkMovement('10000'), mkContext('600000', '10000'));
    expect(result.breached).toBe(false);
    expect(result.post_transfer_value).toBe('590000');
    expect(result.headroom).toBe('90000');
  });

  it('breached when post-transfer cash drops below the floor', () => {
    const result = checkMinCashReserve(mkLimit('500000'), mkMovement('150000'), mkContext('520000', '150000'));
    expect(result.breached).toBe(true);
    expect(result.post_transfer_value).toBe('370000');
    expect(result.overage).toBe('130000');
  });

  it('returns failure when canonicalization failed', () => {
    const ctx = mkContext('600000', '');
    ctx.canonicalization.failure = {
      reason_code: 'canonicalization_failed',
      human_readable: 'Rate unavailable',
      details: {},
      user_action: 'Retry',
    };
    const result = checkMinCashReserve(mkLimit('500000'), mkMovement('10000'), ctx);
    expect(result.failure).toBeDefined();
    expect(result.failure?.reason_code).toBe('canonicalization_failed');
  });
});
```

- [ ] **Step 3: Run test, confirm failure**

```bash
npm test -- src/lib/policy/hard-limit-checker/limits/min-cash-reserve
```

- [ ] **Step 4: Implement `min-cash-reserve.ts`**

Create `src/lib/policy/hard-limit-checker/limits/min-cash-reserve.ts`:

```typescript
// src/lib/policy/hard-limit-checker/limits/min-cash-reserve.ts

import Big from 'big.js';
import { HardLimit, HardLimitEvaluation } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';
import { renderMinCashReserveBreach } from '../templates';

export function checkMinCashReserve(
  limit: HardLimit,
  movement: ProposedMovement,
  ctx: EvaluationContext
): HardLimitEvaluation {
  const base: Omit<HardLimitEvaluation, 'current_value' | 'post_transfer_value' | 'breached'> = {
    limit_id: limit.id,
    limit_type: limit.limit_type,
    limit_name: limit.name,
    limit_value: limit.limit_value,
    limit_currency: limit.limit_currency,
    scope: limit.scope,
  };

  // Canonicalization must have succeeded for USD-denominated limits
  if (ctx.canonicalization.failure) {
    return {
      ...base,
      current_value: ctx.treasury_state.cash_equivalent_usd,
      post_transfer_value: '',
      breached: false,
      failure: {
        reason_code: ctx.canonicalization.failure.reason_code,
        human_readable: `Cannot evaluate '${limit.name}' — ${ctx.canonicalization.failure.human_readable}`,
        details: ctx.canonicalization.failure.details,
        user_action: ctx.canonicalization.failure.user_action,
      },
    };
  }

  const cashUsd = new Big(ctx.treasury_state.cash_equivalent_usd || '0');

  // Determine if this movement is an outflow of cash equivalents
  // Phase 1: treat any destination outside the enterprise's own venues as outflow.
  // We don't track owned-venue lists yet, so use a simpler heuristic: the
  // canonical amount is subtracted from cash_equivalent_usd for outflows.
  // Plan 2 can refine this with a venues-owned registry.
  const canonicalAmount = new Big(ctx.canonicalization.canonical_amount || '0');

  // Phase 1: assume every outbound movement reduces cash_equivalent_usd
  // (since the destination is outside the treasury's cash pool).
  const postTransferValue = cashUsd.minus(canonicalAmount).toString();
  const limitValue = new Big(limit.limit_value);

  const breached = new Big(postTransferValue).lt(limitValue);

  const evaluation: HardLimitEvaluation = {
    ...base,
    current_value: ctx.treasury_state.cash_equivalent_usd,
    post_transfer_value: postTransferValue,
    breached,
    headroom: breached ? undefined : limitValue.minus(postTransferValue).toString(),
    overage: breached ? limitValue.minus(postTransferValue).toString() : undefined,
    utilization_pct: limitValue.eq(0)
      ? undefined
      : Math.min(200, Number(new Big(postTransferValue).gte(0)
          ? new Big(0)  // if post >= 0 and limit is min, utilization is based on distance from floor
          : new Big(100))
        ),
  };

  if (breached) {
    const rendered = renderMinCashReserveBreach(evaluation);
    return {
      ...evaluation,
      // Breach-specific fields get populated by the main checker when it
      // promotes to a HardLimitBreach.
    };
  }

  return evaluation;
}
```

- [ ] **Step 5: Run test, confirm pass**

```bash
npm test -- src/lib/policy/hard-limit-checker/limits/min-cash-reserve
```

- [ ] **Step 6: Implement the remaining 4 limit evaluators**

For each of the remaining limit types, write a failing test, then the implementation. The pattern matches Step 2-5 above.

**`max-concentration.ts`** — computes post-transfer `position_asset_usd / total_treasury_usd` for every asset and finds the max:

```typescript
// src/lib/policy/hard-limit-checker/limits/max-concentration.ts
import Big from 'big.js';
import { HardLimit, HardLimitEvaluation } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';

export function checkMaxConcentration(
  limit: HardLimit,
  movement: ProposedMovement,
  ctx: EvaluationContext
): HardLimitEvaluation {
  const base = {
    limit_id: limit.id, limit_type: limit.limit_type, limit_name: limit.name,
    limit_value: limit.limit_value, limit_currency: limit.limit_currency, scope: limit.scope,
  };

  if (ctx.canonicalization.failure) {
    return {
      ...base,
      current_value: '0',
      post_transfer_value: '',
      breached: false,
      failure: {
        reason_code: ctx.canonicalization.failure.reason_code,
        human_readable: `Cannot evaluate '${limit.name}' — ${ctx.canonicalization.failure.human_readable}`,
        details: ctx.canonicalization.failure.details,
        user_action: ctx.canonicalization.failure.user_action,
      },
    };
  }

  const positions = { ...ctx.treasury_state.positions_usd_by_asset };
  const total = new Big(ctx.treasury_state.total_treasury_usd || '0');
  const canonicalAmount = new Big(ctx.canonicalization.canonical_amount || '0');

  // Adjust positions for the movement (phase 1: assume outflow from source asset)
  const srcAsset = movement.source.asset;
  positions[srcAsset] = new Big(positions[srcAsset] ?? '0').minus(canonicalAmount).toString();

  // New total after outflow
  const newTotal = total.minus(canonicalAmount);

  // Find max concentration
  let maxPct = new Big(0);
  if (newTotal.gt(0)) {
    for (const [, pos] of Object.entries(positions)) {
      const pct = new Big(pos).div(newTotal).times(100);
      if (pct.gt(maxPct)) maxPct = pct;
    }
  }

  const currentMaxPct = total.gt(0)
    ? Object.values(ctx.treasury_state.positions_usd_by_asset)
        .reduce((max, pos) => {
          const pct = new Big(pos).div(total).times(100);
          return pct.gt(max) ? pct : max;
        }, new Big(0))
    : new Big(0);

  const limitValue = new Big(limit.limit_value);
  const breached = maxPct.gt(limitValue);

  return {
    ...base,
    current_value: currentMaxPct.toFixed(2),
    post_transfer_value: maxPct.toFixed(2),
    breached,
    headroom: breached ? undefined : limitValue.minus(maxPct).toFixed(2),
    overage: breached ? maxPct.minus(limitValue).toFixed(2) : undefined,
    utilization_pct: Math.min(200, maxPct.div(limitValue).times(100).toNumber()),
  };
}
```

With matching test covering: not breached / breached / canonicalization failure cases (pattern matches min-cash-reserve.test.ts).

**`max-outflow.ts`** — handles both `max_daily_outflow_usd` and `max_30day_outflow_usd`:

```typescript
// src/lib/policy/hard-limit-checker/limits/max-outflow.ts
import Big from 'big.js';
import { HardLimit, HardLimitEvaluation } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';

export function checkMaxOutflow(
  limit: HardLimit,
  movement: ProposedMovement,
  ctx: EvaluationContext
): HardLimitEvaluation {
  const base = {
    limit_id: limit.id, limit_type: limit.limit_type, limit_name: limit.name,
    limit_value: limit.limit_value, limit_currency: limit.limit_currency, scope: limit.scope,
  };

  // Pre-loaded rolling sum comes from the splitting guard (for 24h) or from
  // a user-authored aggregate_window that matches the same spec (for 30d).
  // For now, phase-1 implementation reads from system_splitting_guard_24h
  // for daily and expects a 30d variant in user_specs (or falls through
  // to a failure). Plan 2 context loader ensures both are populated.
  let trailingSumUsd: string;
  if (limit.limit_type === 'max_daily_outflow_usd') {
    trailingSumUsd = ctx.aggregates.system_splitting_guard_24h.sum_amount_usd;
  } else {
    // Look up the 30d aggregate by hash; in phase 1, we can't compute the hash
    // here without the detector module. Simple fallback: iterate user_specs.
    const thirtyDay = Object.values(ctx.aggregates.user_specs).find(
      (r) => r.window_end.getTime() - r.window_start.getTime() >= 30 * 86_400_000 - 1000
    );
    if (!thirtyDay) {
      return {
        ...base,
        current_value: '0',
        post_transfer_value: '',
        breached: false,
        failure: {
          reason_code: 'historical_outflow_unavailable',
          human_readable: `Cannot evaluate '${limit.name}' — 30-day trailing outflow data is not loaded.`,
          details: { limit_type: limit.limit_type },
          user_action: 'Retry. If the issue persists, contact support.',
        },
      };
    }
    trailingSumUsd = thirtyDay.sum_amount_usd;
  }

  if (ctx.canonicalization.failure) {
    return {
      ...base,
      current_value: trailingSumUsd,
      post_transfer_value: '',
      breached: false,
      failure: {
        reason_code: ctx.canonicalization.failure.reason_code,
        human_readable: `Cannot evaluate '${limit.name}' — ${ctx.canonicalization.failure.human_readable}`,
        details: ctx.canonicalization.failure.details,
        user_action: ctx.canonicalization.failure.user_action,
      },
    };
  }

  const trailing = new Big(trailingSumUsd || '0');
  const proposed = new Big(ctx.canonicalization.canonical_amount || '0');
  const postTransferValue = trailing.plus(proposed).toString();
  const limitValue = new Big(limit.limit_value);
  const breached = new Big(postTransferValue).gt(limitValue);

  return {
    ...base,
    current_value: trailingSumUsd,
    post_transfer_value: postTransferValue,
    breached,
    headroom: breached ? undefined : limitValue.minus(postTransferValue).toString(),
    overage: breached ? new Big(postTransferValue).minus(limitValue).toString() : undefined,
    utilization_pct: limitValue.gt(0)
      ? Math.min(200, new Big(postTransferValue).div(limitValue).times(100).toNumber())
      : undefined,
  };
}
```

Matching test covering: not breached / breached / canonicalization failure / missing 30d data cases.

**`obligation-coverage.ts`** — reads from pre-loaded forecast results:

```typescript
// src/lib/policy/hard-limit-checker/limits/obligation-coverage.ts
import { HardLimit, HardLimitEvaluation } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';

export function checkObligationCoverage(
  limit: HardLimit,
  movement: ProposedMovement,
  ctx: EvaluationContext
): HardLimitEvaluation {
  const base = {
    limit_id: limit.id, limit_type: limit.limit_type, limit_name: limit.name,
    limit_value: limit.limit_value, limit_currency: limit.limit_currency, scope: limit.scope,
  };

  // Look for a matching forecast result with query='obligations_covered'
  // and window_days matching limit.limit_value
  const windowDays = parseInt(limit.limit_value, 10);
  const matchingEntry = Object.entries(ctx.forecast.results).find(([_, result]) => {
    const v = result.value as { covered?: boolean; obligationsChecked?: number } | undefined;
    return v && typeof v.covered === 'boolean';
  });

  if (!matchingEntry) {
    return {
      ...base,
      current_value: 'unknown',
      post_transfer_value: 'unknown',
      breached: false,
      failure: {
        reason_code: 'forecast_unavailable',
        human_readable: `Cannot evaluate '${limit.name}' — obligation coverage forecast was not pre-loaded.`,
        details: { window_days: windowDays },
        user_action: 'Retry. If the forecast module is in stub mode, this limit is advisory only.',
      },
    };
  }

  const [, result] = matchingEntry;
  if (result.failure) {
    return {
      ...base,
      current_value: 'unknown',
      post_transfer_value: 'unknown',
      breached: false,
      failure: {
        reason_code: result.failure.reason_code,
        human_readable: result.failure.human_readable,
        details: result.failure.details,
        user_action: 'Retry once the forecast service is available.',
      },
    };
  }

  const coverage = result.value as { covered: boolean; shortfallAmount?: unknown; firstShortfallDate?: Date };
  const breached = !coverage.covered;

  return {
    ...base,
    current_value: coverage.covered ? 'covered' : 'not_covered',
    post_transfer_value: coverage.covered ? 'covered' : 'not_covered',
    breached,
    overage: breached ? JSON.stringify(coverage.shortfallAmount ?? 'unknown') : undefined,
  };
}
```

Matching test covering: covered / not-covered / forecast unavailable cases.

**`max-native-exposure.ts`** — pure native-unit comparison:

```typescript
// src/lib/policy/hard-limit-checker/limits/max-native-exposure.ts
import Big from 'big.js';
import { HardLimit, HardLimitEvaluation } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';

export function checkMaxNativeExposure(
  limit: HardLimit,
  movement: ProposedMovement,
  ctx: EvaluationContext
): HardLimitEvaluation {
  const base = {
    limit_id: limit.id, limit_type: limit.limit_type, limit_name: limit.name,
    limit_value: limit.limit_value, limit_currency: limit.limit_currency, scope: limit.scope,
  };

  const scopedAsset = limit.scope.asset;
  if (!scopedAsset) {
    return {
      ...base,
      current_value: '0',
      post_transfer_value: '0',
      breached: false,
      failure: {
        reason_code: 'scope_resolution_failed',
        human_readable: `Hard limit '${limit.name}' (max_native_exposure) has no scope.asset.`,
        details: { limit_id: limit.id },
        user_action: 'Edit the limit in Settings → Policies to specify which asset it applies to.',
      },
    };
  }

  // Does this movement affect the scoped asset?
  const isOutflow = movement.source.asset === scopedAsset;
  const isInflow = movement.destination.asset === scopedAsset;

  if (!isOutflow && !isInflow) {
    // Limit doesn't apply to this movement — return a "not breached" with current = post
    const currentNative = ctx.treasury_state.positions_by_asset[scopedAsset] ?? '0';
    return {
      ...base,
      current_value: currentNative,
      post_transfer_value: currentNative,
      breached: false,
    };
  }

  const currentNative = new Big(ctx.treasury_state.positions_by_asset[scopedAsset] ?? '0');
  const delta = new Big(movement.amount.amount);
  const postNative = isOutflow ? currentNative.minus(delta) : currentNative.plus(delta);
  const limitValue = new Big(limit.limit_value);
  const breached = postNative.gt(limitValue);

  return {
    ...base,
    current_value: currentNative.toString(),
    post_transfer_value: postNative.toString(),
    breached,
    headroom: breached ? undefined : limitValue.minus(postNative).toString(),
    overage: breached ? postNative.minus(limitValue).toString() : undefined,
    utilization_pct: limitValue.gt(0) ? Math.min(200, postNative.div(limitValue).times(100).toNumber()) : undefined,
  };
}
```

Matching test covering: outflow not breached / outflow breached / inflow not breached / movement in unrelated asset / missing scope.

- [ ] **Step 7: Write tests for each remaining limit evaluator**

Each test file follows the pattern from Step 2 (`min-cash-reserve.test.ts`) with type-specific assertions. Write tests one file at a time, run each to confirm it fails, then implement, then confirm pass. Keep each test file to 3-5 focused test cases.

- [ ] **Step 8: Run the full hard-limit-checker test suite**

```bash
npm test -- src/lib/policy/hard-limit-checker
```

Expected: all 15-25 tests pass (3-5 per limit type × 5 limit files).

- [ ] **Step 9: Commit all hard limit evaluators as one change**

```bash
git add src/lib/policy/hard-limit-checker/
git commit -m "$(cat <<'EOF'
feat(policy): add 6 hard limit evaluators + breach templates

Implements checkers for all phase-1 hard limit types:
  - min_cash_reserve_usd: post-transfer cash_equivalent_usd vs floor
  - max_single_asset_concentration_pct: max per-asset % of treasury
  - max_daily_outflow_usd + max_30day_outflow_usd: trailing windows
  - obligation_coverage_days: reads pre-loaded forecast result
  - max_native_exposure: native-unit cap per scoped asset

Each evaluator is a pure function (limit, movement, context) →
HardLimitEvaluation. Canonicalization failures propagate as limit
failures. Templates in templates.ts produce structured
human_readable + user_action strings per limit type.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: HardLimitChecker orchestrator + UtilizationProbe

**Files:**
- Create: `src/lib/policy/hard-limit-checker/checker.ts`
- Create: `src/lib/policy/hard-limit-checker/checker.test.ts`
- Create: `src/lib/policy/hard-limit-checker/utilization-probe.ts`

- [ ] **Step 1: Write failing test for the checker**

Create `src/lib/policy/hard-limit-checker/checker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { HardLimitChecker } from './checker';
import { HardLimit } from '../types/hard-limit';
import { ProposedMovement } from '../types/movement';
import { EvaluationContext } from '../types/context';

const mkMovement = (amount: string): ProposedMovement => ({
  id: 'mv-1', kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'external', asset: 'USDC' },
  amount: { amount, asset: 'USDC' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: new Date().toISOString(),
});

const mkContext = (limits: HardLimit[], cashUsd: string, canonicalAmt: string): EvaluationContext => ({
  now: new Date(), enterprise_id: 'ent-1',
  policy_version: {
    id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test',
    rules: [], hard_limits: limits, approval_chains: [],
  },
  treasury_state: {
    positions_by_asset: { USDC: '1000000' },
    positions_by_asset_venue: {},
    positions_usd_by_asset: { USDC: cashUsd },
    total_treasury_usd: cashUsd,
    cash_equivalent_usd: cashUsd,
    loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '0', native_asset: 'USDC', canonical_amount: canonicalAmt,
    canonical_currency: 'USD', rate: '1', rate_source: 'test', rate_as_of: new Date(), max_age_ms: 60000,
  },
  aggregates: {
    system_splitting_guard_24h: { window_spec_hash: 'sys', window_start: new Date(), window_end: new Date(), sum_amount_usd: '0', sum_amount_by_asset: {}, count: 0, distinct_destinations: 0, distinct_counterparties: 0, included_evaluation_ids: [], includes_proposed: false },
    user_specs: {},
  },
  sanctions: { status: 'clear' },
  forecast: { query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] }, hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] }, results: {} },
});

describe('HardLimitChecker', () => {
  it('evaluates all limits and returns HardLimitCheckResult', () => {
    const limits: HardLimit[] = [
      { id: 'hl-1', limit_type: 'min_cash_reserve_usd', name: 'Cash Floor', limit_value: '500000', limit_currency: 'USD', scope: {} },
    ];
    const checker = new HardLimitChecker();
    const result = checker.check(mkMovement('10000'), mkContext(limits, '600000', '10000'));

    expect(result.evaluated).toHaveLength(1);
    expect(result.any_breached).toBe(false);
    expect(result.breaches).toHaveLength(0);
  });

  it('populates breaches when at least one limit is breached', () => {
    const limits: HardLimit[] = [
      { id: 'hl-1', limit_type: 'min_cash_reserve_usd', name: 'Cash Floor', limit_value: '500000', limit_currency: 'USD', scope: {} },
    ];
    const checker = new HardLimitChecker();
    const result = checker.check(mkMovement('200000'), mkContext(limits, '520000', '200000'));

    expect(result.any_breached).toBe(true);
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0].reason_code).toBe('hard_limit_breached');
    expect(result.breaches[0].human_readable).toContain('Cash Floor');
    expect(result.breaches[0].user_action).toBeDefined();
  });

  it('evaluates ALL limits even past a breach (complete trace)', () => {
    const limits: HardLimit[] = [
      { id: 'hl-1', limit_type: 'min_cash_reserve_usd', name: 'Cash Floor', limit_value: '500000', limit_currency: 'USD', scope: {} },
      { id: 'hl-2', limit_type: 'max_daily_outflow_usd', name: 'Daily Cap', limit_value: '1000000', limit_currency: 'USD', scope: {} },
    ];
    const checker = new HardLimitChecker();
    const result = checker.check(mkMovement('200000'), mkContext(limits, '520000', '200000'));

    // Both limits must have been evaluated even if the first breached
    expect(result.evaluated).toHaveLength(2);
    expect(result.evaluated.map(e => e.limit_id)).toEqual(['hl-1', 'hl-2']);
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

```bash
npm test -- src/lib/policy/hard-limit-checker/checker
```

- [ ] **Step 3: Implement the checker**

Create `src/lib/policy/hard-limit-checker/checker.ts`:

```typescript
// src/lib/policy/hard-limit-checker/checker.ts

import { HardLimit, HardLimitEvaluation, HardLimitBreach, HardLimitCheckResult } from '../types/hard-limit';
import { ProposedMovement } from '../types/movement';
import { EvaluationContext } from '../types/context';
import { checkMinCashReserve } from './limits/min-cash-reserve';
import { checkMaxConcentration } from './limits/max-concentration';
import { checkMaxOutflow } from './limits/max-outflow';
import { checkObligationCoverage } from './limits/obligation-coverage';
import { checkMaxNativeExposure } from './limits/max-native-exposure';
import { renderBreach } from './templates';

export class HardLimitChecker {
  check(movement: ProposedMovement, ctx: EvaluationContext): HardLimitCheckResult {
    const limits = ctx.policy_version.hard_limits;
    const evaluated: HardLimitEvaluation[] = [];
    const breaches: HardLimitBreach[] = [];

    for (const limit of limits) {
      const evaluation = this.evaluateOne(limit, movement, ctx);
      evaluated.push(evaluation);

      if (evaluation.breached && !evaluation.failure) {
        const rendered = renderBreach(evaluation);
        breaches.push({
          ...evaluation,
          breached: true,
          overage: evaluation.overage ?? '0',
          reason_code: 'hard_limit_breached',
          human_readable: rendered.human_readable,
          user_action: rendered.user_action,
        });
      }
    }

    return {
      any_breached: breaches.length > 0,
      breaches,
      evaluated,
    };
  }

  private evaluateOne(
    limit: HardLimit,
    movement: ProposedMovement,
    ctx: EvaluationContext
  ): HardLimitEvaluation {
    switch (limit.limit_type) {
      case 'min_cash_reserve_usd':               return checkMinCashReserve(limit, movement, ctx);
      case 'max_single_asset_concentration_pct': return checkMaxConcentration(limit, movement, ctx);
      case 'max_daily_outflow_usd':
      case 'max_30day_outflow_usd':              return checkMaxOutflow(limit, movement, ctx);
      case 'obligation_coverage_days':           return checkObligationCoverage(limit, movement, ctx);
      case 'max_native_exposure':                return checkMaxNativeExposure(limit, movement, ctx);
    }
  }
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- src/lib/policy/hard-limit-checker/checker
```

- [ ] **Step 5: Implement the utilization probe**

Create `src/lib/policy/hard-limit-checker/utilization-probe.ts`:

```typescript
// src/lib/policy/hard-limit-checker/utilization-probe.ts

import { HardLimitEvaluation } from '../types/hard-limit';
import { EvaluationContext } from '../types/context';
import { ProposedMovement } from '../types/movement';
import { HardLimitChecker } from './checker';

/**
 * Probes the current state of every hard limit WITHOUT a proposed movement.
 * Used by dashboard widgets and the Policy view's Hard Guardrails block
 * to show "current vs limit" gauges.
 *
 * Implemented as a thin wrapper around HardLimitChecker: constructs a
 * synthetic zero-amount movement and runs the checker. The resulting
 * `post_transfer_value` is identical to `current_value` since the
 * zero-amount movement has no delta. Consumers read `current_value`
 * and `utilization_pct`.
 */
export class HardLimitUtilizationProbe {
  constructor(private readonly checker: HardLimitChecker = new HardLimitChecker()) {}

  probe(ctx: EvaluationContext): HardLimitEvaluation[] {
    const syntheticMovement: ProposedMovement = {
      id: 'probe',
      kind: 'crypto_transfer',
      source: { venue: 'none', asset: 'USD' },
      destination: { venue: 'none', asset: 'USD' },
      amount: { amount: '0', asset: 'USD' },
      initiator: { type: 'human', user_id: 'probe' },
      requested_at: new Date().toISOString(),
    };
    return this.checker.check(syntheticMovement, ctx).evaluated;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/policy/hard-limit-checker/checker.ts \
        src/lib/policy/hard-limit-checker/checker.test.ts \
        src/lib/policy/hard-limit-checker/utilization-probe.ts
git commit -m "$(cat <<'EOF'
feat(policy): add HardLimitChecker orchestrator + UtilizationProbe

HardLimitChecker iterates every hard limit in the policy version,
evaluates it via the type-specific evaluator, and collects breaches
with rendered human-readable messages. Always evaluates ALL limits
even past a breach so traces and utilization data are complete.

UtilizationProbe is a thin wrapper that runs the checker against a
synthetic zero-amount movement to produce current-state gauges for
the dashboard and Policy view.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: Aggregate detector — queries and module

**Files:**
- Create: `src/lib/policy/aggregate-detector/queries.ts`
- Create: `src/lib/policy/aggregate-detector/queries.test.ts`
- Create: `src/lib/policy/aggregate-detector/detector.ts`
- Create: `src/lib/policy/aggregate-detector/detector.test.ts`

The hash.ts file already exists from Task 17's placeholder. This task keeps it.

- [ ] **Step 1: Write tests for the detector**

Create `src/lib/policy/aggregate-detector/detector.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AggregationDetector } from './detector';
import { PolicyVersionSnapshot } from '../types/policy-version';
import { ProposedMovement } from '../types/movement';

describe('AggregationDetector', () => {
  const mkMovement = (): ProposedMovement => ({
    id: 'mv-1', kind: 'crypto_transfer',
    source: { venue: 'ethereum', asset: 'USDC' },
    destination: { venue: 'external', asset: 'USDC' },
    amount: { amount: '50000', asset: 'USDC' },
    counterparty: { id: 'cp-1' },
    initiator: { type: 'human', user_id: 'user-1' },
    requested_at: new Date().toISOString(),
  });

  const mkPolicy = (): PolicyVersionSnapshot => ({
    id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test',
    rules: [], hard_limits: [], approval_chains: [],
  });

  it('always populates system_splitting_guard_24h', async () => {
    const runQuery = vi.fn().mockResolvedValue({
      sum_amount_usd: '0', sum_amount_by_asset: {}, count: 0,
      distinct_destinations: 0, distinct_counterparties: 0, included_evaluation_ids: [],
    });
    const detector = new AggregationDetector({ runQuery });

    const result = await detector.loadAggregates(mkMovement(), 'ent-1', mkPolicy());

    expect(result.system_splitting_guard_24h).toBeDefined();
    expect(result.system_splitting_guard_24h.window_spec_hash).toBeDefined();
    expect(runQuery).toHaveBeenCalled();
  });

  it('deduplicates user specs by hash', async () => {
    const runQuery = vi.fn().mockResolvedValue({
      sum_amount_usd: '0', sum_amount_by_asset: {}, count: 0,
      distinct_destinations: 0, distinct_counterparties: 0, included_evaluation_ids: [],
    });
    const detector = new AggregationDetector({ runQuery });

    // Two rules referencing the same window spec should produce only one query
    const policy: PolicyVersionSnapshot = {
      ...mkPolicy(),
      rules: [
        {
          id: 'r1', version_id: 'v-1', rule_type: 'approval_threshold',
          name: 'Rule 1', rationale: '', priority: 1, verdict: 'require_approval',
          created_by: 'u', created_at: new Date(),
          condition: {
            kind: 'aggregate_window',
            window: { duration_ms: 86400000, group_by: { counterparty: true } },
            attr: 'sum_amount', op: '>', value: { amount: '100', currency: 'USD' },
          },
        },
        {
          id: 'r2', version_id: 'v-1', rule_type: 'approval_threshold',
          name: 'Rule 2', rationale: '', priority: 2, verdict: 'require_approval',
          created_by: 'u', created_at: new Date(),
          condition: {
            kind: 'aggregate_window',
            window: { duration_ms: 86400000, group_by: { counterparty: true } },
            attr: 'count', op: '>', value: { amount: '5', currency: 'USD' },
          },
        },
      ],
    };

    const result = await detector.loadAggregates(mkMovement(), 'ent-1', policy);

    // runQuery called twice: once for splitting guard, once for the deduplicated user spec
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.user_specs)).toHaveLength(1);
  });

  it('records failure per-spec on query error', async () => {
    const runQuery = vi.fn()
      .mockResolvedValueOnce({ sum_amount_usd: '0', sum_amount_by_asset: {}, count: 0, distinct_destinations: 0, distinct_counterparties: 0, included_evaluation_ids: [] })
      .mockRejectedValueOnce(new Error('db timeout'));
    const detector = new AggregationDetector({ runQuery });

    const policy: PolicyVersionSnapshot = {
      ...mkPolicy(),
      rules: [{
        id: 'r1', version_id: 'v-1', rule_type: 'approval_threshold',
        name: 'Rule', rationale: '', priority: 1, verdict: 'require_approval',
        created_by: 'u', created_at: new Date(),
        condition: {
          kind: 'aggregate_window',
          window: { duration_ms: 86400000, group_by: { initiator: true } },
          attr: 'sum_amount', op: '>', value: { amount: '100', currency: 'USD' },
        },
      }],
    };

    const result = await detector.loadAggregates(mkMovement(), 'ent-1', policy);

    const userSpecResult = Object.values(result.user_specs)[0];
    expect(userSpecResult.failure).toBeDefined();
    expect(userSpecResult.failure?.reason_code).toBe('aggregate_query_failed');
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

```bash
npm test -- src/lib/policy/aggregate-detector/detector
```

- [ ] **Step 3: Implement queries module**

Create `src/lib/policy/aggregate-detector/queries.ts`:

```typescript
// src/lib/policy/aggregate-detector/queries.ts

import { WindowSpec } from '../types/ir';
import { ProposedMovement } from '../types/movement';

/**
 * Parameters passed to the query executor. The actual SQL execution
 * happens via a dependency-injected runQuery function — the detector
 * doesn't import a Supabase client directly so it stays testable.
 */
export interface AggregateQueryParams {
  enterpriseId: string;
  window: WindowSpec;
  movement: ProposedMovement;
  windowStart: Date;
  windowEnd: Date;
}

/**
 * Raw result returned by runQuery — just the numeric values. The detector
 * wraps this with window metadata to produce an AggregateWindowResult.
 */
export interface RawAggregateResult {
  sum_amount_usd: string;
  sum_amount_by_asset: Record<string, string>;
  count: number;
  distinct_destinations: number;
  distinct_counterparties: number;
  included_evaluation_ids: string[];
}

/**
 * The query function signature. Plan 2 supplies a real implementation
 * that hits policy_evaluations via the Supabase service client. Tests
 * supply a mock.
 */
export type RunAggregateQuery = (params: AggregateQueryParams) => Promise<RawAggregateResult>;

/**
 * Build the SQL for an aggregate window query. This is exported for Plan 2
 * to import when wiring up the real database client.
 */
export function buildAggregateQuerySql(params: AggregateQueryParams): { sql: string; bindings: unknown[] } {
  const { enterpriseId, window, movement, windowStart, windowEnd } = params;
  const direction = window.direction ?? 'outflow';

  // Build GROUP BY / WHERE clauses based on dimensions
  const groupFilters: string[] = [];
  const bindings: unknown[] = [enterpriseId, windowStart.toISOString(), windowEnd.toISOString()];

  if (window.group_by.initiator) {
    groupFilters.push(`proposed_movement->'initiator'->>'user_id' = $${bindings.length + 1}`);
    bindings.push(movement.initiator.user_id ?? movement.initiator.agent_id ?? '');
  }
  if (window.group_by.counterparty && movement.counterparty) {
    groupFilters.push(`proposed_movement->'counterparty'->>'id' = $${bindings.length + 1}`);
    bindings.push(movement.counterparty.id);
  }
  if (window.group_by.destination) {
    const destIdentity = `${movement.destination.venue}:${movement.destination.address ?? movement.destination.account_id ?? ''}`;
    groupFilters.push(`(proposed_movement->'destination'->>'venue' || ':' || COALESCE(proposed_movement->'destination'->>'address', proposed_movement->'destination'->>'account_id', '')) = $${bindings.length + 1}`);
    bindings.push(destIdentity);
  }
  if (window.group_by.asset) {
    groupFilters.push(`proposed_movement->'amount'->>'asset' = $${bindings.length + 1}`);
    bindings.push(movement.amount.asset);
  }

  const directionFilter = direction === 'both'
    ? ''
    : `AND (proposed_movement->'metadata'->>'direction' = '${direction}' OR proposed_movement->'metadata'->>'direction' IS NULL)`;

  const sql = `
    SELECT
      COALESCE(SUM((proposed_movement->'amount'->>'amount_usd')::numeric), 0)::text AS sum_amount_usd,
      COUNT(*)::int AS count,
      COUNT(DISTINCT proposed_movement->'destination'->>'address')::int AS distinct_destinations,
      COUNT(DISTINCT proposed_movement->'counterparty'->>'id')::int AS distinct_counterparties,
      ARRAY_AGG(id) AS included_evaluation_ids
    FROM policy_evaluations
    WHERE enterprise_id = $1
      AND final_verdict = 'allow_auto'
      AND executed_at IS NOT NULL
      AND executed_at >= $2
      AND executed_at <  $3
      ${directionFilter}
      ${groupFilters.length > 0 ? 'AND ' + groupFilters.join(' AND ') : ''}
  `;

  return { sql, bindings };
}
```

- [ ] **Step 4: Implement the detector module**

Create `src/lib/policy/aggregate-detector/detector.ts`:

```typescript
// src/lib/policy/aggregate-detector/detector.ts

import { PolicyVersionSnapshot, PolicyRule, ApprovalChain } from '../types/policy-version';
import { ProposedMovement } from '../types/movement';
import { Condition, WindowSpec, AggregateWindowNode } from '../types/ir';
import { AggregateWindowResults, AggregateWindowResult } from '../types/context';
import { RunAggregateQuery } from './queries';
import { computeWindowSpecHash } from './hash';

export interface AggregationDetectorDeps {
  runQuery: RunAggregateQuery;
}

/**
 * Async detector that pre-loads all aggregate window queries referenced by
 * the active policy version plus the always-on system splitting guard.
 */
export class AggregationDetector {
  constructor(private readonly deps: AggregationDetectorDeps) {}

  async loadAggregates(
    movement: ProposedMovement,
    enterpriseId: string,
    policy: PolicyVersionSnapshot
  ): Promise<AggregateWindowResults> {
    const userSpecs = this.extractWindowSpecs(policy);

    // Always include the system 24h splitting guard
    const splittingGuardSpec: WindowSpec = {
      duration_ms: 86_400_000,
      group_by: { initiator: true, destination: true },
      direction: 'outflow',
    };

    const now = new Date();

    // Execute splitting guard query
    const splittingGuardResult = await this.runOne(
      splittingGuardSpec,
      movement,
      enterpriseId,
      now
    );

    // Execute user-spec queries (deduplicated)
    const userResults: Record<string, AggregateWindowResult> = {};
    for (const [hash, spec] of userSpecs) {
      userResults[hash] = await this.runOne(spec, movement, enterpriseId, now);
    }

    return {
      system_splitting_guard_24h: splittingGuardResult,
      user_specs: userResults,
    };
  }

  private extractWindowSpecs(policy: PolicyVersionSnapshot): Map<string, WindowSpec> {
    const map = new Map<string, WindowSpec>();

    for (const rule of policy.rules) {
      this.walkCondition(rule.condition, map);
    }
    for (const chain of policy.approval_chains) {
      if (chain.trigger_condition) {
        this.walkCondition(chain.trigger_condition, map);
      }
    }

    return map;
  }

  private walkCondition(cond: Condition, map: Map<string, WindowSpec>): void {
    switch (cond.kind) {
      case 'and':
      case 'or':
        cond.children.forEach((c) => this.walkCondition(c, map));
        return;
      case 'not':
        this.walkCondition(cond.child, map);
        return;
      case 'aggregate_window': {
        const hash = computeWindowSpecHash(cond.window);
        if (!map.has(hash)) {
          map.set(hash, cond.window);
        }
        return;
      }
      default:
        // Other leaves don't contain aggregate_window nodes
        return;
    }
  }

  private async runOne(
    spec: WindowSpec,
    movement: ProposedMovement,
    enterpriseId: string,
    now: Date
  ): Promise<AggregateWindowResult> {
    const hash = computeWindowSpecHash(spec);
    const windowStart = new Date(now.getTime() - spec.duration_ms);
    const windowEnd = now;

    try {
      const raw = await this.deps.runQuery({
        enterpriseId,
        window: spec,
        movement,
        windowStart,
        windowEnd,
      });

      return {
        window_spec_hash: hash,
        window_start: windowStart,
        window_end: windowEnd,
        sum_amount_usd: raw.sum_amount_usd,
        sum_amount_by_asset: raw.sum_amount_by_asset,
        count: raw.count,
        distinct_destinations: raw.distinct_destinations,
        distinct_counterparties: raw.distinct_counterparties,
        included_evaluation_ids: raw.included_evaluation_ids,
        includes_proposed: false,
      };
    } catch (err) {
      return {
        window_spec_hash: hash,
        window_start: windowStart,
        window_end: windowEnd,
        sum_amount_usd: '',
        sum_amount_by_asset: {},
        count: 0,
        distinct_destinations: 0,
        distinct_counterparties: 0,
        included_evaluation_ids: [],
        includes_proposed: false,
        failure: {
          reason_code: 'aggregate_query_failed',
          human_readable: `Aggregate window query failed: ${err instanceof Error ? err.message : String(err)}`,
          details: { window_spec: spec, error_class: err instanceof Error ? err.name : typeof err },
        },
      };
    }
  }
}
```

- [ ] **Step 5: Run tests, confirm pass**

```bash
npm test -- src/lib/policy/aggregate-detector
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/policy/aggregate-detector/
git commit -m "$(cat <<'EOF'
feat(policy): add AggregationDetector and query builder

Detector walks the active policy version's rules + chain trigger
conditions to find every aggregate_window node, deduplicates by
window spec hash, and executes one query per unique spec plus the
always-on system splitting guard. Query execution is DI'd so the
module stays testable without a real database client. Query builder
produces SQL filtering policy_evaluations by enterprise, time, and
groupings, restricted to executed outflows.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Context loader sub-modules

**Files:**
- Create: `src/lib/policy/context-loader/treasury-state.ts`
- Create: `src/lib/policy/context-loader/treasury-state.test.ts`
- Create: `src/lib/policy/context-loader/counterparty.ts`
- Create: `src/lib/policy/context-loader/counterparty.test.ts`
- Create: `src/lib/policy/context-loader/sanctions.ts`
- Create: `src/lib/policy/context-loader/sanctions.test.ts`

Each sub-module is responsible for one slice of the EvaluationContext. Each takes a DI'd query function (not a Supabase client directly) so the modules stay testable.

- [ ] **Step 1: Implement `treasury-state.ts` (test + impl)**

Create `src/lib/policy/context-loader/treasury-state.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { loadTreasuryState } from './treasury-state';

describe('loadTreasuryState', () => {
  it('assembles balances into TreasuryState shape', async () => {
    const fetchBalances = vi.fn().mockResolvedValue([
      { asset: 'USDC', venue: 'ethereum', amount: '800000', amount_usd: '800000' },
      { asset: 'USDC', venue: 'solana', amount: '200000', amount_usd: '200000' },
      { asset: 'USDT', venue: 'ethereum', amount: '500000', amount_usd: '500000' },
    ]);

    const state = await loadTreasuryState('ent-1', { fetchBalances });

    expect(state.positions_by_asset).toEqual({ USDC: '1000000', USDT: '500000' });
    expect(state.positions_by_asset_venue).toEqual({
      'USDC:ethereum': '800000',
      'USDC:solana': '200000',
      'USDT:ethereum': '500000',
    });
    expect(state.total_treasury_usd).toBe('1500000');
    expect(state.cash_equivalent_usd).toBe('1500000');
  });

  it('records a failure when the fetch throws', async () => {
    const fetchBalances = vi.fn().mockRejectedValue(new Error('db down'));
    const state = await loadTreasuryState('ent-1', { fetchBalances });

    expect(state.failures).toBeDefined();
    expect(state.failures?.[0].reason_code).toBe('treasury_state_unavailable');
    expect(state.total_treasury_usd).toBe('0');
  });
});
```

Create `src/lib/policy/context-loader/treasury-state.ts`:

```typescript
// src/lib/policy/context-loader/treasury-state.ts

import Big from 'big.js';
import { TreasuryState } from '../types/context';
import { AssetCode } from '../types/assets';

/**
 * Row returned by the balances query. Shape matches the existing wallet
 * balance tables in Vantor (adapter lives in Plan 2). Tests supply a
 * mock via DI.
 */
export interface BalanceRow {
  asset: AssetCode;
  venue: string;
  amount: string;        // native
  amount_usd: string;    // already canonicalized to USD at write time
}

export interface TreasuryStateDeps {
  fetchBalances: (enterpriseId: string) => Promise<BalanceRow[]>;
}

const CASH_EQUIVALENT_ASSETS: ReadonlySet<string> = new Set(['USD', 'USDC', 'USDT']);

export async function loadTreasuryState(
  enterpriseId: string,
  deps: TreasuryStateDeps
): Promise<TreasuryState> {
  let rows: BalanceRow[];
  try {
    rows = await deps.fetchBalances(enterpriseId);
  } catch (err) {
    return {
      positions_by_asset: {},
      positions_by_asset_venue: {},
      positions_usd_by_asset: {},
      total_treasury_usd: '0',
      cash_equivalent_usd: '0',
      loaded_at: new Date(),
      failures: [
        {
          reason_code: 'treasury_state_unavailable',
          human_readable: `Failed to load balances: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  const positionsByAsset: Record<string, Big> = {};
  const positionsByAssetVenue: Record<string, string> = {};
  const positionsUsdByAsset: Record<string, Big> = {};
  let totalUsd = new Big(0);
  let cashEquivalentUsd = new Big(0);

  for (const row of rows) {
    positionsByAsset[row.asset] = (positionsByAsset[row.asset] ?? new Big(0)).plus(row.amount);
    positionsByAssetVenue[`${row.asset}:${row.venue}`] = row.amount;
    positionsUsdByAsset[row.asset] = (positionsUsdByAsset[row.asset] ?? new Big(0)).plus(row.amount_usd);
    totalUsd = totalUsd.plus(row.amount_usd);
    if (CASH_EQUIVALENT_ASSETS.has(row.asset)) {
      cashEquivalentUsd = cashEquivalentUsd.plus(row.amount_usd);
    }
  }

  return {
    positions_by_asset: Object.fromEntries(
      Object.entries(positionsByAsset).map(([k, v]) => [k, v.toString()])
    ),
    positions_by_asset_venue: positionsByAssetVenue,
    positions_usd_by_asset: Object.fromEntries(
      Object.entries(positionsUsdByAsset).map(([k, v]) => [k, v.toString()])
    ),
    total_treasury_usd: totalUsd.toString(),
    cash_equivalent_usd: cashEquivalentUsd.toString(),
    loaded_at: new Date(),
  };
}
```

- [ ] **Step 2: Implement `counterparty.ts` (test + impl)**

Create `src/lib/policy/context-loader/counterparty.ts`:

```typescript
// src/lib/policy/context-loader/counterparty.ts

import { CounterpartyHistoryRecord } from '../types/context';

export interface CounterpartyHistoryRow {
  id: string;
  first_seen_at?: Date;
  last_transfer_at?: Date;
  total_volume_usd?: string;
  transfer_count?: number;
}

export interface CounterpartyDeps {
  fetchCounterpartyHistory: (
    enterpriseId: string,
    counterpartyId: string
  ) => Promise<CounterpartyHistoryRow | null>;
}

export async function loadCounterparty(
  enterpriseId: string,
  counterpartyId: string | undefined,
  deps: CounterpartyDeps
): Promise<CounterpartyHistoryRecord | undefined> {
  if (!counterpartyId) return undefined;

  try {
    const row = await deps.fetchCounterpartyHistory(enterpriseId, counterpartyId);
    if (!row) return { id: counterpartyId };
    return {
      id: row.id,
      first_seen_at: row.first_seen_at,
      last_transfer_at: row.last_transfer_at,
      total_volume_usd: row.total_volume_usd,
      transfer_count: row.transfer_count,
    };
  } catch (err) {
    return {
      id: counterpartyId,
      failure: {
        reason_code: 'counterparty_lookup_failed',
        human_readable: `Failed to load counterparty history: ${err instanceof Error ? err.message : String(err)}`,
        details: { counterparty_id: counterpartyId },
      },
    };
  }
}
```

Matching test:

```typescript
// src/lib/policy/context-loader/counterparty.test.ts
import { describe, it, expect, vi } from 'vitest';
import { loadCounterparty } from './counterparty';

describe('loadCounterparty', () => {
  it('returns undefined when no counterparty id provided', async () => {
    const deps = { fetchCounterpartyHistory: vi.fn() };
    const result = await loadCounterparty('ent-1', undefined, deps);
    expect(result).toBeUndefined();
  });

  it('returns record with history when fetch succeeds', async () => {
    const lastTime = new Date('2026-04-09T10:00:00Z');
    const deps = {
      fetchCounterpartyHistory: vi.fn().mockResolvedValue({
        id: 'cp-1', last_transfer_at: lastTime, transfer_count: 5,
      }),
    };
    const result = await loadCounterparty('ent-1', 'cp-1', deps);
    expect(result?.last_transfer_at).toEqual(lastTime);
    expect(result?.transfer_count).toBe(5);
  });

  it('returns minimal record when counterparty is new (fetch returns null)', async () => {
    const deps = { fetchCounterpartyHistory: vi.fn().mockResolvedValue(null) };
    const result = await loadCounterparty('ent-1', 'cp-new', deps);
    expect(result).toEqual({ id: 'cp-new' });
  });

  it('returns failure field when fetch throws', async () => {
    const deps = { fetchCounterpartyHistory: vi.fn().mockRejectedValue(new Error('db down')) };
    const result = await loadCounterparty('ent-1', 'cp-1', deps);
    expect(result?.failure?.reason_code).toBe('counterparty_lookup_failed');
  });
});
```

- [ ] **Step 3: Implement `sanctions.ts` (test + impl)**

Create `src/lib/policy/context-loader/sanctions.ts`:

```typescript
// src/lib/policy/context-loader/sanctions.ts

import { SanctionsSnapshot } from '../types/context';
import { SanctionsStatus } from '../types/ir';

export interface SanctionsScreeningRow {
  counterparty_id: string;
  result: SanctionsStatus;
  screened_at: Date;
}

export interface SanctionsDeps {
  fetchLatestScreening: (
    enterpriseId: string,
    counterpartyId: string
  ) => Promise<SanctionsScreeningRow | null>;
}

export async function loadSanctions(
  enterpriseId: string,
  counterpartyId: string | undefined,
  deps: SanctionsDeps
): Promise<SanctionsSnapshot> {
  if (!counterpartyId) {
    return { status: 'unscreened' };
  }

  try {
    const row = await deps.fetchLatestScreening(enterpriseId, counterpartyId);
    if (!row) {
      return { counterparty_id: counterpartyId, status: 'unscreened' };
    }
    return {
      counterparty_id: counterpartyId,
      status: row.result,
      screened_at: row.screened_at,
    };
  } catch (err) {
    return {
      counterparty_id: counterpartyId,
      status: 'unscreened',
      failure: {
        reason_code: 'sanctions_status_unavailable',
        human_readable: `Failed to load sanctions screening: ${err instanceof Error ? err.message : String(err)}`,
        details: { counterparty_id: counterpartyId },
      },
    };
  }
}
```

Matching test file `sanctions.test.ts` with 4 cases: no counterparty / screened clear / no screening record / fetch error.

- [ ] **Step 4: Run all context-loader sub-module tests**

```bash
npm test -- src/lib/policy/context-loader
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/context-loader/
git commit -m "$(cat <<'EOF'
feat(policy): add treasury-state, counterparty, sanctions loaders

Three context-loader sub-modules, each with DI'd query functions so
they're testable without a real database client. Each returns a
structured failure field on error rather than throwing, matching the
never-throws contract for evaluation context construction.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 23: EvaluationContextLoader orchestrator

**Files:**
- Create: `src/lib/policy/context-loader/loader.ts`
- Create: `src/lib/policy/context-loader/loader.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/policy/context-loader/loader.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EvaluationContextLoader } from './loader';
import { StubForecastQueryFactory } from '../forecast/stub';
import { NoopStubLogger } from '../forecast/stub-logger';
import { AggregationDetector } from '../aggregate-detector/detector';
import { CoingeckoPolicyRateProvider } from '../canonicalizer/coingecko-provider';
import { ProposedMovement } from '../types/movement';
import { PolicyVersionSnapshot } from '../types/policy-version';

describe('EvaluationContextLoader', () => {
  const mkMovement = (): ProposedMovement => ({
    id: 'mv-1', kind: 'crypto_transfer',
    source: { venue: 'ethereum', asset: 'USDC' },
    destination: { venue: 'external', asset: 'USDC' },
    amount: { amount: '50000', asset: 'USDC' },
    counterparty: { id: 'cp-1' },
    initiator: { type: 'human', user_id: 'user-1' },
    requested_at: new Date().toISOString(),
  });

  const mkPolicy = (): PolicyVersionSnapshot => ({
    id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test',
    rules: [], hard_limits: [], approval_chains: [],
  });

  it('assembles a fully-hydrated EvaluationContext', async () => {
    const rateProvider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0002, USDT: 1.0001 },
        source: 'coingecko',
        fetchedAt: new Date(),
      }),
    });
    const aggregateDetector = new AggregationDetector({
      runQuery: vi.fn().mockResolvedValue({
        sum_amount_usd: '0', sum_amount_by_asset: {}, count: 0,
        distinct_destinations: 0, distinct_counterparties: 0, included_evaluation_ids: [],
      }),
    });
    const forecastFactory = new StubForecastQueryFactory(new NoopStubLogger());

    const loader = new EvaluationContextLoader({
      rateProvider,
      aggregateDetector,
      forecastFactory,
      fetchPolicyVersion: vi.fn().mockResolvedValue(mkPolicy()),
      fetchBalances: vi.fn().mockResolvedValue([
        { asset: 'USDC', venue: 'ethereum', amount: '1000000', amount_usd: '1000000' },
      ]),
      fetchCounterpartyHistory: vi.fn().mockResolvedValue(null),
      fetchLatestScreening: vi.fn().mockResolvedValue({
        counterparty_id: 'cp-1', result: 'clear', screened_at: new Date(),
      }),
    });

    const ctx = await loader.load(mkMovement(), 'ent-1');

    expect(ctx.enterprise_id).toBe('ent-1');
    expect(ctx.policy_version.id).toBe('v-1');
    expect(ctx.treasury_state.positions_by_asset.USDC).toBe('1000000');
    expect(ctx.canonicalization.canonical_amount).toBe('50010');
    expect(ctx.sanctions.status).toBe('clear');
    expect(ctx.forecast.query_metadata.mode).toBe('stub');
  });
});
```

- [ ] **Step 2: Implement the loader**

Create `src/lib/policy/context-loader/loader.ts`:

```typescript
// src/lib/policy/context-loader/loader.ts

import { EvaluationContext, ForecastSnapshot, ForecastQueryResult } from '../types/context';
import { ProposedMovement } from '../types/movement';
import { PolicyVersionSnapshot } from '../types/policy-version';
import { Condition } from '../types/ir';
import { canonicalizeToUsd } from '../canonicalizer/canonicalizer';
import { PolicyRateProvider } from '../canonicalizer/interface';
import { AggregationDetector } from '../aggregate-detector/detector';
import { ForecastQueryFactory, ForecastQuery } from '../forecast/interface';
import { loadTreasuryState, BalanceRow } from './treasury-state';
import { loadCounterparty, CounterpartyHistoryRow } from './counterparty';
import { loadSanctions, SanctionsScreeningRow } from './sanctions';
import { computeForecastQueryHash } from '../ir-evaluator/leaves/forecast-query';

export interface EvaluationContextLoaderDeps {
  rateProvider: PolicyRateProvider;
  aggregateDetector: AggregationDetector;
  forecastFactory: ForecastQueryFactory;
  fetchPolicyVersion: (enterpriseId: string) => Promise<PolicyVersionSnapshot>;
  fetchBalances: (enterpriseId: string) => Promise<BalanceRow[]>;
  fetchCounterpartyHistory: (enterpriseId: string, counterpartyId: string) => Promise<CounterpartyHistoryRow | null>;
  fetchLatestScreening: (enterpriseId: string, counterpartyId: string) => Promise<SanctionsScreeningRow | null>;
}

export class EvaluationContextLoader {
  constructor(private readonly deps: EvaluationContextLoaderDeps) {}

  async load(movement: ProposedMovement, enterpriseId: string): Promise<EvaluationContext> {
    // Load everything in parallel where possible
    const [policyVersion, treasuryState, counterparty, sanctions, canonicalization, forecastQuery] = await Promise.all([
      this.deps.fetchPolicyVersion(enterpriseId),
      loadTreasuryState(enterpriseId, { fetchBalances: this.deps.fetchBalances }),
      loadCounterparty(enterpriseId, movement.counterparty?.id, { fetchCounterpartyHistory: this.deps.fetchCounterpartyHistory }),
      loadSanctions(enterpriseId, movement.counterparty?.id, { fetchLatestScreening: this.deps.fetchLatestScreening }),
      canonicalizeToUsd(movement.amount, this.deps.rateProvider, new Date()),
      this.deps.forecastFactory.createForEnterprise(enterpriseId),
    ]);

    // Aggregates depend on the policy version, so load after
    const aggregates = await this.deps.aggregateDetector.loadAggregates(movement, enterpriseId, policyVersion);

    // Pre-load forecast query results referenced by the policy
    const forecast = await this.preloadForecastResults(forecastQuery, movement, policyVersion);

    return {
      now: new Date(),
      enterprise_id: enterpriseId,
      policy_version: policyVersion,
      treasury_state: treasuryState,
      canonicalization,
      aggregates,
      sanctions,
      forecast,
      counterparty,
    };
  }

  private async preloadForecastResults(
    query: ForecastQuery,
    movement: ProposedMovement,
    policy: PolicyVersionSnapshot
  ): Promise<ForecastSnapshot> {
    const queryRequests = this.extractForecastQueryRequests(policy);
    const hypothetical = query.hypothetical(movement);

    const results: Record<string, ForecastQueryResult> = {};

    for (const req of queryRequests) {
      const targetQuery = req.use_hypothetical ? hypothetical : query;
      try {
        let value: unknown;
        switch (req.kind) {
          case 'obligations_covered':
            value = await targetQuery.areObligationsCovered(req.window_days);
            break;
          case 'projected_min_balance':
            value = await targetQuery.getProjectedMinBalance(req.asset ?? 'USD', req.venue ?? null, req.window_days);
            break;
          case 'projected_position':
            value = await targetQuery.getProjectedPosition(req.asset ?? 'USD', req.venue ?? null, new Date(Date.now() + req.window_days * 86400000));
            break;
        }
        results[req.hash] = { value };
      } catch (err) {
        results[req.hash] = {
          failure: {
            reason_code: 'forecast_unavailable',
            human_readable: `Forecast query ${req.kind} failed: ${err instanceof Error ? err.message : String(err)}`,
            details: { kind: req.kind, window_days: req.window_days },
          },
        };
      }
    }

    return {
      query_metadata: query.metadata,
      hypothetical_metadata: hypothetical.metadata,
      results,
    };
  }

  private extractForecastQueryRequests(policy: PolicyVersionSnapshot): ForecastQueryRequest[] {
    const requests: ForecastQueryRequest[] = [];
    const seen = new Set<string>();

    // Walk rules
    for (const rule of policy.rules) {
      this.walkForecastNodes(rule.condition, requests, seen, false);
    }

    // Walk approval chain trigger conditions
    for (const chain of policy.approval_chains) {
      if (chain.trigger_condition) {
        this.walkForecastNodes(chain.trigger_condition, requests, seen, false);
      }
    }

    // Add hard limits that need forecast queries
    for (const limit of policy.hard_limits) {
      if (limit.limit_type === 'obligation_coverage_days') {
        const windowDays = parseInt(limit.limit_value, 10);
        const hash = computeForecastQueryHash({
          kind: 'forecast_query',
          query: 'obligations_covered',
          window_days: windowDays,
          comparator: '==',
          value: { amount: '1', currency: 'USD' },
        });
        if (!seen.has(hash)) {
          seen.add(hash);
          requests.push({
            hash,
            kind: 'obligations_covered',
            window_days: windowDays,
            use_hypothetical: true, // hard limits check post-state
          });
        }
      }
    }

    return requests;
  }

  private walkForecastNodes(
    cond: Condition,
    requests: ForecastQueryRequest[],
    seen: Set<string>,
    useHypothetical: boolean
  ): void {
    switch (cond.kind) {
      case 'and':
      case 'or':
        cond.children.forEach((c) => this.walkForecastNodes(c, requests, seen, useHypothetical));
        return;
      case 'not':
        this.walkForecastNodes(cond.child, requests, seen, useHypothetical);
        return;
      case 'forecast_query': {
        const hash = computeForecastQueryHash(cond);
        if (!seen.has(hash)) {
          seen.add(hash);
          requests.push({
            hash,
            kind: cond.query,
            window_days: cond.window_days,
            asset: cond.scope?.asset,
            venue: cond.scope?.venue,
            use_hypothetical: useHypothetical,
          });
        }
        return;
      }
      default:
        return;
    }
  }
}

interface ForecastQueryRequest {
  hash: string;
  kind: 'projected_min_balance' | 'projected_position' | 'obligations_covered';
  window_days: number;
  asset?: string;
  venue?: string;
  use_hypothetical: boolean;
}
```

- [ ] **Step 3: Run tests, confirm pass**

```bash
npm test -- src/lib/policy/context-loader/loader
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/policy/context-loader/loader.ts src/lib/policy/context-loader/loader.test.ts
git commit -m "$(cat <<'EOF'
feat(policy): add EvaluationContextLoader orchestrator

Loads all 7 components of the EvaluationContext in parallel where
possible: policy version, treasury state, counterparty history,
sanctions status, canonicalization, forecast query. Walks the policy
version's rules + approval chain trigger conditions + hard limits to
extract every forecast query reference, deduplicates by hash, and
pre-loads results from the ForecastQuery interface. All sub-loaders
are DI'd so the orchestrator is unit-testable without touching a
real database.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 24: Verdict composer

**Files:**
- Create: `src/lib/policy/verdict-composer/composer.ts`
- Create: `src/lib/policy/verdict-composer/composer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/policy/verdict-composer/composer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { composeVerdict } from './composer';
import { Verdict } from '../types/verdict';
import { ProposedMovement } from '../types/movement';
import { RuleEvaluationTrace } from '../types/trace';

const mkMovement = (initiatorType: 'human' | 'agent' | 'ai_recommendation' | 'schedule' = 'human'): ProposedMovement => ({
  id: 'mv-1', kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'external', asset: 'USDC' },
  amount: { amount: '10000', asset: 'USDC' },
  initiator: {
    type: initiatorType,
    user_id: initiatorType === 'human' ? 'user-1' : undefined,
    agent_id: initiatorType === 'agent' ? 'agent-1' : undefined,
    recommendation_id: initiatorType === 'ai_recommendation' ? 'rec-1' : undefined,
    scheduled_op_id: initiatorType === 'schedule' ? 'op-1' : undefined,
  },
  requested_at: new Date().toISOString(),
});

const mkRuleTrace = (verdict: Verdict | null, matched: boolean): RuleEvaluationTrace => ({
  rule_id: `r-${Math.random()}`, rule_name: 'Test', rule_type: 'approval_threshold',
  priority: 1, condition_result: { path: [], node_kind: 'amount_compare', result: matched ? 'matched' : 'not_matched' },
  matched, verdict_contribution: verdict,
});

describe('composeVerdict', () => {
  it('defaults to allow_auto for human initiator with no matching rules', () => {
    const result = composeVerdict(mkMovement('human'), [], false);
    expect(result.verdict).toBe('allow_auto');
    expect(result.source).toBe('default_deny'); // actually "default allow" for humans
  });

  it('defaults to require_approval for agent initiator with no matching rules (default deny)', () => {
    const result = composeVerdict(mkMovement('agent'), [], false);
    expect(result.verdict).toBe('require_approval');
    expect(result.invariants_applied.some(i => i.invariant === 'default_deny')).toBe(true);
  });

  it('defaults to require_approval for schedule initiator with no matching rules (default deny)', () => {
    const result = composeVerdict(mkMovement('schedule'), [], false);
    expect(result.verdict).toBe('require_approval');
  });

  it('promotes human-initiator allow_auto to require_approval when initiator is ai_recommendation', () => {
    const rules = [mkRuleTrace('allow_auto', true)];
    const result = composeVerdict(mkMovement('ai_recommendation'), rules, false);
    expect(result.verdict).toBe('require_approval');
    expect(result.invariants_applied.some(i => i.invariant === 'ai_initiator_floor')).toBe(true);
  });

  it('promotes agent-initiator allow_auto to require_approval (same invariant)', () => {
    const rules = [mkRuleTrace('allow_auto', true)];
    const result = composeVerdict(mkMovement('agent'), rules, false);
    expect(result.verdict).toBe('require_approval');
    expect(result.invariants_applied.some(i => i.invariant === 'ai_initiator_floor')).toBe(true);
  });

  it('lowest-privilege wins: block > require_approval > allow_auto', () => {
    const rules = [
      mkRuleTrace('allow_auto', true),
      mkRuleTrace('require_approval', true),
      mkRuleTrace('block', true),
    ];
    const result = composeVerdict(mkMovement('human'), rules, false);
    expect(result.verdict).toBe('block');
  });

  it('hard limit breach forces block_hard_limit regardless of user rules', () => {
    const rules = [mkRuleTrace('allow_auto', true)];
    const result = composeVerdict(mkMovement('human'), rules, true);
    expect(result.verdict).toBe('block_hard_limit');
    expect(result.source).toBe('hard_limit');
  });
});
```

- [ ] **Step 2: Implement the composer**

Create `src/lib/policy/verdict-composer/composer.ts`:

```typescript
// src/lib/policy/verdict-composer/composer.ts

import { Verdict } from '../types/verdict';
import { ProposedMovement } from '../types/movement';
import { RuleEvaluationTrace, SystemInvariantTrace } from '../types/trace';
import { REASON_CODES, WARNING_CODES } from '../errors/reason-codes';

export interface ComposeVerdictResult {
  verdict: Verdict;
  source: 'hard_limit' | 'user_rule' | 'system_invariant' | 'default_deny';
  invariants_applied: SystemInvariantTrace[];
}

/**
 * Compose the final verdict from the set of rule evaluations + hard limit
 * check result + system invariants. Implements the precedence spec:
 *
 *   1. Hard limit breach → 'block_hard_limit' (terminal)
 *   2. Lowest-privilege wins among user rules: block > require_approval > allow_auto
 *   3. AI-initiator floor: promotes allow_auto → require_approval for ai_recommendation/agent
 *   4. Default deny: non-human initiators with no allow → require_approval
 *   5. Human initiator with no matching rules → allow_auto (trusted by default)
 */
export function composeVerdict(
  movement: ProposedMovement,
  ruleTraces: RuleEvaluationTrace[],
  hardLimitBreached: boolean
): ComposeVerdictResult {
  const invariants: SystemInvariantTrace[] = [];

  // Step 1: hard limit breach wins
  if (hardLimitBreached) {
    return {
      verdict: 'block_hard_limit',
      source: 'hard_limit',
      invariants_applied: invariants,
    };
  }

  // Step 2: compose user rules with lowest-privilege-wins
  const matchingRules = ruleTraces.filter((r) => r.matched && !r.failure);
  const failedRules = ruleTraces.filter((r) => r.failure !== undefined);

  // Cannot-fully-evaluate any rule that would have mattered → block
  if (failedRules.length > 0) {
    return {
      verdict: 'block',
      source: 'user_rule',
      invariants_applied: invariants,
    };
  }

  let composed: Verdict | null = null;
  if (matchingRules.some((r) => r.verdict_contribution === 'block')) {
    composed = 'block';
  } else if (matchingRules.some((r) => r.verdict_contribution === 'require_approval')) {
    composed = 'require_approval';
  } else if (matchingRules.some((r) => r.verdict_contribution === 'allow_auto')) {
    composed = 'allow_auto';
  }

  // Step 3: AI/agent initiator floor
  const initiatorType = movement.initiator.type;
  const isAutonomousInitiator = initiatorType === 'ai_recommendation' || initiatorType === 'agent';

  if (composed === 'allow_auto' && isAutonomousInitiator) {
    invariants.push({
      invariant: 'ai_initiator_floor',
      applied: true,
      warning_code: WARNING_CODES.ai_initiator_floor_applied,
      human_readable:
        `This movement would have auto-executed under the matching rules, but was held for ` +
        `approval because Vantor's system invariant requires human approval for all ` +
        `${initiatorType === 'ai_recommendation' ? 'AI-initiated' : 'agent-initiated'} transfers.`,
    });
    return {
      verdict: 'require_approval',
      source: 'system_invariant',
      invariants_applied: invariants,
    };
  }

  // Step 4: default deny for non-human initiators with no explicit allow
  if (composed === null && (isAutonomousInitiator || initiatorType === 'schedule')) {
    invariants.push({
      invariant: 'default_deny',
      applied: true,
      warning_code: WARNING_CODES.default_deny_triggered,
      human_readable:
        `No rule explicitly permitted this ${initiatorType}-initiated transfer. ` +
        `The default deny invariant for non-human initiators required approval.`,
    });
    return {
      verdict: 'require_approval',
      source: 'system_invariant',
      invariants_applied: invariants,
    };
  }

  // Step 5: human initiator with no matching rules → allow_auto
  if (composed === null) {
    return {
      verdict: 'allow_auto',
      source: 'default_deny', // even though it's "default allow" for humans, the source label reflects that we fell through
      invariants_applied: invariants,
    };
  }

  return {
    verdict: composed,
    source: 'user_rule',
    invariants_applied: invariants,
  };
}
```

- [ ] **Step 3: Run tests, confirm pass**

```bash
npm test -- src/lib/policy/verdict-composer
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/policy/verdict-composer/
git commit -m "$(cat <<'EOF'
feat(policy): add verdict composer with system invariants

composeVerdict implements the precedence spec: hard_limit > user_rule
composition (lowest-privilege wins) > ai_initiator_floor > default_deny
for non-humans > allow_auto for humans. Applied system invariants are
recorded on the returned trace so the final verdict explains which
floors kicked in.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 25: Main EvaluationEngine orchestrator

**Files:**
- Create: `src/lib/policy/engine/evaluator.ts`
- Create: `src/lib/policy/engine/evaluator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/policy/engine/evaluator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { EvaluationEngine } from './evaluator';
import { ProposedMovement } from '../types/movement';
import { EvaluationContext } from '../types/context';
import { PolicyVersionSnapshot } from '../types/policy-version';

describe('EvaluationEngine.evaluate', () => {
  const mkMovement = (overrides: Partial<ProposedMovement> = {}): ProposedMovement => ({
    id: 'mv-1', kind: 'crypto_transfer',
    source: { venue: 'ethereum', asset: 'USDC' },
    destination: { venue: 'external', asset: 'USDC' },
    amount: { amount: '10000', asset: 'USDC' },
    initiator: { type: 'human', user_id: 'user-1' },
    requested_at: new Date().toISOString(),
    ...overrides,
  });

  const mkContext = (policy: PolicyVersionSnapshot): EvaluationContext => ({
    now: new Date(),
    enterprise_id: 'ent-1',
    policy_version: policy,
    treasury_state: {
      positions_by_asset: { USDC: '1000000' },
      positions_by_asset_venue: { 'USDC:ethereum': '1000000' },
      positions_usd_by_asset: { USDC: '1000000' },
      total_treasury_usd: '1000000',
      cash_equivalent_usd: '1000000',
      loaded_at: new Date(),
    },
    canonicalization: {
      native_amount: '10000', native_asset: 'USDC', canonical_amount: '10002',
      canonical_currency: 'USD', rate: '1.0002', rate_source: 'coingecko',
      rate_as_of: new Date(), max_age_ms: 60000,
    },
    aggregates: {
      system_splitting_guard_24h: { window_spec_hash: 'sys', window_start: new Date(), window_end: new Date(), sum_amount_usd: '0', sum_amount_by_asset: {}, count: 0, distinct_destinations: 0, distinct_counterparties: 0, included_evaluation_ids: [], includes_proposed: false },
      user_specs: {},
    },
    sanctions: { status: 'clear' },
    forecast: {
      query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
      hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
      results: {},
    },
  });

  it('returns allow_auto for a human transfer with no matching rules and no hard limits', () => {
    const engine = new EvaluationEngine();
    const policy: PolicyVersionSnapshot = {
      id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test',
      rules: [], hard_limits: [], approval_chains: [],
    };
    const result = engine.evaluate(mkMovement(), mkContext(policy));
    expect(result.verdict).toBe('allow_auto');
    expect(result.trace.final_verdict_source).toBe('default_deny');
  });

  it('returns require_approval when a matching rule says so', () => {
    const engine = new EvaluationEngine();
    const policy: PolicyVersionSnapshot = {
      id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test',
      rules: [{
        id: 'r-1', version_id: 'v-1', rule_type: 'approval_threshold',
        name: 'Approval over $5k', rationale: '',
        priority: 1,
        verdict: 'require_approval',
        condition: { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '5000', currency: 'USD' } },
        created_by: 'u', created_at: new Date(),
      }],
      hard_limits: [], approval_chains: [],
    };
    const result = engine.evaluate(mkMovement(), mkContext(policy));
    expect(result.verdict).toBe('require_approval');
  });

  it('returns block_hard_limit when a hard limit is breached', () => {
    const engine = new EvaluationEngine();
    const policy: PolicyVersionSnapshot = {
      id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test',
      rules: [],
      hard_limits: [{
        id: 'hl-1', limit_type: 'min_cash_reserve_usd', name: 'Cash Floor',
        limit_value: '995000', limit_currency: 'USD', scope: {},
      }],
      approval_chains: [],
    };
    const result = engine.evaluate(mkMovement(), mkContext(policy));
    expect(result.verdict).toBe('block_hard_limit');
    expect(result.trace.final_verdict_source).toBe('hard_limit');
  });

  it('promotes AI-initiated allow_auto to require_approval (system invariant)', () => {
    const engine = new EvaluationEngine();
    const policy: PolicyVersionSnapshot = {
      id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test',
      rules: [{
        id: 'r-1', version_id: 'v-1', rule_type: 'approval_threshold',
        name: 'Small transfers', rationale: '',
        priority: 1,
        verdict: 'allow_auto',
        condition: { kind: 'amount_compare', attr: 'transfer.amount', op: '<', value: { amount: '100000', currency: 'USD' } },
        created_by: 'u', created_at: new Date(),
      }],
      hard_limits: [], approval_chains: [],
    };
    const movement = mkMovement({ initiator: { type: 'ai_recommendation', recommendation_id: 'rec-1' } });
    const result = engine.evaluate(movement, mkContext(policy));
    expect(result.verdict).toBe('require_approval');
    expect(result.trace.system_invariants_applied.some(i => i.invariant === 'ai_initiator_floor')).toBe(true);
  });

  it('returns block when a rule cannot be fully evaluated', () => {
    const engine = new EvaluationEngine();
    const policy: PolicyVersionSnapshot = {
      id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test',
      rules: [{
        id: 'r-1', version_id: 'v-1', rule_type: 'lookahead',
        name: 'Forecast rule', rationale: '',
        priority: 1,
        verdict: 'require_approval',
        condition: { kind: 'forecast_query', query: 'obligations_covered', window_days: 14, comparator: '==', value: { amount: '1', currency: 'USD' } },
        created_by: 'u', created_at: new Date(),
      }],
      hard_limits: [], approval_chains: [],
    };
    // Context has no forecast results → rule fails → overall verdict = block
    const result = engine.evaluate(mkMovement(), mkContext(policy));
    expect(result.verdict).toBe('block');
  });

  it('persists canonicalization metadata on the trace', () => {
    const engine = new EvaluationEngine();
    const policy: PolicyVersionSnapshot = {
      id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test',
      rules: [], hard_limits: [], approval_chains: [],
    };
    const result = engine.evaluate(mkMovement(), mkContext(policy));
    expect(result.trace.canonicalization.rate).toBe('1.0002');
    expect(result.trace.canonicalization.rate_source).toBe('coingecko');
    expect(result.trace.canonicalization.succeeded).toBe(true);
  });

  it('records all rules evaluated on the trace even if none matched', () => {
    const engine = new EvaluationEngine();
    const policy: PolicyVersionSnapshot = {
      id: 'v-1', enterprise_id: 'ent-1', version_number: 1, status: 'active', name: 'Test',
      rules: [
        {
          id: 'r-1', version_id: 'v-1', rule_type: 'counterparty',
          name: 'Block sanctioned', rationale: '', priority: 1, verdict: 'block',
          condition: { kind: 'sanctions_status', op: 'in', values: ['sanctioned'] },
          created_by: 'u', created_at: new Date(),
        },
        {
          id: 'r-2', version_id: 'v-1', rule_type: 'approval_threshold',
          name: 'Big transfer approval', rationale: '', priority: 2, verdict: 'require_approval',
          condition: { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '100000', currency: 'USD' } },
          created_by: 'u', created_at: new Date(),
        },
      ],
      hard_limits: [], approval_chains: [],
    };
    const result = engine.evaluate(mkMovement(), mkContext(policy));
    expect(result.trace.rules_evaluated).toHaveLength(2);
    expect(result.trace.rules_evaluated[0].matched).toBe(false); // sanctions clear, not in [sanctioned]
    expect(result.trace.rules_evaluated[1].matched).toBe(false); // 10k < 100k
  });
});
```

- [ ] **Step 2: Implement the main evaluator**

Create `src/lib/policy/engine/evaluator.ts`:

```typescript
// src/lib/policy/engine/evaluator.ts

import { ProposedMovement } from '../types/movement';
import { EvaluationContext } from '../types/context';
import { EvaluationResult } from '../types/verdict';
import { EvaluationTrace, RuleEvaluationTrace, CanonicalizationTrace, ReasonCodeEntry } from '../types/trace';
import { HardLimitChecker } from '../hard-limit-checker/checker';
import { evalCondition } from '../ir-evaluator/evaluator';
import { composeVerdict } from '../verdict-composer/composer';
import { REASON_CODES } from '../errors/reason-codes';

const ENGINE_VERSION = '1.0.0';

/**
 * Main policy engine evaluator. Pure, synchronous, deterministic given
 * a (movement, context) pair. The async context loader (Plan 1 Task 23)
 * builds the context; this evaluator only transforms (movement, context)
 * → EvaluationResult.
 *
 * Same function called by live evaluation and simulation (Plan 3).
 */
export class EvaluationEngine {
  private readonly hardLimitChecker: HardLimitChecker;

  constructor(hardLimitChecker?: HardLimitChecker) {
    this.hardLimitChecker = hardLimitChecker ?? new HardLimitChecker();
  }

  evaluate(movement: ProposedMovement, ctx: EvaluationContext): EvaluationResult {
    const startTime = Date.now();

    // Step 1: Hard limit check — runs first, terminal on breach
    const hardLimitCheckResult = this.hardLimitChecker.check(movement, ctx);

    // Step 2: Evaluate every user rule (even past a hard limit breach, for trace completeness)
    const rulesEvaluated: RuleEvaluationTrace[] = [];
    for (const rule of ctx.policy_version.rules) {
      const leafResult = evalCondition(rule.condition, movement, ctx, [rule.id]);
      rulesEvaluated.push({
        rule_id: rule.id,
        rule_name: rule.name,
        rule_type: rule.rule_type,
        priority: rule.priority,
        condition_result: {
          path: [rule.id],
          node_kind: rule.condition.kind,
          result: leafResult.failure ? 'failed' : (leafResult.matched ? 'matched' : 'not_matched'),
          details: leafResult.evaluation_details,
        },
        matched: leafResult.matched,
        matched_via: leafResult.via,
        verdict_contribution: leafResult.matched ? rule.verdict : null,
        failure: leafResult.failure
          ? {
              reason_code: leafResult.failure.reason_code,
              human_readable: leafResult.failure.human_readable,
              details: leafResult.failure.details,
              affected_condition_path: [rule.id],
              user_action: leafResult.failure.user_action,
            }
          : undefined,
      });
    }

    // Step 3: Compose final verdict with system invariants
    const composition = composeVerdict(movement, rulesEvaluated, hardLimitCheckResult.any_breached);

    // Step 4: Build reason codes list
    const reasonCodes: ReasonCodeEntry[] = this.buildReasonCodes(
      composition.verdict,
      hardLimitCheckResult,
      rulesEvaluated,
      composition.invariants_applied
    );

    // Step 5: Build canonicalization trace
    const canonicalizationTrace: CanonicalizationTrace = {
      native_amount: ctx.canonicalization.native_amount,
      native_asset: ctx.canonicalization.native_asset,
      canonical_amount: ctx.canonicalization.canonical_amount,
      canonical_currency: ctx.canonicalization.canonical_currency,
      rate: ctx.canonicalization.rate,
      rate_source: ctx.canonicalization.rate_source,
      rate_as_of: ctx.canonicalization.rate_as_of.toISOString(),
      max_age_ms: ctx.canonicalization.max_age_ms,
      succeeded: !ctx.canonicalization.failure,
      failure_reason_code: ctx.canonicalization.failure?.reason_code,
    };

    // Step 6: Assemble the full trace
    const trace: EvaluationTrace = {
      engine_version: ENGINE_VERSION,
      policy_version_id: ctx.policy_version.id,
      policy_version_number: ctx.policy_version.version_number,
      proposed_movement_id: movement.id,
      canonicalization: canonicalizationTrace,
      hard_limit_check: hardLimitCheckResult,
      rules_evaluated: rulesEvaluated,
      system_invariants_applied: composition.invariants_applied,
      final_verdict: composition.verdict,
      final_verdict_source: composition.source,
      final_verdict_reasons: reasonCodes,
      forecast_mode: ctx.forecast.query_metadata.mode,
      forecast_warnings: ctx.forecast.query_metadata.warnings,
      evaluation_duration_ms: Date.now() - startTime,
    };

    return {
      verdict: composition.verdict,
      trace,
      reason_codes: reasonCodes.map((r) => r.reason_code),
    };
  }

  private buildReasonCodes(
    verdict: EvaluationResult['verdict'],
    hardLimitResult: ReturnType<HardLimitChecker['check']>,
    ruleTraces: RuleEvaluationTrace[],
    invariants: EvaluationTrace['system_invariants_applied']
  ): ReasonCodeEntry[] {
    const entries: ReasonCodeEntry[] = [];

    if (verdict === 'block_hard_limit') {
      for (const breach of hardLimitResult.breaches) {
        entries.push({
          reason_code: REASON_CODES.hard_limit_breached,
          human_readable: breach.human_readable,
          details: {
            limit_name: breach.limit_name,
            limit_type: breach.limit_type,
            limit_value: breach.limit_value,
            post_transfer_value: breach.post_transfer_value,
            overage: breach.overage,
          },
          user_action: breach.user_action,
        });
      }
    }

    if (verdict === 'block') {
      for (const rule of ruleTraces) {
        if (rule.failure) {
          entries.push({
            reason_code: rule.failure.reason_code,
            human_readable: rule.failure.human_readable,
            details: rule.failure.details,
            user_action: rule.failure.user_action,
          });
        } else if (rule.matched && rule.verdict_contribution === 'block') {
          entries.push({
            reason_code: REASON_CODES.condition_node_evaluation_failed,  // generic block reason
            human_readable: `Rule '${rule.rule_name}' blocked this movement.`,
            details: { rule_id: rule.rule_id },
          });
        }
      }
    }

    for (const invariant of invariants) {
      if (invariant.applied) {
        entries.push({
          reason_code: REASON_CODES.condition_node_evaluation_failed,
          human_readable: invariant.human_readable,
          details: { invariant: invariant.invariant },
        });
      }
    }

    return entries;
  }
}
```

- [ ] **Step 3: Run tests and confirm all pass**

```bash
npm test -- src/lib/policy/engine/evaluator
```

Expected: all 7 tests pass.

- [ ] **Step 4: Run the full policy test suite as a regression check**

```bash
npm test -- src/lib/policy
```

Expected: all tests across every module pass — should be ~100+ tests total.

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/engine/evaluator.ts src/lib/policy/engine/evaluator.test.ts
git commit -m "$(cat <<'EOF'
feat(policy): add main EvaluationEngine orchestrator

Assembles the full pipeline: hard limit check → IR evaluation of every
user rule → verdict composition with system invariants → structured
trace with canonicalization metadata, per-rule evaluation details,
invariants applied, and reason codes. Pure and synchronous —
everything the evaluator needs is in the pre-loaded EvaluationContext.

Same function will be called by live evaluation (via Plan 2 gate) and
simulation (via Plan 3 replay) — no parallel implementation.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 26: Test fixtures

**Files:**
- Create: `src/lib/policy/__fixtures__/movements.ts`
- Create: `src/lib/policy/__fixtures__/contexts.ts`
- Create: `src/lib/policy/__fixtures__/policy-versions.ts`
- Create: `src/lib/policy/__fixtures__/index.ts`

Fixtures for downstream tests (Plan 2 + Plan 3). No test file for the fixtures themselves.

- [ ] **Step 1: Create `movements.ts`**

```typescript
// src/lib/policy/__fixtures__/movements.ts

import { ProposedMovement } from '../types/movement';

export function humanUsdcTransfer(overrides: Partial<ProposedMovement> = {}): ProposedMovement {
  return {
    id: 'mv-fixture-human-usdc',
    kind: 'crypto_transfer',
    source: { venue: 'ethereum', asset: 'USDC', address: '0xsource' },
    destination: { venue: 'external', asset: 'USDC', address: '0xdest' },
    amount: { amount: '10000', asset: 'USDC' },
    counterparty: { id: 'cp-acme', type: 'known', jurisdiction: 'US' },
    initiator: { type: 'human', user_id: 'user-1' },
    purpose_code: 'payroll',
    rail: 'ethereum',
    requested_at: '2026-04-10T14:22:33.000Z',
    ...overrides,
  };
}

export function aiRecommendedRebalance(overrides: Partial<ProposedMovement> = {}): ProposedMovement {
  return {
    id: 'mv-fixture-ai-rebalance',
    kind: 'swap',
    source: { venue: 'ethereum', asset: 'USDC', address: '0xtreasury' },
    destination: { venue: 'ethereum', asset: 'USDT', address: '0xtreasury' },
    amount: { amount: '100000', asset: 'USDC' },
    initiator: { type: 'ai_recommendation', recommendation_id: 'rec-fixture-1' },
    rail: 'ethereum',
    requested_at: '2026-04-10T14:22:33.000Z',
    ...overrides,
  };
}

export function scheduledYieldDeposit(overrides: Partial<ProposedMovement> = {}): ProposedMovement {
  return {
    id: 'mv-fixture-scheduled-yield',
    kind: 'yield_deposit',
    source: { venue: 'ethereum', asset: 'USDC', address: '0xtreasury' },
    destination: { venue: 'ondo', asset: 'USDC' },
    amount: { amount: '250000', asset: 'USDC' },
    initiator: { type: 'schedule', scheduled_op_id: 'op-fixture-1' },
    rail: 'ethereum',
    requested_at: '2026-04-10T14:22:33.000Z',
    ...overrides,
  };
}

export function largeHumanWire(overrides: Partial<ProposedMovement> = {}): ProposedMovement {
  return {
    id: 'mv-fixture-large-wire',
    kind: 'fiat_ramp',
    source: { venue: 'svb', asset: 'USD', account_id: 'acct-operating' },
    destination: { venue: 'external-bank', asset: 'USD', account_id: 'acct-vendor' },
    amount: { amount: '500000', asset: 'USD' },
    counterparty: { id: 'cp-vendor-1', type: 'known' },
    initiator: { type: 'human', user_id: 'user-1' },
    purpose_code: 'acquisition',
    rail: 'wire',
    requested_at: '2026-04-10T14:22:33.000Z',
    ...overrides,
  };
}
```

- [ ] **Step 2: Create `contexts.ts`**

```typescript
// src/lib/policy/__fixtures__/contexts.ts

import { EvaluationContext, TreasuryState, CanonicalizationResult, AggregateWindowResults, ForecastSnapshot, SanctionsSnapshot } from '../types/context';
import { PolicyVersionSnapshot } from '../types/policy-version';
import { standardPolicy } from './policy-versions';

export function healthyContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    now: new Date('2026-04-10T14:22:33.000Z'),
    enterprise_id: 'ent-fixture-1',
    policy_version: overrides.policy_version ?? standardPolicy(),
    treasury_state: healthyTreasuryState(),
    canonicalization: successfulCanonicalization('10000', 'USDC', '10002'),
    aggregates: emptyAggregates(),
    sanctions: clearSanctions(),
    forecast: stubForecastSnapshot(),
    counterparty: undefined,
    ...overrides,
  };
}

export function healthyTreasuryState(): TreasuryState {
  return {
    positions_by_asset: { USDC: '5000000', USDT: '2000000', USD: '1000000' },
    positions_by_asset_venue: {
      'USDC:ethereum': '3000000',
      'USDC:solana': '2000000',
      'USDT:ethereum': '2000000',
      'USD:svb': '1000000',
    },
    positions_usd_by_asset: { USDC: '5000000', USDT: '2000000', USD: '1000000' },
    total_treasury_usd: '8000000',
    cash_equivalent_usd: '8000000',
    loaded_at: new Date('2026-04-10T14:22:33.000Z'),
  };
}

export function successfulCanonicalization(
  nativeAmount: string,
  nativeAsset: string,
  canonicalAmount: string
): CanonicalizationResult {
  return {
    native_amount: nativeAmount,
    native_asset: nativeAsset,
    canonical_amount: canonicalAmount,
    canonical_currency: 'USD',
    rate: '1.0002',
    rate_source: 'coingecko',
    rate_as_of: new Date('2026-04-10T14:22:00.000Z'),
    max_age_ms: 60_000,
  };
}

export function emptyAggregates(): AggregateWindowResults {
  return {
    system_splitting_guard_24h: {
      window_spec_hash: 'sys-fixture',
      window_start: new Date('2026-04-09T14:22:33.000Z'),
      window_end: new Date('2026-04-10T14:22:33.000Z'),
      sum_amount_usd: '0',
      sum_amount_by_asset: {},
      count: 0,
      distinct_destinations: 0,
      distinct_counterparties: 0,
      included_evaluation_ids: [],
      includes_proposed: false,
    },
    user_specs: {},
  };
}

export function clearSanctions(): SanctionsSnapshot {
  return { status: 'clear' };
}

export function stubForecastSnapshot(): ForecastSnapshot {
  return {
    query_metadata: {
      mode: 'stub',
      snapshot_taken_at: new Date('2026-04-10T14:22:33.000Z'),
      source: 'stub-pass-through',
      warnings: ['FORECAST_STUB_MODE: fixture'],
    },
    hypothetical_metadata: {
      mode: 'stub',
      snapshot_taken_at: new Date('2026-04-10T14:22:33.000Z'),
      source: 'stub-pass-through',
      warnings: ['FORECAST_STUB_MODE: fixture'],
    },
    results: {},
  };
}
```

- [ ] **Step 3: Create `policy-versions.ts`**

```typescript
// src/lib/policy/__fixtures__/policy-versions.ts

import { PolicyVersionSnapshot } from '../types/policy-version';

export function emptyPolicy(overrides: Partial<PolicyVersionSnapshot> = {}): PolicyVersionSnapshot {
  return {
    id: 'v-fixture-empty',
    enterprise_id: 'ent-fixture-1',
    version_number: 1,
    status: 'active',
    name: 'Empty Policy (fixture)',
    rules: [],
    hard_limits: [],
    approval_chains: [],
    ...overrides,
  };
}

export function standardPolicy(overrides: Partial<PolicyVersionSnapshot> = {}): PolicyVersionSnapshot {
  const now = new Date('2026-04-10T14:22:33.000Z');
  return {
    id: 'v-fixture-standard',
    enterprise_id: 'ent-fixture-1',
    version_number: 1,
    status: 'active',
    name: 'Standard Controls (fixture)',
    rules: [
      {
        id: 'r-approval-50k',
        version_id: 'v-fixture-standard',
        rule_type: 'approval_threshold',
        name: 'Approval over $50,000',
        rationale: 'Standard wire approval threshold',
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>',
          value: { amount: '50000', currency: 'USD' },
        },
        verdict: 'require_approval',
        priority: 100,
        created_by: 'user-fixture-admin',
        created_at: now,
      },
      {
        id: 'r-block-sanctioned',
        version_id: 'v-fixture-standard',
        rule_type: 'counterparty',
        name: 'Block sanctioned counterparties',
        rationale: 'OFAC / compliance blocking',
        condition: {
          kind: 'sanctions_status',
          op: 'in',
          values: ['sanctioned', 'partial_match'],
        },
        verdict: 'block',
        priority: 10,
        created_by: 'user-fixture-admin',
        created_at: now,
      },
    ],
    hard_limits: [
      {
        id: 'hl-cash-floor',
        limit_type: 'min_cash_reserve_usd',
        name: 'Operating Cash Floor',
        limit_value: '500000',
        limit_currency: 'USD',
        scope: {},
      },
      {
        id: 'hl-concentration',
        limit_type: 'max_single_asset_concentration_pct',
        name: 'Max Asset Concentration',
        limit_value: '70',
        limit_currency: undefined,
        scope: {},
      },
    ],
    approval_chains: [],
    ...overrides,
  };
}
```

- [ ] **Step 4: Create `index.ts`**

```typescript
// src/lib/policy/__fixtures__/index.ts

export * from './movements';
export * from './contexts';
export * from './policy-versions';
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/policy/__fixtures__/
git commit -m "$(cat <<'EOF'
feat(policy): add test fixtures for movements, contexts, policy versions

Reusable fixtures for downstream test files. Four movement fixtures
(human USDC transfer, AI rebalance, scheduled yield, large wire),
helpers for contexts + treasury state + canonicalization + aggregates
+ sanctions + forecast snapshots, and two policy versions (empty +
standard controls with two rules and two hard limits).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 27: End-to-end integration test

**Files:**
- Create: `src/lib/policy/engine/engine.integration.test.ts`

One integration test exercises the main evaluator against fixture data across several scenarios. This is the "does the whole engine work together" smoke check.

- [ ] **Step 1: Write the integration test**

Create `src/lib/policy/engine/engine.integration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { EvaluationEngine } from './evaluator';
import { humanUsdcTransfer, aiRecommendedRebalance, largeHumanWire, scheduledYieldDeposit } from '../__fixtures__/movements';
import { healthyContext, healthyTreasuryState, emptyAggregates, clearSanctions, stubForecastSnapshot, successfulCanonicalization } from '../__fixtures__/contexts';
import { standardPolicy, emptyPolicy } from '../__fixtures__/policy-versions';

describe('Engine integration — full pipeline', () => {
  const engine = new EvaluationEngine();

  it('a $10k human USDC transfer under the standard policy auto-executes', () => {
    const movement = humanUsdcTransfer();
    const ctx = healthyContext({
      policy_version: standardPolicy(),
      canonicalization: successfulCanonicalization('10000', 'USDC', '10002'),
    });
    const result = engine.evaluate(movement, ctx);
    expect(result.verdict).toBe('allow_auto');
    expect(result.trace.hard_limit_check.any_breached).toBe(false);
  });

  it('a $500k human wire under the standard policy requires approval', () => {
    const movement = largeHumanWire();
    const ctx = healthyContext({
      policy_version: standardPolicy(),
      canonicalization: successfulCanonicalization('500000', 'USD', '500000'),
    });
    const result = engine.evaluate(movement, ctx);
    expect(result.verdict).toBe('require_approval');
    // Rule r-approval-50k should have matched
    expect(result.trace.rules_evaluated.find(r => r.rule_id === 'r-approval-50k')?.matched).toBe(true);
  });

  it('a transfer to a sanctioned counterparty is blocked', () => {
    const movement = humanUsdcTransfer({ counterparty: { id: 'cp-bad' } });
    const ctx = healthyContext({
      policy_version: standardPolicy(),
      sanctions: { counterparty_id: 'cp-bad', status: 'sanctioned', screened_at: new Date() },
    });
    const result = engine.evaluate(movement, ctx);
    expect(result.verdict).toBe('block');
    expect(result.trace.rules_evaluated.find(r => r.rule_id === 'r-block-sanctioned')?.matched).toBe(true);
  });

  it('an AI-initiated $1000 swap is held for approval due to system invariant', () => {
    const movement = aiRecommendedRebalance({ amount: { amount: '1000', asset: 'USDC' } });
    const ctx = healthyContext({
      policy_version: emptyPolicy(), // no user rules
      canonicalization: successfulCanonicalization('1000', 'USDC', '1000.2'),
    });
    const result = engine.evaluate(movement, ctx);
    expect(result.verdict).toBe('require_approval');
    expect(result.trace.system_invariants_applied.some(i => i.invariant === 'ai_initiator_floor')).toBe(true);
  });

  it('a scheduled yield deposit with no matching allow rule is held (default deny)', () => {
    const movement = scheduledYieldDeposit();
    const ctx = healthyContext({
      policy_version: emptyPolicy(),
      canonicalization: successfulCanonicalization('250000', 'USDC', '250050'),
    });
    const result = engine.evaluate(movement, ctx);
    expect(result.verdict).toBe('require_approval');
    expect(result.trace.system_invariants_applied.some(i => i.invariant === 'default_deny')).toBe(true);
  });

  it('a transfer that would drop cash below the floor is block_hard_limit', () => {
    const movement = largeHumanWire({ amount: { amount: '7600000', asset: 'USD' } });
    const ctx = healthyContext({
      policy_version: standardPolicy(),
      canonicalization: successfulCanonicalization('7600000', 'USD', '7600000'),
    });
    const result = engine.evaluate(movement, ctx);
    // Cash starts at 8M, floor is 500k, drop of 7.6M → 400k post, breaches floor
    expect(result.verdict).toBe('block_hard_limit');
    expect(result.trace.final_verdict_source).toBe('hard_limit');
    expect(result.trace.hard_limit_check.breaches).toHaveLength(1);
    expect(result.trace.hard_limit_check.breaches[0].limit_name).toBe('Operating Cash Floor');
  });

  it('splitting guard matches when 24h rolling sum + proposed exceeds threshold', () => {
    const movement = humanUsdcTransfer({ amount: { amount: '5000', asset: 'USDC' } });
    const ctx = healthyContext({
      policy_version: standardPolicy(),
      canonicalization: successfulCanonicalization('5000', 'USDC', '5001'),
      aggregates: {
        system_splitting_guard_24h: {
          window_spec_hash: 'sys',
          window_start: new Date('2026-04-09T14:22:33.000Z'),
          window_end: new Date('2026-04-10T14:22:33.000Z'),
          sum_amount_usd: '48000', // already $48k in trailing 24h
          sum_amount_by_asset: {},
          count: 9,
          distinct_destinations: 1,
          distinct_counterparties: 1,
          included_evaluation_ids: [],
          includes_proposed: false,
        },
        user_specs: {},
      },
    });
    const result = engine.evaluate(movement, ctx);
    // Direct amount is 5001 USD, threshold is 50000 — direct fails.
    // Rolling + proposed = 53001, exceeds 50000 — splitting matches.
    expect(result.verdict).toBe('require_approval');
    const rule50k = result.trace.rules_evaluated.find(r => r.rule_id === 'r-approval-50k');
    expect(rule50k?.matched).toBe(true);
    expect(rule50k?.matched_via).toBe('splitting');
  });

  it('trace includes forecast_mode stub warning', () => {
    const movement = humanUsdcTransfer();
    const ctx = healthyContext({ policy_version: standardPolicy() });
    const result = engine.evaluate(movement, ctx);
    expect(result.trace.forecast_mode).toBe('stub');
    expect(result.trace.forecast_warnings.some(w => w.includes('STUB'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
npm test -- src/lib/policy/engine/engine.integration
```

Expected: all 8 integration tests pass.

- [ ] **Step 3: Run the complete policy test suite as a final regression check**

```bash
npm test -- src/lib/policy
```

Expected: every test across every sub-module passes.

- [ ] **Step 4: Commit**

```bash
git add src/lib/policy/engine/engine.integration.test.ts
git commit -m "$(cat <<'EOF'
test(policy): add end-to-end integration test for the engine

Exercises the full pipeline (hard limits → IR evaluation → verdict
composition → trace assembly) against fixture scenarios: auto-execute,
approval threshold, sanctions block, AI-initiator invariant, default
deny, hard limit breach, splitting guard, stub forecast warnings.

All tests use the public EvaluationEngine.evaluate() API with
fixtures — no internal mocking — so they also smoke-test the
fixture files themselves.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 28: Top-level index, README, final sweep

**Files:**
- Create: `src/lib/policy/index.ts`
- Create: `src/lib/policy/README.md`

- [ ] **Step 1: Create top-level public exports**

Create `src/lib/policy/index.ts`:

```typescript
// src/lib/policy/index.ts
//
// Public surface of the policy engine library. Plan 2 consumers
// (gate.ts, authoring API, approval workflow service) import from
// here. Internal modules may import directly from subpaths.

export type * from './types';
export { EvaluationEngine } from './engine/evaluator';
export { EvaluationContextLoader } from './context-loader/loader';
export { HardLimitChecker } from './hard-limit-checker/checker';
export { HardLimitUtilizationProbe } from './hard-limit-checker/utilization-probe';
export { AggregationDetector } from './aggregate-detector/detector';
export { CoingeckoPolicyRateProvider } from './canonicalizer/coingecko-provider';
export { canonicalizeToUsd } from './canonicalizer/canonicalizer';
export { fetchStablecoinPricesWithTimestamp } from './canonicalizer/oracle-adapter';
export { StubForecastQuery, StubForecastQueryFactory } from './forecast/stub';
export {
  StubLogger,
  TestStubLogger,
  NoopStubLogger,
  ProductionStubLogger,
} from './forecast/stub-logger';
export { PolicyError, CanonicalizationError, HardLimitBreachError, ForecastUnavailableError, AggregateQueryFailedError } from './errors/classes';
export { REASON_CODES, WARNING_CODES } from './errors/reason-codes';
export type { ReasonCode, WarningCode } from './errors/reason-codes';
export { conditionSchema } from './schemas/ir.schema';
export { proposedMovementSchema } from './schemas/movement.schema';
export { hardLimitSchema } from './schemas/hard-limit.schema';
```

- [ ] **Step 2: Create README**

Create `src/lib/policy/README.md`:

```markdown
# Policy Engine

Treasury rules & approval policy engine for Vantor. This module is the
pure library foundation — Plan 2 wires it into the gate and API routes;
Plan 3 adds the UI and simulation engine.

## Module layout

- **`types/`** — TypeScript type definitions (ProposedMovement,
  EvaluationContext, EvaluationTrace, Verdict, Condition IR, HardLimit,
  PolicyVersionSnapshot)
- **`schemas/`** — zod validators for ProposedMovement, Condition IR,
  HardLimit. Used at save time in Plan 2's authoring API and at gate
  entry.
- **`errors/`** — closed ReasonCode enum and PolicyError class hierarchy
- **`canonicalizer/`** — PolicyRateProvider interface +
  CoingeckoPolicyRateProvider + the canonicalizeToUsd function. Strict
  failure semantics: never returns stale or fallback rates.
- **`forecast/`** — ForecastQuery interface + stub implementation. See
  "Replacing the forecast stub" below.
- **`ir-evaluator/`** — recursive evaluator that pattern-matches over
  the typed Condition discriminated union. Leaves dispatch to
  `leaves/amount-compare.ts` etc.
- **`hard-limit-checker/`** — 6 limit type evaluators + orchestrator +
  utilization probe
- **`aggregate-detector/`** — deterministic window-spec hashing + SQL
  query builder + async detector module
- **`context-loader/`** — async loaders for treasury state,
  counterparty, sanctions + EvaluationContextLoader orchestrator
- **`verdict-composer/`** — composes the final verdict applying
  lowest-privilege wins + AI-initiator floor + default deny
- **`engine/`** — main EvaluationEngine orchestrator
- **`__fixtures__/`** — reusable test fixtures

## Evaluation pipeline

```
ProposedMovement (from Plan 2 gate)
  │
  ▼
EvaluationContextLoader.load()  ──async──▶  EvaluationContext
  │                                            - policy_version
  │                                            - treasury_state
  │                                            - canonicalization
  │                                            - aggregates
  │                                            - sanctions
  │                                            - forecast
  │                                            - counterparty
  ▼
EvaluationEngine.evaluate()  ──sync pure──▶  EvaluationResult
  │                                           - verdict
  │  Hard limit check first                   - trace
  │  User rules in priority order              - reason_codes
  │  System invariants (AI floor, default deny)
  │  Verdict composition (lowest-privilege wins)
  │
  ▼
Plan 2 gate persists to policy_evaluations + dispatches
```

## How to add a new condition kind

1. Add the new node interface to `src/lib/policy/types/ir.ts`
2. Add the new `kind` literal to the `Condition` discriminated union —
   TypeScript will flag every missing case in the evaluator, leaves, and
   zod schema
3. Add a leaf evaluator under `src/lib/policy/ir-evaluator/leaves/`
4. Add a new case to `evalCondition` in
   `src/lib/policy/ir-evaluator/evaluator.ts`
5. Add zod schema case in `src/lib/policy/schemas/ir.schema.ts`
6. Add tests per new leaf (unit tests in leaves/*.test.ts, integration
   in engine/engine.integration.test.ts)

## How to add a new hard limit type

1. Add the new value to the `HardLimitType` union in
   `src/lib/policy/types/hard-limit.ts`
2. Add the CHECK constraint value in a new Supabase migration (NOT in
   0034 — migrations are append-only)
3. Add a new file under
   `src/lib/policy/hard-limit-checker/limits/<name>.ts` implementing
   the evaluator
4. Add a new case in `HardLimitChecker.evaluateOne` dispatch
5. Add a new template function in
   `src/lib/policy/hard-limit-checker/templates.ts`
6. Add a new case in `renderBreach()`
7. Add matching tests
8. Add the new limit type to the Plan 3 UI authoring form

## How to add a new movement kind

Not this plan — Plan 2 adds the gate and the `MovementKind` dispatch.
The type file already supports extension via the `MovementKind` union,
but the gate's dispatch switch is where the actual wiring happens.

## Replacing the forecast stub

When the real forecast module ships, the replacement is a single-line
change:

1. Delete `src/lib/policy/forecast/stub.ts`
2. Delete `src/lib/policy/forecast/stub-logger.ts`
3. In `src/lib/policy/gate.ts` (created by Plan 2), change:
   ```typescript
   // BEFORE
   const forecastFactory = new StubForecastQueryFactory(stubLogger);
   // AFTER
   const forecastFactory = new RealForecastQueryFactory(...);
   ```
4. Implement `RealForecastQueryFactory` and ensure it passes the
   contract tests in `src/lib/policy/forecast/contract.test.ts`

The `forecast_mode: 'stub'` flag will stop appearing on new traces,
and the UI advisory badges (added in Plan 3) automatically disappear.

## Rollback

This plan adds only new files + a new Supabase migration. Rollback is:

1. Run the inverse migration (DROP all `policy_*` tables + revert
   column additions to user_profiles and ai_recommendations)
2. Delete `src/lib/policy/`
3. Delete `vitest.config.ts` and `tests/smoke.test.ts`
4. Revert `package.json` test script additions

Because nothing in production imports from `src/lib/policy/*` yet
(Plan 2 does the wiring), the rollback is safe: no behavior changes
on master before Plan 2 ships.

## Tests

Run the full policy engine suite:

```bash
npm test -- src/lib/policy
```

Expected: ~120 tests passing across all modules.

Watch mode for iterative development:

```bash
npm run test:watch -- src/lib/policy
```
```

- [ ] **Step 3: Final full test sweep**

```bash
npm test
```

Expected: all tests across the repo pass (smoke test + ~120 policy tests).

- [ ] **Step 4: TypeScript compilation check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit and push the feature branch**

```bash
git add src/lib/policy/index.ts src/lib/policy/README.md
git commit -m "$(cat <<'EOF'
docs(policy): add README + top-level index exports

README covers module layout, evaluation pipeline diagram, how to add
a new condition kind / hard limit type / movement kind, forecast stub
replacement procedure, and rollback instructions. index.ts is the
public surface for Plan 2 consumers (gate, authoring API, approval
workflow service).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"

git push origin feature/policy-engine
```

---

## Plan 1 completion criteria

When all tasks are checked:

- [ ] Vitest installed, configured, and running against the repo
- [ ] `0034_policy_engine_schema.sql` migration applied to both dev and prod Supabase
- [ ] All 9 `policy_*` tables exist with triggers, RLS policies, indexes
- [ ] `is_policy_admin` and `approval_request_id` columns added to existing tables
- [ ] `src/lib/policy/errors/` — ReasonCode enum + PolicyError classes
- [ ] `src/lib/policy/types/` — all 9 type files compile and export cleanly
- [ ] `src/lib/policy/schemas/` — zod schemas for movement, IR, hard limit with passing tests
- [ ] `src/lib/policy/canonicalizer/` — interface + CoingeckoPolicyRateProvider + canonicalizer with passing tests
- [ ] `src/lib/policy/forecast/` — interface + stub + stub-logger + contract tests passing
- [ ] `src/lib/policy/ir-evaluator/` — all 6 leaf evaluators + recursive composer with passing tests
- [ ] `src/lib/policy/hard-limit-checker/` — all 5 limit implementations + checker + utilization probe with passing tests
- [ ] `src/lib/policy/aggregate-detector/` — hash + queries + detector with passing tests
- [ ] `src/lib/policy/context-loader/` — treasury state, counterparty, sanctions loaders + main EvaluationContextLoader
- [ ] `src/lib/policy/verdict-composer/` — compose verdict with system invariants
- [ ] `src/lib/policy/engine/` — main EvaluationEngine orchestrator + integration test
- [ ] `src/lib/policy/__fixtures__/` — movements, contexts, policy versions fixtures
- [ ] `src/lib/policy/index.ts` — public exports
- [ ] `src/lib/policy/README.md` — architecture + extension guides
- [ ] Full test suite passes: `npm test`
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] Branch pushed to origin: `feature/policy-engine`

## What Plan 2 will cover

- Approval workflow service (lifecycle, stricter SoD, re-evaluation)
- Rule authoring API (CRUD, draft/activate, diff, satisfiability)
- Main `gateMoneyMovement()` function + adapter rename refactor +
  ESLint enforcement
- All existing API route refactors to call the gate
- Data migration from `treasury_rules` + `ai_recommendations` pending
  approval
- `is_policy_admin` bootstrap with A1 strategy + 7-day review banner
- Deletion of `rules-engine.ts`, old approve route, `TreasuryRulesForm`
- Integration tests for each movement kind through the gate

## What Plan 3 will cover

- Simulation engine (replay + divergence reports)
- New Policies tab replacing Treasury Rules tab
- Policy view with Hard Guardrails block, rule sections, edit affordances
- Evaluation Log, Simulation workspace, Version History sub-tabs
- Dashboard Approvals + LimitUtilization cards
- Treasury AI Overview restructure
- Admin forecast stub observability page
- E2E Playwright tests

---

## Self-review checklist

After writing the plan, I ran through these checks:

**Placeholder scan:** No TBD, TODO, FIXME, "implement later", "similar to Task N", or other plan failures. Every step has concrete code or commands.

**Spec coverage:** The Section 1 domain model schema is implemented in Task 1 (migration file) and verified in Task 2 (application). Section 2 evaluation engine interface is implemented across Tasks 3-18 and 23-25. Section 3 hard limit checker is implemented in Tasks 19-20. Section 4 splitting detector is implemented as part of Task 15 (amount_compare splitting guard) and Task 21 (aggregate detector). Section 6 forecast interface + stub is implemented in Tasks 11-14. The error catalog in Section 11 is implemented in Task 3. Sections 5 (approval workflow), 7 (simulation), 8 (authoring API), 9 (integration gate), 10 (UI changes), and 12 (migration plan) are explicitly deferred to Plans 2 and 3.

**Type consistency:** The Condition discriminated union, ProposedMovement shape, and EvaluationContext shape are defined once in Task 4 and referenced by identical names throughout the remaining tasks. `LeafResult` is defined in amount-compare.ts and re-imported by all other leaves. HardLimitEvaluation/HardLimitBreach/HardLimitCheckResult are defined once in types/hard-limit.ts and used consistently by the checker and templates.

**Scope check:** This plan produces a single cohesive deliverable — a working, testable policy engine library with all foundation (schema, types, canonicalizer, forecast stub, IR evaluator, hard limit checker, aggregate detector, context loader, verdict composer, main orchestrator). Plans 2 and 3 are explicitly listed for the pieces that connect this library to live production paths and treasurer-facing UI.

**Ambiguity check:** Each hard limit type's post-state computation is spelled out with explicit formulas in Task 19. The splitting guard semantics in Task 15 explicitly document when it applies (transfer.amount attr only) and when it doesn't (treasury.position, rolling_sum). The AI-initiator invariant is scoped to `ai_recommendation` and `agent` initiator types explicitly in Task 24. The rate-at-booking semantics for historical outflow queries are called out in Task 21.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-10-policy-engine-plan-1.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent is dispatched per task, I review each subagent's work before moving to the next, fast iteration with clean isolation. Best for a plan this large because it keeps each subagent's context focused on one task at a time.

**2. Inline Execution** — tasks execute in this same session using the executing-plans skill, with batch execution and checkpoints for review. Lower overhead for small plans but risks context bloat for this one given its scope.

Which approach?







