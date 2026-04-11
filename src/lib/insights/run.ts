/**
 * Detector runner.
 *
 * Given a DetectorContext, runs every registered detector in parallel,
 * isolates failures via Promise.allSettled, and returns the flattened
 * list of insights. Failures are logged but never fail the overall
 * cycle — one misbehaving detector must not take down the cron.
 *
 * Persistence (dedup + write + policy evaluation) happens downstream
 * in the cron orchestrator via the store and policy gate. This module
 * is deliberately small: its only job is to invoke detectors safely.
 */

import { ALL_DETECTORS } from './detectors/registry';
import type { DetectorContext } from './detectors/types';
import type { DetectedInsight } from './types';

export interface DetectorResult {
  detectorName: string;
  insights: DetectedInsight[];
  error?: string;
}

export interface RunSummary {
  detectorsRun: number;
  detectorsFailed: number;
  totalInsights: number;
  results: DetectorResult[];
}

/**
 * Run all registered detectors in parallel. Never throws.
 */
export async function runAllDetectors(ctx: DetectorContext): Promise<RunSummary> {
  const settled = await Promise.allSettled(
    ALL_DETECTORS.map(async (detector) => {
      try {
        const insights = await detector.run(ctx);
        return {
          detectorName: detector.name,
          insights,
        } satisfies DetectorResult;
      } catch (err) {
        return {
          detectorName: detector.name,
          insights: [],
          error: (err as Error).message,
        } satisfies DetectorResult;
      }
    }),
  );

  const results: DetectorResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
    } else {
      results.push({
        detectorName: ALL_DETECTORS[i].name,
        insights: [],
        error: `Unhandled detector rejection: ${String(outcome.reason)}`,
      });
    }
  }

  const detectorsFailed = results.filter((r) => r.error).length;
  const totalInsights = results.reduce((sum, r) => sum + r.insights.length, 0);

  if (detectorsFailed > 0) {
    console.error(
      `[insights/run] ${detectorsFailed} detector(s) failed for enterprise ${ctx.enterpriseId}`,
      results.filter((r) => r.error).map((r) => ({ detector: r.detectorName, error: r.error })),
    );
  }

  return {
    detectorsRun: ALL_DETECTORS.length,
    detectorsFailed,
    totalInsights,
    results,
  };
}
