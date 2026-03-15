import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

interface SentryIssue {
  title: string;
  culprit: string;
  count: string;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
  level: string;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sentryOrg = process.env.SENTRY_ORG;
  const sentryProject = process.env.SENTRY_PROJECT;
  const sentryToken = process.env.SENTRY_AUTH_TOKEN;

  if (!sentryOrg || !sentryProject || !sentryToken) {
    return NextResponse.json({ error: 'Sentry env vars not configured' }, { status: 500 });
  }

  try {
    // Fetch issues from last 24 hours
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const res = await fetch(
      `https://sentry.io/api/0/projects/${sentryOrg}/${sentryProject}/issues/?query=is:unresolved&statsPeriod=24h&sort=freq`,
      {
        headers: { Authorization: `Bearer ${sentryToken}` },
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error('[cron/error-digest] Sentry API error:', res.status, errText);
      return NextResponse.json({ error: `Sentry API: ${res.status}` }, { status: 502 });
    }

    const issues: SentryIssue[] = await res.json();

    // Filter to issues seen in last 24h
    const recentIssues = issues.filter(
      (issue) => new Date(issue.lastSeen) >= new Date(since)
    );

    if (recentIssues.length === 0) {
      console.log('[cron/error-digest] No errors in last 24h — skipping email');
      return NextResponse.json({ sent: false, reason: 'No errors in last 24h' });
    }

    // Build email
    const issueRows = recentIssues
      .slice(0, 25) // Cap at 25 issues
      .map(
        (issue) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">
            <a href="${escapeHtml(issue.permalink)}" style="color: #19595b; text-decoration: none; font-weight: 500;">
              ${escapeHtml(issue.title)}
            </a>
            <br/>
            <span style="color: #999; font-size: 12px;">${escapeHtml(issue.culprit)}</span>
          </td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
            <span style="background: ${issue.level === 'error' ? '#fef2f2' : '#fefce8'}; color: ${issue.level === 'error' ? '#dc2626' : '#ca8a04'}; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
              ${escapeHtml(issue.level)}
            </span>
          </td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; font-weight: 600;">
            ${escapeHtml(issue.count)}
          </td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #666; font-size: 12px;">
            ${new Date(issue.lastSeen).toLocaleString('en-US', { timeZone: 'America/New_York' })}
          </td>
        </tr>`
      )
      .join('');

    const totalEvents = recentIssues.reduce((sum, i) => sum + Number(i.count), 0);

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 700px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #19595b, #2dd4bf); padding: 24px 32px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; color: white; font-size: 20px;">Vantor Error Digest</h1>
          <p style="margin: 4px 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">
            ${recentIssues.length} issue${recentIssues.length !== 1 ? 's' : ''} &middot; ${totalEvents} event${totalEvents !== 1 ? 's' : ''} in the last 24 hours
          </p>
        </div>

        <div style="background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; overflow: hidden;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead>
              <tr style="background: #f9fafb;">
                <th style="padding: 10px 12px; text-align: left; font-weight: 600; color: #374151;">Error</th>
                <th style="padding: 10px 12px; text-align: center; font-weight: 600; color: #374151;">Level</th>
                <th style="padding: 10px 12px; text-align: center; font-weight: 600; color: #374151;">Events</th>
                <th style="padding: 10px 12px; text-align: left; font-weight: 600; color: #374151;">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              ${issueRows}
            </tbody>
          </table>
          ${recentIssues.length > 25 ? `<p style="padding: 12px; text-align: center; color: #999; font-size: 13px;">+ ${recentIssues.length - 25} more issues</p>` : ''}
        </div>

        <p style="text-align: center; color: #999; font-size: 12px; margin-top: 16px;">
          <a href="https://sentry.io/organizations/${escapeHtml(sentryOrg)}/issues/?project=${escapeHtml(sentryProject)}" style="color: #19595b;">
            View all issues in Sentry
          </a>
        </p>
      </div>
    `;

    if (process.env.SMTP_USE_MOCK === 'true') {
      console.log(`[MOCK SMTP] Would send error digest: ${recentIssues.length} issues, ${totalEvents} events`);
      return NextResponse.json({ sent: false, mock: true, issues: recentIssues.length, events: totalEvents });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER || 'john@vantor.xyz',
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Vantor Monitoring" <${process.env.SMTP_USER || 'john@vantor.xyz'}>`,
      to: 'john@vantor.xyz',
      subject: `[Vantor] ${recentIssues.length} error${recentIssues.length !== 1 ? 's' : ''} in the last 24h (${totalEvents} events)`,
      html,
    });

    console.log(`[cron/error-digest] Sent digest: ${recentIssues.length} issues, ${totalEvents} events`);
    return NextResponse.json({ sent: true, issues: recentIssues.length, events: totalEvents });
  } catch (err) {
    console.error('[cron/error-digest] Failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
