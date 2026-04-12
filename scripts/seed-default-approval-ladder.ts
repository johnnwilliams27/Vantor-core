/**
 * Seed the default approval ladder for one or all enterprises.
 *
 * Usage:
 *   npx tsx scripts/seed-default-approval-ladder.ts <enterprise_id> <actor_user_id>
 *   npx tsx scripts/seed-default-approval-ladder.ts --all <actor_user_id>
 *
 * Idempotent — see src/lib/policy/seed/default-ladder.ts for semantics.
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.
 */

import { createClient } from '@supabase/supabase-js';
import { seedDefaultApprovalLadder } from '../src/lib/policy/seed/default-ladder';

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function main() {
  const [, , arg1, actorUserId] = process.argv;
  if (!arg1 || !actorUserId) {
    die(
      'Usage:\n' +
        '  npx tsx scripts/seed-default-approval-ladder.ts <enterprise_id> <actor_user_id>\n' +
        '  npx tsx scripts/seed-default-approval-ladder.ts --all <actor_user_id>',
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    die('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let enterpriseIds: string[] = [];
  if (arg1 === '--all') {
    const { data, error } = await supabase
      .from('enterprises')
      .select('id')
      .eq('is_test_enterprise', false);
    if (error) die(`Failed to list enterprises: ${error.message}`);
    enterpriseIds = (data ?? []).map((r) => r.id as string);
    console.log(`Found ${enterpriseIds.length} non-test enterprises.`);
  } else {
    enterpriseIds = [arg1];
  }

  let seededCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const enterpriseId of enterpriseIds) {
    try {
      const result = await seedDefaultApprovalLadder(enterpriseId, actorUserId, supabase);
      if (result.policySkipped) {
        console.log(`[skip] ${enterpriseId} — active policy already exists (rbac settings ensured)`);
        skippedCount++;
      } else {
        console.log(`[seed] ${enterpriseId} → policy version ${result.policyVersionId}`);
        seededCount++;
      }
    } catch (err) {
      console.error(`[fail] ${enterpriseId}: ${(err as Error).message}`);
      failedCount++;
    }
  }

  console.log(
    `\nDone. seeded=${seededCount} skipped=${skippedCount} failed=${failedCount} total=${enterpriseIds.length}`,
  );
  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
