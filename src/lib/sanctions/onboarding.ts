import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/logger';
import { getOpenSanctionsClient } from './client';
import { getSanctionsConfig, type Counterparty, type ScreeningStatus } from './types';

export interface OnboardingScreenResult {
  screening_id: string;
  result_status: ScreeningStatus;
  top_match_score: number | null;
  case_opened: boolean;
  case_id: string | null;
}

/**
 * Screen a counterparty at onboarding (creation time).
 * If match score >= threshold, opens a case and blocks transfers.
 * Fails gracefully — counterparty stays pending on API error.
 */
export async function screenCounterpartyOnboarding(
  enterpriseId: string,
  counterpartyId: string,
  userId: string,
): Promise<OnboardingScreenResult> {
  const supabase = createAdminClient();
  const config = getSanctionsConfig();

  // Read counterparty
  const { data: counterparty, error: cpErr } = await supabase
    .from('counterparties')
    .select('*')
    .eq('id', counterpartyId)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (cpErr || !counterparty) {
    throw new Error(`Counterparty not found: ${counterpartyId}`);
  }

  const cp = counterparty as Counterparty;

  try {
    const client = getOpenSanctionsClient();
    const schema = cp.type === 'individual' ? 'Person' : 'Company';
    const matchResponse = await client.matchEntity(cp.name, schema);

    const queryResult = matchResponse.responses?.q1;
    const topMatch = queryResult?.results?.[0] ?? null;
    const topScore = topMatch?.score ?? 0;
    const topLabel = topMatch?.caption ?? null;

    const resultStatus: ScreeningStatus =
      topScore >= config.matchThreshold ? 'flagged' : 'cleared';

    // Insert screening record
    const { data: screening, error: scrErr } = await supabase
      .from('counterparty_screenings')
      .insert({
        enterprise_id: enterpriseId,
        counterparty_id: counterpartyId,
        dataset_version: topMatch?.last_change ?? null,
        top_match_score: topScore,
        top_match_label: topLabel,
        raw_response: matchResponse,
        result_status: resultStatus,
      })
      .select('id')
      .single();

    if (scrErr) {
      throw new Error(`Failed to insert screening: ${scrErr.message}`);
    }

    // Update counterparty status
    await supabase
      .from('counterparties')
      .update({
        screening_status: resultStatus,
        transfer_eligible: resultStatus === 'cleared',
        last_screened_at: new Date().toISOString(),
      })
      .eq('id', counterpartyId);

    let caseId: string | null = null;
    let caseOpened = false;

    // Open case if flagged
    if (resultStatus === 'flagged' && topMatch) {
      const { data: newCase } = await supabase
        .from('screening_cases')
        .insert({
          enterprise_id: enterpriseId,
          counterparty_id: counterpartyId,
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
        caseId = newCase.id;
        caseOpened = true;

        await writeAuditLog({
          userId,
          enterpriseId,
          action: 'screening_case_open',
          entityType: 'screening_case',
          entityId: newCase.id,
          details: {
            counterparty_id: counterpartyId,
            counterparty_name: cp.name,
            top_match_score: topScore,
            top_match_label: topLabel,
          },
        });
      }
    }

    await writeAuditLog({
      userId,
      enterpriseId,
      action: 'counterparty_screen',
      entityType: 'counterparty',
      entityId: counterpartyId,
      details: {
        screening_id: screening.id,
        result_status: resultStatus,
        top_match_score: topScore,
        source: 'onboarding',
      },
    });

    return {
      screening_id: screening.id,
      result_status: resultStatus,
      top_match_score: topScore,
      case_opened: caseOpened,
      case_id: caseId,
    };
  } catch (err) {
    // Fail gracefully: leave counterparty as pending, transfer_eligible=false
    console.error(
      `[sanctions/onboarding] Screening failed for counterparty ${counterpartyId}:`,
      err,
    );

    await writeAuditLog({
      userId,
      enterpriseId,
      action: 'counterparty_screen',
      entityType: 'counterparty',
      entityId: counterpartyId,
      details: {
        error: (err as Error).message,
        source: 'onboarding',
        result_status: 'error',
      },
    });

    return {
      screening_id: '',
      result_status: 'pending',
      top_match_score: null,
      case_opened: false,
      case_id: null,
    };
  }
}
