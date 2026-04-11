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
    args: Record<string, unknown>,
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
    const consoleLogger = this.deps.consoleLogger ?? defaultConsoleLogger;

    // 1. Console log (structured)
    consoleLogger('[POLICY_FORECAST_STUB]', {
      enterprise_id: enterpriseId,
      method,
      args,
      timestamp: new Date().toISOString(),
      note: 'Forecast stub in use — real forecast module not yet deployed',
    });

    // 2. DB counter (fire-and-forget; failures should not block the evaluator)
    this.deps
      .insertStubCall({
        enterprise_id: enterpriseId,
        method,
        args_json: args,
        called_at: new Date(),
      })
      .catch((err) => {
        // Swallowing errors is intentional — we don't want a stub-logger
        // failure to block evaluation. We DO want to surface it to console.
        consoleLogger('[POLICY_FORECAST_STUB_LOGGER_ERROR]', {
          enterprise_id: enterpriseId,
          method,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    // 3. Sentry breadcrumb (optional)
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
