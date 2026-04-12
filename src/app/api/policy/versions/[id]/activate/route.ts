import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  handleAuthoringRequest,
  AuthoringContext,
} from '@/lib/policy/authoring/http';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';

const activateBodySchema = z.object({
  reason: z.string().min(1),
});

export function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handleAuthoringRequest(
    async (innerReq: NextRequest, { actor, service }: AuthoringContext) => {
      const raw = await innerReq.json();
      const parsed = activateBodySchema.safeParse(raw);
      if (!parsed.success) {
        throw new AuthoringError({
          reason_code: REASON_CODES.condition_ir_schema_invalid,
          human_readable: 'Invalid request body for activating a version.',
          user_action: 'Provide a non-empty reason string.',
          details: { zod_error: parsed.error.flatten() },
        });
      }

      const version = await service.activateVersion(actor, params.id, parsed.data);
      return NextResponse.json({ data: version });
    },
  )(req);
}
