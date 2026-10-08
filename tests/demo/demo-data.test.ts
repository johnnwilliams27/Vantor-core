import { describe, expect, it } from 'vitest';
import { ASSET_MIX, DEMO_GROUPS, DEMO_SURFACES, LIQUIDITY_POINTS } from '@/components/demo/demoData';

describe('public demo fixtures', () => {
  it('covers every declared product navigation surface', () => {
    const slugs = DEMO_GROUPS.flatMap(group => group.items.map(item => item.slug));
    expect(slugs.length).toBeGreaterThanOrEqual(20);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(DEMO_SURFACES[slug]).toBeDefined();
      expect(DEMO_SURFACES[slug].rows.length).toBeGreaterThan(0);
    }
  });
  it('uses unique sample row ids and populated display values', () => {
    const rows = Object.values(DEMO_SURFACES).flatMap(surface => surface.rows);
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.name.trim()).not.toBe('');
      expect(row.status.trim()).not.toBe('');
    }
  });
  it('keeps fixture asset allocation and dashboard total consistent', () => {
    expect(ASSET_MIX.reduce((sum, item) => sum + item.value, 0)).toBe(4218350);
    expect(LIQUIDITY_POINTS[LIQUIDITY_POINTS.length - 1].total).toBeCloseTo(4.22);
  });
});
