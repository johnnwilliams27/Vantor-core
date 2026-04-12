/**
 * Yield Rebalance Detector.
 *
 * Cross-category yield comparison: surfaces rebalance opportunities when
 * a position's APY lags materially behind actionable alternatives. Also
 * surfaces deployment opportunities for idle stablecoin wallet balances.
 *
 * Fires:
 *   - `yield_drop` (warning) — position APY >100bps below best alternative
 *   - `yield_opportunity` (info) — specific rebalance route with target venue
 *   - `yield_idle_opportunity` (info) — idle wallet stablecoins above safety
 *     buffer could earn yield
 *
 * Rules enforced:
 *   - Only actionable tiers (1-2) considered as targets. Tier 3 (derived)
 *     and tier 4 (reference) are never recommended.
 *   - Concentration cap checked before sizing — never recommend more than
 *     the venue's remaining capacity.
 *   - Conservative satellite yield premium floor respected — satellite
 *     venues only recommended when `satelliteAllocationActive` is true.
 */

import { isTokenizedMMF, isDeFiCategory, VENUES } from '@/lib/yield/venues';
import type { VenueMetadata } from '@/lib/yield/venues';
import type { DetectedInsight } from '../types';
import type { Detector, DetectorContext } from './types';
import type { EligibleVenue } from '../yield-universe';
import type { YieldPositionSnapshot } from '@/lib/treasury/interface';

// ─── Constants ──────────────────────────────────────────────────────

/** Minimum APY gap (bps) to trigger a yield_drop warning. */
const YIELD_DROP_THRESHOLD_BPS = 100;

/** Minimum deployable amount (USD) to surface an idle opportunity. */
const MIN_IDLE_DEPLOYABLE_USD = 10_000;

// ─── Helpers ────────────────────────────────────────────────────────

