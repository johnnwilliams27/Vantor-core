import { NextRequest, NextResponse } from 'next/server';
import {
  handleAuthoringRequest,
  AuthoringContext,
} from '@/lib/policy/authoring/http';
import { canViewActivePolicy } from '@/lib/policy/authoring/permissions';
import { AuthoringError } from '@/lib/policy/authoring/errors';
import { REASON_CODES } from '@/lib/policy/errors/reason-codes';

export function GET(
  req: NextRequest,
  { params }: { params: { id: string; otherId: string } },
) {
  return handleAuthoringRequest(
    async (_req: NextRequest, { actor, service }: AuthoringContext) => {
      if (!canViewActivePolicy(actor.role)) {
        throw new AuthoringError({
          reason_code: REASON_CODES.requires_policy_admin,
          human_readable: 'Diffing policy versions requires at least auditor role.',
          user_action: 'Ask an admin to elevate your role.',
          details: { role: actor.role },
        });
      }

      const diff = await service.diffVersions(actor, params.id, params.otherId);
      return NextResponse.json({ data: diff });
    },
  )(req);
}
