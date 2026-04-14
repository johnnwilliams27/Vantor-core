import type { MeasureDefinition } from './types';

export const MEASURES: MeasureDefinition[] = [
  // Balance measures
  {
    slug: 'total_balance_usd',
    label: 'Total Balance',
    description: 'Total treasury balance across all asset types in USD',
    unit: 'usd',
    source: {
      table: 'treasury_state_snapshots',
      valueColumn: 'total_value_base_usd',
      dateColumn: 'taken_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'latest',
    },
    dimensions: ['time'],
  },
  // ─── Phase C-1.5a — canonical L3-leaf balance measures ────────────
  // See docs/architecture/forecast-analytics.md for the full taxonomy.
  {
    slug: 'bank_balance_usd',
    label: 'Bank',
    description: 'Off-chain bank account balances (multi-currency, USD base). L3 leaf of Cash & Equivalents.',
    unit: 'usd',
    source: {
      table: 'treasury_state_snapshots',
      valueColumn: 'total_bank_base_usd',
      dateColumn: 'taken_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'latest',
    },
    dimensions: ['time'],
  },
  {
    slug: 'stablecoin_idle_balance_usd',
    label: 'Stablecoins',
    description: 'Idle USDC/USDT in self-custody wallets (not deployed). L3 leaf of Cash & Equivalents.',
    unit: 'usd',
    source: {
      table: 'treasury_state_snapshots',
      valueColumn: 'total_stablecoin_idle_base_usd',
      dateColumn: 'taken_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'latest',
    },
    dimensions: ['time'],
  },
  {
    slug: 'mmf_balance_usd',
    label: 'Tokenized MMFs',
    description: 'Tokenized money-market-fund positions (Spiko, BUIDL, USYC, Ondo USDY, etc.). L3 leaf of Yield Positions.',
    unit: 'usd',
    source: {
      table: 'treasury_state_snapshots',
      valueColumn: 'total_mmf_base_usd',
      dateColumn: 'taken_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'latest',
    },
    dimensions: ['time'],
  },
  {
    slug: 'defi_vault_balance_usd',
    label: 'DeFi Vaults',
    description: 'DeFi vault protocol positions (Kamino Multiply, Morpho Reservoir, Morpho Steakhouse). L3 leaf of DeFi Protocols.',
    unit: 'usd',
    source: {
      table: 'treasury_state_snapshots',
      valueColumn: 'total_defi_vault_base_usd',
      dateColumn: 'taken_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'latest',
    },
    dimensions: ['time'],
  },
  {
    slug: 'defi_lending_balance_usd',
    label: 'DeFi Lending',
    description: 'DeFi lending protocol positions (Aave V3, Compound V3, Kamino Lend). L3 leaf of DeFi Protocols.',
    unit: 'usd',
    source: {
      table: 'treasury_state_snapshots',
      valueColumn: 'total_defi_lending_base_usd',
      dateColumn: 'taken_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'latest',
    },
    dimensions: ['time'],
  },
  {
    slug: 'other_balance_usd',
    label: 'Other',
    description: 'Non-stable wallet tokens (ETH, SOL, etc.) and unknown yield venues.',
    unit: 'usd',
    source: {
      table: 'treasury_state_snapshots',
      valueColumn: 'total_other_base_usd',
      dateColumn: 'taken_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'latest',
    },
    dimensions: ['time'],
  },

  // ─── Phase C-1.5a — rollup measures (computed by resolver) ────────
  {
    slug: 'cash_and_equivalents_usd',
    label: 'Cash & Equivalents',
    description: 'Bank + idle stablecoins. Liquid, USD-pegged balances available to settle obligations immediately.',
    unit: 'usd',
    computed: true,
    dimensions: ['time'],
  },
  {
    slug: 'defi_protocols_usd',
    label: 'DeFi Protocols',
    description: 'DeFi Vaults + DeFi Lending. The deployed-to-DeFi portion of the yield portfolio.',
    unit: 'usd',
    computed: true,
    dimensions: ['time'],
  },
  {
    slug: 'yield_positions_usd',
    label: 'Yield Positions',
    description: 'Tokenized MMFs + DeFi Protocols. Capital earning a yield.',
    unit: 'usd',
    computed: true,
    dimensions: ['time'],
  },

  // Obligation measures
  {
    slug: 'obligation_total_usd',
    label: 'Obligation Total',
    description: 'Total value of active obligations in USD',
    unit: 'usd',
    source: {
      table: 'obligations',
      valueColumn: 'amount_usd',
      dateColumn: 'due_date',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
      baseFilters: { is_active: true },
    },
    dimensions: ['time', 'direction', 'confidence', 'status'],
  },
  {
    slug: 'obligation_count',
    label: 'Obligation Count',
    description: 'Number of active obligations',
    unit: 'count',
    source: {
      table: 'obligations',
      valueColumn: 'id',
      dateColumn: 'due_date',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
      baseFilters: { is_active: true },
    },
    dimensions: ['time', 'direction', 'confidence', 'status'],
  },

  // Ramp measures
  {
    slug: 'ramp_volume_usd',
    label: 'Ramp Volume',
    description: 'Total on/off ramp transaction volume in USD',
    unit: 'usd',
    source: {
      table: 'fiat_transactions',
      valueColumn: 'fiat_amount',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
    },
    dimensions: ['time', 'direction', 'status'],
  },
  {
    slug: 'ramp_count',
    label: 'Ramp Count',
    description: 'Number of on/off ramp transactions',
    unit: 'count',
    source: {
      table: 'fiat_transactions',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
    },
    dimensions: ['time', 'direction', 'status'],
  },
  {
    slug: 'ramp_fee_usd',
    label: 'Ramp Fees',
    description: 'Total fees paid on ramp transactions in USD',
    unit: 'usd',
    source: {
      table: 'fiat_transactions',
      valueColumn: 'fee_amount',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
    },
    dimensions: ['time', 'direction'],
  },

  // Transfer measures
  {
    slug: 'transfer_volume_usd',
    label: 'Transfer Volume',
    description: 'Total stablecoin transfer volume in USD',
    unit: 'usd',
    source: {
      table: 'transfers',
      valueColumn: 'amount_usd',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
    },
    dimensions: ['time', 'status', 'chain'],
  },
  {
    slug: 'transfer_count',
    label: 'Transfer Count',
    description: 'Number of stablecoin transfers',
    unit: 'count',
    source: {
      table: 'transfers',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
    },
    dimensions: ['time', 'status', 'chain'],
  },

  // Swap measures
  {
    slug: 'swap_volume_usd',
    label: 'Swap Volume',
    description: 'Total bridge/swap transaction volume in USD',
    unit: 'usd',
    source: {
      table: 'bridge_transfers',
      valueColumn: 'amount_usd',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
    },
    dimensions: ['time', 'status', 'chain'],
  },
  {
    slug: 'swap_count',
    label: 'Swap Count',
    description: 'Number of bridge/swap transactions',
    unit: 'count',
    source: {
      table: 'bridge_transfers',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
    },
    dimensions: ['time', 'chain'],
  },

  // Invoice measures
  {
    slug: 'invoice_outstanding_usd',
    label: 'Invoice Outstanding',
    description: 'Total outstanding (unpaid) invoice value in USD',
    unit: 'usd',
    source: {
      table: 'invoices',
      valueColumn: 'amount_usd',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
      baseFilters: { status: 'unpaid' },
    },
    dimensions: ['time', 'status'],
  },
  {
    slug: 'invoice_count',
    label: 'Invoice Count',
    description: 'Number of invoices',
    unit: 'count',
    source: {
      table: 'invoices',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
    },
    dimensions: ['time', 'status'],
  },

  // Recommendation measures
  {
    slug: 'recommendation_count',
    label: 'AI Recommendation Count',
    description: 'Number of AI recommendations generated',
    unit: 'count',
    source: {
      table: 'ai_recommendations',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
    },
    dimensions: ['time', 'status', 'action'],
  },
  {
    slug: 'recommendation_executed_count',
    label: 'Executed Recommendations',
    description: 'Number of AI recommendations that were executed',
    unit: 'count',
    source: {
      table: 'ai_recommendations',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
      baseFilters: { status: 'executed' },
    },
    dimensions: ['time', 'action'],
  },

  // Compliance measures
  {
    slug: 'screening_count',
    label: 'Sanctions Screenings',
    description: 'Number of sanctions screening checks performed',
    unit: 'count',
    source: {
      table: 'sanctions_screenings',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
    },
    dimensions: ['time'],
  },
  {
    slug: 'screening_hit_count',
    label: 'Sanctions Hits',
    description: 'Number of sanctions screening checks that returned a hit',
    unit: 'count',
    source: {
      table: 'sanctions_screenings',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
      baseFilters: { result: 'sanctioned' },
    },
    dimensions: ['time'],
  },
  {
    slug: 'kyt_alert_count',
    label: 'KYT Alerts',
    description: 'Number of Know Your Transaction alerts raised',
    unit: 'count',
    source: {
      table: 'kyt_alerts',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
    },
    dimensions: ['time', 'severity'],
  },
  {
    slug: 'kyt_open_count',
    label: 'Open KYT Alerts',
    description: 'Number of open (unresolved) KYT alerts',
    unit: 'count',
    source: {
      table: 'kyt_alerts',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
      baseFilters: { status: 'open' },
    },
    dimensions: ['time'],
  },

  // Yield measures
  {
    slug: 'yield_deposited_usd',
    label: 'Yield Deposited',
    description: 'Total amount deposited into yield protocols in USD',
    unit: 'usd',
    source: {
      table: 'yield_transactions',
      valueColumn: 'amount_usd',
      dateColumn: 'executed_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
      baseFilters: { tx_type: 'deposit' },
    },
    dimensions: ['time', 'protocol', 'status'],
  },
  {
    slug: 'yield_withdrawn_usd',
    label: 'Yield Withdrawn',
    description: 'Total amount withdrawn from yield protocols in USD',
    unit: 'usd',
    source: {
      table: 'yield_transactions',
      valueColumn: 'amount_usd',
      dateColumn: 'executed_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
      baseFilters: { tx_type: 'withdraw' },
    },
    dimensions: ['time', 'protocol', 'status'],
  },

  // Computed measures
  {
    slug: 'idle_cash_usd',
    label: 'Idle Cash',
    description: 'Estimated idle cash not deployed to yield or obligations in USD',
    unit: 'usd',
    computed: true,
    dimensions: ['time'],
  },
  {
    slug: 'coverage_ratio',
    label: 'Coverage Ratio',
    description: 'Ratio of liquid treasury balance to total obligations',
    unit: 'ratio',
    computed: true,
    dimensions: ['time'],
  },
  {
    slug: 'forecast_projected_usd',
    label: 'Forecast Projected',
    description: 'Projected treasury balance based on cash flow forecast in USD',
    unit: 'usd',
    computed: true,
    dimensions: ['time'],
  },
];

