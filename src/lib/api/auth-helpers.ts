import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth/nextauth.config';

/**
 * Get authenticated session with enterprise context.
 * Returns the session or a NextResponse error.
 */
export async function getEnterpriseSession() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return { session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (session.user.is_app_admin) {
    return { session: null, error: NextResponse.json({ error: 'App admins cannot access enterprise data' }, { status: 403 }) };
  }

  if (!session.user.enterprise_id) {
    return { session: null, error: NextResponse.json({ error: 'No enterprise assigned' }, { status: 403 }) };
  }

  return {
    session: session as typeof session & { user: typeof session.user & { enterprise_id: string } },
    error: null,
  };
}

/**
 * Get authenticated admin session.
 * Returns the session or a NextResponse error.
 */
export async function getAdminSession() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return { session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (!session.user.is_app_admin) {
    return { session: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { session, error: null };
}
