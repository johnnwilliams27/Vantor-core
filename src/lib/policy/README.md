# Policy Engine

Treasury rules & approval policy engine for Vantor. This module is the pure library foundation — Plan 2 wires it into the gate and API routes; Plan 3 adds the UI and simulation engine.

## Module layout

- **`types/`** — TypeScript type definitions (ProposedMovement, EvaluationContext, EvaluationTrace, Verdict, Condition IR, HardLimit, PolicyVersionSnapshot)
- **`schemas/`** — zod validators for ProposedMovement, Condition IR, HardLimit. Used at save time in Plan 2's authoring API and at gate entry.
- **`errors/`** — closed ReasonCode enum and PolicyError class hierarchy
- **`canonicalizer/`** — PolicyRateProvider interface + CoingeckoPolicyRateProvider + canonicalizeToUsd function. Strict failure semantics: never returns stale or fallback rates. Uses a parallel `getStablecoinPricesStrict()` helper that throws on every failure mode (the display-side `getStablecoinPrices()` is intentionally fail-open).
- **`forecast/`** — ForecastQuery interface + stub implementation. See "Replacing the forecast stub" below.
- **`ir-evaluator/`** — recursive evaluator that pattern-matches over the typed Condition discriminated union. Leaves dispatch to `leaves/amount-compare.ts` etc. `MAX_EVALUATION_DEPTH=64` runtime guard on top of the schema's compile-time `MAX_CONDITION_DEPTH=32`.
- **`hard-limit-checker/`** — 5 limit type evaluators + orchestrator + utilization probe + breach templates
- **`aggregate-detector/`** — deterministic window-spec hashing + SQL query builder + async detector module
- **`context-loader/`** — async loaders for treasury state, counterparty, sanctions + EvaluationContextLoader orchestrator
- **`verdict-composer/`** — composes the final verdict applying lowest-privilege wins + AI-initiator floor + default deny for non-humans
- **`engine/`** — main EvaluationEngine orchestrator (pure, sync)
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
  │  Hard limit check first (always all limits)  - verdict
  │  If any limit failed to evaluate → block     - trace
  │  Walk every user rule via IR evaluator       - reason_codes
  │  Compose verdict (lowest-privilege wins)
  │  AI initiator floor for ai/agent movements
  │  Default deny for non-human, default allow for human
  │
  ▼
Plan 2 gate persists to policy_evaluations + dispatches
```

## Fail-closed semantics

The engine is fail-closed at every layer:

1. **Canonicalizer:** strict oracle helper throws on every failure mode (non-OK, invalid JSON, missing/non-numeric/zero/negative prices, mock mode in prod). `canonicalizeToUsd` catches these and returns a `CanonicalizationResult` with a populated `failure` field — it never throws and never returns silent fallback values.
2. **IR leaves:** every leaf has a never-throws contract (`matched=true → failure=undefined`). Malformed inputs, big.js arithmetic errors, missing context fields all become structured `LeafResult.failure` entries.
3. **Recursive composer:** AND fail-fasts on any child failure; OR returns the first failure only when no child matched (any match short-circuits); NOT propagates child failure unchanged. `MAX_EVALUATION_DEPTH=64` guards against pathological recursion.
4. **Hard limit evaluators:** every limit validates decimal inputs via `isValidDecimalString` before big.js; canonicalization failures propagate as limit failures. Phase-1 conservatism: every movement is treated as a worst-case outflow.
5. **Verdict composer:** cannot-fully-evaluate → `block`. AI initiator floor is enforced at composition time — no path to `allow_auto` for `ai_recommendation` / `agent` initiators. Unknown verdict_contribution values fail closed.
6. **Main engine:** if any hard limit failed to evaluate (not breached, but failure field populated), the engine short-circuits to `block` with `source='hard_limit'`. Per-rule try/catch catches `assertNever` crashes and converts them to rule failures.

## How to add a new Condition kind

1. Add the new node interface to `src/lib/policy/types/ir.ts`
2. Add the new `kind` literal to the `Condition` discriminated union — TypeScript will flag every missing case in the evaluator, leaves, and zod schema via `assertNever` switches
3. Add a leaf evaluator under `src/lib/policy/ir-evaluator/leaves/`
4. Add a new case to `evalCondition` in `src/lib/policy/ir-evaluator/evaluator.ts`
5. Add zod schema case in `src/lib/policy/schemas/ir.schema.ts`
6. Add tests per new leaf and update the integration test

## How to add a new hard limit type

1. Add the new value to the `HardLimitType` union in `src/lib/policy/types/hard-limit.ts`
2. Add a new Supabase migration with the CHECK constraint value (migrations are append-only — don't edit 0034)
3. Add a new file under `src/lib/policy/hard-limit-checker/limits/<name>.ts` implementing the evaluator
4. Add a new case in `HardLimitChecker.evaluateOne` dispatch
5. Add a new template function in `src/lib/policy/hard-limit-checker/templates.ts` and a case in `renderBreach`
6. Add matching tests
7. Add the new limit type to the Plan 3 UI authoring form

## Replacing the forecast stub

When the real forecast module ships, the replacement is a single-line change in Plan 2's `gate.ts`:

1. Implement `RealForecastQueryFactory` that satisfies the contract tests in `src/lib/policy/forecast/contract.test.ts`
2. In `gate.ts`:
   ```typescript
   // BEFORE
   const forecastFactory = new StubForecastQueryFactory(stubLogger);
   // AFTER
   const forecastFactory = new RealForecastQueryFactory(...);
   ```
3. Delete `src/lib/policy/forecast/stub.ts` and `stub-logger.ts`

The `forecast_mode: 'stub'` flag will stop appearing on new traces, and any UI advisory badges (Plan 3) automatically disappear.

## Rollback

This plan adds only new files + a new Supabase migration. Rollback is:

1. Run the inverse migration (DROP all `policy_*` tables + revert column additions)
2. Delete `src/lib/policy/`
3. Revert `vitest.config.ts`, `tests/smoke.test.ts`, and `package.json` test script additions

Because nothing in production imports from `src/lib/policy/*` yet (Plan 2 does the wiring), the rollback is safe: no behavior changes on master before Plan 2 ships.

## Tests

Run the full policy engine suite:

```bash
npm test -- src/lib/policy
```

Expected: 432+ tests passing across canonicalizer, forecast, IR leaves + evaluator, hard-limit checker + limits, aggregate detector, context loader, verdict composer, main engine, and integration tests.

Watch mode for iterative development:

```bash
npm test -- src/lib/policy --watch
```
