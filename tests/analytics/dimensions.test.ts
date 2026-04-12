import { describe, it, expect } from 'vitest';
import { DIMENSIONS, getDimension, getDimensions } from '@/lib/analytics/dimensions';
import { MEASURES } from '@/lib/analytics/measures';

describe('dimensions registry', () => {
  it('has no duplicate slugs', () => {
    const slugs = DIMENSIONS.map((d) => d.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it('every dimension has non-empty label', () => {
    for (const d of DIMENSIONS) {
      expect(d.label.trim().length, `${d.slug} label`).toBeGreaterThan(0);
    }
  });

  it('time dimension has granularity options', () => {
    const time = getDimension('time');
    expect(time).toBeDefined();
    expect(time!.granularities).toBeDefined();
    expect(time!.granularities!.length).toBeGreaterThan(0);
    expect(time!.granularities).toContain('day');
    expect(time!.granularities).toContain('week');
    expect(time!.granularities).toContain('month');
  });

  it('non-time non-computed dimensions have a column', () => {
    // age_bucket is a computed dimension (no column), time has granularities instead
    const computedDims = new Set(['time', 'age_bucket']);
    for (const d of DIMENSIONS) {
      if (!computedDims.has(d.slug)) {
        expect(d.column, `${d.slug} should have a column`).toBeDefined();
        expect(d.column!.trim().length, `${d.slug} column`).toBeGreaterThan(0);
      }
    }
  });

  it('getDimension returns correct dimension for known slug', () => {
    const d = getDimension('direction');
    expect(d).toBeDefined();
    expect(d!.slug).toBe('direction');
    expect(d!.column).toBe('direction');
  });

  it('getDimension returns undefined for unknown slug', () => {
    expect(getDimension('does_not_exist')).toBeUndefined();
  });

  it('getDimensions returns all dimensions', () => {
    expect(getDimensions()).toEqual(DIMENSIONS);
    expect(getDimensions().length).toBe(9);
  });

  it('every dimension referenced by a measure exists in registry', () => {
    const known = new Set(DIMENSIONS.map((d) => d.slug));
    for (const m of MEASURES) {
      for (const dim of m.dimensions) {
        expect(known.has(dim), `measure ${m.slug} references unknown dimension '${dim}'`).toBe(true);
      }
    }
  });
});
