import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { encryptSlackCredentials } from '@/lib/integrations/slack';
import { z } from 'zod';

const connectSchema = z.object({
  botToken: z.string().min(1).max(500),
  signingSecret: z.string().min(1).max(200),
  channelId: z.string().min(1).max(20),
  channelName: z.string().max(100).optional(),
  workspaceName: z.string().max(200).optional(),
  teamId: z.string().max(100).optional(),
});

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('slack_integrations')
    .select('id, workspace_name, team_id, channel_id, channel_name, is_active, verified_at, created_at')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', session.user.enterprise_id)
    .eq('is_active', true)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json().catch(() => ({}));
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { botToken, signingSecret, channelId, channelName, workspaceName, teamId } = parsed.data;
  const encrypted = encryptSlackCredentials({ botToken, signingSecret });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('slack_integrations')
    .upsert({
      user_id: session.user.id,
      enterprise_id: session.user.enterprise_id,
      workspace_name: workspaceName ?? null,
      team_id: teamId ?? null,
      channel_id: channelId,
      channel_name: channelName ?? null,
      credentials: encrypted,
      is_active: true,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select('id, workspace_name, team_id, channel_id, channel_name, is_active, verified_at, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'slack_connect',
    entityType: 'slack_integration',
    entityId: data.id,
    details: { channel_id: channelId, channel_name: channelName, workspace_name: workspaceName },
  });

  return NextResponse.json({ data }, { status: 201 });
}

export async function DELETE(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('slack_integrations')
    .select('id')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', session.user.enterprise_id)
    .eq('is_active', true)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: 'No active Slack integration found' }, { status: 404 });

  const { error } = await supabase
    .from('slack_integrations')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('user_id', session.user.id)
    .eq('enterprise_id', session.user.enterprise_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'slack_disconnect',
    entityType: 'slack_integration',
    entityId: existing.id,
    details: {},
  });

  return NextResponse.json({ data: { success: true } });
}
