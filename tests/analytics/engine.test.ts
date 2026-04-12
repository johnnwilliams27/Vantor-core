import { describe, it, expect } from 'vitest';
import { STANDARD_VIEWS } from '@/lib/analytics/standard-views';
import { RESOLVER_REGISTRY, getResolver } from '@/lib/analytics/resolvers';
import { executeView } from '@/lib/analytics/engine';

describe('resolver registry', () => {
  it('has exactly 12 entries', () => {
    expect(Object.keys(RESOLVER_REGISTRY).length).toBe(12);
  });

  it('every standard view has a registered resolver', () => {
    for (const view of STANDARD_VIEWS) {
      const resolver = getResolver(view.slug);
      expect(resolver, `Missing resolver for view '${view.slug}'`).toBeDefined();
      expect(typeof resolver).toBe('function');
    }
  });

  it('registry keys match standard view slugs exactly', () => {
    const registryKeys = new Set(Object.keys(RESOLVER_REGISTRY));
    const viewSlugs = new Set(STANDARD_VIEWS.map(v => v.slug));
    expect(registryKeys).toEqual(viewSlugs);
  });

  it('getResolver returns undefined for unknown slug', () => {
    expect(getResolver('nonexistent-view')).toBeUndefined();
  });
});

describe('executeView', () => {
  it('rejects unknown view slug', async () => {
    const fakeSupabase = {} as any;
    await expect(
      executeView(fakeSupabase, 'ent-1', 'nonexistent-view', {
        from: '2026-01-01',
        to: '2026-01-31',
      }),
    ).rejects.toThrow(/unknown view/i);
  });
});
