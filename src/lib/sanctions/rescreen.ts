import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/logger';
import { getOpenSanctionsClient } from './client';
import { getSanctionsConfig, type Counterparty, type ScreeningStatus } from './types';

const BATCH_SIZE = 50;
const RESCREEN_INTERVAL_DAYS = 7;

export interface RescreenBatchResult {
  processed: number;
  flagged: number;
  errors: number;
  nextCursor: string | null;
}

/**
 * Re-screen a batch of counterparties whose last screening is older than 7 days.
 * Skips blocked and pending counterparties. Idempotent and resumable via cursor.
 */
export async function rescreenCounterpartyBatch(
  cursor?: string,
): Promise<RescreenBatchResult> {
  const supabase = createAdminClient();
  const config = getSanctionsConfig();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RESCREEN_INTERVAL_DAYS);

  // Exclude test enterprises
  const { data: testEnts } = await supabase
    .from('enterprises')
    .select('id')
    .eq('is_test_enterprise', true);
  const testEntIds = (testEnts ?? []).map((e) => e.id);

  // Query counterparties due for re-screening
  let query = supabase
    .from('counterparties')
    .select('*')
    .in('screening_status', ['cleared', 'flagged'])
    .lt('last_screened_at', cutoff.toISOString())
    .order('id', { ascending: true })
    .limit(BATCH_SIZE);

  if (cursor) {
    query = query.gt('id', cursor);
  }

  if (testEntIds.length > 0) {
    query = query.not('enterprise_id', 'in', `(${testEntIds.join(',')})`);
  }

  const { data: counterparties, error } = await query;

  if (error) {
    throw new Error(`Failed to query counterparties for rescreen: ${error.message}`);
  }

  if (!counterparties?.length) {
    return { processed: 0, flagged: 0, errors: 0, nextCursor: null };
  }

  const client = getOpenSanctionsClient();
  let flagged = 0;
  let errors = 0;

  for (const row of counterparties as Counterparty[]) {
    try {
      const schema = row.type === 'individual' ? 'Person' : 'Company';
      const matchResponse = await client.matchEntity(row.name, schema);

      const queryResult = matchResponse.responses?.q1;
      const topMatch = queryResult?.results?.[0] ?? null;
      const topScore = topMatch?.score ?? 0;
      const topLabel = topMatch?.caption ?? null;

      const resultStatus: ScreeningStatus =
        topScore >= config.matchThreshold ? 'flagged' : 'cleared';

      // Insert screening record
      const { data: screening } = await supabase
        .from('counterparty_screenings')
        .insert({
          enterprise_id: row.enterprise_id,
          counterparty_id: row.id,
          dataset_version: topMatch?.last_change ?? null,
          top_match_score: topScore,
          top_match_label: topLabel,
          raw_response: matchResponse,
          result_status: resultStatus,
        })
        .select('id')
        .single();

      // Update counterparty
      await supabase
        .from('counterparties')
        .update({
          screening_status: resultStatus,
          transfer_eligible: resultStatus === 'cleared',
          last_screened_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      // If newly flagged (was cleared, now flagged) and no open case exists, open one
      if (resultStatus === 'flagged' && topMatch && screening) {
        const { data: existingCase } = await supabase
          .from('screening_cases')
          .select('id')
          .eq('counterparty_id', row.id)
          .eq('state', 'open')
          .maybeSingle();

        if (!existingCase) {
          const { data: newCase } = await supabase
            .from('screening_cases')
            .insert({
              enterprise_id: row.enterprise_id,
              counterparty_id: row.id,
              screening_id: screening.id,
              state: 'open',
              matched_entity_snapshot: {
                entity_id: topMatch.id,
                caption: topMatch.caption,
                schema: topMatch.schema,
                score: topMatch.score,
                properties: topMatch.properties,
                datasets: topMatch.datasets,
              },
            })
            .select('id')
            .single();

          if (newCase) {
            await writeAuditLog({
              enterpriseId: row.enterprise_id,
              action: 'screening_case_open',
              entityType: 'screening_case',
              entityId: newCase.id,
              details: {
                counterparty_id: row.id,
                counterparty_name: row.name,
                top_match_score: topScore,
                source: 'rescreen',
              },
            });
          }

          flagged++;
        }
      }

      await writeAuditLog({
        enterpriseId: row.enterprise_id,
        action: 'counterparty_screen',
        entityType: 'counterparty',
        entityId: row.id,
        details: {
          screening_id: screening?.id,
          result_status: resultStatus,
          top_match_score: topScore,
          source: 'rescreen',
        },
      });
    } catch (err) {
      errors++;
      console.error(
        `[sanctions/rescreen] Failed to rescreen counterparty ${row.id}:`,
        err,
      );
    }
  }

  const lastId = counterparties[counterparties.length - 1].id;
  const nextCursor = counterparties.length === BATCH_SIZE ? lastId : null;

  return {
    processed: counterparties.length,
    flagged,
    errors,
    nextCursor,
  };
}
