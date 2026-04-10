// ---- OpenSanctions Sanctions Screening Types ----

// -- Domain enums (mirror DB enums) --

export type CounterpartyType = 'individual' | 'business';
export type ScreeningStatus = 'pending' | 'cleared' | 'flagged' | 'blocked';
export type CaseState = 'open' | 'cleared' | 'escalated' | 'blocked'; // escalated kept for legacy rows
export type CaseActionType = 'clear' | 'block' | 'note';
export type ClearReasonCode =
  | 'false_positive_name_similarity'
  | 'false_positive_different_entity'
  | 'verified_not_match'
  | 'other';

// -- DB row interfaces --

export interface Counterparty {
  id: string;
  enterprise_id: string;
  name: string;
  wallet_address: string;
  chain: 'ethereum' | 'solana';
  type: CounterpartyType;
  screening_status: ScreeningStatus;
  transfer_eligible: boolean;
  last_screened_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CounterpartyScreening {
  id: string;
  enterprise_id: string;
  counterparty_id: string;
  screened_at: string;
  dataset_version: string | null;
  top_match_score: number | null;
  top_match_label: string | null;
  raw_response: Record<string, unknown>;
  result_status: ScreeningStatus;
  created_at: string;
}

export interface ScreeningCase {
  id: string;
  enterprise_id: string;
  counterparty_id: string;
  screening_id: string;
  state: CaseState;
  assignee_user_id: string | null;
  matched_entity_snapshot: Record<string, unknown>;
  opened_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseAction {
  id: string;
  case_id: string;
  actor_user_id: string;
  action: CaseActionType;
  reason_code: ClearReasonCode | null;
  notes: string | null;
  created_at: string;
}

// -- OpenSanctions API types --

export interface OpenSanctionsProperty {
  name?: string[];
  country?: string[];
  birthDate?: string[];
  idNumber?: string[];
  address?: string[];
  [key: string]: string[] | undefined;
}

export interface OpenSanctionsEntity {
  id: string;
  caption: string;
  schema: string;
  properties: OpenSanctionsProperty;
  datasets: string[];
  referents: string[];
  first_seen: string;
  last_seen: string;
  last_change: string;
  score?: number;
  match?: boolean;
}

export interface OpenSanctionsMatchResponse {
  responses: {
    [queryId: string]: {
      query: Record<string, unknown>;
      results: OpenSanctionsEntity[];
      total: { value: number; relation: string };
    };
  };
}

export interface OpenSanctionsSearchResponse {
  results: OpenSanctionsEntity[];
  total: { value: number; relation: string };
}

// -- Config --

export interface SanctionsConfig {
  apiUrl: string;
  apiKey: string;
  matchThreshold: number;
  stalenessThresholdDays: number;
  useMock: boolean;
}

export function getSanctionsConfig(): SanctionsConfig {
  return {
    apiUrl: process.env.OPENSANCTIONS_API_URL || 'https://api.opensanctions.org',
    apiKey: process.env.OPENSANCTIONS_API_KEY || '',
    matchThreshold: parseFloat(process.env.OPENSANCTIONS_MATCH_THRESHOLD || '0.7'),
    stalenessThresholdDays: parseInt(process.env.OPENSANCTIONS_STALENESS_DAYS || '14', 10),
    useMock: process.env.OPENSANCTIONS_USE_MOCK === 'true' || process.env.FORCE_MOCK === 'true',
  };
}
