import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { executeView } from '@/lib/analytics/engine';
import {
  viewResultToCsvColumns,
  viewResultToCsvRows,
} from '@/components/analytics/export-helpers';

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

  let body: { from?: string; to?: string; format?: 'csv' | 'pdf' };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { from, to } = body;
  const format = body.format ?? 'csv';
  if (!from || !to) {
    return NextResponse.json({ error: 'from and to required' }, { status: 400 });
  }
  if (format !== 'csv' && format !== 'pdf') {
    return NextResponse.json({ error: 'format must be csv or pdf' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Resolve the user's pinned views + always lead with Treasury Summary.
  const { data: pinData } = await supabase
    .from('analytics_pin_preferences')
    .select('pinned_slugs')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .limit(1);

  const pinnedSlugs = pinData?.[0]?.pinned_slugs ?? DEFAULT_PINS;
  const allSlugs = ['treasury-summary', ...pinnedSlugs];

  const results = await Promise.all(
    allSlugs.map(async (slug) => {
      try {
        return await executeView(supabase, enterpriseId, slug, { from, to });
      } catch {
        return null;
      }
    }),
  );

  const nonNull = results.filter((r): r is NonNullable<typeof r> => r !== null);

  // PDF: dynamic import @react-pdf/renderer to keep it out of edge runtime,
  // same pattern as /api/treasury/report.
  if (format === 'pdf') {
    const { renderToBuffer } = await import('@react-pdf/renderer');
    const { AnalyticsReportPdf } = await import('@/lib/analytics/report-pdf');
    const React = (await import('react')).default;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(AnalyticsReportPdf, {
      period: { from, to },
      sections: nonNull,
    }) as any;
    const buffer = await renderToBuffer(element);

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="vantor-analytics-report-${from}-to-${to}.pdf"`,
      },
    });
  }

  // CSV (default): multi-section with comment headers
  const sections: string[] = [];
  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  sections.push(`# Vantor Analytics Report — ${from} to ${to}`);
  sections.push(`# Generated: ${now}`);
  sections.push('');

  for (const result of nonNull) {
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
