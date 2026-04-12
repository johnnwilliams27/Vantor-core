import { describe, it, expect } from 'vitest';
import { buildInlineContext, fireInlineInsights } from './inline';
import type { InlineTriggerInput } from './inline';

/**
 * Tests for the inline insights runner.
 *
 * The core functions require a live Supabase connection (they call
 * buildTreasurySnapshot, buildYieldUniverse, etc.) so integration-level
 * tests are deferred. These unit tests verify the exported API surface
 * exists and has the expected shape.
 */

describe('inline insights runner', () => {
  it('exports buildInlineContext as a function', () => {
    expect(typeof buildInlineContext).toBe('function');
  });

  it('exports fireInlineInsights as a function', () => {
    expect(typeof fireInlineInsights).toBe('function');
  });

  it('InlineTriggerInput type accepts all four trigger types', () => {
    const triggers: InlineTriggerInput['trigger'][] = [
      'yield_deposit',
      'yield_withdraw',
      'transfer_confirm',
      'invoice_sync',
    ];
    expect(triggers).toHaveLength(4);
  });
});
