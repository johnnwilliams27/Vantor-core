import { NextRequest, NextResponse } from 'next/server';
import {
  handleAuthoringRequest,
  AuthoringContext,
} from '@/lib/policy/authoring/http';
import { canViewActivePolicy } from '@/lib/policy/authoring/permissions';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';

export const GET = handleAuthoringRequest(
  async (_req: NextRequest, { actor, service }: AuthoringContext) => {
    if (!canViewActivePolicy(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Viewing the active policy version requires at least auditor role.',
        user_action: 'Ask an admin to elevate your role.',
        details: { role: actor.role },
      });
    }

    const version = await service.getActiveVersion(actor);
    return NextResponse.json({ data: version });
  },
);
