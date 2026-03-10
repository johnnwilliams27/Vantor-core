import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/logger';
import { getComplianceAdapter } from './factory';
import type { ChainType } from '@/types/database';

export interface CachedScreening {
  id: string;
  address: string;
  chain: ChainType;
  result: 'clear' | 'sanctioned' | 'partial_match' | 'error';
  risk_score: string | null;
  match_details: Record<string, unknown> | null;
  screened_at: string;
  expires_at: string;
}

export async function screenAddressWithCache(
  userId: string,
  address: string,
  chain: ChainType,
  entityType?: string,
  entityId?: string
): Promise<CachedScreening> {
  const supabase = createAdminClient();

  // Check for non-expired cached result
  const { data: cached } = await supabase
    .from('sanctions_screenings')
    .select('*')
    .eq('address', address)
    .eq('chain', chain)
    .gt('expires_at', new Date().toISOString())
    .order('screened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached) {
    return cached as CachedScreening;
  }

  // Screen via adapter
  const adapter = getComplianceAdapter();
  const result = await adapter.screenAddress(address, chain);

  // Persist result
  const { data: screening, error } = await supabase
    .from('sanctions_screenings')
    .insert({
      user_id: userId,
      address,
      chain,
      result: result.result,
      risk_score: result.riskScore,
      match_details: result.identifications.length > 0 ? { identifications: result.identifications } : null,
      provider: 'chainalysis',
      entity_type: entityType ?? null,
      entity_id: entityId ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to persist screening: ${error.message}`);
  }

  await writeAuditLog({
    userId,
    action: 'compliance_sanctions_screen',
    entityType: entityType ?? 'address',
    entityId: entityId ?? address,
    details: { address, chain, result: result.result, riskScore: result.riskScore },
  });

  return screening as CachedScreening;
}

export async function requireClearScreening(
  userId: string,
  address: string,
  chain: ChainType,
  entityType?: string,
  entityId?: string
): Promise<void> {
  const screening = await screenAddressWithCache(userId, address, chain, entityType, entityId);

  if (screening.result === 'sanctioned') {
    throw new Error(
      `Transaction blocked: recipient address ${address} is on a sanctions list`
    );
  }
}
