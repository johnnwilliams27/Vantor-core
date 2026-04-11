import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { materializeRecurringObligations } from '@/lib/obligations/materialize';

const BATCH_SIZE = 50;

/**
 * Nightly cron: materialize recurring obligation instances into the
 * `obligations` table up to 90 days out.
 *
 * Idempotent per enterprise — `materializeRecurringObligations` skips
 * any (parent_id, due_date) already on disk, so reruns are free and
 * reruns during retries won't duplicate.
 *
 * Excludes test enterprises. Processes up to BATCH_SIZE enterprises
 * per invocation (hard cap to keep runtime bounded).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: enterprises, error } = await supabase
    .from('enterprises')
    .select('id')
    .eq('status', 'active')
    .neq('is_test_enterprise', true)
    .limit(BATCH_SIZE);

  if (error) {
    console.error('[cron/materialize-obligations] list enterprises', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let totalCreated = 0;
  let succeeded = 0;
  let failed = 0;
  const failures: Array<{ enterpriseId: string; error: string }> = [];

  for (const ent of enterprises ?? []) {
    try {
      const created = await materializeRecurringObligations(supabase, ent.id as string);
      totalCreated += created.length;
      succeeded += 1;
    } catch (e) {
      failed += 1;
      failures.push({
        enterpriseId: ent.id as string,
        error: (e as Error).message,
      });
      console.error(
        `[cron/materialize-obligations] enterprise ${ent.id} failed:`,
        e,
      );
    }
  }

  return NextResponse.json({
    processed: (enterprises ?? []).length,
    succeeded,
    failed,
    totalCreated,
    failures: failures.length > 0 ? failures : undefined,
  });
}
