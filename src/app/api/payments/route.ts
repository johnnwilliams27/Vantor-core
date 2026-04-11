import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

const PAYMENT_STATUSES = ['pending', 'processing', 'completed', 'failed', 'cancelled'] as const;

// GET remains available so historical payment records stay visible in any UI
// that still reads from /api/payments (e.g. reporting exports). Listing is a
// read-only operation and has no side effects.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const { searchParams } = new URL(req.url);
  const rawStatus = searchParams.get('status');
  const status = rawStatus && (PAYMENT_STATUSES as readonly string[]).includes(rawStatus) ? rawStatus : null;

  const supabase = createAdminClient();

  let q = supabase
    .from('fiat_payments')
    .select('*, from_bank_account:bank_accounts(id, institution_name, account_name, last4, nickname)')
    .eq('enterprise_id', enterpriseId)
    .order('created_at', { ascending: false });

  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// POST is intentionally disabled. Bridge only supports fiat<->crypto routes
// (confirmed via sandbox probing on 2026-04-11), and the stablecoin sandwich
// pattern that would emulate fiat->fiat requires a full two-leg orchestration
// engine we haven't built yet. A dedicated bank payment provider (Modern
// Treasury / Column / Increase) will be wired up in a future PR. The
// /payments page shows a Coming Soon placeholder until then.
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error: 'payments_disabled',
      message: 'Bank payments are temporarily disabled while we integrate a new payment provider.',
    },
    { status: 501 },
  );
}
