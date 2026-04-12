import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  handleAuthoringRequest,
  AuthoringContext,
} from '@/lib/policy/authoring/http';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';
import { conditionSchema } from '@/lib/policy/schemas/ir.schema';

const slotSchema = z.object({
  slot_index: z.number().int().nonnegative(),
  minimum_role: z.enum(['auditor', 'accountant', 'treasury_manager', 'approver', 'executive']),
});

const upsertChainBodySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  slots: z.array(slotSchema).min(1),
  trigger_condition: conditionSchema.optional(),
  priority: z.number().int().nonnegative(),
  expiration_hours: z.number().int().positive().optional(),
});

export function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handleAuthoringRequest(
    async (innerReq: NextRequest, { actor, service }: AuthoringContext) => {
      const raw = await innerReq.json();
      const parsed = upsertChainBodySchema.safeParse(raw);
      if (!parsed.success) {
        throw new AuthoringError({
          reason_code: REASON_CODES.chain_reference_not_found,
          human_readable: 'Invalid request body for upserting an approval chain.',
          user_action: 'Fix the chain fields and retry.',
          details: { zod_error: parsed.error.flatten() },
        });
      }

      const chain = await service.upsertApprovalChain(actor, params.id, parsed.data);
      return NextResponse.json({ data: chain }, { status: 200 });
    },
  )(req);
}
