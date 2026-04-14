export type XeroReasonCode =
  | 'ERP_XERO_STATE_MISMATCH'
  | 'ERP_XERO_NOT_CONNECTED'
  | 'ERP_XERO_AUTH_EXPIRED'
  | 'ERP_XERO_REFRESH_PERSIST_FAILURE'
  | 'ERP_XERO_RATE_LIMITED'
  | 'ERP_XERO_TENANT_UNKNOWN'
  | 'ERP_XERO_UPSTREAM_FAILURE'
  | 'ERP_XERO_VALIDATION';

export interface XeroErrorFields {
  connection_id?: string;
  xero_tenant_id?: string;
  endpoint?: string;
  trace_id: string;
  [key: string]: unknown;
}

export interface XeroUserFacing {
  reason_code: XeroReasonCode;
  next_step: string;
  trace_id: string;
}

export class XeroError extends Error {
  readonly reason_code: XeroReasonCode;
  readonly explanation: string;
  readonly next_step: string;
  readonly fields: XeroErrorFields;

  constructor(
    reason_code: XeroReasonCode,
    explanation: string,
    next_step: string,
    fields: XeroErrorFields,
  ) {
    super(`[${reason_code}] ${explanation}`);
    this.name = 'XeroError';
    this.reason_code = reason_code;
    this.explanation = explanation;
    this.next_step = next_step;
    this.fields = fields;
  }

  /** Shape safe to return to the UI — no tokens, no raw Xero bodies. */
  toUserFacing(): XeroUserFacing {
    return {
      reason_code: this.reason_code,
      next_step: this.next_step,
      trace_id: this.fields.trace_id,
    };
  }
}

function truncate(body: string | undefined, max = 200): string | undefined {
  if (!body) return body;
  return body.length > max ? body.slice(0, max) : body;
}

export function xeroStateMismatch(fields: XeroErrorFields): XeroError {
  return new XeroError(
    'ERP_XERO_STATE_MISMATCH',
    'OAuth state parameter did not match the signed cookie.',
    'Restart the Xero connection from Settings → ERP.',
    fields,
  );
}

export function xeroNotConnected(fields: XeroErrorFields): XeroError {
  return new XeroError(
    'ERP_XERO_NOT_CONNECTED',
    'No active Xero connection for this user.',
    'Connect Xero from Settings → ERP.',
    fields,
  );
}

export function xeroAuthExpired(
  fields: XeroErrorFields & { refresh_token_rotated_at?: string },
): XeroError {
  return new XeroError(
    'ERP_XERO_AUTH_EXPIRED',
    'The Xero refresh token is no longer valid.',
    'Reconnect Xero from Settings → ERP.',
    fields,
  );
}

export function xeroRefreshPersistFailure(fields: XeroErrorFields): XeroError {
  return new XeroError(
    'ERP_XERO_REFRESH_PERSIST_FAILURE',
    'Xero refresh succeeded but the new token could not be saved to the database.',
    'Try the action again in a moment. If it keeps failing, contact support with this trace ID.',
    fields,
  );
}

export function xeroRateLimited(
  fields: XeroErrorFields & { retry_after_seconds: number; daily_limit_remaining?: number },
): XeroError {
  return new XeroError(
    'ERP_XERO_RATE_LIMITED',
    'Xero rate-limited this connection.',
    `Xero is throttling this connection. Vantor will resume automatically in ${fields.retry_after_seconds} seconds.`,
    fields,
  );
}

export function xeroTenantUnknown(fields: XeroErrorFields): XeroError {
  return new XeroError(
    'ERP_XERO_TENANT_UNKNOWN',
    'The stored Xero tenant ID is no longer present in /connections.',
    'This Xero connection was removed from the Xero side. Reconnect from Settings → ERP.',
    fields,
  );
}

export function xeroUpstreamFailure(fields: XeroErrorFields): XeroError {
  return new XeroError(
    'ERP_XERO_UPSTREAM_FAILURE',
    'Xero returned a server error or the request failed to reach Xero.',
    'Xero is having trouble right now. Try again in a moment.',
    fields,
  );
}

export function xeroValidation(
  fields: XeroErrorFields & { zod_issues: unknown[]; body_prefix?: string },
): XeroError {
  return new XeroError(
    'ERP_XERO_VALIDATION',
    'A Xero response failed schema validation.',
    'Vantor needs to update its Xero integration. The engineering team has been notified with this trace ID.',
    { ...fields, body_prefix: truncate(fields.body_prefix) },
  );
}
