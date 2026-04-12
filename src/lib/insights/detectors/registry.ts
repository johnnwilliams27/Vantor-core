/**
 * Detector registry.
 *
 * To add a new detector: implement the Detector interface in a new file
 * under this directory, then add it to ALL_DETECTORS below. The cron
 * orchestrator will automatically pick it up.
 */

import type { Detector } from './types';
import { concentrationDetector } from './concentration';
import { liquidityDetector } from './liquidity';
import { yieldRebalanceDetector } from './yield-rebalance';

export const ALL_DETECTORS: Detector[] = [
  concentrationDetector,
  liquidityDetector,
  yieldRebalanceDetector,
];
