import type { SupabaseClient } from '@supabase/supabase-js';
import type { ViewQuery, ViewResult, ResolverContext } from './types';
import { getStandardView } from './standard-views';
import { getResolver } from './resolvers';
import { STANDARD_VIEWS } from './standard-views';

export async function executeView(
  supabase: SupabaseClient,
  enterpriseId: string,
  viewSlug: string,
  query: ViewQuery,
): Promise<ViewResult> {
  const view = getStandardView(viewSlug);
  if (!view) {
    const available = STANDARD_VIEWS.map(v => v.slug).join(', ');
    throw new Error(`Unknown view slug: '${viewSlug}'. Available: ${available}`);
  }

  const resolver = getResolver(viewSlug);
  if (!resolver) {
    throw new Error(`No resolver registered for view '${viewSlug}'`);
  }

  const ctx: ResolverContext = {
    supabase,
    enterpriseId,
    from: query.from,
    to: query.to,
    filters: { ...(view.config.defaultFilters ?? {}), ...(query.filters ?? {}) } as Record<string, string | string[]>,
    groupBy: query.groupBy ?? view.config.primaryDimension,
    granularity: query.granularity ?? view.config.granularity ?? 'day',
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 50,
  };

  return resolver(ctx);
}
