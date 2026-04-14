/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.production.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const testId = process.argv[2] ?? '802988b5-f726-4f4e-99d1-89e182c16d10';

async function main() {
  console.log(`\nChecking transfers for test enterprise: ${testId}\n`);

  const { data: transfers, error } = await sb
    .from('transfers')
    .select('id, status')
    .eq('enterprise_id', testId);

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  const statusCounts: Record<string, number> = {};
  transfers?.forEach(t => {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  });

  console.log('Transfer status distribution:');
  Object.entries(statusCounts).sort().forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });
  console.log(`\nTotal transfers: ${transfers?.length || 0}`);
  console.log(`Failed transfers: ${statusCounts['failed'] || 0}`);
  console.log(`Expected transfer_attempts rows: ${(statusCounts['failed'] || 0) * 2}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
