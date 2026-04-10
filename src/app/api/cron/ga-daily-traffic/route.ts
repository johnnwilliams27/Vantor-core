import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/send';
import { runGa4Report, isGa4Configured, type RunReportRow } from '@/lib/google/ga4';

/**
 * Daily traffic digest for vantor.xyz.
 * Scheduled via vercel.json cron. Sends to john@vantor.xyz.
 *
 * Setup required before this starts working:
 *   1. Create a Google Cloud service account, enable GA4 Data API.
 *   2. Download the service account JSON key.
 *   3. In GA4 Admin, grant that service account email "Viewer" on the property.
 *   4. Set GA_SERVICE_ACCOUNT_JSON (the full JSON as a string) and
 *      GA_PROPERTY_ID (the numeric property ID — NOT the G-XXXX measurement ID)
 *      on Vercel as Production env vars.
 *
 * Until those env vars are set, the cron returns a no-op response with an
 * explanatory message — it does not 500 and does not send an email.
 */

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isGa4Configured()) {
    return NextResponse.json({
      sent: false,
      reason:
        'GA_SERVICE_ACCOUNT_JSON and/or GA_PROPERTY_ID are not set. See route file header for setup.',
    });
  }

  try {
    // Pull yesterday's totals and top pages in parallel.
    const [totalsReport, topPagesReport, topSourcesReport] = await Promise.all([
      runGa4Report({
        dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'newUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'engagementRate' },
          { name: 'averageSessionDuration' },
        ],
      }),
      runGa4Report({
        dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
        dimensions: [{ name: 'pagePath' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 10,
      }),
      runGa4Report({
        dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        dimensions: [{ name: 'sessionSource' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
      }),
    ]);

    const totalsRow = totalsReport.totals?.[0] ?? totalsReport.rows?.[0];
    const [activeUsers, newUsers, sessions, pageViews, engagementRate, avgDuration] =
      (totalsRow?.metricValues ?? []).map((m) => m.value);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dateLabel = yesterday.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      timeZone: 'America/New_York',
    });

    // If there was literally no traffic yesterday, still send a one-line email
    // so you know the pipeline is alive.
    const noTraffic = !pageViews || pageViews === '0';

    const html = buildHtml({
      dateLabel,
      activeUsers: activeUsers ?? '0',
      newUsers: newUsers ?? '0',
      sessions: sessions ?? '0',
      pageViews: pageViews ?? '0',
      engagementRatePct: formatPct(engagementRate),
      avgDurationHuman: formatDuration(avgDuration),
      topPages: topPagesReport.rows ?? [],
      topSources: topSourcesReport.rows ?? [],
      noTraffic,
    });

    await sendEmail({
      to: 'john@vantor.xyz',
      subject: `[Vantor traffic] ${pageViews ?? '0'} page views yesterday (${activeUsers ?? '0'} users)`,
      html,
    });

    return NextResponse.json({
      sent: true,
      date: dateLabel,
      activeUsers,
      sessions,
      pageViews,
    });
  } catch (err) {
    console.error('[cron/ga-daily-traffic] Failed:', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

function formatPct(raw: string | undefined): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function formatDuration(raw: string | undefined): string {
  const sec = Number(raw);
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(data: {
  dateLabel: string;
  activeUsers: string;
  newUsers: string;
  sessions: string;
  pageViews: string;
  engagementRatePct: string;
  avgDurationHuman: string;
  topPages: RunReportRow[];
  topSources: RunReportRow[];
  noTraffic: boolean;
}): string {
  const statCard = (label: string, value: string) => `
    <td style="padding:14px 12px;border-right:1px solid #eee;text-align:center;vertical-align:top">
      <p style="margin:0;color:#999;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600">${esc(label)}</p>
      <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#111">${esc(value)}</p>
    </td>`;

  const topPagesRows = data.topPages
    .map((row) => {
      const path = row.dimensionValues?.[0]?.value ?? '(unknown)';
      const views = row.metricValues?.[0]?.value ?? '0';
      const users = row.metricValues?.[1]?.value ?? '0';
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:ui-monospace,Menlo,Monaco,monospace;font-size:12px;color:#134849">${esc(path)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${esc(views)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;color:#666">${esc(users)}</td>
        </tr>`;
    })
    .join('');

  const topSourcesRows = data.topSources
    .map((row) => {
      const source = row.dimensionValues?.[0]?.value ?? '(direct)';
      const sessions = row.metricValues?.[0]?.value ?? '0';
      const users = row.metricValues?.[1]?.value ?? '0';
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">${esc(source)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${esc(sessions)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;color:#666">${esc(users)}</td>
        </tr>`;
    })
    .join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:640px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="background:linear-gradient(135deg,#19595b,#2dd4bf);padding:24px 32px">
      <p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600">vantor.xyz &middot; daily traffic</p>
      <h1 style="margin:6px 0 0;color:#fff;font-size:22px">${esc(data.dateLabel)}</h1>
    </div>

    ${
      data.noTraffic
        ? `<div style="padding:32px;text-align:center">
            <p style="margin:0;color:#666;font-size:14px">No traffic recorded yesterday. (Heartbeat email — the pipeline is working.)</p>
           </div>`
        : `
    <table style="width:100%;border-collapse:collapse;border-bottom:1px solid #eee">
      <tr>
        ${statCard('Page views', data.pageViews)}
        ${statCard('Active users', data.activeUsers)}
        ${statCard('New users', data.newUsers)}
      </tr>
      <tr>
        ${statCard('Sessions', data.sessions)}
        ${statCard('Engagement', data.engagementRatePct)}
        <td style="padding:14px 12px;text-align:center;vertical-align:top">
          <p style="margin:0;color:#999;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600">Avg session</p>
          <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#111">${esc(data.avgDurationHuman)}</p>
        </td>
      </tr>
    </table>

    ${
      topPagesRows
        ? `<div style="padding:24px 32px 8px">
             <h2 style="margin:0 0 12px;font-size:14px;color:#111;font-weight:600">Top pages</h2>
             <table style="width:100%;border-collapse:collapse;font-size:13px">
               <thead>
                 <tr style="background:#fafafa">
                   <th style="padding:8px 12px;text-align:left;font-weight:600;color:#555">Path</th>
                   <th style="padding:8px 12px;text-align:right;font-weight:600;color:#555">Views</th>
                   <th style="padding:8px 12px;text-align:right;font-weight:600;color:#555">Users</th>
                 </tr>
               </thead>
               <tbody>${topPagesRows}</tbody>
             </table>
           </div>`
        : ''
    }

    ${
      topSourcesRows
        ? `<div style="padding:16px 32px 28px">
             <h2 style="margin:0 0 12px;font-size:14px;color:#111;font-weight:600">Top traffic sources</h2>
             <table style="width:100%;border-collapse:collapse;font-size:13px">
               <thead>
                 <tr style="background:#fafafa">
                   <th style="padding:8px 12px;text-align:left;font-weight:600;color:#555">Source</th>
                   <th style="padding:8px 12px;text-align:right;font-weight:600;color:#555">Sessions</th>
                   <th style="padding:8px 12px;text-align:right;font-weight:600;color:#555">Users</th>
                 </tr>
               </thead>
               <tbody>${topSourcesRows}</tbody>
             </table>
           </div>`
        : ''
    }
    `
    }

    <div style="padding:16px 32px;background:#fafafa;border-top:1px solid #eee;text-align:center">
      <p style="color:#999;font-size:11px;margin:0">
        GA4 daily digest &middot; Generated by /api/cron/ga-daily-traffic &middot; <a href="https://analytics.google.com" style="color:#19595b;text-decoration:none">Open GA4</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}
