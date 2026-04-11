import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { ObligationsRepo } from '@/lib/obligations/repo';
import {
  OBLIGATION_TYPES,
  OBLIGATION_CONFIDENCES,
  OBLIGATION_RECURRENCES,
  OBLIGATION_VENUE_KINDS,
} from '@/lib/obligations/types';

const CreateSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
  direction: z.enum(OBLIGATION_TYPES),
  amount: z.number().positive(),
  currency: z.string().length(3),
  asset: z.string().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceAccountId: z.string().uuid().nullable().optional(),
  sourceVenueKind: z.enum(OBLIGATION_VENUE_KINDS).nullable().optional(),
  confidence: z.enum(OBLIGATION_CONFIDENCES).optional(),
  recurrence: z.enum(OBLIGATION_RECURRENCES).optional(),
  recurrenceCron: z.string().nullable().optional(),
  counterpartyId: z.string().uuid().nullable().optional(),
  erpReference: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.enterprise_id) {
    return NextResponse.json(
      {
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Sign in required',
          nextStep: 'Sign in again',
        },
      },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_OBLIGATION_INPUT',
          message: 'Obligation payload failed validation',
          nextStep: 'Fix the highlighted fields and resubmit',
          fields: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json(
      {
        error: {
          code: 'NO_ENTERPRISE',
          message: 'User is not attached to an enterprise',
          nextStep: 'Contact support',
        },
      },
      { status: 403 },
    );
  }

  try {
    const repo = new ObligationsRepo(createAdminClient());
    const created = await repo.create(enterpriseId, session.user.id, parsed.data);
    return NextResponse.json({ obligation: created }, { status: 201 });
  } catch (e) {
    const traceId = crypto.randomUUID();
    console.error('[obligations.create]', traceId, e);
    return NextResponse.json(
      {
        error: {
          code: 'OBLIGATION_CREATE_FAILED',
          message: 'Could not save the obligation',
          nextStep: 'Retry; contact support with the trace id if it persists',
          traceId,
        },
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id) {
    return NextResponse.json(
      {
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Sign in required',
          nextStep: 'Sign in again',
        },
      },
      { status: 401 },
    );
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ obligations: [] });
  }

  const url = new URL(req.url);
  const windowDays = parseInt(url.searchParams.get('windowDays') ?? '90', 10);
  const from = new Date();
  const to = new Date(from.getTime() + windowDays * 24 * 60 * 60 * 1000);

  try {
    const repo = new ObligationsRepo(createAdminClient());
    const obligations = await repo.listUpcoming(enterpriseId, from, to);
    return NextResponse.json({ obligations });
  } catch (e) {
    const traceId = crypto.randomUUID();
    console.error('[obligations.list]', traceId, e);
    return NextResponse.json(
      {
        error: {
          code: 'OBLIGATION_LIST_FAILED',
          message: 'Could not load obligations',
          nextStep: 'Retry; contact support with the trace id if it persists',
          traceId,
        },
      },
      { status: 500 },
    );
  }
}
