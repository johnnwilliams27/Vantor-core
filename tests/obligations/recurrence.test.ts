import { describe, it, expect } from 'vitest';
import { expandRecurrence } from '@/lib/obligations/recurrence';
import type { Obligation } from '@/lib/obligations/types';

function base(overrides: Partial<Obligation>): Obligation {
  return {
    id: 'ob_1', enterpriseId: 'e_1', userId: 'u_1',
    label: 'Test', description: null,
    direction: 'outflow', amount: 1000, currency: 'USD', asset: null,
    dueDate: '2026-05-01',
    sourceAccountId: null, sourceVenueKind: null,
    confidence: 'confirmed', source: 'manual', status: 'upcoming',
    recurrence: 'once', recurrenceCron: null,
    counterpartyId: null, erpReference: null,
    recurringParentId: null, tags: [], metadata: {},
    paidAt: null, settlementTxRef: null, isActive: true,
    createdAt: '', updatedAt: '',
    ...overrides,
  };
}

describe('expandRecurrence', () => {
  const from = new Date('2026-04-10T00:00:00Z');
  const to = new Date('2026-07-10T00:00:00Z'); // 91 days

  it('once: emits a single instance if inside window', () => {
    const ob = base({ recurrence: 'once', dueDate: '2026-05-15' });
    const out = expandRecurrence(ob, from, to);
    expect(out).toHaveLength(1);
    expect(out[0].dueDate).toBe('2026-05-15');
    expect(out[0].amount).toBe(1000);
  });

  it('once: emits zero if outside window', () => {
    const ob = base({ recurrence: 'once', dueDate: '2026-08-15' });
    expect(expandRecurrence(ob, from, to)).toHaveLength(0);
  });

  it('weekly: emits every 7 days within window', () => {
    const ob = base({ recurrence: 'weekly', dueDate: '2026-04-01' });
    const out = expandRecurrence(ob, from, to);
    // First occurrence on/after 2026-04-10: 2026-04-15, then 04-22, 04-29, ... through ≤ 2026-07-10
    expect(out.map(o => o.dueDate)).toEqual([
      '2026-04-15', '2026-04-22', '2026-04-29',
      '2026-05-06', '2026-05-13', '2026-05-20', '2026-05-27',
      '2026-06-03', '2026-06-10', '2026-06-17', '2026-06-24',
      '2026-07-01', '2026-07-08',
    ]);
  });

  it('monthly: calendar-month intervals from base date', () => {
    const ob = base({ recurrence: 'monthly', dueDate: '2026-04-20' });
    const out = expandRecurrence(ob, from, to);
    // Calendar months: 04-20, 05-20, 06-20 all within [04-10, 07-10]. 07-20 is past to.
    expect(out.map(o => o.dueDate)).toEqual(['2026-04-20', '2026-05-20', '2026-06-20']);
  });

  it('quarterly: 3-calendar-month intervals', () => {
    const ob = base({ recurrence: 'quarterly', dueDate: '2026-04-15' });
    const out = expandRecurrence(ob, from, to);
    expect(out.map(o => o.dueDate)).toEqual(['2026-04-15']);
  });

  it('monthly: clamps end-of-month without drifting', () => {
    // Jan 31 is the canonical drift case: 30-day arithmetic would land on Mar 02.
    // Calendar semantics with clamp-and-reset-to-base: Jan 31 → Feb 28 → Mar 31 → Apr 30.
    const ob = base({ recurrence: 'monthly', dueDate: '2026-01-31' });
    const wideFrom = new Date('2026-01-01T00:00:00Z');
    const wideTo = new Date('2026-05-15T00:00:00Z');
    const out = expandRecurrence(ob, wideFrom, wideTo);
    expect(out.map(o => o.dueDate)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('annual: clamps leap-day Feb 29 to Feb 28 in non-leap years', () => {
    // 2024 is a leap year, 2025/2026/2027 are not.
    const ob = base({ recurrence: 'annual', dueDate: '2024-02-29' });
    const wideFrom = new Date('2024-01-01T00:00:00Z');
    const wideTo = new Date('2027-06-01T00:00:00Z');
    const out = expandRecurrence(ob, wideFrom, wideTo);
    expect(out.map(o => o.dueDate)).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
    ]);
  });

  it('custom with cron: throws if no cron provided', () => {
    const ob = base({ recurrence: 'custom', recurrenceCron: null });
    expect(() => expandRecurrence(ob, from, to)).toThrow(/cron.*required/i);
  });

  it('materialized instance carries recurringParentId and isMaterialized=true flag', () => {
    const ob = base({ recurrence: 'weekly', dueDate: '2026-04-15' });
    const out = expandRecurrence(ob, from, to);
    for (const inst of out) {
      expect(inst.recurringParentId).toBe('ob_1');
    }
  });

  it('past materialized instance is never re-emitted (idempotent expansion)', () => {
    // When expanding from a date AFTER some instances already materialized,
    // those earlier dates must not appear in output.
    const ob = base({ recurrence: 'weekly', dueDate: '2026-01-01' });
    const laterFrom = new Date('2026-06-01T00:00:00Z');
    const laterTo = new Date('2026-06-30T00:00:00Z');
    const out = expandRecurrence(ob, laterFrom, laterTo);
    expect(out.every(o => o.dueDate >= '2026-06-01')).toBe(true);
  });
});
