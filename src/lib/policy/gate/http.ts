// src/lib/policy/gate/http.ts
//
// HTTP-layer helpers: map GateError to { status, body }.

import { GateError } from './errors';
import type { ReasonCode } from '../errors/reason-codes';

export interface GateErrorBody {
  reason_code: ReasonCode;
  human_readable: string;
  user_action: string;
  details: Record<string, unknown>;
}

// Status code mapping table:
//
// | Reason Code                    | HTTP |
// |--------------------------------|------|
// | policy_blocked                 | 403  |
// | hard_limit_breached            | 403  |
// | enterprise_mismatch            | 403  |
// | canonicalization_failed        | 400  |
// | policy_engine_unavailable      | 503  |
// | approval_creation_failed       | 500  |
// | gate_internal_error            | 500  |
// | everything else                | 400  |

const STATUS_403: ReadonlySet<ReasonCode> = new Set([
  'policy_blocked',
  'hard_limit_breached',
  'enterprise_mismatch',
] as ReasonCode[]);

const STATUS_503: ReadonlySet<ReasonCode> = new Set([
  'policy_engine_unavailable',
] as ReasonCode[]);

const STATUS_500: ReadonlySet<ReasonCode> = new Set([
  'approval_creation_failed',
  'gate_internal_error',
] as ReasonCode[]);

/**
 * Map a GateError to an HTTP status code and structured response body.
 */
export function mapGateErrorToHttp(err: GateError): {
  status: number;
  body: GateErrorBody;
} {
  let status = 400;
  if (STATUS_403.has(err.reason_code)) {
    status = 403;
  } else if (STATUS_503.has(err.reason_code)) {
    status = 503;
  } else if (STATUS_500.has(err.reason_code)) {
    status = 500;
  }

  return {
    status,
    body: {
      reason_code: err.reason_code,
      human_readable: err.human_readable,
      user_action: err.user_action,
      details: err.details,
    },
  };
}
