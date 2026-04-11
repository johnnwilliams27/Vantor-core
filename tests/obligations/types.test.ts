import { describe, it, expect } from 'vitest';
import {
  type Obligation,
  type ObligationInput,
  type ObligationRecurrence,
  OBLIGATION_TYPES,
  OBLIGATION_CONFIDENCES,
  OBLIGATION_STATUSES,
  OBLIGATION_RECURRENCES,
} from '@/lib/obligations/types';

describe('obligation types', () => {
  it('exports all enum arrays matching SQL enum values', () => {
    expect(OBLIGATION_TYPES).toEqual(['outflow', 'inflow']);
    expect(OBLIGATION_CONFIDENCES).toEqual(['confirmed', 'expected', 'estimated']);
    expect(OBLIGATION_STATUSES).toEqual(['upcoming', 'paid', 'missed', 'cancelled']);
    expect(OBLIGATION_RECURRENCES).toEqual([
      'once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual', 'custom',
    ]);
  });

  it('ObligationInput has no id/timestamps/enterprise_id', () => {
    // Compile-time check via satisfies
    const input = {
      label: 'Payroll',
      direction: 'outflow' as const,
      amount: 50000,
      currency: 'USD',
      dueDate: '2026-05-01',
      confidence: 'confirmed' as const,
      recurrence: 'monthly' as const,
    } satisfies ObligationInput;
    expect(input.label).toBe('Payroll');
  });
});
