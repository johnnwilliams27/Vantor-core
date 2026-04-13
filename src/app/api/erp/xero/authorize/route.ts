import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { randomBytes, createHash } from 'node:crypto';

// Granular scopes (post 2026-03-02 Xero migration). New Xero apps cannot
// use the deprecated broad `accounting.transactions` / `.transactions.read`
// scopes — they were split into invoices / payments / banktransactions /
// manualjournals. Vantor's read surface needs invoices + contacts + settings
// (for /Accounts BANK lookup); the write surface (recordBillPayment → POST
// /Payments) needs accounting.payments. OIDC scopes (openid/profile/email)
// must be paired with the accounting scopes — Xero rejects accounting-only
// requests with unauthorized_client at the consent screen.
const SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'accounting.contacts.read',
  'accounting.invoices.read',
  'accounting.payments',
  'accounting.settings.read',
].join(' ');

export async function GET(_req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clientId = process.env.XERO_CLIENT_ID!;
  const redirectUri = process.env.XERO_REDIRECT_URI!;

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(32).toString('base64url');

  const cookiePayload = JSON.stringify({
    verifier,
    state,
    user_id: session.user.id,
    enterprise_id: session.user.enterprise_id,
  });
  // MVP cookie protection relies on HttpOnly + SameSite=Lax + 10-minute TTL
  // (see spec §Token Lifecycle — Out of scope). HMAC-signing with
  // NEXTAUTH_SECRET is an intentional follow-up hardening and is not part
  // of this slice.
  const cookieValue = Buffer.from(cookiePayload).toString('base64url');

  const authorizeUrl = new URL('https://login.xero.com/identity/connect/authorize');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', SCOPES);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  const res = NextResponse.redirect(authorizeUrl.toString(), { status: 302 });
  res.headers.append('set-cookie',
    `xero_oauth=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  return res;
}
