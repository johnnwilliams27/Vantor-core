/**
 * Detector registry.
 *
 * To add a new detector: implement the Detector interface in a new file
 * under this directory, then add it to ALL_DETECTORS below. The cron
 * orchestrator will automatically pick it up.
 *
 * v1 ships three detectors:
 *   - Concentration Risk (unblocked, ships with v1 foundation)
 *   - Liquidity & Safety Buffer (soft-blocked on forecast-queries module)
 *   - Yield Rebalance (soft-blocked on policy engine types)
 *
 * Liquidity and Yield Rebalance register later as their dependencies land.
 */

import type { Detector } from './types';
import { concentrationDetector } from './concentration';

export const ALL_DETECTORS: Detector[] = [
  concentrationDetector,
  // liquidityDetector,       // added when forecast-queries lands
  // yieldRebalanceDetector,  // added when policy types land on master
];
