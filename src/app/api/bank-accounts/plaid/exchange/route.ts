import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { exchangePublicToken, getAccountDetails } from '@/lib/banking/plaid';
import { z } from 'zod';

const schema = z.object({
  publicToken: z.string().min(1).max(500),
  accountId: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  try {
    const { accessToken, itemId } = await exchangePublicToken(parsed.data.publicToken);
    const details = await getAccountDetails(accessToken, parsed.data.accountId);

    const supabase = createAdminClient();
    const { data: account, error } = await supabase
      .from('bank_accounts')
      .insert({
        user_id: session.user.id,
        plaid_item_id: itemId,
        plaid_account_id: parsed.data.accountId,
        institution_name: details.institutionName,
        account_name: details.accountName,
        account_type: details.accountType,
        last4: details.last4,
        routing_number: details.routingNumber,
        verified_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await writeAuditLog({
      userId: session.user.id,
      action: 'bank_account_connect',
      entityType: 'bank_account',
      entityId: account.id,
      details: { institution: details.institutionName, method: 'plaid' },
    });

    return NextResponse.json({ data: account }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
