import { describe, it, expect } from 'vitest';
import { generateInsightReasoning } from './claude';
import type { DetectedInsight } from './types';

/**
 * Tests for the insight reasoning generator.
 *
 * Without ANTHROPIC_API_KEY, the function runs in mock mode — returns
 * a template reasoning string with model='mock'. These tests verify
 * the mock path and the output shape.
 */

function buildInsight(overrides: Partial<DetectedInsight> = {}): DetectedInsight {
  return {
    type: 'liquidity_below_buffer',
    severity: 'critical',
    title: 'Projected balance falls below safety buffer',
    summary: 'Projected minimum balance of $50k on 2026-04-25 is $150k below the Balanced safety buffer of $200k.',
    rationale: { projectedMinUsd: 50_000, safetyBufferUsd: 200_000 },
    recommendedAction: null,
    impact: { dollarValue: 150_000, bufferDays: 5 },
    dedupKey: 'liquidity_below_buffer:USD',
    dataFreshness: 'fresh',
    supportingData: {},
    confidence: 0.9,
    ...overrides,
  };
}

describe('generateInsightReasoning', () => {
  it('returns a reasoning string in mock mode', async () => {
    const result = await generateInsightReasoning(buildInsight());
    expect(result.model).toBe('mock');
    expect(result.reasoning).toBeTruthy();
    expect(typeof result.reasoning).toBe('string');
    expect(result.reasoning.length).toBeGreaterThan(50);
  });

  it('includes the 3-section structure in mock output', async () => {
    const result = await generateInsightReasoning(buildInsight());
    expect(result.reasoning).toContain('Analysis');
    expect(result.reasoning).toContain('Context');
    expect(result.reasoning).toContain('Next Step');
  });

  it('adapts mock output when a recommended action is present', async () => {
    const result = await generateInsightReasoning(
      buildInsight({
        type: 'yield_drop',
        severity: 'warning',
        recommendedAction: {
          type: 'yield_deposit',
          fromVenueId: 'aave_v3',
          toVenueId: 'morpho_steakhouse',
          asset: 'USDC',
          amount: 2_000_000,
          amountUsd: 2_000_000,
        },
      }),
    );
    expect(result.reasoning).toContain('yield deposit');
    expect(result.reasoning).toContain('2,000,000');
  });

  it('adapts mock output when no recommended action', async () => {
    const result = await generateInsightReasoning(
      buildInsight({ recommendedAction: null }),
    );
    expect(result.reasoning).toContain('rebalancing');
  });
});
