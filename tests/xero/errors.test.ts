import { describe, it, expect } from 'vitest';
import {
  xeroStateMismatch,
  xeroNotConnected,
  xeroAuthExpired,
  xeroRefreshPersistFailure,
  xeroRateLimited,
  xeroTenantUnknown,
  xeroUpstreamFailure,
  xeroValidation,
} from '@/lib/erp/real/xero/errors';

const baseFields = {
  connection_id: 'c-1',
  xero_tenant_id: 't-1',
  endpoint: '/api.xro/2.0/Contacts',
  trace_id: 'trace-1',
};

describe('XeroError factory', () => {
  it('xeroStateMismatch sets reason code and next step', () => {
    const err = xeroStateMismatch({ ...baseFields });
    expect(err.reason_code).toBe('ERP_XERO_STATE_MISMATCH');
    expect(err.next_step).toMatch(/restart the xero connection/i);
    expect(err.fields.connection_id).toBe('c-1');
  });

  it('xeroNotConnected has an explanation and next step', () => {
    const err = xeroNotConnected({ ...baseFields });
    expect(err.reason_code).toBe('ERP_XERO_NOT_CONNECTED');
    expect(err.next_step).toMatch(/connect xero/i);
  });

  it('xeroAuthExpired carries optional rotated_at', () => {
    const err = xeroAuthExpired({ ...baseFields, refresh_token_rotated_at: '2026-04-12T00:00:00Z' });
    expect(err.reason_code).toBe('ERP_XERO_AUTH_EXPIRED');
    expect(err.fields.refresh_token_rotated_at).toBe('2026-04-12T00:00:00Z');
  });

  it('xeroRefreshPersistFailure is distinct from AUTH_EXPIRED', () => {
    const err = xeroRefreshPersistFailure({ ...baseFields });
    expect(err.reason_code).toBe('ERP_XERO_REFRESH_PERSIST_FAILURE');
  });

  it('xeroRateLimited carries retry_after_seconds', () => {
    const err = xeroRateLimited({ ...baseFields, retry_after_seconds: 30, daily_limit_remaining: 4000 });
    expect(err.reason_code).toBe('ERP_XERO_RATE_LIMITED');
    expect(err.fields.retry_after_seconds).toBe(30);
    expect(err.fields.daily_limit_remaining).toBe(4000);
  });

  it('xeroTenantUnknown exists', () => {
    const err = xeroTenantUnknown({ ...baseFields });
    expect(err.reason_code).toBe('ERP_XERO_TENANT_UNKNOWN');
  });

  it('xeroUpstreamFailure exists', () => {
    const err = xeroUpstreamFailure({ ...baseFields });
    expect(err.reason_code).toBe('ERP_XERO_UPSTREAM_FAILURE');
  });

  it('xeroValidation carries zod issues and a truncated body', () => {
    const err = xeroValidation({
      ...baseFields,
      zod_issues: [{ path: ['Contacts'], message: 'Required' }],
      body_prefix: 'a'.repeat(500),
    });
    expect(err.reason_code).toBe('ERP_XERO_VALIDATION');
    expect((err.fields.body_prefix as string).length).toBeLessThanOrEqual(200);
    expect(err.fields.zod_issues).toHaveLength(1);
  });

  it('toUserFacing drops internal fields and keeps reason_code + next_step + trace_id', () => {
    const err = xeroUpstreamFailure({ ...baseFields });
    const user = err.toUserFacing();
    expect(user.reason_code).toBe('ERP_XERO_UPSTREAM_FAILURE');
    expect(user.next_step).toBeDefined();
    expect(user.trace_id).toBe('trace-1');
    expect((user as unknown as Record<string, unknown>).zod_issues).toBeUndefined();
    expect((user as unknown as Record<string, unknown>).connection_id).toBeUndefined();
  });
});
