import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { ensureTestEnterprise } from '@/lib/test-mode/helpers';
import { writeAuditLog } from '@/lib/audit/logger';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session.user.enterprise_id) {
    return NextResponse.json({ error: 'No enterprise' }, { status: 400 });
  }

  const { enabled } = (await req.json()) as { enabled: boolean };

  if (enabled) {
    // Ensure test enterprise exists (lazy creation + seeding)
    await ensureTestEnterprise(session.user.enterprise_id);
  }

  await writeAuditLog({
    userId: session.user.id,
    action: 'test_mode_toggle' as any,
    entityType: 'enterprise' as any,
    entityId: session.user.enterprise_id,
    details: { enabled },
  });

  // Set or clear the test mode cookie
  const response = NextResponse.json({ ok: true, testMode: enabled });

  if (enabled) {
    response.cookies.set('vantor_test_mode', '1', {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });
  } else {
    response.cookies.delete('vantor_test_mode');
  }

  return response;
}
