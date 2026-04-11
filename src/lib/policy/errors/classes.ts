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
  user_action: string;
  details?: Record<string, unknown>;
  cause?: unknown;
  occurred_at?: string;
}

export class PolicyError extends Error {
  readonly reason_code: ReasonCode;
  readonly module: string;
  readonly human_readable: string;
  readonly user_action: string;
  readonly details: Record<string, unknown>;
  readonly occurred_at: string;
  readonly cause: unknown;

  constructor(init: PolicyErrorInit) {
    super(
      `[${init.reason_code}] ${init.human_readable}`,
      init.cause !== undefined ? { cause: init.cause } : undefined,
    );
    this.name = 'PolicyError';
    this.reason_code = init.reason_code;
    this.module = init.module;
    this.human_readable = init.human_readable;
    this.user_action = init.user_action;
    this.details = init.details ?? {};
    this.occurred_at = init.occurred_at ?? new Date().toISOString();
    this.cause = init.cause;
  }

  toJSON(): PolicyErrorEnvelope {
    return {
      reason_code: this.reason_code,
      module: this.module,
      human_readable: this.human_readable,
      user_action: this.user_action,
      details: this.details,
      occurred_at: this.occurred_at,
      ...(this.cause instanceof Error
        ? { cause: { name: this.cause.name, message: this.cause.message } }
        : {}),
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
  cause?: { name: string; message: string } | undefined;
}

/** Canonicalization failed for any reason — rate stale, source down, unsupported asset. */
export class CanonicalizationError extends PolicyError {
  constructor(
    init: Omit<PolicyErrorInit, 'reason_code' | 'module'> & { reason_code?: ReasonCode },
  ) {
    super({
      ...init,
      reason_code: init.reason_code ?? REASON_CODES.canonicalization_failed,
      module: 'canonicalizer',
    });
    this.name = 'CanonicalizationError';
  }
}

/** Canonicalization failed because the rate source is unreachable, mock, or unconfigured. */
export class CanonicalizationSourceUnavailableError extends CanonicalizationError {
  constructor(init: Omit<PolicyErrorInit, 'reason_code' | 'module'>) {
    super({ ...init, reason_code: REASON_CODES.canonicalization_source_unavailable });
    this.name = 'CanonicalizationSourceUnavailableError';
  }
}

/** Canonicalization failed because the rate reading is older than POLICY_RATE_MAX_AGE_MS. */
export class CanonicalizationRateStaleError extends CanonicalizationError {
  constructor(init: Omit<PolicyErrorInit, 'reason_code' | 'module'>) {
    super({ ...init, reason_code: REASON_CODES.canonicalization_rate_stale });
    this.name = 'CanonicalizationRateStaleError';
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
