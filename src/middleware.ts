import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';
import { canAccessRoute } from '@/lib/auth/rbac';
import type { UserRole } from '@/types/database';

const PUBLIC_PATHS = ['/login', '/register', '/api/auth', '/api/contact', '/api/integrations/slack/callback', '/opengraph-image', '/terms', '/privacy', '/robots.txt', '/sitemap.xml', '/api/indexnow'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow landing page (root)
  if (pathname === '/') {
    return NextResponse.next();
  }

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow cron with secret token
  if (pathname.startsWith('/api/cron')) {
    const authHeader = req.headers.get('authorization');
    const expected = `Bearer ${process.env.CRON_SECRET}`;
    if (authHeader !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
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

  // App admin: redirect from root app pages to /admin
  if (isAppAdmin && (pathname === '/dashboard' || pathname === '/setup')) {
    return NextResponse.redirect(new URL('/admin', req.url));
  }

  // Onboarding redirect — skip for app admins (they don't need onboarding)
  const justCompleted = req.cookies.get('onboarding_complete')?.value === '1';
  if (
    !isAppAdmin &&
    !token.onboarding_done &&
    !justCompleted &&
    !pathname.startsWith('/setup') &&
    !pathname.startsWith('/api/')
  ) {
    return NextResponse.redirect(new URL('/setup', req.url));
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
