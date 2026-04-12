import { describe, it, expect } from 'vitest';
import { STANDARD_VIEWS, getStandardView, getStandardViews } from '@/lib/analytics/standard-views';
import { getMeasure } from '@/lib/analytics/measures';
import { getDimension } from '@/lib/analytics/dimensions';

describe('standard views registry', () => {
  it('has exactly 12 views', () => {
    expect(STANDARD_VIEWS.length).toBe(12);
  });

  it('no duplicate slugs', () => {
    const slugs = STANDARD_VIEWS.map((v) => v.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it('every view references only known measures', () => {
    for (const v of STANDARD_VIEWS) {
      for (const slug of v.config.measures) {
        expect(
          getMeasure(slug),
          `view '${v.slug}' references unknown measure '${slug}'`,
        ).toBeDefined();
      }
    }
  });

  it('every view with primaryDimension references a known dimension', () => {
    for (const v of STANDARD_VIEWS) {
      if (v.config.primaryDimension) {
        expect(
          getDimension(v.config.primaryDimension),
          `view '${v.slug}' references unknown dimension '${v.config.primaryDimension}'`,
        ).toBeDefined();
      }
    }
  });

  it('sort orders are unique and sequential from 1', () => {
    const orders = STANDARD_VIEWS.map((v) => v.sortOrder).sort((a, b) => a - b);
    for (let i = 0; i < orders.length; i++) {
      expect(orders[i]).toBe(i + 1);
    }
  });

  it('getStandardView returns correct view for known slug', () => {
    const v = getStandardView('treasury-summary');
    expect(v).toBeDefined();
    expect(v!.slug).toBe('treasury-summary');
    expect(v!.chartType).toBe('kpi');
    expect(v!.sortOrder).toBe(1);
  });

  it('getStandardView returns undefined for unknown slug', () => {
    expect(getStandardView('does_not_exist')).toBeUndefined();
  });

  it('getStandardViews returns all views', () => {
    expect(getStandardViews()).toEqual(STANDARD_VIEWS);
  });

  it('all views have kind=standard', () => {
    for (const v of STANDARD_VIEWS) {
      expect(v.kind, `view '${v.slug}' kind`).toBe('standard');
    }
  });

  it('all views have enterpriseId=null', () => {
    for (const v of STANDARD_VIEWS) {
      expect(v.enterpriseId, `view '${v.slug}' enterpriseId`).toBeNull();
    }
  });
});
