import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

const MAX_PINS = 4;
const DEFAULT_PINS = ['balance-history', 'obligation-coverage'];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ data: { pinnedSlugs: DEFAULT_PINS } });
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('analytics_pin_preferences')
    .select('pinned_slugs')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .limit(1);

  const pinnedSlugs = data?.[0]?.pinned_slugs ?? DEFAULT_PINS;
  return NextResponse.json({ data: { pinnedSlugs } });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ error: 'No enterprise' }, { status: 400 });
  }

  let body: { slugs?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const slugs = body.slugs;
  if (!Array.isArray(slugs)) {
    return NextResponse.json({ error: 'slugs must be an array' }, { status: 400 });
  }
  if (slugs.length > MAX_PINS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_PINS} pinned views allowed` },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('analytics_pin_preferences')
    .upsert(
      {
        user_id: session.user.id,
        enterprise_id: enterpriseId,
        pinned_slugs: slugs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,enterprise_id' },
    );

  if (error) {
    return NextResponse.json({ error: 'Failed to update pins' }, { status: 500 });
  }

  return NextResponse.json({ data: { pinnedSlugs: slugs } });
}
