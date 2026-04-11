import { describe, it, expect } from 'vitest';
import {
  type Obligation,
  type ObligationInput,
  type ObligationRecurrence,
  OBLIGATION_TYPES,
  OBLIGATION_CONFIDENCES,
  OBLIGATION_SOURCES,
  OBLIGATION_STATUSES,
  OBLIGATION_RECURRENCES,
  OBLIGATION_VENUE_KINDS,
} from '@/lib/obligations/types';

describe('obligation types', () => {
  it('exports all enum arrays matching SQL enum values', () => {
    expect(OBLIGATION_TYPES).toEqual(['outflow', 'inflow']);
    expect(OBLIGATION_CONFIDENCES).toEqual(['confirmed', 'expected', 'estimated']);
    expect(OBLIGATION_SOURCES).toEqual(['manual', 'erp_sync', 'recurring_rule']);
    expect(OBLIGATION_STATUSES).toEqual(['upcoming', 'paid', 'missed', 'cancelled']);
    expect(OBLIGATION_RECURRENCES).toEqual([
      'once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual', 'custom',
    ]);
    expect(OBLIGATION_VENUE_KINDS).toEqual(['bank', 'wallet', 'defi']);
  });

  it('ObligationInput rejects privileged fields at compile time', () => {
    // Valid input — shape check
    const valid = {
      label: 'Payroll',
      direction: 'outflow' as const,
      amount: 50000,
      currency: 'USD',
      dueDate: '2026-05-01',
      confidence: 'confirmed' as const,
      recurrence: 'monthly' as const,
    } satisfies ObligationInput;
    expect(valid.label).toBe('Payroll');

    // Negative compile-time checks — each block MUST error or the test file fails to compile.
    // @ts-expect-error — id must not be accepted on create
    const withId: ObligationInput = { id: 'x', label: 'p', direction: 'outflow', amount: 1, currency: 'USD', dueDate: '2026-05-01' };
    // @ts-expect-error — enterpriseId must not be accepted on create
    const withEnt: ObligationInput = { enterpriseId: 'e', label: 'p', direction: 'outflow', amount: 1, currency: 'USD', dueDate: '2026-05-01' };
    // @ts-expect-error — userId must not be accepted on create
    const withUser: ObligationInput = { userId: 'u', label: 'p', direction: 'outflow', amount: 1, currency: 'USD', dueDate: '2026-05-01' };
    // @ts-expect-error — status must not be settable on create (set via patch/markPaid)
    const withStatus: ObligationInput = { status: 'paid', label: 'p', direction: 'outflow', amount: 1, currency: 'USD', dueDate: '2026-05-01' };
    // @ts-expect-error — isActive must not be accepted on create
    const withActive: ObligationInput = { isActive: false, label: 'p', direction: 'outflow', amount: 1, currency: 'USD', dueDate: '2026-05-01' };
    // @ts-expect-error — recurringParentId is set by the materialization job, not callers
    const withParent: ObligationInput = { recurringParentId: 'p', label: 'p', direction: 'outflow', amount: 1, currency: 'USD', dueDate: '2026-05-01' };

    // Reference the unused locals so lint doesn't strip them out and invalidate the ts-expect-error directives
    void withId; void withEnt; void withUser; void withStatus; void withActive; void withParent;
  });
});
