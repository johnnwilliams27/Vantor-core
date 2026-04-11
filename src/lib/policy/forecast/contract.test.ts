import { describe, it, expect } from 'vitest';
import { ForecastQueryFactory } from './interface';
import { StubForecastQueryFactory } from './stub';
import { NoopStubLogger } from './stub-logger';
import { ProposedMovement } from '../types/movement';

/**
 * Shared contract test suite. Every ForecastQuery implementation must
 * pass this suite. Called once with the stub; future real implementations
 * will add another `describeForecastQueryContract(...)` call.
 */
function describeForecastQueryContract(name: string, makeFactory: () => ForecastQueryFactory) {
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
      expect(r1.obligations_checked).toBe(r2.obligations_checked);
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
