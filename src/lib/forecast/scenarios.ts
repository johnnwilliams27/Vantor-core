import type { ForecastScenario, ScenarioParams } from './types';

/**
 * The "base" scenario — our default lens. Includes confirmed + expected
 * obligations, no day-0 drawdown, and the FX rates captured at snapshot
 * time. Every other scenario derives from this and overrides a few fields.
 */
export const DEFAULT_SCENARIO_PARAMS: ScenarioParams = {
  includeExpected: true,
  includeEstimated: false,
  extraDrawdownPct: 0,
  fxStrategy: 'current',
};

/**
 * Map a ForecastScenario label to concrete ScenarioParams, optionally
 * merging caller-supplied overrides on top.
 *
 * - `base`         — defaults; confirmed + expected, current FX.
 * - `conservative` — confirmed only; no drawdown; current FX.
 * - `stress`       — confirmed only; 20% day-0 drawdown; pessimistic FX
 *                    (default 500 bps shift); the treasurer's worst-case lens.
 * - `custom`       — starts from base and applies whatever the caller passes.
 */
export function resolveScenarioParams(
  scenario: ForecastScenario,
  overrides?: Partial<ScenarioParams>,
): ScenarioParams {
  let base: ScenarioParams;
  switch (scenario) {
    case 'base':
      base = { ...DEFAULT_SCENARIO_PARAMS };
      break;
    case 'conservative':
      base = { ...DEFAULT_SCENARIO_PARAMS, includeExpected: false };
      break;
    case 'stress':
      base = {
        ...DEFAULT_SCENARIO_PARAMS,
        includeExpected: false,
        extraDrawdownPct: 20,
        fxStrategy: 'pessimistic',
        fxPessimisticBpsShift: 500,
      };
      break;
    case 'custom':
      base = { ...DEFAULT_SCENARIO_PARAMS };
      break;
  }
  return { ...base, ...(overrides ?? {}) };
}
