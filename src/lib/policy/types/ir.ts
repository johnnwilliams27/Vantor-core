// src/lib/policy/types/ir.ts

import { AmountValue, AssetCode, VenueId } from './assets';

/**
 * The typed intermediate representation (IR) for rule conditions. Closed
 * discriminated union of 9 node kinds. Expansion requires adding a new
 * kind to this union, the ir-evaluator switch, the zod schema, and every
 * rule editor UI form — TypeScript exhaustiveness checking enforces all
 * consumers update together.
 */
export type Condition =
  | AndNode
  | OrNode
  | NotNode
  | AmountCompareNode
  | StringCompareNode
  | TimeCompareNode
  | SanctionsStatusNode
  | ForecastQueryNode
  | AggregateWindowNode;

export interface AndNode {
  kind: 'and';
  children: Condition[];
}

export interface OrNode {
  kind: 'or';
  children: Condition[];
}

export interface NotNode {
  kind: 'not';
  child: Condition;
}

// ─── Amount comparison ──────────────────────────────────────────────────

export type AmountAttribute =
  | 'transfer.amount'           // the movement's own amount (splitting guard applies)
  | 'treasury.position'         // pre-transfer position of an asset
  | 'treasury.post_position'    // post-transfer position of an asset
  | 'rolling_sum';              // pre-computed aggregate (see aggregate_window)

export type NumericOp = '>' | '>=' | '<' | '<=' | '==' | '!=' | 'between';

export interface AmountScope {
  asset?: AssetCode;
  venue?: VenueId;
}

export interface AmountCompareNode {
  kind: 'amount_compare';
  attr: AmountAttribute;
  scope?: AmountScope;
  op: NumericOp;
  value: AmountValue;
  value_upper?: AmountValue;    // required iff op='between'
}

// ─── String comparison ──────────────────────────────────────────────────

export type StringAttribute =
  | 'transfer.counterparty_id'
  | 'transfer.purpose_code'
  | 'transfer.initiator_type'
  | 'transfer.rail'
  | 'transfer.source_venue'
  | 'transfer.destination_venue';

export type StringOp = '==' | '!=' | 'in' | 'not_in';

export interface StringCompareNode {
  kind: 'string_compare';
  attr: StringAttribute;
  op: StringOp;
  value: string | string[];
}

// ─── Time comparison ────────────────────────────────────────────────────

export type TimeAttribute =
  | 'now.day_of_week'           // 0-6 (Sun-Sat)
  | 'now.hour_local'            // 0-23
  | 'now.is_business_hours'     // boolean
  | 'time_since_last_to_counterparty'   // milliseconds
  | 'time_since_last_by_initiator';     // milliseconds

export type TimeOp = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'not_in';

export type TimeValue = number | string | boolean | (number | string)[];

export interface TimeCompareNode {
  kind: 'time_compare';
  attr: TimeAttribute;
  op: TimeOp;
  value: TimeValue;
}

// ─── Sanctions status ───────────────────────────────────────────────────

export type SanctionsStatus = 'clear' | 'sanctioned' | 'partial_match' | 'unscreened';

export interface SanctionsStatusNode {
  kind: 'sanctions_status';
  op: 'in' | 'not_in';
  values: SanctionsStatus[];
}

// ─── Forecast query ─────────────────────────────────────────────────────

export type ForecastQueryKind =
  | 'projected_min_balance'
  | 'projected_position'
  | 'obligations_covered';

export interface ForecastScope {
  asset?: AssetCode;
  venue?: VenueId;
}

export interface ForecastQueryNode {
  kind: 'forecast_query';
  query: ForecastQueryKind;
  window_days: number;
  scope?: ForecastScope;
  comparator: NumericOp;
  value: AmountValue;
}

// ─── Aggregate window ───────────────────────────────────────────────────

export interface WindowSpec {
  duration_ms: number;
  group_by: GroupingDimensions;
  direction?: 'outflow' | 'inflow' | 'both';  // default 'outflow'
}

export interface GroupingDimensions {
  initiator?: boolean;
  counterparty?: boolean;
  destination?: boolean;
  asset?: boolean;
}

export type AggregateAttr =
  | 'sum_amount'
  | 'count'
  | 'distinct_destinations'
  | 'distinct_counterparties';

export interface AggregateScope {
  asset?: AssetCode;
}

export interface AggregateWindowNode {
  kind: 'aggregate_window';
  window: WindowSpec;
  attr: AggregateAttr;
  scope?: AggregateScope;
  op: NumericOp;
  value: AmountValue;
}
