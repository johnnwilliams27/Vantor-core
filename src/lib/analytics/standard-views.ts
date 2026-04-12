import type { AnalyticsView } from './types';

const CREATED_AT = '2026-04-12T00:00:00Z';
const UPDATED_AT = '2026-04-12T00:00:00Z';

export const STANDARD_VIEWS: AnalyticsView[] = [
  {
    id: 'std-treasury-summary',
    enterpriseId: null,
    slug: 'treasury-summary',
    label: 'Treasury Summary',
    description: 'Key treasury balance metrics at a glance',
    kind: 'standard',
    chartType: 'kpi',
    config: {
      // Phase C-1.5a taxonomy: show the two L1 rollups (Cash & Equivalents,
      // Yield Positions) plus total + coverage. Drill-in exposes the leaves.
      measures: [
        'total_balance_usd',
        'cash_and_equivalents_usd',
        'yield_positions_usd',
        'idle_cash_usd',
        'coverage_ratio',
      ],
    },
    sortOrder: 1,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'std-balance-history',
    enterpriseId: null,
    slug: 'balance-history',
    label: 'Balance History',
    description: 'Treasury balance trends over time by taxonomy leaf',
    kind: 'standard',
    chartType: 'line',
    config: {
      // 4 lines: Cash & Equivalents rollup + 3 yield leaves. Cleaner than
      // 6 lines; users who want DeFi vault vs lending can fork this view.
      measures: [
        'cash_and_equivalents_usd',
        'mmf_balance_usd',
        'defi_protocols_usd',
        'other_balance_usd',
      ],
      primaryDimension: 'time',
      granularity: 'day',
    },
    sortOrder: 2,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'std-obligation-coverage',
    enterpriseId: null,
    slug: 'obligation-coverage',
    label: 'Obligation Coverage',
    description: 'Weekly view of obligations vs Cash & Equivalents, with coverage ratio',
    kind: 'standard',
    chartType: 'bar',
    config: {
      // Coverage uses Cash & Equivalents (what can actually settle), not
      // just bank balance — MMFs and idle stablecoins both count.
      measures: ['obligation_total_usd', 'cash_and_equivalents_usd', 'coverage_ratio'],
      primaryDimension: 'time',
      granularity: 'week',
    },
    sortOrder: 3,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'std-forecast-vs-actuals',
    enterpriseId: null,
    slug: 'forecast-vs-actuals',
    label: 'Forecast vs Actuals',
    description: 'Compare projected cash flow forecast against actual treasury balance',
    kind: 'standard',
    chartType: 'line',
    config: {
      measures: ['forecast_projected_usd', 'total_balance_usd'],
      primaryDimension: 'time',
      granularity: 'day',
    },
    sortOrder: 4,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'std-ramp-activity',
    enterpriseId: null,
    slug: 'ramp-activity',
    label: 'Ramp Activity',
    description: 'On/off ramp volume, count, and fees broken down by direction',
    kind: 'standard',
    chartType: 'bar',
    config: {
      measures: ['ramp_volume_usd', 'ramp_count', 'ramp_fee_usd'],
      primaryDimension: 'direction',
    },
    sortOrder: 5,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'std-transfer-volume',
    enterpriseId: null,
    slug: 'transfer-volume',
    label: 'Transfer Volume',
    description: 'Stablecoin transfer volume and count by status',
    kind: 'standard',
    chartType: 'table',
    config: {
      measures: ['transfer_volume_usd', 'transfer_count'],
      primaryDimension: 'status',
    },
    sortOrder: 6,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'std-swap-activity',
    enterpriseId: null,
    slug: 'swap-activity',
    label: 'Swap Activity',
    description: 'Bridge/swap transaction volume and count by chain',
    kind: 'standard',
    chartType: 'table',
    config: {
      measures: ['swap_volume_usd', 'swap_count'],
      primaryDimension: 'chain',
    },
    sortOrder: 7,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'std-invoice-aging',
    enterpriseId: null,
    slug: 'invoice-aging',
    label: 'Invoice Aging',
    description: 'Outstanding invoice amounts and counts by age bucket',
    kind: 'standard',
    chartType: 'bar',
    config: {
      measures: ['invoice_outstanding_usd', 'invoice_count'],
      primaryDimension: 'age_bucket',
    },
    sortOrder: 8,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'std-ai-actions',
    enterpriseId: null,
    slug: 'ai-actions',
    label: 'AI Actions',
    description: 'AI recommendation activity and execution rates by status',
    kind: 'standard',
    chartType: 'table',
    config: {
      measures: ['recommendation_count', 'recommendation_executed_count'],
      primaryDimension: 'status',
    },
    sortOrder: 9,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'std-compliance-summary',
    enterpriseId: null,
    slug: 'compliance-summary',
    label: 'Compliance Summary',
    description: 'Sanctions screening and KYT alert metrics at a glance',
    kind: 'standard',
    chartType: 'kpi',
    config: {
      measures: [
        'screening_count',
        'screening_hit_count',
        'kyt_alert_count',
        'kyt_open_count',
      ],
    },
    sortOrder: 10,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'std-yield-performance',
    enterpriseId: null,
    slug: 'yield-performance',
    label: 'Yield Performance',
    description: 'Yield protocol deposits and withdrawals by protocol',
    kind: 'standard',
    chartType: 'table',
    config: {
      measures: ['yield_deposited_usd', 'yield_withdrawn_usd'],
      primaryDimension: 'protocol',
    },
    sortOrder: 11,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'std-idle-cash',
    enterpriseId: null,
    slug: 'idle-cash',
    label: 'Idle Cash',
    description: 'Idle cash vs Cash & Equivalents over time',
    kind: 'standard',
    chartType: 'line',
    config: {
      measures: ['idle_cash_usd', 'cash_and_equivalents_usd'],
      primaryDimension: 'time',
      granularity: 'day',
    },
    sortOrder: 12,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
];

const viewMap = new Map<string, AnalyticsView>(
  STANDARD_VIEWS.map((v) => [v.slug, v]),
);

export function getStandardView(slug: string): AnalyticsView | undefined {
  return viewMap.get(slug);
}

export function getStandardViews(): AnalyticsView[] {
  return STANDARD_VIEWS;
}
