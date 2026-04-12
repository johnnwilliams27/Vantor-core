import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveRbacSettings, updateRbacSettings } from '@/lib/auth/rbac-settings';

/**
 * Per-enterprise RBAC settings endpoint.
 *
 * GET  /api/enterprise/rbac-settings
 *   Returns the caller's enterprise RBAC settings. Any authenticated
 *   user with an enterprise_id can read — the settings drive UI
 *   affordances (e.g. "separation is enabled — strict mode" badge).
 *
 * PUT  /api/enterprise/rbac-settings
 *   Updates settings. Gated on role === 'enterprise_admin'.
 *   Body: { authorApproverSeparationEnabled: boolean }
 *
 * POST is aliased to PUT for convenience (forms without method override).
 */

const updateBodySchema = z.object({
  authorApproverSeparationEnabled: z.boolean().optional(),
});

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.enterprise_id) {
    return NextResponse.json(
      { error: 'User is not associated with an enterprise' },
      { status: 400 },
    );
  }

  try {
    const settings = await resolveRbacSettings(session.user.enterprise_id, createAdminClient());
    return NextResponse.json({ data: settings });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ─── PUT / POST ──────────────────────────────────────────────────────────────

async function handleUpdate(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.enterprise_id) {
    return NextResponse.json(
      { error: 'User is not associated with an enterprise' },
      { status: 400 },
    );
  }
  // Strict role check — matches the canCreateDraft gate in
  // src/lib/policy/authoring/permissions.ts. Changing the
  // author-approver separation toggle is a policy-level decision.
  if (session.user.role !== 'enterprise_admin') {
    return NextResponse.json(
      {
        error: 'Forbidden',
        reason: 'Only users with the enterprise_admin role may update RBAC settings.',
      },
      { status: 403 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = updateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const settings = await updateRbacSettings(
      session.user.enterprise_id,
      parsed.data,
      createAdminClient(),
    );

    // Audit trail — writes never happen silently.
    const supabase = createAdminClient();
    await supabase
      .from('audit_logs')
      .insert({
        user_id: session.user.id,
        enterprise_id: session.user.enterprise_id,
        action: 'rbac_settings_updated',
        details: {
          patch: parsed.data,
          new_state: settings,
        },
      })
      // Audit logging is best-effort — a failure here must not block
      // the settings update from returning success to the user.
      .then(
        () => undefined,
        (err: unknown) => {
          // eslint-disable-next-line no-console
          console.error('[rbac-settings] audit_logs insert failed:', err);
        },
      );

    return NextResponse.json({ data: settings });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export const PUT = handleUpdate;
export const POST = handleUpdate;
