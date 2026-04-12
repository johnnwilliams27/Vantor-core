import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  handleAuthoringRequest,
  AuthoringContext,
} from '@/lib/policy/authoring/http';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';
import { hardLimitTypeSchema, assetCodeSchema } from '@/lib/policy/schemas/primitives';

const hardLimitScopeSchema = z.object({
  asset: z.string().optional(),
  venue: z.string().optional(),
  include_venues: z.array(z.string()).optional(),
});

const patchHardLimitBodySchema = z.object({
  limit_type: hardLimitTypeSchema.optional(),
  name: z.string().min(1).optional(),
  limit_value: z.string().regex(/^(\d+)(\.\d+)?$/, 'Must be a non-negative decimal').optional(),
  limit_currency: assetCodeSchema.optional(),
  scope: hardLimitScopeSchema.optional(),
});

export function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; limitId: string } },
) {
  return handleAuthoringRequest(
    async (innerReq: NextRequest, { actor, service }: AuthoringContext) => {
      const raw = await innerReq.json();
      const parsed = patchHardLimitBodySchema.safeParse(raw);
      if (!parsed.success) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: 'Invalid request body for updating a hard limit.',
          user_action: 'Fix the hard limit fields and retry.',
          details: { zod_error: parsed.error.flatten() },
        });
      }

      const limit = await service.upsertHardLimit(actor, params.id, {
        ...parsed.data,
        id: params.limitId,
      } as Parameters<typeof service.upsertHardLimit>[2]);
      return NextResponse.json({ data: limit });
    },
  )(req);
}

export function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; limitId: string } },
) {
  return handleAuthoringRequest(
    async (_req: NextRequest, { actor, service }: AuthoringContext) => {
      const updated = await service.deleteHardLimit(actor, params.id, params.limitId);
      return NextResponse.json({ data: updated });
    },
  )(req);
}
