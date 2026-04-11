/**
 * GET /api/insights
 *
 * Returns the authenticated user's active insights (state = 'new' or 'viewed')
 * for their effective enterprise, newest first. Supports filtering by state
 * and cursor-based pagination via `before=<iso>`.
 *
 * Used by the frontend insight feed on the Treasury AI overview tab.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { listInsights } from '@/lib/insights/store';
import type { InsightState } from '@/lib/insights/types';

const VALID_STATES: InsightState[] = ['new', 'viewed', 'dismissed', 'acted_on', 'expired'];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    requireRole(session.user.role as any, 'accountant');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ error: 'No enterprise context' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const stateParam = searchParams.get('state');
  const limitParam = searchParams.get('limit');
  const before = searchParams.get('before') ?? undefined;

  let state: InsightState | InsightState[] | undefined;
  if (stateParam) {
    const states = stateParam.split(',').filter((s): s is InsightState =>
      (VALID_STATES as readonly string[]).includes(s),
    );
    if (states.length === 0) {
      return NextResponse.json(
        { error: `Invalid state parameter. Expected one of: ${VALID_STATES.join(', ')}` },
        { status: 400 },
      );
    }
    state = states.length === 1 ? states[0] : states;
  }

  let limit: number | undefined;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 200) {
      limit = parsed;
    }
  }

  try {
    const supabase = createAdminClient();
    const data = await listInsights(
      {
        enterpriseId,
        userId: session.user.id,
        state,
        limit,
        before,
      },
      supabase,
    );
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
