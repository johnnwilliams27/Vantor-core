/**
 * GET /api/insights/[id]        — return a single insight by ID
 * PATCH /api/insights/[id]      — transition state (view/dismiss/acted_on)
 *
 * State transitions map to the store's transition helpers:
 *   { action: 'view' }       → markViewed
 *   { action: 'dismiss' }    → dismissInsight (sets cooldown)
 *   { action: 'acted_on' }   → markActedOn
 *
 * Enterprise isolation is enforced via RLS + the effective enterprise
 * lookup — a user can never transition another enterprise's insight.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import {
  getInsight,
  markViewed,
  dismissInsight,
  markActedOn,
} from '@/lib/insights/store';

type RouteParams = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: RouteParams) {
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

  try {
    const supabase = createAdminClient();
    const insight = await getInsight(params.id, supabase);

    if (!insight) {
      return NextResponse.json({ error: 'Insight not found' }, { status: 404 });
    }

    // Enterprise isolation
    if (insight.enterprise_id !== enterpriseId) {
      return NextResponse.json({ error: 'Insight not found' }, { status: 404 });
    }

    return NextResponse.json({ data: insight });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

const VALID_ACTIONS = ['view', 'dismiss', 'acted_on'] as const;
type PatchAction = typeof VALID_ACTIONS[number];

export async function PATCH(req: NextRequest, { params }: RouteParams) {
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

  let body: { action?: string };
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = body.action;
  if (!action || !(VALID_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json(
      { error: `Invalid action. Expected one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();

    // Enterprise isolation check
    const insight = await getInsight(params.id, supabase);
    if (!insight) {
      return NextResponse.json({ error: 'Insight not found' }, { status: 404 });
    }
    if (insight.enterprise_id !== enterpriseId) {
      return NextResponse.json({ error: 'Insight not found' }, { status: 404 });
    }

    switch (action as PatchAction) {
      case 'view':
        await markViewed(params.id, session.user.id, supabase);
        break;
      case 'dismiss':
        await dismissInsight(params.id, session.user.id, supabase);
        break;
      case 'acted_on':
        await markActedOn(params.id, session.user.id, supabase);
        break;
    }

    const updated = await getInsight(params.id, supabase);
    return NextResponse.json({ data: updated });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
