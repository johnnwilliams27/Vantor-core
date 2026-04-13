import type { SeedContext } from './helpers';
import { daysAgo } from './helpers';

export async function seedInsights(ctx: SeedContext): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  const rows = [
    // 1. CRITICAL liquidity_below_buffer — new, has agent reasoning
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'liquidity_buffer_detector',
      insight_type: 'liquidity_below_buffer',
      severity: 'critical', state: 'new',
      title: 'Liquidity buffer dips below 1.5× on day 7',
      summary: 'Forecast shows coverage falling below the 1.5× buffer between days 7-11.',
      ai_reasoning: 'Forecast engine projects a 3-day dip below the 1.5× buffer between day 7 and day 11 of the forecast window. Recommended action is a $350K USDC onramp from JPMorgan Operating Account, which restores coverage for the full 30-day window. This insight is linked to the pending AI recommendation in the approvals queue — approving the recommendation resolves the insight.',
      ai_model: 'claude-sonnet-4-6',
      rationale: { buffer_target: 1.5, projected_min_coverage_ratio: 1.32, dip_start_day: 7, dip_end_day: 11 },
      recommended_action: { kind: 'onramp', amount_usd: 350000, asset: 'USDC', from_account: 'JPMorgan Operating' },
      policy_verdict: 'require_approval', policy_reason: 'AI-initiated movement — always requires human approval',
      impact_dollar_value: 350000, impact_buffer_days: 4,
      confidence: 0.92, data_freshness: 'fresh',
      venue_category: null, supporting_data: {},
      created_at: daysAgo(0),
    },
    // 2. CRITICAL concentration_breach — new, has agent reasoning
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'concentration_detector',
      insight_type: 'concentration_breach',
      severity: 'critical', state: 'new',
      title: 'USDC concentration exceeds 60% hard limit',
      summary: 'USDC is 73% of total stablecoin holdings, breaching the 60% concentration limit.',
      ai_reasoning: 'Current holdings are USDC $2.14M / USDT $790K. USDC concentration of 73% exceeds the 60% hard limit set in policy v3. Recommend swapping $200K USDC → USDT to bring concentration to ~58% and restore policy compliance.',
      ai_model: 'claude-sonnet-4-6',
      rationale: { usdc_pct: 73, usdt_pct: 27, limit_pct: 60 },
      recommended_action: { kind: 'swap', from_asset: 'USDC', to_asset: 'USDT', amount_usd: 200000 },
      policy_verdict: 'require_approval', policy_reason: 'AI-initiated movement — always requires human approval',
      impact_dollar_value: 200000, confidence: 0.95, data_freshness: 'fresh',
      venue_category: null, supporting_data: {},
      created_at: daysAgo(0),
    },
    // 3. WARNING yield_drop — new
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'yield_drop_detector',
      insight_type: 'yield_drop', severity: 'warning', state: 'new',
      title: 'Morpho Reservoir APY dropped 180bps in 7 days',
      summary: 'APY fell from 7.0% → 5.2%. Consider rebalancing to Aave.',
      ai_reasoning: null, ai_model: null,
      rationale: { protocol: 'morpho_reservoir', apy_before: 7.0, apy_now: 5.2, window_days: 7 },
      recommended_action: null, policy_verdict: null, policy_reason: null,
      impact_apy_delta_bps: -180, confidence: 0.88, data_freshness: 'fresh',
      venue_category: 'defi_lending', supporting_data: {},
      created_at: daysAgo(1),
    },
    // 4. WARNING yield_opportunity — viewed
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'yield_opportunity_detector',
      insight_type: 'yield_opportunity', severity: 'warning', state: 'viewed',
      title: 'Kamino (Solana) APY 8.1% — 130bps above current Aave allocation',
      summary: 'Consider rebalancing $150K from Aave to Kamino for a 130bps APY uplift.',
      ai_reasoning: null, ai_model: null,
      rationale: { target_protocol: 'kamino', target_apy: 8.1, current_protocol: 'aave_v3', current_apy: 6.8 },
      recommended_action: { kind: 'rebalance', from_protocol: 'aave_v3', to_protocol: 'kamino', amount_usd: 150000 },
      policy_verdict: 'require_approval', policy_reason: 'AI-initiated movement — always requires human approval',
      impact_apy_delta_bps: 130, impact_dollar_value: 150000,
      confidence: 0.78, data_freshness: 'fresh',
      venue_category: 'defi_lending', supporting_data: {},
      created_at: daysAgo(3),
    },
    // 5. WARNING yield_idle_opportunity — new
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'idle_cash_detector',
      insight_type: 'yield_idle_opportunity', severity: 'warning', state: 'new',
      title: '$450K idle in operating wallet for 14 days',
      summary: 'Move idle cash to Spiko USD MMF for 4.8% APY.',
      ai_reasoning: null, ai_model: null,
      rationale: { idle_amount_usd: 450000, idle_days: 14, suggested_venue: 'spiko_usd', suggested_apy: 4.8 },
      recommended_action: { kind: 'mmf_deposit', venue: 'spiko_usd', amount_usd: 450000 },
      policy_verdict: null, policy_reason: null,
      impact_dollar_value: 450000, impact_apy_delta_bps: 480,
      confidence: 0.82, data_freshness: 'fresh',
      venue_category: 'tokenized_mmf', supporting_data: {},
      created_at: daysAgo(2),
    },
    // 6. INFO concentration_warning — new
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'concentration_detector',
      insight_type: 'concentration_warning', severity: 'info', state: 'new',
      title: 'Ethereum chain holds 91% of stablecoin exposure',
      summary: 'Chain concentration is high. Consider diversifying to Solana.',
      ai_reasoning: null, ai_model: null,
      rationale: { ethereum_pct: 91, solana_pct: 9 },
      recommended_action: null, policy_verdict: null, policy_reason: null,
      confidence: 0.75, data_freshness: 'fresh',
      venue_category: null, supporting_data: {},
      created_at: daysAgo(4),
    },
    // 7. INFO yield_opportunity — dismissed
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'yield_opportunity_detector',
      insight_type: 'yield_opportunity', severity: 'info', state: 'dismissed',
      title: 'Ondo OUSG offers 4.5% APY on $500K+ allocations',
      summary: 'Tokenized US Treasuries — stable yield alternative.',
      ai_reasoning: null, ai_model: null,
      rationale: { protocol: 'ondo_ousg', apy: 4.5, min_size_usd: 500000 },
      recommended_action: null, policy_verdict: null, policy_reason: null,
      confidence: 0.70, data_freshness: 'fresh',
      venue_category: 'tokenized_mmf', supporting_data: {},
      created_at: daysAgo(6),
    },
    // 8. INFO liquidity_idle_cash — viewed
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'idle_cash_detector',
      insight_type: 'liquidity_idle_cash', severity: 'info', state: 'viewed',
      title: '$85K in HSBC GBP account has been idle for 30 days',
      summary: 'Consider FX-offramping to USD for operational use.',
      ai_reasoning: null, ai_model: null,
      rationale: { account: 'HSBC GBP', idle_amount_gbp: 67000, idle_days: 30 },
      recommended_action: null, policy_verdict: null, policy_reason: null,
      confidence: 0.65, data_freshness: 'fresh',
      venue_category: null, supporting_data: {},
      created_at: daysAgo(5),
    },
  ];

  const { error } = await supabase.from('treasury_insights').insert(rows);
  if (error) console.error('[seed:insights] insert failed', error);
  else console.log('[seed:insights] ✓ 8 insights (2 critical w/ agent, 3 warning, 3 info)');
}
