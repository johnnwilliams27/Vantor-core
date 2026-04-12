import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  handleAuthoringRequest,
  AuthoringContext,
} from '@/lib/policy/authoring/http';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';
import { conditionSchema } from '@/lib/policy/schemas/ir.schema';
import { APPROVER_ROLES } from '@/lib/auth/roles';

const slotSchema = z.object({
  slot_index: z.number().int().nonnegative(),
  // Sourced from the single source of truth — stays in lockstep with
  // the TS union + runtime Set. Legacy 'approver' literal removed.
  minimum_role: z.enum(APPROVER_ROLES),
});

const patchChainBodySchema = z.object({
  name: z.string().min(1).optional(),
  slots: z.array(slotSchema).min(1).optional(),
  trigger_condition: conditionSchema.optional(),
  priority: z.number().int().nonnegative().optional(),
  expiration_hours: z.number().int().positive().optional(),
});

export function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; chainId: string } },
) {
  return handleAuthoringRequest(
    async (innerReq: NextRequest, { actor, service }: AuthoringContext) => {
      const raw = await innerReq.json();
      const parsed = patchChainBodySchema.safeParse(raw);
      if (!parsed.success) {
        throw new AuthoringError({
          reason_code: REASON_CODES.chain_reference_not_found,
          human_readable: 'Invalid request body for updating an approval chain.',
          user_action: 'Fix the chain fields and retry.',
          details: { zod_error: parsed.error.flatten() },
        });
      }

      const chain = await service.upsertApprovalChain(actor, params.id, {
        ...parsed.data,
        id: params.chainId,
      } as Parameters<typeof service.upsertApprovalChain>[2]);
      return NextResponse.json({ data: chain });
    },
  )(req);
}

export function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; chainId: string } },
) {
  return handleAuthoringRequest(
    async (_req: NextRequest, { actor, service }: AuthoringContext) => {
      const updated = await service.deleteApprovalChain(actor, params.id, params.chainId);
      return NextResponse.json({ data: updated });
    },
  )(req);
}