const measureMap = new Map<string, MeasureDefinition>(
  MEASURES.map((m) => [m.slug, m]),
);

export function getMeasure(slug: string): MeasureDefinition | undefined {
  return measureMap.get(slug);
}

export function getMeasures(): MeasureDefinition[] {
  return MEASURES;
}

/**
 * Map of database column names to human-readable labels for table display.
 * Used when displaying query results that include raw database columns.
 */
const COLUMN_LABELS: Record<string, string> = {
  // Transaction/activity columns
  id: 'ID',
  wallet_id: 'Wallet',
  user_id: 'User',
  enterprise_id: 'Enterprise',
  position_id: 'Position',
  protocol: 'Protocol',
  chain: 'Chain',
  source_chain: 'From Chain',
  destination_chain: 'To Chain',
  tx_type: 'Type',
  action_type: 'Action',
  underlying_token: 'Token',
  token_in: 'Token In',
  token_out: 'Token Out',
  amount: 'Amount',
  amount_usd: 'Amount (USD)',
  tx_hash: 'Hash',
  status: 'Status',
  direction: 'Direction',
  from_address: 'From',
  to_address: 'To',
  error_message: 'Error',
  executed_at: 'Executed',
  description: 'Description',
  metadata: 'Metadata',
  created_at: 'Created',
  updated_at: 'Updated',
  denial_reason: 'Denial Reason',
  // Common columns
  slug: 'Identifier',
  label: 'Label',
  kind: 'Kind',
};

/**
 * Return a human-readable label for a measure slug or column name.
 * Falls back to pretty-printing the slug (snake_case → Title Case) when
 * the slug isn't a registered measure — useful for unknown group/row keys
 * that come back from the resolver.
 */
export function getMeasureLabel(slug: string): string {
  const measure = measureMap.get(slug);
  if (measure) return measure.label;

  // Check if it's a known column name
  if (COLUMN_LABELS[slug]) return COLUMN_LABELS[slug];

  // Fallback: snake_case or kebab-case → Title Case, strip "_usd" suffix
  return slug
    .replace(/_usd$/, '')
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
