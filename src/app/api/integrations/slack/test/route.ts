import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { decryptSlackCredentials, postTestMessage } from '@/lib/integrations/slack';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const supabase = createAdminClient();
  const { data: integration, error } = await supabase
    .from('slack_integrations')
    .select('id, channel_id, credentials')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!integration) return NextResponse.json({ error: 'No active Slack integration configured' }, { status: 404 });

  let creds;
  try {
    creds = await decryptSlackCredentials(integration.credentials, `slack_integrations/id=${integration.id}`);
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt Slack credentials' }, { status: 500 });
  }

  const result = await postTestMessage(creds.botToken, integration.channel_id);

  await writeAuditLog({
    userId: session.user.id,
    action: 'slack_test',
    entityType: 'slack_integration',
    entityId: integration.id,
    details: { success: result.ok, slack_error: result.error ?? null },
  });

  if (!result.ok) {
    return NextResponse.json({
      success: false,
      message: `Slack API error: ${result.error ?? 'unknown'}`,
    });
  }

  return NextResponse.json({ success: true, message: 'Test message sent to Slack channel!' });
}
