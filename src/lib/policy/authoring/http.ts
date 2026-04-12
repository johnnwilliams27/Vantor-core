/**
 * Shared HTTP helpers for policy authoring API routes.
 *
 * - resolveAuthoringContext  — resolves a NextAuth session to an AuthoringActor
 *                              + PolicyAuthoringService instance.
 * - mapAuthoringErrorToHttp  — maps AuthoringError reason_codes to HTTP status
 *                              codes and a structured JSON body.
 * - handleAuthoringRequest   — wraps a route handler with auth + error mapping.
 */

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { PolicyAuthoringService, type SupabaseLike } from './service';
import { AuthoringError } from './errors';
import type { AuthoringActor } from './types';
import type { ReasonCode } from '../errors/reason-codes';

// ─── Status code table ────────────────────────────────────────────────────────

const STATUS_403: ReadonlySet<ReasonCode> = new Set([
  'requires_policy_admin',
] as ReasonCode[]);

const STATUS_409: ReadonlySet<ReasonCode> = new Set([
  'version_not_draft',
  'activation_race_conflict',
  'stale_approval_chain_mismatch',
  'activation_blocked_by_validation',
  'chain_unsatisfiable_at_activation',
] as ReasonCode[]);

// Everything else maps to 400.

// ─── Context resolution ───────────────────────────────────────────────────────

export interface AuthoringContext {
  actor: AuthoringActor;
  service: PolicyAuthoringService;
}

/**
 * Resolves the current NextAuth session into an AuthoringActor and a
 * PolicyAuthoringService backed by the admin Supabase client.
 *
 * Returns `null` when the session is missing or lacks an enterprise_id;
 * the caller should respond with 401.
 */
export async function resolveAuthoringContext(
  _req: NextRequest,
): Promise<AuthoringContext | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.role) return null;

  const supabase = createAdminClient();
  const enterprise_id = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterprise_id) return null;

  const actor: AuthoringActor = {
    user_id: session.user.id,
    role: session.user.role as AuthoringActor['role'],
    enterprise_id,
  };

  // The real SupabaseClient satisfies SupabaseLike structurally at runtime
  // but TS can't prove it because `rpc`'s return type diverges (PostgrestFilterBuilder
  // vs Promise). Cast via unknown is intentional.
  return { actor, service: new PolicyAuthoringService(supabase as unknown as SupabaseLike) };
}

// ─── Error → HTTP mapping ─────────────────────────────────────────────────────

export interface AuthoringErrorBody {
  reason_code: ReasonCode;
  human_readable: string;
  user_action: string;
  details: Record<string, unknown>;
  path: (string | number)[];
}

/**
 * Maps an AuthoringError to an HTTP status code and a structured response body.
 *
 * Mapping rules:
 *   requires_policy_admin                              → 403
 *   version_not_draft | activation_race_conflict |
 *   stale_approval_chain_mismatch |
 *   activation_blocked_by_validation |
 *   chain_unsatisfiable_at_activation                 → 409
 *   everything else (validation errors)               → 400
 */
export function mapAuthoringErrorToHttp(err: AuthoringError): {
  status: number;
  body: AuthoringErrorBody;
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
      path: err.path,
    },
  };
}

// ─── Route handler wrapper ────────────────────────────────────────────────────

type RouteHandler = (
  req: NextRequest,
  ctx: AuthoringContext,
) => Promise<NextResponse>;

/**
 * Wraps a route handler with:
 *   1. Session resolution — returns 401 if no valid session.
 *   2. AuthoringError mapping — AuthoringErrors become structured JSON with
 *      the correct 400 / 403 / 409 status.
 *   3. Unhandled errors — re-thrown so Next.js error boundaries handle them.
 */
export function handleAuthoringRequest(handler: RouteHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const ctx = await resolveAuthoringContext(req);
    if (!ctx) {
      return NextResponse.json(
        { error: 'Unauthorized', reason_code: 'requires_policy_admin' },
        { status: 401 },
      );
    }

    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof AuthoringError) {
        const { status, body } = mapAuthoringErrorToHttp(err);
        return NextResponse.json(body, { status });
      }
      throw err;
    }
  };
}
