/**
 * Liquidity & Safety Buffer Detector.
 *
 * Fires two insight types:
 *   - `liquidity_below_buffer` (critical) — projected minimum balance drops
 *     below the safety buffer computed by the cron orchestrator.
 *   - `liquidity_idle_cash` (info) — available liquid cash exceeds 2× the
 *     safety buffer, suggesting capital that could be deployed.
 *
 * Both rely on `ctx.forecast` being present. The detector degrades
 * gracefully (returns []) when the forecast bundle is absent.
 *
 * Available cash is defined as: bank + wallet stablecoins + MMF positions.
 * DeFi positions are intentionally excluded — they are not same-day liquid.
 *
 * Safety buffer is pre-computed by the orchestrator as:
 *   totalObligations × profile.safetyBufferMultiplier
 * and passed in via `forecast.safetyBufferUsd`.
 */

import type { DetectedInsight } from '../types';
import type { Detector, DetectorContext } from './types';

const IDLE_CASH_MULTIPLIER = 2;

function formatUsd(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}k`;
  return `$${amount.toFixed(0)}`;
}

function estimateBufferDays(
  currentCashUsd: number,
  safetyBufferUsd: number,
  windowDays: number,
  totalObligationsUsd: number,
): number | undefined {
  if (totalObligationsUsd <= 0 || windowDays <= 0) return undefined;
  const dailyBurn = totalObligationsUsd / windowDays;
  if (dailyBurn <= 0) return undefined;
  const surplus = currentCashUsd - safetyBufferUsd;
  if (surplus <= 0) return 0;
  return Math.floor(surplus / dailyBurn);
}

export const liquidityDetector: Detector = {
  name: 'liquidity',

  async run(ctx: DetectorContext): Promise<DetectedInsight[]> {
    const { forecast, snapshot, profile } = ctx;
    if (!forecast) return [];

    const insights: DetectedInsight[] = [];
    const projectedMin = forecast.projectedMinBalance.amount;
    const safetyBuffer = forecast.safetyBufferUsd;
    const availableCashUsd =
      snapshot.totalBankBalanceUsd +
      snapshot.totalCryptoBalanceUsd +
      snapshot.totalMmfPositionsUsd;
    const totalObligationsUsd = forecast.obligationsInWindow.reduce(
      (sum, o) => sum + o.amount, 0,
    );

    const belowBuffer = projectedMin < safetyBuffer;

    if (belowBuffer) {
      const shortfallUsd = safetyBuffer - projectedMin;
      const bufferDays = estimateBufferDays(
        availableCashUsd, safetyBuffer, forecast.windowDays, totalObligationsUsd,
      );

      insights.push({
        type: 'liquidity_below_buffer',
        severity: 'critical',
        title: 'Projected balance falls below safety buffer',
        summary:
          `Projected minimum balance of ${formatUsd(projectedMin)} on ${forecast.projectedMinBalance.date} ` +
          `is ${formatUsd(shortfallUsd)} below the ${profile.displayName} safety buffer of ${formatUsd(safetyBuffer)}` +
          (forecast.coverage.shortfallAmount
            ? `. Obligation shortfall of ${formatUsd(forecast.coverage.shortfallAmount)} expected on ${forecast.coverage.firstShortfallDate}.`
            : '.'),
        rationale: {
          projectedMinUsd: projectedMin,
          projectedMinDate: forecast.projectedMinBalance.date,
          safetyBufferUsd: safetyBuffer,
          shortfallUsd,
          profileMultiplier: profile.safetyBufferMultiplier,
          totalObligationsUsd,
          obligationCount: forecast.obligationsInWindow.length,
          windowDays: forecast.windowDays,
          shortfall: forecast.coverage.covered ? null : {
            amount: forecast.coverage.shortfallAmount,
            date: forecast.coverage.firstShortfallDate,
            asset: forecast.coverage.shortfallAsset,
          },
        },
        recommendedAction: null,
        impact: { dollarValue: shortfallUsd, bufferDays },
        dedupKey: 'liquidity_below_buffer:USD',
        dataFreshness: 'fresh',
        supportingData: {
          available_cash_usd: availableCashUsd,
          bank_balance_usd: snapshot.totalBankBalanceUsd,
          crypto_balance_usd: snapshot.totalCryptoBalanceUsd,
          mmf_positions_usd: snapshot.totalMmfPositionsUsd,
          profile: profile.id,
        },
        confidence: 0.9,
      });
    }

    if (!belowBuffer && availableCashUsd > safetyBuffer * IDLE_CASH_MULTIPLIER) {
      const excessUsd = availableCashUsd - safetyBuffer;
      insights.push({
        type: 'liquidity_idle_cash',
        severity: 'info',
        title: 'Idle stablecoin balance exceeds safety buffer',
        summary:
          `${formatUsd(availableCashUsd)} in available cash (bank + wallet + MMF) ` +
          `exceeds ${IDLE_CASH_MULTIPLIER}× the ${profile.displayName} safety buffer of ${formatUsd(safetyBuffer)}. ` +
          `${formatUsd(excessUsd)} could potentially be deployed into yield-generating positions.`,
        rationale: {
          availableCashUsd, safetyBufferUsd: safetyBuffer, excessUsd,
          multiplier: IDLE_CASH_MULTIPLIER, profile: profile.id,
        },
        recommendedAction: null,
        impact: { dollarValue: excessUsd },
        dedupKey: 'liquidity_idle_cash:USD',
        dataFreshness: 'fresh',
        supportingData: {
          bank_balance_usd: snapshot.totalBankBalanceUsd,
          crypto_balance_usd: snapshot.totalCryptoBalanceUsd,
          mmf_positions_usd: snapshot.totalMmfPositionsUsd,
          defi_positions_usd: snapshot.totalDefiPositionsUsd,
          profile: profile.id,
        },
        confidence: 0.85,
      });
    }

    return insights;
  },
};
