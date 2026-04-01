import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/kyc/complete
 * Called when the user completes the Persona flow on the client side.
 * Marks KYC as completed without waiting for the Persona webhook.
 * The webhook will also update it, but this ensures immediate availability.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  await supabase
    .from('kyc_verifications')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('user_id', session.user.id)
    .eq('status', 'pending');

  return NextResponse.json({ success: true });
}
