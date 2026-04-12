import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { executeView } from '@/lib/analytics/engine';
import { viewResultToCsvColumns, viewResultToCsvRows } from '@/components/analytics/export-helpers';

const DEFAULT_PINS = ['balance-history', 'obligation-coverage'];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ error: 'No enterprise' }, { status: 400 });
  }

  let body: { from?: string; to?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { from, to } = body;
  if (!from || !to) {
    return NextResponse.json({ error: 'from and to required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Get user's pinned slugs
  const { data: pinData } = await supabase
    .from('analytics_pin_preferences')
    .select('pinned_slugs')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .limit(1);

  const pinnedSlugs = pinData?.[0]?.pinned_slugs ?? DEFAULT_PINS;
  const allSlugs = ['treasury-summary', ...pinnedSlugs];

  // Fetch all pinned views
  const results = await Promise.all(
    allSlugs.map(async (slug) => {
      try {
        return await executeView(supabase, enterpriseId, slug, { from, to });
      } catch {
        return null;
      }
    }),
  );

  // Build multi-section CSV (simpler than server-side PDF — PDF requires @react-pdf which is client-only)
  // Return as CSV with section headers
  const sections: string[] = [];
  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  sections.push(`# Vantor Analytics Report — ${from} to ${to}`);
  sections.push(`# Generated: ${now}`);
  sections.push('');

  for (const result of results) {
    if (!result) continue;
    sections.push(`# ${result.view.label}`);
    const cols = viewResultToCsvColumns(result);
    const rows = viewResultToCsvRows(result);
    if (cols.length > 0 && rows.length > 0) {
      sections.push(cols.map((c) => c.header).join(','));
      for (const row of rows) {
        sections.push(cols.map((c) => c.accessor(row as Record<string, unknown>)).join(','));
      }
    }
    sections.push('');
  }

  const csv = sections.join('\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="vantor-analytics-report-${from}-to-${to}.csv"`,
    },
  });
}
