import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('treasury_rules')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', session.user.enterprise_id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

const createSchema = z.object({
  label: z.string().min(1).max(200).default('Default Rule'),
  safety_buffer_multiplier: z.number().min(1).max(10).default(1.5),
  obligation_lookahead_days: z.number().int().min(1).max(365).default(7),
  target_stablecoin: z.string().default('USDC'),
  target_chain: z.string().default('ethereum'),
  approval_threshold_usd: z.number().positive().default(100000),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Deactivate existing active rules for this user first
  await supabase
    .from('treasury_rules')
    .update({ is_active: false })
    .eq('user_id', session.user.id)
    .eq('enterprise_id', session.user.enterprise_id)
    .eq('is_active', true);

  const { data: rule, error } = await supabase
    .from('treasury_rules')
    .insert({
      user_id: session.user.id,
      enterprise_id: session.user.enterprise_id,
      label: parsed.data.label,
      safety_buffer_multiplier: parsed.data.safety_buffer_multiplier,
      obligation_lookahead_days: parsed.data.obligation_lookahead_days,
      target_stablecoin: parsed.data.target_stablecoin,
      target_chain: parsed.data.target_chain,
      approval_threshold_usd: parsed.data.approval_threshold_usd,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'treasury_rule_create',
    entityType: 'treasury_rule',
    entityId: rule.id,
    details: { label: parsed.data.label },
  });

  return NextResponse.json({ data: rule }, { status: 201 });
}
