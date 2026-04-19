import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import type { AuditAction } from '@/types/database';

export interface AuditLogEntry {
  userId?: string;
  enterpriseId?: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

// Auto-capture client IP + user-agent when writeAuditLog is called inside a
// request scope (route handler, server action, server component). Returns an
// empty object outside request scope (cron, scripts) — headers() throws
// there, and we never want audit writes to crash the caller.
function captureRequestContext(): { ipAddress?: string; userAgent?: string } {
  try {
    const h = headers();
    const xff = h.get('x-forwarded-for');
    const ip = xff?.split(',')[0]?.trim() || h.get('x-real-ip') || undefined;
    const ua = h.get('user-agent') || undefined;
    return { ipAddress: ip, userAgent: ua };
  } catch {
    return {};
  }
}

// In-memory cache: userId → enterpriseId (avoids repeated DB lookups)
const enterpriseCache = new Map<string, string | null>();

async function resolveEnterpriseId(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<string | null> {
  if (enterpriseCache.has(userId)) return enterpriseCache.get(userId)!;
  const { data } = await supabase
    .from('user_profiles')
    .select('enterprise_id')
    .eq('id', userId)
    .single();
  const eid = data?.enterprise_id ?? null;
  enterpriseCache.set(userId, eid);
  // Expire after 5 minutes so changes propagate
  setTimeout(() => enterpriseCache.delete(userId), 5 * 60 * 1000);
  return eid;
}

export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const supabase = createAdminClient();

    // Auto-resolve enterpriseId from userId when not provided
    let enterpriseId = entry.enterpriseId ?? null;
    if (!enterpriseId && entry.userId) {
      enterpriseId = await resolveEnterpriseId(supabase, entry.userId);
    }

    // Explicit ipAddress/userAgent on the entry wins; otherwise fall back
    // to whatever we can pull from the current request's headers.
    const ctx = captureRequestContext();

    await supabase.from('audit_logs').insert({
      user_id: entry.userId ?? null,
      enterprise_id: enterpriseId,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      details: entry.details ?? null,
      ip_address: entry.ipAddress ?? ctx.ipAddress ?? null,
      user_agent: entry.userAgent ?? ctx.userAgent ?? null,
    });
  } catch (err) {
    // Non-blocking – log to stderr but never crash the caller
    console.error('[AuditLog] Failed to write audit entry:', err);
  }
}
