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

// Status is intentionally narrowed to terminal states — an obligation cannot be
// resurrected back to 'upcoming' via PATCH. See ObligationPatch jsdoc in types.ts.
const PATCHABLE_STATUSES = ['paid', 'missed', 'cancelled'] as const;

const PatchSchema = z.object({
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  direction: z.enum(OBLIGATION_TYPES).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  asset: z.string().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sourceAccountId: z.string().uuid().nullable().optional(),
  sourceVenueKind: z.enum(OBLIGATION_VENUE_KINDS).nullable().optional(),
  confidence: z.enum(OBLIGATION_CONFIDENCES).optional(),
  recurrence: z.enum(OBLIGATION_RECURRENCES).optional(),
  recurrenceCron: z.string().nullable().optional(),
  counterpartyId: z.string().uuid().nullable().optional(),
  erpReference: z.string().nullable().optional(),
  status: z.enum(PATCHABLE_STATUSES).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

async function resolveEnterpriseId(): Promise<
  { enterpriseId: string } | { error: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id) {
    return {
      error: NextResponse.json(
        {
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Sign in required',
            nextStep: 'Sign in again',
          },
        },
        { status: 401 },
      ),
    };
  }
  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return {
      error: NextResponse.json(
        {
          error: {
            code: 'NO_ENTERPRISE',
            message: 'User is not attached to an enterprise',
            nextStep: 'Contact support',
          },
        },
        { status: 403 },
      ),
    };
  }
  return { enterpriseId };
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const resolved = await resolveEnterpriseId();
  if ('error' in resolved) return resolved.error;

  try {
    const repo = new ObligationsRepo(createAdminClient());
    const obligation = await repo.getById(resolved.enterpriseId, params.id);
    return NextResponse.json({ obligation });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'OBLIGATION_NOT_FOUND',
          message: 'No such obligation',
          nextStep: 'Refresh the list',
        },
      },
      { status: 404 },
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const resolved = await resolveEnterpriseId();
  if ('error' in resolved) return resolved.error;

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_OBLIGATION_PATCH',
          message: 'Patch payload failed validation',
          nextStep: 'Fix the highlighted fields',
          fields: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  try {
    const repo = new ObligationsRepo(createAdminClient());
    const updated = await repo.patch(
      resolved.enterpriseId,
      params.id,
      parsed.data,
    );
    return NextResponse.json({ obligation: updated });
  } catch (e) {
    const traceId = crypto.randomUUID();
    console.error('[obligations.patch]', traceId, e);
    return NextResponse.json(
      {
        error: {
          code: 'OBLIGATION_PATCH_FAILED',
          message: 'Could not update the obligation',
          nextStep: 'Retry; contact support with the trace id if it persists',
          traceId,
        },
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const resolved = await resolveEnterpriseId();
  if ('error' in resolved) return resolved.error;

  try {
    const repo = new ObligationsRepo(createAdminClient());
    await repo.delete(resolved.enterpriseId, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const traceId = crypto.randomUUID();
    console.error('[obligations.delete]', traceId, e);
    return NextResponse.json(
      {
        error: {
          code: 'OBLIGATION_DELETE_FAILED',
          message: 'Could not delete the obligation',
          nextStep: 'Retry; contact support with the trace id if it persists',
          traceId,
        },
      },
      { status: 500 },
    );
  }
}
