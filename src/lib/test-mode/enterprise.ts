import { createAdminClient } from '@/lib/supabase/admin';
import { cookies } from 'next/headers';

/**
 * Returns the effective enterprise ID, swapping to test enterprise when test mode is active.
 * Use this in all API routes instead of directly reading session.user.enterprise_id.
 */
export async function getEffectiveEnterpriseId(
  realEnterpriseId: string | null
): Promise<string | null> {
  if (!realEnterpriseId) return null;

  const cookieStore = cookies();
  const isTest = cookieStore.get('vantor_test_mode')?.value === '1';
  if (!isTest) return realEnterpriseId;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('enterprises')
    .select('test_enterprise_id')
    .eq('id', realEnterpriseId)
    .single();

  // Return test enterprise if it exists, otherwise fall back to real
  return data?.test_enterprise_id ?? realEnterpriseId;
}
