import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getERPAdapter, encryptCredentials, decryptCredentials } from '@/lib/erp/factory';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';
import type { ErpProvider } from '@/types/database';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';

const schema = z.object({
  provider: z.enum(['sap', 'oracle', 'xero', 'netsuite']),
  label: z.string().min(1).max(200),
  credentials: z.object({
    apiUrl: z.string().url().max(500),
    clientId: z.string().min(1).max(500),
    clientSecret: z.string().min(1).max(500),
    companyCode: z.string().max(100).optional(),
    tenantId: z.string().max(200).optional(),
    accountId: z.string().max(200).optional(),
  }),
  testOnly: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('connect ERP'); throw e; }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  const { provider, label, credentials, testOnly } = parsed.data;
  const adapter = getERPAdapter(provider as ErpProvider, credentials);
  const testResult = await adapter.testConnection();

  if (testOnly) {
    return NextResponse.json({ data: testResult });
  }

  if (!testResult.success) {
    return NextResponse.json({ error: testResult.message }, { status: 400 });
  }

  const encrypted = await encryptCredentials(credentials);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('erp_configurations')
    .upsert(
      {
        user_id: session.user.id,
        enterprise_id: enterpriseId,
        provider,
        label,
        credentials: encrypted,
        is_active: true,
      },
      { onConflict: 'user_id,provider' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'erp_connect',
    entityType: 'erp_configuration',
    entityId: data.id,
    details: { provider },
  });

  // Don't return raw credentials
  const { credentials: _creds, ...safeConfig } = data;
  return NextResponse.json({ data: safeConfig });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  let rawBody: unknown;
  try { rawBody = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const patchSchema = z.object({
    id: z.string().uuid(),
    is_active: z.boolean().optional(),
    label: z.string().min(1).max(200).optional(),
  });
  const patchParsed = patchSchema.safeParse(rawBody);
  if (!patchParsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { id, is_active, label } = patchParsed.data;

  const updates: Record<string, unknown> = {};
  if (is_active !== undefined) updates.is_active = is_active;
  if (label !== undefined) updates.label = label;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('erp_configurations')
    .update(updates)
    .eq('id', id)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .select('id, provider, label, is_active, last_synced, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  let rawBody: unknown;
  try { rawBody = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const deleteSchema = z.object({ id: z.string().uuid() });
  const parsed = deleteSchema.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createAdminClient();

  const { error } = await supabase
    .from('erp_configurations')
    .delete()
    .eq('id', parsed.data.id)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'erp_connect',
    entityType: 'erp_configuration',
    entityId: parsed.data.id,
  });

  return NextResponse.json({ message: 'ERP configuration deleted' });
}

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('erp_configurations')
    .select('id, provider, label, is_active, last_synced, created_at')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
