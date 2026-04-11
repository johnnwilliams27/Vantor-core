import { describe, it, expect } from 'vitest';
import {
  DEFAULT_COOLDOWN_HOURS,
  VALID_TRANSITIONS,
  isValidTransition,
} from './store';
import type { InsightState, InsightType } from './types';

/**
 * Pure tests for the insight state machine + cooldown table.
 *
 * Full store tests (dedup, create/read/transition integration) require
 * a Supabase test harness and are deferred — see README. This file
 * covers only the pieces that don't touch a DB:
 *
 *   - VALID_TRANSITIONS has the expected shape for every state
 *   - isValidTransition agrees with the table
 *   - DEFAULT_COOLDOWN_HOURS covers every InsightType
 *   - Terminal states cannot transition
 */

// Every state in the InsightState union. Keep in sync with types.ts —
// if a new state is added there and not here, the "all states listed"
// test below will fail.
const ALL_STATES: InsightState[] = [
  'new',
  'viewed',
  'dismissed',
  'acted_on',
  'expired',
];

// Every insight type in the InsightType union. Used to verify the
// cooldown table is exhaustive.
const ALL_INSIGHT_TYPES: InsightType[] = [
  'liquidity_below_buffer',
  'liquidity_idle_cash',
  'yield_drop',
  'yield_opportunity',
  'yield_idle_opportunity',
  'concentration_warning',
  'concentration_breach',
];

describe('VALID_TRANSITIONS', () => {
  it('has an entry for every InsightState', () => {
    for (const state of ALL_STATES) {
      expect(VALID_TRANSITIONS).toHaveProperty(state);
    }
  });

  it('new → {viewed, dismissed, acted_on, expired}', () => {
    expect(VALID_TRANSITIONS.new.sort()).toEqual(
      ['acted_on', 'dismissed', 'expired', 'viewed'].sort(),
    );
  });

  it('viewed → {dismissed, acted_on, expired} (cannot go back to new)', () => {
    expect(VALID_TRANSITIONS.viewed).not.toContain('new');
    expect(VALID_TRANSITIONS.viewed.sort()).toEqual(
      ['acted_on', 'dismissed', 'expired'].sort(),
    );
  });

  it('dismissed is terminal', () => {
    expect(VALID_TRANSITIONS.dismissed).toEqual([]);
  });

  it('acted_on is terminal', () => {
    expect(VALID_TRANSITIONS.acted_on).toEqual([]);
  });

  it('expired is terminal', () => {
    expect(VALID_TRANSITIONS.expired).toEqual([]);
  });
});

describe('isValidTransition', () => {
  it('accepts new → viewed', () => {
    expect(isValidTransition('new', 'viewed')).toBe(true);
  });

  it('accepts new → dismissed (skipping viewed)', () => {
    expect(isValidTransition('new', 'dismissed')).toBe(true);
  });

  it('accepts new → acted_on (skipping viewed)', () => {
    expect(isValidTransition('new', 'acted_on')).toBe(true);
  });

  it('accepts viewed → dismissed', () => {
    expect(isValidTransition('viewed', 'dismissed')).toBe(true);
  });

  it('accepts viewed → acted_on', () => {
    expect(isValidTransition('viewed', 'acted_on')).toBe(true);
  });

  it('rejects viewed → new (no regression to unseen)', () => {
    expect(isValidTransition('viewed', 'new')).toBe(false);
  });

  it('rejects dismissed → anything', () => {
    for (const to of ALL_STATES) {
      expect(isValidTransition('dismissed', to)).toBe(false);
    }
  });

  it('rejects acted_on → anything', () => {
    for (const to of ALL_STATES) {
      expect(isValidTransition('acted_on', to)).toBe(false);
    }
  });

  it('rejects expired → anything (terminal — no resurrection)', () => {
    for (const to of ALL_STATES) {
      expect(isValidTransition('expired', to)).toBe(false);
    }
  });

  it('rejects a state-to-itself no-op transition', () => {
    // The store short-circuits self-transitions before calling this,
    // but the helper should still say "no" for cleanliness.
    for (const state of ALL_STATES) {
      expect(isValidTransition(state, state)).toBe(false);
    }
  });
});

describe('DEFAULT_COOLDOWN_HOURS', () => {
  it('has an entry for every InsightType', () => {
    for (const type of ALL_INSIGHT_TYPES) {
      expect(DEFAULT_COOLDOWN_HOURS).toHaveProperty(type);
    }
  });

  it('uses positive finite hours for every entry', () => {
    for (const type of ALL_INSIGHT_TYPES) {
      const hours = DEFAULT_COOLDOWN_HOURS[type];
      expect(Number.isFinite(hours)).toBe(true);
      expect(hours).toBeGreaterThan(0);
    }
  });

  it('re-surfaces liquidity_below_buffer faster than liquidity_idle_cash', () => {
    // Critical insights (cash below buffer) must come back quickly; idle
    // cash can wait. This invariant is load-bearing — the cron otherwise
    // suppresses the critical one when a user dismisses during an ongoing
    // shortfall.
    expect(DEFAULT_COOLDOWN_HOURS.liquidity_below_buffer).toBeLessThan(
      DEFAULT_COOLDOWN_HOURS.liquidity_idle_cash,
    );
  });

  it('re-surfaces concentration_breach faster than concentration_warning', () => {
    // Breach is higher-severity than warning — same invariant as above.
    expect(DEFAULT_COOLDOWN_HOURS.concentration_breach).toBeLessThan(
      DEFAULT_COOLDOWN_HOURS.concentration_warning,
    );
  });
});
