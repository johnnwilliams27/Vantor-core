import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { ALL_ROLES, type UserRole } from '@/lib/auth/roles';

/**
 * PATCH /api/user/enterprise/team/[userId]
 *
 * Updates a team member's role. Gated on the caller being an
 * enterprise_admin in the same enterprise as the target user.
 *
 * Body: { role: UserRole }
 *
 * Returns: { data: { id, role } } on success.
 *
 * Guardrails:
 *   - Caller must be enterprise_admin (strict role check — matches the
 *     authoring gate in src/lib/policy/authoring/permissions.ts).
 *   - Target user must belong to the caller's enterprise (no cross-tenant
 *     edits even for enterprise_admin).
 *   - Target user cannot be the caller themselves (no self-demotion
 *     into a non-admin trap; the DB state is recoverable but the UX
 *     confusion isn't worth it).
 *
 * Audit: every successful change writes to audit_logs.
 */

const patchBody = z.object({
  role: z.enum(ALL_ROLES),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { userId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'enterprise_admin') {
    return NextResponse.json(
      {
        error: 'Forbidden',
        reason: 'Only enterprise admins may change team member roles.',
      },
      { status: 403 },
    );
  }
  if (!session.user.enterprise_id) {
    return NextResponse.json(
      { error: 'User is not associated with an enterprise' },
      { status: 400 },
    );
  }
  if (params.userId === session.user.id) {
    return NextResponse.json(
      {
        error: 'Cannot change your own role',
        reason:
          'Ask another enterprise admin to update your role, or contact Vantor support.',
      },
      { status: 400 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = patchBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  // Verify target user exists in the same enterprise
  const { data: target, error: fetchErr } = await supabase
    .from('user_profiles')
    .select('id, role, enterprise_id, full_name')
    .eq('id', params.userId)
    .single();

  if (fetchErr || !target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  if (target.enterprise_id !== session.user.enterprise_id) {
    // Don't leak existence to cross-tenant probers — same shape as 404.
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const previousRole = target.role as UserRole;
  const newRole = parsed.data.role;

  if (previousRole === newRole) {
    return NextResponse.json({ data: { id: target.id, role: previousRole } });
  }

  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({ role: newRole })
    .eq('id', params.userId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Audit trail — best-effort, do not block the user-facing response.
  supabase
    .from('audit_logs')
    .insert({
      user_id: session.user.id,
      enterprise_id: session.user.enterprise_id,
      action: 'team_role_changed',
      details: {
        target_user_id: params.userId,
        target_name: target.full_name,
        previous_role: previousRole,
        new_role: newRole,
      },
    })
    .then(
      () => undefined,
      (err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[team role change] audit_logs insert failed:', err);
      },
    );

  return NextResponse.json({ data: { id: target.id, role: newRole } });
}
