import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { getYieldAdapter, ALL_YIELD_PROTOCOLS } from '@/lib/yield/factory';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = session.user.enterprise_id;
  let enterpriseCountry: string | null = null;
  if (enterpriseId) {
    const supabase = createAdminClient();
    const { data: ent } = await supabase
      .from('enterprises')
      .select('country')
      .eq('id', enterpriseId)
      .single();
    enterpriseCountry = ent?.country ?? null;
  }

  const protocols = await Promise.all(
    ALL_YIELD_PROTOCOLS.map(async (pid) => {
      const adapter = getYieldAdapter(pid);
      const info = adapter.getInfo();
      const rates = await Promise.all(
        info.supportedTokens.map((t) => adapter.getAPY(t)),
      );
      return { ...info, rates };
    }),
  );

  // Filter out Ondo for US enterprises
  const filteredProtocols = protocols.filter((p) => {
    if (p.id === 'ondo') {
      return enterpriseCountry && enterpriseCountry !== 'US';
    }
    return true;
  });

  return NextResponse.json({ data: filteredProtocols });
}
