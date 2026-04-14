/**
 * Concentration Risk Detector.
 *
 * Monitors treasury composition against risk-profile concentration limits.
 * This is one of the three v1 detectors and is UNBLOCKED — it only depends
 * on foundation work already merged (snapshot with yield positions, venue
 * category registry, risk profiles). Does not depend on the forecast
 * module or the policy engine.
 *
 * Concentration axes monitored in v1:
 *   - Per-protocol on satellite (DeFi vaults + lending markets)
 *   - Per-curator on satellite (for profiles with curator caps)
 *   - Per-issuer on primary (tokenized MMFs — applies per-issuer not per-venue)
 *   - Per-chain across total yield AUM
 *
 * Fires:
 *   - `concentration_warning` at `warningThresholdPct` of the cap (default 80%)
 *   - `concentration_breach` above the cap
 *
 * Recommendation structure: identifies the breached axis, the current %,
 * the cap, and suggests a target rebalance amount (USD to move out of the
 * over-concentrated position). The actual destination is NOT prescribed —
 * that's the Yield Rebalance detector's job once it lands. Concentration
 * says "too much here"; Rebalance says "go here instead".
 */

import { getVenue, isTokenizedMMF, isDeFiCategory } from '@/lib/yield/venues';
import type { DetectedInsight } from '../types';
import type { Detector, DetectorContext } from './types';
import type { YieldPositionSnapshot } from '@/lib/treasury/interface';

// ─── Helpers ─────────────────────────────────────────────────────────

