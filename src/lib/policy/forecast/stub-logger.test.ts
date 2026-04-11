import { describe, it, expect, vi, afterEach } from 'vitest';
import { TestStubLogger, NoopStubLogger, ProductionStubLogger } from './stub-logger';

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

describe('ProductionStubLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to flush microtasks so the fire-and-forget .catch handler runs
  const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

  it('calls insertStubCall with the right shape', () => {
    const insertStubCall = vi.fn().mockResolvedValue(undefined);
    const consoleLogger = vi.fn();
    const logger = new ProductionStubLogger({ insertStubCall, consoleLogger });

    logger.logStubCall('getProjectedMinBalance', 'ent-7', { asset: 'USDC', windowDays: 14 });

    expect(insertStubCall).toHaveBeenCalledTimes(1);
    expect(insertStubCall).toHaveBeenCalledWith({
      enterprise_id: 'ent-7',
      method: 'getProjectedMinBalance',
      args_json: { asset: 'USDC', windowDays: 14 },
      called_at: expect.any(Date),
    });
  });

  it('calls consoleLogger with structured payload on every invocation', () => {
    const insertStubCall = vi.fn().mockResolvedValue(undefined);
    const consoleLogger = vi.fn();
    const logger = new ProductionStubLogger({ insertStubCall, consoleLogger });

    logger.logStubCall('hypothetical', 'ent-2', { movement_id: 'mv-1' });

    expect(consoleLogger).toHaveBeenCalledWith(
      '[POLICY_FORECAST_STUB]',
      expect.objectContaining({
        enterprise_id: 'ent-2',
        method: 'hypothetical',
        args: { movement_id: 'mv-1' },
        timestamp: expect.any(String),
        note: expect.stringContaining('stub'),
      }),
    );
  });

  it('falls back to console.warn when consoleLogger is not provided', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const insertStubCall = vi.fn().mockResolvedValue(undefined);
    const logger = new ProductionStubLogger({ insertStubCall });

    logger.logStubCall('m', 'ent-3', {});

    expect(warnSpy).toHaveBeenCalledWith(
      '[POLICY_FORECAST_STUB]',
      expect.stringContaining('"enterprise_id":"ent-3"'),
    );
  });

  it('calls sentryBreadcrumb when provided', () => {
    const insertStubCall = vi.fn().mockResolvedValue(undefined);
    const consoleLogger = vi.fn();
    const sentryBreadcrumb = vi.fn();
    const logger = new ProductionStubLogger({ insertStubCall, consoleLogger, sentryBreadcrumb });

    logger.logStubCall('areObligationsCovered', 'ent-4', { windowDays: 30 });

    expect(sentryBreadcrumb).toHaveBeenCalledWith({
      category: 'policy.forecast.stub',
      message: 'Stub call: areObligationsCovered',
      level: 'warning',
      data: { enterprise_id: 'ent-4', method: 'areObligationsCovered' },
    });
  });

  it('skips sentryBreadcrumb when not provided (no error)', () => {
    const insertStubCall = vi.fn().mockResolvedValue(undefined);
    const consoleLogger = vi.fn();
    const logger = new ProductionStubLogger({ insertStubCall, consoleLogger });

    expect(() => logger.logStubCall('m', 'ent-5', {})).not.toThrow();
    expect(consoleLogger).toHaveBeenCalled();
    expect(insertStubCall).toHaveBeenCalled();
  });

  it('swallows insertStubCall errors and logs them via consoleLogger', async () => {
    const consoleLogger = vi.fn();
    const insertStubCall = vi.fn().mockRejectedValue(new Error('db down'));
    const logger = new ProductionStubLogger({ insertStubCall, consoleLogger });

    logger.logStubCall('getProjectedMinBalance', 'ent-1', { asset: 'USDC' });

    // Flush pending microtasks so the .catch handler runs
    await flushMicrotasks();

    expect(consoleLogger).toHaveBeenCalledTimes(2);
    expect(consoleLogger).toHaveBeenNthCalledWith(
      1,
      '[POLICY_FORECAST_STUB]',
      expect.objectContaining({ method: 'getProjectedMinBalance', enterprise_id: 'ent-1' }),
    );
    expect(consoleLogger).toHaveBeenNthCalledWith(
      2,
      '[POLICY_FORECAST_STUB_LOGGER_ERROR]',
      expect.objectContaining({
        method: 'getProjectedMinBalance',
        enterprise_id: 'ent-1',
        error: 'db down',
      }),
    );
  });

  it('logStubCall returns void synchronously even when insert fails', async () => {
    const consoleLogger = vi.fn();
    const insertStubCall = vi.fn().mockRejectedValue(new Error('db down'));
    const logger = new ProductionStubLogger({ insertStubCall, consoleLogger });

    expect(() => logger.logStubCall('m', 'ent-1', {})).not.toThrow();

    // Flush so the rejection doesn't leak into the next test
    await flushMicrotasks();
  });
});
