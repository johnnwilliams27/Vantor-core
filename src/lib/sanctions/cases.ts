import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/logger';
import type {
  CaseState,
  CaseActionType,
  ClearReasonCode,
  ScreeningCase,
} from './types';

// -- Valid state transitions --
const VALID_TRANSITIONS: Record<CaseState, CaseState[]> = {
  open: ['cleared', 'blocked'],
  escalated: ['cleared', 'blocked'], // legacy — treat same as open
  cleared: [],   // terminal
  blocked: [],   // terminal
};

async function getCase(caseId: string): Promise<ScreeningCase> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('screening_cases')
    .select('*')
    .eq('id', caseId)
    .single();

  if (error || !data) {
    throw new Error(`Case not found: ${caseId}`);
  }
  return data as ScreeningCase;
}

function validateTransition(current: CaseState, target: CaseState): void {
  if (!VALID_TRANSITIONS[current]?.includes(target)) {
    throw new Error(
      `Invalid case state transition: ${current} → ${target}`,
    );
  }
}

async function insertCaseAction(
  caseId: string,
  actorUserId: string,
  action: CaseActionType,
  reasonCode?: ClearReasonCode | null,
  notes?: string | null,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('case_actions').insert({
    case_id: caseId,
    actor_user_id: actorUserId,
    action,
    reason_code: reasonCode ?? null,
    notes: notes ?? null,
  });

  if (error) {
    throw new Error(`Failed to insert case action: ${error.message}`);
  }
}

/**
 * Clear a case — marks as false positive / not a match.
 * Restores the counterparty's transfer eligibility.
 */
export async function clearCase(
  caseId: string,
  userId: string,
  reasonCode: ClearReasonCode,
  notes?: string,
): Promise<void> {
  const screeningCase = await getCase(caseId);
  validateTransition(screeningCase.state, 'cleared');

  const supabase = createAdminClient();

  await insertCaseAction(caseId, userId, 'clear', reasonCode, notes);

  await supabase
    .from('screening_cases')
    .update({ state: 'cleared', resolved_at: new Date().toISOString() })
    .eq('id', caseId);

  // Restore transfer eligibility
  await supabase
    .from('counterparties')
    .update({ screening_status: 'cleared', transfer_eligible: true })
    .eq('id', screeningCase.counterparty_id);

  await writeAuditLog({
    userId,
    enterpriseId: screeningCase.enterprise_id,
    action: 'screening_case_clear',
    entityType: 'screening_case',
    entityId: caseId,
    details: {
      counterparty_id: screeningCase.counterparty_id,
      reason_code: reasonCode,
      notes,
    },
  });
}

/**
 * Block a case — confirms the match. Holds transfer eligibility.
 */
export async function blockCase(
  caseId: string,
  userId: string,
  notes?: string,
): Promise<void> {
  const screeningCase = await getCase(caseId);
  validateTransition(screeningCase.state, 'blocked');

  const supabase = createAdminClient();

  await insertCaseAction(caseId, userId, 'block', null, notes);

  await supabase
    .from('screening_cases')
    .update({ state: 'blocked', resolved_at: new Date().toISOString() })
    .eq('id', caseId);

  // Block counterparty permanently until manually overridden
  await supabase
    .from('counterparties')
    .update({ screening_status: 'blocked', transfer_eligible: false })
    .eq('id', screeningCase.counterparty_id);

  await writeAuditLog({
    userId,
    enterpriseId: screeningCase.enterprise_id,
    action: 'screening_case_block',
    entityType: 'screening_case',
    entityId: caseId,
    details: { counterparty_id: screeningCase.counterparty_id, notes },
  });
}

/**
 * Add a note to a case without changing its state.
 */
export async function addCaseNote(
  caseId: string,
  userId: string,
  notes: string,
): Promise<void> {
  const screeningCase = await getCase(caseId);

  await insertCaseAction(caseId, userId, 'note', null, notes);

  await writeAuditLog({
    userId,
    enterpriseId: screeningCase.enterprise_id,
    action: 'screening_case_note',
    entityType: 'screening_case',
    entityId: caseId,
    details: { counterparty_id: screeningCase.counterparty_id, notes },
  });
}