function formatUsd(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}k`;
  }
  return `$${amount.toFixed(0)}`;
}

function formatPct(decimal: number): string {
  return `${(decimal * 100).toFixed(1)}%`;
}

/**
 * Classify a yield position into its primary/satellite bucket based on
 * the venue category. Primary = tokenized MMF. Satellite = DeFi vault
 * or lending market.
 */
function isPositionPrimary(position: YieldPositionSnapshot): boolean {
  if (!position.venueCategory) return false;
  return position.venueCategory === 'tokenized_mmf';
}

function isPositionSatellite(position: YieldPositionSnapshot): boolean {
  if (!position.venueCategory) return false;
  return isDeFiCategory(position.venueCategory);
}

// ─── Detector ────────────────────────────────────────────────────────

export const concentrationDetector: Detector = {
  name: 'concentration',

  async run(ctx: DetectorContext): Promise<DetectedInsight[]> {
    const insights: DetectedInsight[] = [];
    const { snapshot, profile } = ctx;

    const totalYieldAumUsd = snapshot.totalYieldBalanceUsd;
    if (totalYieldAumUsd <= 0) {
      // No yield positions, nothing to concentrate. Early return.
      return insights;
    }

    // Group positions by several axes
    const perProtocol = new Map<string, number>();
    const perCurator = new Map<string, number>();
    const perIssuer = new Map<string, number>();
    const perChain = new Map<string, number>();
    let totalSatelliteUsd = 0;
    let totalPrimaryUsd = 0;

    for (const position of snapshot.yieldPositions) {
      const valueUsd = position.currentValueUsd;
      if (valueUsd <= 0) continue;

      // Always track per-chain
      const chainKey = position.chain;
      perChain.set(chainKey, (perChain.get(chainKey) ?? 0) + valueUsd);

      const venue = getVenue(position.protocol);
      if (!venue) continue; // unknown venue — can't categorize

      // Per-protocol on ALL positions (used for per-protocol satellite cap)
      perProtocol.set(position.protocol, (perProtocol.get(position.protocol) ?? 0) + valueUsd);

      if (isPositionSatellite(position)) {
        totalSatelliteUsd += valueUsd;

        // Per-curator lookup (DeFi vaults only — lending markets don't have curators)
        if (venue.category === 'defi_vault') {
          const curator = venue.curator;
          perCurator.set(curator, (perCurator.get(curator) ?? 0) + valueUsd);
        }
      } else if (isPositionPrimary(position)) {
        totalPrimaryUsd += valueUsd;

        // Per-issuer lookup (MMFs)
        if (isTokenizedMMF(venue)) {
          const issuer = venue.issuer;
          perIssuer.set(issuer, (perIssuer.get(issuer) ?? 0) + valueUsd);
        }
      }
    }

    // ─── 1. Per-protocol satellite concentration ─────────────────
    // Use the per-vault cap from the profile. Check against total yield AUM
    // as the denominator — if a protocol holds more than the cap, flag it.
    for (const [protocolId, amountUsd] of Array.from(perProtocol.entries())) {
      const venue = getVenue(protocolId);
      if (!venue || !isDeFiCategory(venue.category)) continue;

      // The per-vault cap depends on the vault's TVL, which lives in the
      // yield universe view. Look it up there.
      const eligibleView = ctx.yieldUniverse.eligible.find((e) => e.venue.id === protocolId);
      const cap = eligibleView?.concentrationCapUsd ?? null;
      if (cap == null) continue; // no TVL, can't compute cap — skip

      const warningThreshold = cap * profile.concentration.warningThresholdPct;
      const breached = amountUsd >= cap;
      const warning = !breached && amountUsd >= warningThreshold;

      if (!warning && !breached) continue;

      const type = breached ? 'concentration_breach' : 'concentration_warning';
      const severity = breached ? 'critical' : 'warning';
      const pctOfAum = amountUsd / totalYieldAumUsd;
      const pctOfCap = amountUsd / cap;
      const excessOverCap = Math.max(0, amountUsd - cap);

      insights.push({
        channel: 'deterministic',
        type,
        severity,
        title: breached
          ? `${venue.displayName} concentration breach`
          : `${venue.displayName} approaching concentration cap`,
        summary: breached
          ? `${formatUsd(amountUsd)} in ${venue.displayName} exceeds the ${profile.displayName} per-vault cap of ${formatUsd(cap)} (${eligibleView?.concentrationCapReason ?? 'profile limit'}). ` +
            `Consider reducing this position by ${formatUsd(excessOverCap)} to stay within the cap.`
          : `${formatUsd(amountUsd)} in ${venue.displayName} is ${formatPct(pctOfCap)} of the ${profile.displayName} per-vault cap of ${formatUsd(cap)}. ` +
            `Consider diversifying before hitting the cap.`,
        rationale: {
          axis: 'per_vault',
          protocol: protocolId,
          displayName: venue.displayName,
          category: venue.category,
          amountUsd,
          capUsd: cap,
          capReason: eligibleView?.concentrationCapReason,
          pctOfAum,
          pctOfCap,
          excessOverCap,
          profile: profile.id,
          breached,
        },
        // Recommend a reduction but no specific destination (that's the
        // Yield Rebalance detector's job). Amount is the excess over cap
        // for breaches, or the gap to the cap for warnings.
        recommendedAction: breached
          ? {
              type: 'yield_withdraw',
              fromVenueId: protocolId,
              toVenueId: 'unallocated',
              asset: 'USDC',
              amount: excessOverCap,
              amountUsd: excessOverCap,
              metadata: {
                reason: 'concentration_breach',
                source_detector: 'concentration',
              },
            }
          : null,
        impact: {
          dollarValue: breached ? excessOverCap : undefined,
        },
        dedupKey: `${type}:per_vault:${protocolId}`,
        venueCategory: venue.category,
        dataFreshness: eligibleView?.dataFreshness ?? 'fresh',
        supportingData: {
          total_yield_aum_usd: totalYieldAumUsd,
          vault_tvl_usd: eligibleView?.tvlUsd,
          profile: profile.id,
        },
        confidence: 0.95,
      });
    }

    // ─── 2. Per-curator satellite concentration ──────────────────
    // Only applies for profiles that define a per-curator cap.
    const perCuratorCap = profile.concentration.satellitePerCuratorMaxPct;
    if (perCuratorCap != null && totalSatelliteUsd > 0) {
      for (const [curator, amountUsd] of Array.from(perCurator.entries())) {
        const pctOfSatellite = amountUsd / totalSatelliteUsd;
        const warningThreshold = perCuratorCap * profile.concentration.warningThresholdPct;
        const breached = pctOfSatellite >= perCuratorCap;
        const warning = !breached && pctOfSatellite >= warningThreshold;

        if (!warning && !breached) continue;

        const type = breached ? 'concentration_breach' : 'concentration_warning';
        const severity = breached ? 'critical' : 'warning';
        const excessPct = Math.max(0, pctOfSatellite - perCuratorCap);
        const excessUsd = excessPct * totalSatelliteUsd;

        insights.push({
          channel: 'deterministic',
          type,
          severity,
          title: breached
            ? `${curator} curator concentration breach`
            : `${curator} curator approaching cap`,
          summary: breached
            ? `${formatPct(pctOfSatellite)} of satellite AUM (${formatUsd(amountUsd)}) sits in vaults curated by ${curator}, above the ${profile.displayName} per-curator cap of ${formatPct(perCuratorCap)}. ` +
              `Consider reducing exposure by ${formatUsd(excessUsd)}.`
            : `${formatPct(pctOfSatellite)} of satellite AUM is in vaults curated by ${curator}, approaching the ${formatPct(perCuratorCap)} per-curator cap. ` +
              `Consider diversifying across additional curators.`,
          rationale: {
            axis: 'per_curator',
            curator,
            amountUsd,
            capPct: perCuratorCap,
            pctOfSatellite,
            excessPct,
            excessUsd,
            profile: profile.id,
            breached,
          },
          recommendedAction: null, // no specific target — needs curator-aware routing
          impact: {
            dollarValue: breached ? excessUsd : undefined,
          },
          dedupKey: `${type}:per_curator:${curator}`,
          dataFreshness: 'fresh',
          supportingData: {
            total_satellite_usd: totalSatelliteUsd,
            profile: profile.id,
          },
          confidence: 0.9,
        });
      }
    }

    // ─── 3. Per-issuer primary concentration ─────────────────────
    // Applies only if there are primary positions.
    if (totalPrimaryUsd > 0) {
      const issuerCap = profile.concentration.primaryPerIssuerMaxPct;
      const warningThreshold = issuerCap * profile.concentration.warningThresholdPct;

      for (const [issuer, amountUsd] of Array.from(perIssuer.entries())) {
        const pctOfPrimary = amountUsd / totalPrimaryUsd;
        const breached = pctOfPrimary >= issuerCap;
        const warning = !breached && pctOfPrimary >= warningThreshold;

        if (!warning && !breached) continue;

        const type = breached ? 'concentration_breach' : 'concentration_warning';
        const severity = breached ? 'critical' : 'warning';
        const excessPct = Math.max(0, pctOfPrimary - issuerCap);
        const excessUsd = excessPct * totalPrimaryUsd;

        insights.push({
          channel: 'deterministic',
          type,
          severity,
          title: breached
            ? `${issuer} issuer concentration breach`
            : `${issuer} issuer approaching cap`,
          summary: breached
            ? `${formatPct(pctOfPrimary)} of primary allocation (${formatUsd(amountUsd)}) is in ${issuer}-issued tokenized MMFs, above the ${profile.displayName} per-issuer cap of ${formatPct(issuerCap)}. ` +
              `Consider diversifying across additional MMF issuers by ${formatUsd(excessUsd)}.`
            : `${formatPct(pctOfPrimary)} of primary allocation is in ${issuer}-issued MMFs, approaching the ${formatPct(issuerCap)} per-issuer cap. ` +
              `Consider diversifying across additional issuers.`,
          rationale: {
            axis: 'per_issuer',
            issuer,
            amountUsd,
            capPct: issuerCap,
            pctOfPrimary,
            excessPct,
            excessUsd,
            profile: profile.id,
            breached,
          },
          recommendedAction: null,
          impact: {
            dollarValue: breached ? excessUsd : undefined,
          },
          dedupKey: `${type}:per_issuer:${issuer}`,
          venueCategory: 'tokenized_mmf',
          dataFreshness: 'fresh',
          supportingData: {
            total_primary_usd: totalPrimaryUsd,
            profile: profile.id,
          },
          confidence: 0.95,
        });
      }
    }

    // ─── 4. Per-chain concentration ──────────────────────────────
    const chainCap = profile.concentration.perChainMaxPct;
    const chainWarnThreshold = chainCap * profile.concentration.warningThresholdPct;

    for (const [chain, amountUsd] of Array.from(perChain.entries())) {
      const pctOfAum = amountUsd / totalYieldAumUsd;
      const breached = pctOfAum >= chainCap;
      const warning = !breached && pctOfAum >= chainWarnThreshold;

      if (!warning && !breached) continue;

      // Per-chain concentration often applies naturally (e.g. most MMFs are
      // on Ethereum) — emit as warning only unless very heavily skewed.
      // Skip outright breaches for single-chain portfolios where >95% on
      // one chain is structural, not a warning.
      const skipSingleChain = perChain.size === 1 && pctOfAum > 0.95;
      if (skipSingleChain) continue;

      const type = breached ? 'concentration_breach' : 'concentration_warning';
      const severity = breached ? 'warning' : 'info'; // chain concentration is less critical

      insights.push({
        channel: 'deterministic',
        type,
        severity,
        title: `${chain} chain concentration ${breached ? 'breach' : 'warning'}`,
        summary: `${formatPct(pctOfAum)} of yield AUM (${formatUsd(amountUsd)}) is on ${chain}. ` +
          `${profile.displayName} per-chain cap is ${formatPct(chainCap)}. Consider diversifying across chains.`,
        rationale: {
          axis: 'per_chain',
          chain,
          amountUsd,
          capPct: chainCap,
          pctOfAum,
          profile: profile.id,
          breached,
        },
        recommendedAction: null,
        impact: {},
        dedupKey: `${type}:per_chain:${chain}`,
        dataFreshness: 'fresh',
        supportingData: {
          total_yield_aum_usd: totalYieldAumUsd,
          profile: profile.id,
        },
        confidence: 0.8,
      });
    }

    return insights;
  },
};
