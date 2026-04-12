import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  handleAuthoringRequest,
  AuthoringContext,
} from '@/lib/policy/authoring/http';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';

const cloneBodySchema = z.object({
  name: z.string().min(1).optional(),
});

export function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handleAuthoringRequest(
    async (innerReq: NextRequest, { actor, service }: AuthoringContext) => {
      const raw = await innerReq.json().catch(() => ({}));
      const parsed = cloneBodySchema.safeParse(raw);
      if (!parsed.success) {
        throw new AuthoringError({
          reason_code: REASON_CODES.condition_ir_schema_invalid,
          human_readable: 'Invalid request body for cloning a version.',
          user_action: 'Optionally provide a name string.',
          details: { zod_error: parsed.error.flatten() },
        });
      }

      const version = await service.cloneVersion(actor, params.id, parsed.data.name);
      return NextResponse.json({ data: version }, { status: 201 });
    },
  )(req);
}
