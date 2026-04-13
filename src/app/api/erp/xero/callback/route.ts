import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { encryptCredentials } from '@/lib/erp/factory';
import {
  xeroStateMismatch,
  xeroUpstreamFailure,
  xeroValidation,
} from '@/lib/erp/real/xero/errors';
import {
  TokenResponseSchema,
  ConnectionsResponseSchema,
  AccountsResponseSchema,
} from '@/lib/erp/real/xero/schemas';

function readCookie(
  req: Request,
): { verifier: string; state: string; user_id: string; enterprise_id: string } | null {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(/xero_oauth=([^;]+)/);
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(match[1], 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookie = readCookie(req);
  const traceId = randomUUID();

  if (!cookie || !code || !state || state !== cookie.state) {
    return NextResponse.json(
      xeroStateMismatch({ endpoint: '/api/erp/xero/callback', trace_id: traceId }).toUserFacing(),
      { status: 400 },
    );
  }

  const clientId = process.env.XERO_CLIENT_ID!;
  const clientSecret = process.env.XERO_CLIENT_SECRET!;
  const redirectUri = process.env.XERO_REDIRECT_URI!;

  // Exchange code for tokens.
  const tokenRes = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: cookie.verifier,
    }).toString(),
  });

  if (!tokenRes.ok) {
    return NextResponse.json(
      xeroUpstreamFailure({
        endpoint: '/connect/token',
        trace_id: tokenRes.headers.get('X-Trace-Id') ?? traceId,
      }).toUserFacing(),
      { status: 502 },
    );
  }

  const tokenBody: unknown = await tokenRes.json();
  const tokenParsed = TokenResponseSchema.safeParse(tokenBody);
  if (!tokenParsed.success) {
    return NextResponse.json(
      xeroValidation({
        endpoint: '/connect/token',
        trace_id: traceId,
        zod_issues: tokenParsed.error.issues,
        body_prefix: JSON.stringify(tokenBody).slice(0, 200),
      }).toUserFacing(),
      { status: 502 },
    );
  }
  const tokens = tokenParsed.data;

  // Resolve tenant.
  const connectionsRes = await fetch('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
  });
  const connectionsBody: unknown = await connectionsRes.json();
  const connectionsParsed = ConnectionsResponseSchema.safeParse(connectionsBody);
  if (!connectionsParsed.success) {
    return NextResponse.json(
      xeroValidation({
        endpoint: '/connections',
        trace_id: traceId,
        zod_issues: connectionsParsed.error.issues,
        body_prefix: JSON.stringify(connectionsBody).slice(0, 200),
      }).toUserFacing(),
      { status: 502 },
    );
  }
  const orgs = connectionsParsed.data.filter((c) => c.tenantType === 'ORGANISATION');
  if (orgs.length === 0) {
    return NextResponse.json({ error: 'No ORGANISATION tenants' }, { status: 400 });
  }
  const chosen = orgs[0];
  if (orgs.length > 1) {
    // eslint-disable-next-line no-console
    console.warn('[xero-connect] multiple orgs — auto-picked first', {
      picked: chosen.tenantId,
      all: orgs.map((o) => o.tenantId),
    });
  }

  // Resolve bank account.
  const acctsRes = await fetch('https://api.xero.com/api.xro/2.0/Accounts?where=Type=="BANK"', {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'xero-tenant-id': chosen.tenantId,
      Accept: 'application/json',
    },
  });
  const acctsBody: unknown = await acctsRes.json();
  const acctsParsed = AccountsResponseSchema.safeParse(acctsBody);
  if (!acctsParsed.success || acctsParsed.data.Accounts.length === 0) {
    return NextResponse.json(
      xeroValidation({
        endpoint: '/Accounts',
        trace_id: traceId,
        zod_issues: acctsParsed.success
          ? [{ message: 'no BANK accounts' }]
          : acctsParsed.error.issues,
        body_prefix: JSON.stringify(acctsBody).slice(0, 200),
      }).toUserFacing(),
      { status: 502 },
    );
  }
  const bankAccount = acctsParsed.data.Accounts[0];

  // Encrypt + upsert. encryptCredentials is async — must await.
  const credentialsBlob = await encryptCredentials({
    apiUrl: 'https://api.xero.com',
    clientId,
    clientSecret,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  } as never);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('erp_configurations')
    .upsert(
      {
        user_id: cookie.user_id,
        enterprise_id: cookie.enterprise_id,
        provider: 'xero',
        credentials: credentialsBlob,
        xero_tenant_id: chosen.tenantId,
        xero_bank_account_id: bankAccount.AccountID,
        access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        refresh_token_rotated_at: new Date().toISOString(),
        status: 'active',
        is_active: true,
      },
      { onConflict: 'user_id,provider' },
    );

  if (error) {
    return NextResponse.json({ error: 'Failed to store Xero connection' }, { status: 500 });
  }

  const redirectRes = NextResponse.redirect(
    new URL('/settings/erp?xero=connected', req.url).toString(),
    { status: 302 },
  );
  redirectRes.headers.append('set-cookie', 'xero_oauth=; Path=/; HttpOnly; Max-Age=0');
  return redirectRes;
}