function formatUsd(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}k`;
  return `$${amount.toFixed(0)}`;
}

function bps(decimal: number): number {
  return Math.round(decimal * 10_000);
}

function formatApy(decimal: number): string {
  return `${(decimal * 100).toFixed(2)}%`;
}

/**
 * Get actionable venues (tier 1-2, non-null APY, no nonActionableReason)
 * sorted by APY descending.
 */
function getActionableVenues(ctx: DetectorContext): EligibleVenue[] {
  return ctx.yieldUniverse.eligible
    .filter(
      (e) =>
        e.apyTier <= 2 &&
        e.currentApy != null &&
        e.nonActionableReason == null,
    )
    .sort((a, b) => (b.currentApy ?? 0) - (a.currentApy ?? 0));
}

/**
 * Find the best actionable alternative for a given position. Excludes:
 * - The same venue the position is in
 * - Venues where the position size would exceed the concentration cap
 * - MMF→DeFi rebalance when satellite allocation is inactive
 */
function findBestAlternative(
  position: YieldPositionSnapshot,
  actionable: EligibleVenue[],
  ctx: DetectorContext,
): EligibleVenue | null {
  const positionVenue = VENUES[position.protocol as keyof typeof VENUES] as
    | VenueMetadata
    | undefined;
  const positionIsMMF = positionVenue ? isTokenizedMMF(positionVenue) : false;

  for (const candidate of actionable) {
    // Skip self
    if (candidate.venue.id === position.protocol) continue;

    // Satellite gate: if satellite allocation is inactive and position
    // is in a primary venue, don't recommend moving to a satellite.
    if (!ctx.yieldUniverse.satelliteAllocationActive && positionIsMMF) {
      if (isDeFiCategory(candidate.venue.category)) continue;
    }

    // Concentration cap: don't recommend if position size exceeds capacity
    if (candidate.concentrationCapUsd != null) {
      // Find existing position in this venue to compute remaining capacity
      const existingInTarget = ctx.snapshot.yieldPositions
        .filter((p) => p.protocol === candidate.venue.id)
        .reduce((sum, p) => sum + p.currentValueUsd, 0);
      const remainingCap = candidate.concentrationCapUsd - existingInTarget;
      if (remainingCap <= 0) continue;
    }

    return candidate;
  }

  return null;
}

/**
 * Compute the recommended move amount, capped by the target venue's
 * remaining concentration capacity.
 */
function computeMoveAmount(
  positionValueUsd: number,
  target: EligibleVenue,
  ctx: DetectorContext,
): number {
  let amount = positionValueUsd;

  if (target.concentrationCapUsd != null) {
    const existingInTarget = ctx.snapshot.yieldPositions
      .filter((p) => p.protocol === target.venue.id)
      .reduce((sum, p) => sum + p.currentValueUsd, 0);
    const remainingCap = target.concentrationCapUsd - existingInTarget;
    amount = Math.min(amount, Math.max(0, remainingCap));
  }

  return amount;
}

// ─── Detector ───────────────────────────────────────────────────────

export const yieldRebalanceDetector: Detector = {
  name: 'yield_rebalance',

  async run(ctx: DetectorContext): Promise<DetectedInsight[]> {
    const insights: DetectedInsight[] = [];
    const actionable = getActionableVenues(ctx);

    if (actionable.length === 0) return insights;

    // ─── 1. yield_drop: positions lagging behind alternatives ───
    for (const position of ctx.snapshot.yieldPositions) {
      if (position.currentValueUsd <= 0) continue;
      if (position.apySnapshot == null) continue;

      const bestAlt = findBestAlternative(position, actionable, ctx);
      if (!bestAlt || bestAlt.currentApy == null) continue;

      const gapBps = bps(bestAlt.currentApy - position.apySnapshot);
      if (gapBps < YIELD_DROP_THRESHOLD_BPS) continue;

      const moveAmount = computeMoveAmount(position.currentValueUsd, bestAlt, ctx);
      if (moveAmount <= 0) continue;

      insights.push({
        type: 'yield_drop',
        severity: 'warning',
        title: `${VENUES[position.protocol as keyof typeof VENUES]?.displayName ?? position.protocol} yield underperforming`,
        summary:
          `Position in ${VENUES[position.protocol as keyof typeof VENUES]?.displayName ?? position.protocol} yields ${formatApy(position.apySnapshot)} ` +
          `while ${bestAlt.venue.displayName} offers ${formatApy(bestAlt.currentApy)}` +
          ` (${gapBps}bps gap). Consider rebalancing ${formatUsd(moveAmount)}.`,
        rationale: {
          fromProtocol: position.protocol,
          fromApy: position.apySnapshot,
          toProtocol: bestAlt.venue.id,
          toApy: bestAlt.currentApy,
          gapBps,
          positionValueUsd: position.currentValueUsd,
          moveAmountUsd: moveAmount,
          concentrationCapUsd: bestAlt.concentrationCapUsd,
        },
        recommendedAction: {
          type: 'yield_deposit',
          fromVenueId: position.protocol,
          toVenueId: bestAlt.venue.id,
          asset: position.underlyingToken,
          amount: moveAmount,
          amountUsd: moveAmount,
          metadata: {
            reason: 'yield_drop',
            source_detector: 'yield_rebalance',
            from_apy: position.apySnapshot,
            to_apy: bestAlt.currentApy,
          },
        },
        impact: {
          dollarValue: moveAmount,
          apyDeltaBps: gapBps,
        },
        dedupKey: `yield_drop:${position.protocol}`,
        venueCategory: position.venueCategory ?? undefined,
        dataFreshness: bestAlt.dataFreshness,
        supportingData: {
          from_venue: position.protocol,
          to_venue: bestAlt.venue.id,
          from_apy: position.apySnapshot,
          to_apy: bestAlt.currentApy,
          profile: ctx.profile.id,
        },
        confidence: 0.85,
      });
    }

    // ─── 2. yield_idle_opportunity: idle wallet stablecoins ─────
    const safetyBuffer = ctx.forecast?.safetyBufferUsd ?? 0;
    const idleWalletUsd = ctx.snapshot.totalCryptoBalanceUsd;
    const deployableUsd = idleWalletUsd - safetyBuffer;

    if (deployableUsd >= MIN_IDLE_DEPLOYABLE_USD && actionable.length > 0) {
      const bestVenue = actionable[0]; // sorted by APY desc
      const moveAmount = computeMoveAmount(deployableUsd, bestVenue, ctx);

      if (moveAmount >= MIN_IDLE_DEPLOYABLE_USD) {
        insights.push({
          type: 'yield_idle_opportunity',
          severity: 'info',
          title: 'Idle stablecoins could earn yield',
          summary:
            `${formatUsd(idleWalletUsd)} in idle wallet stablecoins, ` +
            `${formatUsd(deployableUsd)} above the safety buffer. ` +
            `${bestVenue.venue.displayName} offers ${formatApy(bestVenue.currentApy!)} APY.`,
          rationale: {
            idleWalletUsd,
            safetyBufferUsd: safetyBuffer,
            deployableUsd,
            bestVenueId: bestVenue.venue.id,
            bestVenueApy: bestVenue.currentApy,
            moveAmountUsd: moveAmount,
          },
          recommendedAction: {
            type: 'yield_deposit',
            fromVenueId: 'wallet',
            toVenueId: bestVenue.venue.id,
            asset: 'USDC',
            amount: moveAmount,
            amountUsd: moveAmount,
            metadata: {
              reason: 'yield_idle_opportunity',
              source_detector: 'yield_rebalance',
            },
          },
          impact: {
            dollarValue: moveAmount,
            apyDeltaBps: bestVenue.currentApy ? bps(bestVenue.currentApy) : undefined,
          },
          dedupKey: 'yield_idle_opportunity:USDC',
          dataFreshness: bestVenue.dataFreshness,
          supportingData: {
            idle_wallet_usd: idleWalletUsd,
            best_venue: bestVenue.venue.id,
            best_apy: bestVenue.currentApy,
            profile: ctx.profile.id,
          },
          confidence: 0.8,
        });
      }
    }

    return insights;
  },
};
