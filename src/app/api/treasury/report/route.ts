import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { buildReportData, reportToCsv } from '@/lib/treasury/report';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const { searchParams } = new URL(req.url);
  const format = searchParams.get('format') ?? 'json';
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!from || !to) {
    return NextResponse.json({ error: 'Missing required query params: from, to' }, { status: 400 });
  }

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(from) || !dateRegex.test(to)) {
    return NextResponse.json({ error: 'Dates must be in YYYY-MM-DD format' }, { status: 400 });
  }

  if (from > to) {
    return NextResponse.json({ error: '"from" must be before or equal to "to"' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const userId = session.user.id;

  try {
    const reportData = await buildReportData(supabase, userId, from, to);

    await writeAuditLog({
      userId,
      action: 'treasury_report_export',
      details: { format, from, to },
    });

    if (format === 'csv') {
      const csv = reportToCsv(reportData);
      const filename = `vantor-report-${from}-to-${to}.csv`;
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    if (format === 'pdf') {
      // Dynamic import to keep PDF renderer out of edge runtime
      const { renderToBuffer } = await import('@react-pdf/renderer');
      const { TreasuryReportPdf } = await import('@/lib/treasury/report-pdf');
      const React = (await import('react')).default;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const element = React.createElement(TreasuryReportPdf, { data: reportData }) as any;
      const buffer: Buffer = await renderToBuffer(element);

      const filename = `vantor-report-${from}-to-${to}.pdf`;
      return new NextResponse(buffer as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    // Default: JSON
    return NextResponse.json({ data: reportData });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
