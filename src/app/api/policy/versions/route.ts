import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  handleAuthoringRequest,
  AuthoringContext,
} from '@/lib/policy/authoring/http';
import { canViewActivePolicy, canCreateDraft } from '@/lib/policy/authoring/permissions';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';

const createDraftBodySchema = z.object({
  name: z.string().min(1),
  source_version_id: z.string().uuid().optional(),
});

export const GET = handleAuthoringRequest(
  async (_req: NextRequest, { actor, service }: AuthoringContext) => {
    if (!canViewActivePolicy(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Listing policy versions requires at least auditor role.',
        user_action: 'Ask an admin to elevate your role.',
        details: { role: actor.role },
      });
    }

    const versions = await service.listVersions(actor);
    return NextResponse.json({ data: versions });
  },
);

export const POST = handleAuthoringRequest(
  async (req: NextRequest, { actor, service }: AuthoringContext) => {
    if (!canCreateDraft(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Creating a draft policy version requires at least treasury_manager role.',
        user_action: 'Ask an admin to elevate your role.',
        details: { role: actor.role },
      });
    }

    const raw = await req.json();
    const parsed = createDraftBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AuthoringError({
        reason_code: REASON_CODES.condition_ir_schema_invalid,
        human_readable: 'Invalid request body for creating a draft.',
        user_action: 'Provide a name and optionally a source_version_id (UUID).',
        details: { zod_error: parsed.error.flatten() },
      });
    }

    const version = await service.createDraft(actor, parsed.data);
    return NextResponse.json({ data: version }, { status: 201 });
  },
);
