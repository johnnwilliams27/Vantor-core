import { writeAuditLog } from '@/lib/audit/logger';
import { getOpenSanctionsClient } from './client';
import type { OpenSanctionsSearchResponse } from './types';

/**
 * Ad-hoc name search against OpenSanctions for analyst investigations.
 * Read-only — no case creation, no counterparty side effects.
 */
export async function lookupEntity(
  name: string,
  userId: string,
  limit: number = 10,
): Promise<OpenSanctionsSearchResponse> {
  const client = getOpenSanctionsClient();
  const results = await client.search(name, limit);

  await writeAuditLog({
    userId,
    action: 'screening_adhoc_lookup',
    entityType: 'sanctions_lookup',
    entityId: name,
    details: {
      query: name,
      result_count: results.total?.value ?? results.results.length,
    },
  });

  return results;
}
