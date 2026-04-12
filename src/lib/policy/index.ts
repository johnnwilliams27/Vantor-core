// src/lib/policy/index.ts
//
// Public surface of the policy engine library. Plan 2 consumers
// (gate.ts, authoring API, approval workflow service) import from
// here. Internal modules may import directly from subpaths when
// needed for tighter coupling.

// Types
export type * from './types';

// Core engine
export { EvaluationEngine } from './engine/evaluator';
export { EvaluationContextLoader } from './context-loader/loader';
export type { EvaluationContextLoaderDeps } from './context-loader/loader';

// Hard limit checking
export { HardLimitChecker } from './hard-limit-checker/checker';
export { HardLimitUtilizationProbe } from './hard-limit-checker/utilization-probe';
export { renderBreach } from './hard-limit-checker/templates';

// Aggregate detector
export { AggregationDetector } from './aggregate-detector/detector';
export { computeWindowSpecHash } from './aggregate-detector/hash';
export type {
  AggregateQueryParams,
  RawAggregateResult,
  RunAggregateQuery,
} from './aggregate-detector/queries';
export { buildAggregateQuerySql } from './aggregate-detector/queries';

// Canonicalizer
export { CoingeckoPolicyRateProvider } from './canonicalizer/coingecko-provider';
export type {
  StablecoinPricesResult,
  CoingeckoPolicyRateProviderOpts,
} from './canonicalizer/coingecko-provider';
export { canonicalizeToUsd, buildCanonicalizationResult } from './canonicalizer/canonicalizer';
export { fetchStablecoinPricesWithTimestamp } from './canonicalizer/oracle-adapter';
export type { PolicyRateProvider, RateReading } from './canonicalizer/interface';
export { POLICY_RATE_MAX_AGE_MS } from './canonicalizer/interface';

// Forecast (stub for Plan 1; Plan 2 swaps for real implementation)
export { StubForecastQuery, StubForecastQueryFactory } from './forecast/stub';
export { TestStubLogger, NoopStubLogger, ProductionStubLogger } from './forecast/stub-logger';
export type { StubLogger, ProductionStubLoggerDeps } from './forecast/stub-logger';
export type {
  ForecastQuery,
  ForecastQueryFactory,
  ForecastQueryMetadata,
  ObligationCoverageResult,
  Obligation,
} from './forecast/interface';

// IR evaluator
export { evalCondition } from './ir-evaluator/evaluator';
export type { ConditionPath } from './ir-evaluator/evaluator';
export type { LeafResult, LeafFailure } from './ir-evaluator/leaves/amount-compare';

// Verdict composer
export { composeVerdict } from './verdict-composer/composer';
export type { ComposeVerdictResult } from './verdict-composer/composer';

// Errors
export {
  PolicyError,
  CanonicalizationError,
  CanonicalizationSourceUnavailableError,
  CanonicalizationRateStaleError,
  HardLimitBreachError,
  ForecastUnavailableError,
  AggregateQueryFailedError,
} from './errors/classes';
export type { PolicyErrorInit, PolicyErrorEnvelope } from './errors/classes';
export { REASON_CODES, WARNING_CODES } from './errors/reason-codes';
export type { ReasonCode, WarningCode } from './errors/reason-codes';

// Schemas
export { conditionSchema, MAX_CONDITION_DEPTH, MAX_WINDOW_MS } from './schemas/ir.schema';
export { proposedMovementSchema } from './schemas/movement.schema';
export type {
  ProposedMovementInput,
  ProposedMovementParsed,
} from './schemas/movement.schema';
export { hardLimitSchema } from './schemas/hard-limit.schema';
export type { HardLimitInput, HardLimitParsed } from './schemas/hard-limit.schema';

export * from './authoring';
export * from './approvals';
