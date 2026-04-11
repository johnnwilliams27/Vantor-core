/**
 * Detector framework types.
 *
 * A Detector is a pure function from a DetectorContext (the snapshot of
 * the world at a point in time) to a list of DetectedInsight objects.
 * The cron orchestrator builds the context once and hands it to every
 * registered detector via `runAllDetectors()`. Detectors never query
 * the database directly — all data lives in the context.
 *
 * This pattern follows `src/lib/yield/rates/index.ts` (the fetcher
 * registry), which is the idiomatic pluggable-module pattern in this
 * codebase: Promise.allSettled, isolated failures, unit-testable in
 * isolation.
 */

import type { TreasurySnapshot } from '@/lib/treasury/interface';
import type { DetectedInsight } from '../types';
import type { YieldUniverseView } from '../yield-universe';
import type { RiskProfile } from '../risk-profiles';
import type { AumTier, CustomerKycTier } from '../types';

/**
 * The world-state every detector sees. Built once per cron cycle per
 * enterprise by the orchestrator. Immutable — detectors MUST NOT mutate
 * any field.
 */
export interface DetectorContext {
  enterpriseId: string;
  userId: string;
  /** The full treasury snapshot including bank, crypto, and yield positions. */
  snapshot: TreasurySnapshot;
  /** The customer's risk profile. */
  profile: RiskProfile;
  /** AUM tier for per-tier overrides. */
  aumTier: AumTier;
  /** Customer KYC tier (optional). */
  customerKycTier?: CustomerKycTier;
  /**
   * Pre-built yield universe view for the customer's primary asset
   * (typically USDC). Detectors that need a different asset/chain slice
   * can call `buildYieldUniverse` themselves, but most v1 detectors
   * only need this default view.
   */
  yieldUniverse: YieldUniverseView;
  /** Wall clock at the start of the cycle. Use this instead of new Date() for deterministic testing. */
  now: Date;
}

/**
 * A single detector module. Every detector exports a default object of
 * this shape and is registered in `registry.ts`.
 */
export interface Detector {
  /** Unique stable name used for logging and the `detector_name` column. */
  name: string;
  /** Run the detector and return the insights it found. Must not throw —
   *  errors should be caught internally and logged. The orchestrator will
   *  also catch via Promise.allSettled, but in-detector error handling
   *  produces better logs with more context. */
  run(ctx: DetectorContext): Promise<DetectedInsight[]>;
}
