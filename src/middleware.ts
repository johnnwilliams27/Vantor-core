import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';
import { canAccessRoute } from '@/lib/auth/rbac';
import type { UserRole } from '@/types/database';

const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/api/auth', '/api/contact', '/api/integrations/slack/callback', '/api/webhooks/stripe', '/opengraph-image', '/terms', '/privacy', '/robots.txt', '/sitemap.xml', '/api/indexnow'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // IP allowlist — only enforced when ALLOWED_IPS is set (dev environment)
  const allowedIps = process.env.ALLOWED_IPS;
  if (allowedIps) {
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || '';
    const ipList = allowedIps.split(',').map(ip => ip.trim());
    if (!ipList.includes(clientIp)) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  // Allow landing page (root)
  if (pathname === '/') {
    return NextResponse.next();
  }

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow cron with secret token (disabled unless ENABLE_CRONS is set)
  if (pathname.startsWith('/api/cron')) {
    if (process.env.ENABLE_CRONS !== 'true') {
      return NextResponse.json({ skipped: true, reason: 'Crons disabled in this environment' });
    }
    const authHeader = req.headers.get('authorization');
    const expected = `Bearer ${process.env.CRON_SECRET}`;
    if (authHeader !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Allow service-role key auth for admin API endpoints (reseed, etc.)
  if (pathname.startsWith('/api/test-mode/reseed')) {
    const authHeader = req.headers.get('authorization');
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (bearer && bearer === process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.next();
    }
  }

  // JWT auth check
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const isAppAdmin = token.is_app_admin as boolean;

  // Frozen enterprise: kick already-authenticated users out. App admins
  // bypass so they can still reach /admin to unfreeze.
  const enterpriseStatus = token.enterprise_status as string | null | undefined;
  if (enterpriseStatus === 'frozen' && !isAppAdmin) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Enterprise frozen' }, { status: 403 });
    }
    const url = new URL('/login', req.url);
    url.searchParams.set('error', 'EnterpriseFrozen');
    return NextResponse.redirect(url);
  }

  // App admin: redirect from root app pages to /admin
  if (isAppAdmin && (pathname === '/dashboard' || pathname === '/setup')) {
    return NextResponse.redirect(new URL('/admin', req.url));
  }

  // Onboarding: no longer redirect to /setup — the wizard renders as a modal overlay
  // on top of the dashboard via AppShell when onboarding_done is false.
  // Redirect old /setup URL to dashboard so the overlay shows there.
  if (!isAppAdmin && pathname.startsWith('/setup')) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  // RBAC check
  const userRole = token.role as UserRole;
  if (!canAccessRoute(userRole, pathname, isAppAdmin)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.redirect(
      new URL(isAppAdmin ? '/admin' : '/dashboard', req.url),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|otf|eot|txt)).*)',
  ],
};
