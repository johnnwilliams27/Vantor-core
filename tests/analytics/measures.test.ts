import { describe, it, expect } from 'vitest';
import { MEASURES, getMeasure, getMeasures } from '@/lib/analytics/measures';

describe('measures registry', () => {
  it('has no duplicate slugs', () => {
    const slugs = MEASURES.map((m) => m.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it('every measure has non-empty label and description', () => {
    for (const m of MEASURES) {
      expect(m.label.trim().length, `${m.slug} label`).toBeGreaterThan(0);
      expect(m.description.trim().length, `${m.slug} description`).toBeGreaterThan(0);
    }
  });

  it('declarative measures have source with required fields', () => {
    const declarative = MEASURES.filter((m) => !m.computed);
    for (const m of declarative) {
      expect(m.source, `${m.slug} should have source`).toBeDefined();
      expect(m.source!.table.trim().length, `${m.slug} source.table`).toBeGreaterThan(0);
      expect(m.source!.valueColumn.trim().length, `${m.slug} source.valueColumn`).toBeGreaterThan(0);
      expect(m.source!.dateColumn.trim().length, `${m.slug} source.dateColumn`).toBeGreaterThan(0);
      expect(m.source!.enterpriseColumn.trim().length, `${m.slug} source.enterpriseColumn`).toBeGreaterThan(0);
      expect(m.source!.aggregation, `${m.slug} source.aggregation`).toBeDefined();
    }
  });

  it('computed measures have computed=true and no source', () => {
    const computed = MEASURES.filter((m) => m.computed);
    expect(computed.length).toBeGreaterThan(0);
    for (const m of computed) {
      expect(m.computed).toBe(true);
      expect(m.source).toBeUndefined();
    }
  });

  it('getMeasure returns correct measure for known slug', () => {
    const m = getMeasure('total_balance_usd');
    expect(m).toBeDefined();
    expect(m!.slug).toBe('total_balance_usd');
    expect(m!.unit).toBe('usd');
  });

  it('getMeasure returns undefined for unknown slug', () => {
    expect(getMeasure('does_not_exist')).toBeUndefined();
  });

  it('getMeasures returns all measures', () => {
    expect(getMeasures()).toEqual(MEASURES);
    // 26 baseline + 6 L3 leaves + 3 rollups (Phase C-1.5a) = 35
    expect(getMeasures().length).toBe(35);
  });

  it('every measure has at least one dimension', () => {
    for (const m of MEASURES) {
      expect(m.dimensions.length, `${m.slug} dimensions`).toBeGreaterThan(0);
    }
  });
});
