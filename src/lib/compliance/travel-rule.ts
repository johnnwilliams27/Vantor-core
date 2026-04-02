import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/logger';
import { getComplianceAdapter } from './factory';
import type { TravelRuleCreateParams } from './interface';
import type { ChainType } from '@/types/database';

export function isAboveTravelRuleThreshold(amountUsd: number): boolean {
  const threshold = Number(process.env.TRAVEL_RULE_THRESHOLD_USD ?? '3000');
  return amountUsd >= threshold;
}

export async function createTravelRuleTransfer(
  userId: string,
  transferId: string,
  params: TravelRuleCreateParams
) {
  const supabase = createAdminClient();
  const adapter = getComplianceAdapter();

  // Submit to Chainalysis Travel Rule
  const result = await adapter.submitTravelRule(params);

  // Persist record
  const { data: transfer, error } = await supabase
    .from('travel_rule_transfers')
    .insert({
      user_id: userId,
      transfer_id: transferId,
      direction: params.direction,
      amount_usd: params.amountUsd,
      originator_name: params.originatorName,
      originator_address: params.originatorAddress ?? null,
      originator_wallet: params.originatorWallet,
      originator_chain: params.originatorChain as ChainType,
      originator_vasp: params.originatorVasp ?? process.env.TRAVEL_RULE_VASP_NAME ?? 'Vantor Treasury',
      beneficiary_name: params.beneficiaryName,
      beneficiary_address: params.beneficiaryAddress ?? null,
      beneficiary_wallet: params.beneficiaryWallet,
      beneficiary_chain: params.beneficiaryChain as ChainType,
      beneficiary_vasp: params.beneficiaryVasp ?? null,
      status: result.status,
      provider_ref: result.providerRef,
      raw_response: result.rawResponse,
      sent_at: result.status === 'sent' ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to persist travel rule transfer: ${error.message}`);
  }

  await writeAuditLog({
    userId,
    action: 'compliance_travel_rule_create',
    entityType: 'travel_rule_transfer',
    entityId: transfer.id,
    details: {
      transferId,
      direction: params.direction,
      amountUsd: params.amountUsd,
      status: result.status,
    },
  });

  return transfer;
}
