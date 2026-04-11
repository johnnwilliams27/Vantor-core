import { describe, it, expect } from 'vitest';
import {
  resolveScenarioParams,
  DEFAULT_SCENARIO_PARAMS,
} from '@/lib/forecast/scenarios';

describe('resolveScenarioParams', () => {
  it('base: confirmed + expected, no drawdown, current FX', () => {
    const p = resolveScenarioParams('base');
    expect(p.includeExpected).toBe(true);
    expect(p.includeEstimated).toBe(false);
    expect(p.extraDrawdownPct).toBe(0);
    expect(p.fxStrategy).toBe('current');
  });

  it('conservative: confirmed only, no estimated, no drawdown', () => {
    const p = resolveScenarioParams('conservative');
    expect(p.includeExpected).toBe(false);
    expect(p.includeEstimated).toBe(false);
    expect(p.extraDrawdownPct).toBe(0);
  });

  it('stress: confirmed only + default 20% drawdown + pessimistic FX', () => {
    const p = resolveScenarioParams('stress');
    expect(p.includeExpected).toBe(false);
    expect(p.extraDrawdownPct).toBe(20);
    expect(p.fxStrategy).toBe('pessimistic');
    expect(p.fxPessimisticBpsShift).toBe(500);
  });

  it('custom: merges caller overrides onto base defaults', () => {
    const p = resolveScenarioParams('custom', {
      includeEstimated: true,
      extraDrawdownPct: 5,
    });
    expect(p.includeEstimated).toBe(true);
    expect(p.extraDrawdownPct).toBe(5);
    expect(p.fxStrategy).toBe('current');
  });

  it('DEFAULT_SCENARIO_PARAMS matches base scenario', () => {
    const base = resolveScenarioParams('base');
    expect(base).toEqual(DEFAULT_SCENARIO_PARAMS);
  });
});
