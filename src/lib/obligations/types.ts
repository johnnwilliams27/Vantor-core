export const OBLIGATION_TYPES = ['outflow', 'inflow'] as const;
export type ObligationType = (typeof OBLIGATION_TYPES)[number];

export const OBLIGATION_CONFIDENCES = ['confirmed', 'expected', 'estimated'] as const;
export type ObligationConfidence = (typeof OBLIGATION_CONFIDENCES)[number];

export const OBLIGATION_SOURCES = ['manual', 'erp_sync', 'recurring_rule'] as const;
export type ObligationSource = (typeof OBLIGATION_SOURCES)[number];

export const OBLIGATION_STATUSES = ['upcoming', 'paid', 'missed', 'cancelled'] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export const OBLIGATION_RECURRENCES = [
  'once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual', 'custom',
] as const;
export type ObligationRecurrence = (typeof OBLIGATION_RECURRENCES)[number];

export const OBLIGATION_VENUE_KINDS = ['bank', 'wallet', 'defi'] as const;
export type VenueKind = (typeof OBLIGATION_VENUE_KINDS)[number];

export interface Obligation {
  id: string;
  enterpriseId: string;
  userId: string;
  label: string;
  description: string | null;
  direction: ObligationType;
  amount: number;
  currency: string;
  asset: string | null;
  dueDate: string; // ISO date YYYY-MM-DD
  sourceAccountId: string | null;
  sourceVenueKind: VenueKind | null;
  confidence: ObligationConfidence;
  source: ObligationSource;
  status: ObligationStatus;
  recurrence: ObligationRecurrence;
  recurrenceCron: string | null;
  counterpartyId: string | null;
  erpReference: string | null;
  recurringParentId: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  paidAt: string | null;
  settlementTxRef: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ObligationInput {
  label: string;
  description?: string;
  direction: ObligationType;
  amount: number;
  currency: string;
  asset?: string | null;
  dueDate: string;
  sourceAccountId?: string | null;
  sourceVenueKind?: VenueKind | null;
  confidence?: ObligationConfidence;
  source?: ObligationSource;
  recurrence?: ObligationRecurrence;
  recurrenceCron?: string | null;
  counterpartyId?: string | null;
  erpReference?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Patch shape for updating an obligation. The `status` field is intentionally
 * narrowed to exclude 'upcoming' — once an obligation has transitioned out of
 * upcoming (paid, missed, cancelled), the type system prevents resurrecting it.
 * This enforces the invariant established in migration 0041's cancelled-backfill
 * of legacy is_active=false rows. The service layer is still responsible for
 * validating transitions between terminal states.
 */
export interface ObligationPatch extends Partial<ObligationInput> {
  status?: Exclude<ObligationStatus, 'upcoming'>;
  paidAt?: string | null;
  settlementTxRef?: string | null;
}
