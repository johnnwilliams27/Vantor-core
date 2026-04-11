// src/lib/policy/types/movement.ts

import { AssetCode, AmountNative, VenueId } from './assets';

/**
 * The seven movement kinds supported in phase 1. Expansion requires adding
 * the kind here, adding a case in the gate's dispatch switch, and adding
 * a matching adapter under src/lib/[kind]/*.internal.ts.
 */
export type MovementKind =
  | 'crypto_transfer'
  | 'fiat_ramp'
  | 'yield_deposit'
  | 'yield_withdraw'
  | 'swap'
  | 'bridge'
  | 'payment';

export type InitiatorType = 'human' | 'agent' | 'ai_recommendation' | 'schedule';

/**
 * Who initiated this movement. Exactly one of the identity fields should be
 * populated based on `type`:
 *   - type='human' → user_id
 *   - type='agent' → agent_id (+ optional recommendation_id)
 *   - type='ai_recommendation' → recommendation_id
 *   - type='schedule' → scheduled_op_id
 *
 * Validation is enforced by the zod schema, not by TypeScript narrowing.
 */
export interface Initiator {
  type: InitiatorType;
  user_id?: string;
  agent_id?: string;
  recommendation_id?: string;
  scheduled_op_id?: string;
}

/**
 * One end of a movement (source or destination). At least one of
 * address/account_id must be present depending on the venue type.
 */
export interface MovementEndpoint {
  venue: VenueId;
  asset: AssetCode;
  address?: string;      // for crypto
  account_id?: string;   // for bank accounts
  label?: string;        // optional display name
}

/**
 * Reference to a counterparty, if the movement is attributable to one.
 * The full counterparty record is loaded separately by the context loader.
 */
export interface CounterpartyRef {
  id: string;
  type?: 'known' | 'new' | 'unknown';
  jurisdiction?: string;
}

/**
 * The normalized proposed movement — the canonical shape every caller's
 * input is converted into before the engine evaluates.
 *
 * Built by `src/lib/policy/gate.ts` (in Plan 2) from whatever shape the
 * caller provided. The engine never sees the caller's raw body.
 */
export interface ProposedMovement {
  id: string;                 // idempotency key
  kind: MovementKind;
  source: MovementEndpoint;
  destination: MovementEndpoint;
  amount: AmountNative;
  counterparty?: CounterpartyRef;
  initiator: Initiator;
  purpose_code?: string;
  rail?: string;
  metadata?: Record<string, unknown>;
  requested_at: string;       // ISO 8601
}
