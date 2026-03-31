import { createAdminClient } from '@/lib/supabase/admin';
import { cookies } from 'next/headers';
import { seedAll } from './seed/seed-all';

const TEST_MODE_COOKIE = 'vantor_test_mode';

export function isTestMode(): boolean {
  const cookieStore = cookies();
  return cookieStore.get(TEST_MODE_COOKIE)?.value === '1';
}

export async function getEffectiveEnterpriseId(
  realEnterpriseId: string | null
): Promise<string | null> {
  if (!realEnterpriseId) return null;
  if (!isTestMode()) return realEnterpriseId;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('enterprises')
    .select('test_enterprise_id')
    .eq('id', realEnterpriseId)
    .single();

  if (!data?.test_enterprise_id) {
    const testId = await ensureTestEnterprise(realEnterpriseId);
    return testId;
  }

  return data.test_enterprise_id;
}

export async function ensureTestEnterprise(
  realEnterpriseId: string
): Promise<string> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('enterprises')
    .select('test_enterprise_id')
    .eq('id', realEnterpriseId)
    .single();

  if (existing?.test_enterprise_id) {
    return existing.test_enterprise_id;
  }

  const { data: realEnt } = await supabase
    .from('enterprises')
    .select('name')
    .eq('id', realEnterpriseId)
    .single();

  const { data: testEnt, error } = await supabase
    .from('enterprises')
    .insert({
      name: `${realEnt?.name ?? 'Enterprise'} [TEST]`,
      status: 'active',
      is_test_enterprise: true,
      metadata: { source_enterprise_id: realEnterpriseId },
    })
    .select('id')
    .single();

  if (error || !testEnt) {
    throw new Error(`Failed to create test enterprise: ${error?.message}`);
  }

  await supabase
    .from('enterprises')
    .update({ test_enterprise_id: testEnt.id })
    .eq('id', realEnterpriseId);

  // Seed test data — if this fails, the enterprise still exists but will be empty.
  // Registration/toggle can still proceed; user gets an empty test mode rather than a broken signup.
  try {
    await seedAll(testEnt.id, realEnterpriseId);
  } catch (err) {
    console.error('Failed to seed test enterprise data:', err);
  }

  return testEnt.id;
}

export async function seedTestEnterprise(
  testEnterpriseId: string,
  sourceEnterpriseId: string,
  adminClient?: ReturnType<typeof createAdminClient>
): Promise<void> {
  await seedAll(testEnterpriseId, sourceEnterpriseId, adminClient);
}
