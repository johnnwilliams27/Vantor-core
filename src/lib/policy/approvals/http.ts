// src/lib/policy/approvals/http.ts
//
// Shared HTTP helpers for approval workflow API routes.
// Same pattern as authoring/http.ts but uses ApprovalError.

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { ApprovalWorkflowService } from './service';
import { ApprovalError } from './errors';
import type { ApprovalActor } from './types';
import type { ReasonCode } from '../errors/reason-codes';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildProductionEvaluate } from '../gate/production-wiring';

// ─── Status code mapping table ─────────────────────────────────────────
//
// | Reason Code                            | HTTP Status |
// |----------------------------------------|-------------|
// | sod_initiator_conflict                 | 403         |
// | sod_rule_editor_conflict               | 403         |
// | requires_policy_admin                  | 403         |
// | approval_not_pending                   | 409         |
// | sod_already_filled                     | 409         |
// | approval_concurrent_modification       | 409         |
// | stale_approval_reevaluation_failed     | 409         |
// | no_matching_slot                       | 400         |
// | everything else                        | 400         |

const STATUS_403: ReadonlySet<ReasonCode> = new Set([
  'sod_initiator_conflict',
  'sod_rule_editor_conflict',
  'requires_policy_admin',
] as ReasonCode[]);

const STATUS_409: ReadonlySet<ReasonCode> = new Set([
  'approval_not_pending',
  'sod_already_filled',
  'approval_concurrent_modification',
  'stale_approval_reevaluation_failed',
] as ReasonCode[]);

// ─── Context resolution ────────────────────────────────────────────────

export interface ApprovalContext {
  actor: ApprovalActor;
  service: ApprovalWorkflowService;
  /** Exposed so route handlers can dispatch to the executor registry after
   *  service.fillSlot/deny returns. Same admin client the service uses. */
  supabase: SupabaseClient;
}

/**
 * Resolves the current NextAuth session into an ApprovalActor and an
 * ApprovalWorkflowService backed by the admin Supabase client. The
 * service is wired with the production evaluate function so the
 * post-approval re-evaluation runs against real policy state (Plan 2b
 * shipped with the evaluate hook but no-op; Plan 3 wires it here).
 *
 * Returns null when the session is missing or lacks an enterprise_id;
 * the caller should respond with 401.
 */
export async function resolveApprovalContext(
  _req: NextRequest,
): Promise<ApprovalContext | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.role) return null;

  const supabase = createAdminClient();
  const enterprise_id = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterprise_id) return null;

  const actor: ApprovalActor = {
    user_id: session.user.id,
    role: session.user.role as ApprovalActor['role'],
    enterprise_id,
  };

  return {
    actor,
    service: new ApprovalWorkflowService(supabase, {
      evaluate: buildProductionEvaluate(supabase),
    }),
    supabase,
  };
}

// ─── Error mapping ─────────────────────────────────────────────────────

export interface ApprovalErrorBody {
  reason_code: ReasonCode;
  human_readable: string;
  user_action: string;
  details: Record<string, unknown>;
}

/**
 * Maps an ApprovalError to an HTTP status code and structured response body.
 */
export function mapApprovalErrorToHttp(err: ApprovalError): {
  status: number;
  body: ApprovalErrorBody;
} {
  let status = 400;
  if (STATUS_403.has(err.reason_code)) {
    status = 403;
  } else if (STATUS_409.has(err.reason_code)) {
    status = 409;
  }

  return {
    status,
    body: {
      reason_code: err.reason_code,
      human_readable: err.human_readable,
      user_action: err.user_action,
      details: err.details,
    },
  };
}

// ─── Route handler wrapper ─────────────────────────────────────────────

type RouteHandler = (
  req: NextRequest,
  ctx: ApprovalContext,
) => Promise<NextResponse>;

/**
 * Wraps a route handler with:
 *   1. Session resolution -- returns 401 if no valid session.
 *   2. ApprovalError mapping -- ApprovalErrors become structured JSON
 *      with the correct 400 / 403 / 409 status.
 *   3. Unhandled errors -- re-thrown so Next.js error boundaries handle them.
 */
export function handleApprovalRequest(handler: RouteHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const ctx = await resolveApprovalContext(req);
    if (!ctx) {
      return NextResponse.json(
        { error: 'Unauthorized', reason_code: 'requires_policy_admin' },
        { status: 401 },
      );
    }

    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApprovalError) {
        const { status, body } = mapApprovalErrorToHttp(err);
        return NextResponse.json(body, { status });
      }
      throw err;
    }
  };
}
