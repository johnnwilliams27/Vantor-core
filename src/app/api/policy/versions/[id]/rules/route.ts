import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  handleAuthoringRequest,
  AuthoringContext,
} from '@/lib/policy/authoring/http';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';
import { conditionSchema } from '@/lib/policy/schemas/ir.schema';

const upsertRuleBodySchema = z.object({
  id: z.string().uuid().optional(),
  rule_type: z.enum(['approval_threshold', 'counterparty', 'time_window', 'lookahead']),
  name: z.string().min(1),
  rationale: z.string().min(1),
  condition: conditionSchema,
  verdict: z.enum(['allow_auto', 'require_approval', 'block', 'block_hard_limit']),
  verdict_chain_id: z.string().uuid().optional(),
  priority: z.number().int().nonnegative(),
});

export function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handleAuthoringRequest(
    async (innerReq: NextRequest, { actor, service }: AuthoringContext) => {
      const raw = await innerReq.json();
      const parsed = upsertRuleBodySchema.safeParse(raw);
      if (!parsed.success) {
        throw new AuthoringError({
          reason_code: REASON_CODES.condition_ir_schema_invalid,
          human_readable: 'Invalid request body for upserting a rule.',
          user_action: 'Fix the rule fields and retry.',
          details: { zod_error: parsed.error.flatten() },
        });
      }

      const rule = await service.upsertRule(actor, params.id, parsed.data);
      return NextResponse.json({ data: rule }, { status: 200 });
    },
  )(req);
}
