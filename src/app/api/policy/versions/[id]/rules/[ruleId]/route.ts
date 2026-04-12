import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  handleAuthoringRequest,
  AuthoringContext,
} from '@/lib/policy/authoring/http';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';
import { conditionSchema } from '@/lib/policy/schemas/ir.schema';

const patchRuleBodySchema = z.object({
  rule_type: z.enum(['approval_threshold', 'counterparty', 'time_window', 'lookahead']).optional(),
  name: z.string().min(1).optional(),
  rationale: z.string().min(1).optional(),
  condition: conditionSchema.optional(),
  verdict: z.enum(['allow_auto', 'require_approval', 'block', 'block_hard_limit']).optional(),
  verdict_chain_id: z.string().uuid().optional(),
  priority: z.number().int().nonnegative().optional(),
});

export function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; ruleId: string } },
) {
  return handleAuthoringRequest(
    async (innerReq: NextRequest, { actor, service }: AuthoringContext) => {
      const raw = await innerReq.json();
      const parsed = patchRuleBodySchema.safeParse(raw);
      if (!parsed.success) {
        throw new AuthoringError({
          reason_code: REASON_CODES.condition_ir_schema_invalid,
          human_readable: 'Invalid request body for updating a rule.',
          user_action: 'Fix the rule fields and retry.',
          details: { zod_error: parsed.error.flatten() },
        });
      }

      const rule = await service.upsertRule(actor, params.id, {
        ...parsed.data,
        id: params.ruleId,
      } as Parameters<typeof service.upsertRule>[2]);
      return NextResponse.json({ data: rule });
    },
  )(req);
}

export function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; ruleId: string } },
) {
  return handleAuthoringRequest(
    async (_req: NextRequest, { actor, service }: AuthoringContext) => {
      const updated = await service.deleteRule(actor, params.id, params.ruleId);
      return NextResponse.json({ data: updated });
    },
  )(req);
}
