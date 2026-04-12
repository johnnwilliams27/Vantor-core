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
  asset: assetCodeSchema.optional(),
  venue: z.string().optional(),
  include_venues: z.array(z.string()).optional(),
});

const upsertHardLimitBodySchema = z.object({
  id: z.string().uuid().optional(),
  limit_type: hardLimitTypeSchema,
  name: z.string().min(1),
  limit_value: z.string().regex(/^(\d+)(\.\d+)?$/, 'Must be a non-negative decimal'),
  limit_currency: assetCodeSchema.optional(),
  scope: hardLimitScopeSchema,
});

export function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handleAuthoringRequest(
    async (innerReq: NextRequest, { actor, service }: AuthoringContext) => {
      const raw = await innerReq.json();
      const parsed = upsertHardLimitBodySchema.safeParse(raw);
      if (!parsed.success) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: 'Invalid request body for upserting a hard limit.',
          user_action: 'Fix the hard limit fields and retry.',
          details: { zod_error: parsed.error.flatten() },
        });
      }

      const limit = await service.upsertHardLimit(actor, params.id, parsed.data);
      return NextResponse.json({ data: limit }, { status: 200 });
    },
  )(req);
}
