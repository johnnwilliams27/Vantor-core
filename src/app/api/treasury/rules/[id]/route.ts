import { isValidUUID } from '@/lib/api/rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { NotificationService } from '@/lib/notifications/service';
import { infoEmail } from '@/lib/notifications/email-templates';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

const updateSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  safety_buffer_multiplier: z.number().min(1).max(10).optional(),
  obligation_lookahead_days: z.number().int().min(1).max(365).optional(),
  target_stablecoin: z.string().optional(),
  target_chain: z.string().optional(),
  approval_threshold_usd: z.number().positive().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: rule, error } = await supabase
    .from('treasury_rules')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rule) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'treasury_rule_update',
    entityType: 'treasury_rule',
    entityId: params.id,
    details: parsed.data as Record<string, unknown>,
  });

  if (enterpriseId) {
    const changedFields = Object.keys(parsed.data).join(', ');
    const emailHtml = infoEmail({
      title: 'Treasury Rule Updated',
      description: `The treasury rule "${rule.label}" has been updated. Changed fields: ${changedFields}.`,
      ctaLabel: 'View Rules',
      ctaHref: '/treasury',
    });

    NotificationService.notify({
      eventType: 'treasury_rule_updated',
      enterpriseId: session.user.enterprise_id!,
      title: 'Treasury Rule Updated',
      body: `Rule "${rule.label}" updated (${changedFields})`,
      link: '/treasury',
      metadata: {
        ruleId: rule.id,
        _emailSubject: 'Treasury Rule Updated',
        _emailHtml: emailHtml,
      },
      actorId: session.user.id,
    }).catch(() => {});
  }

  return NextResponse.json({ data: rule });
}
