/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.production.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const testId = process.argv[2] ?? '802988b5-f726-4f4e-99d1-89e182c16d10';

async function main() {
  console.log(`\nChecking transfer_attempts for test enterprise: ${testId}\n`);

  // Get transfer_attempts count
  const { count: attemptCount } = await sb
    .from('transfer_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('enterprise_id', testId);

  console.log(`transfer_attempts rows (direct count): ${attemptCount || 0}`);

  // Try to get some actual rows
  const { data: attempts, error } = await sb
    .from('transfer_attempts')
    .select('id, transfer_id, attempt_no, status')
    .eq('enterprise_id', testId)
    .limit(5);

  if (error) {
    console.error('Error fetching attempts:', error);
  } else {
    console.log(`\nFirst 5 attempts:`);
    if (attempts && attempts.length > 0) {
      attempts.forEach(a => {
        console.log(`  ${a.id}: transfer_id=${a.transfer_id}, attempt_no=${a.attempt_no}, status=${a.status}`);
      });
    } else {
      console.log('  (none)');
    }
  }

  // Also check what the "expected" transfer_attempts count should be
  const { data: failedTxfers } = await sb
    .from('transfers')
    .select('id')
    .eq('enterprise_id', testId)
    .eq('status', 'failed');

  const expectedAttempts = (failedTxfers?.length || 0) * 2;
  console.log(`\nExpected transfer_attempts (based on failed transfers): ${expectedAttempts}`);
  console.log(`Actual transfer_attempts: ${attemptCount || 0}`);
  console.log(`Missing: ${expectedAttempts - (attemptCount || 0)}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
