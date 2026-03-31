// src/lib/test-mode/seed/treasury.ts
import { SeedContext, daysAgo, daysFromNow, dateDaysFromNow, rand, randInt, pick } from './helpers';

export async function seedTreasury(ctx: SeedContext): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  // Treasury rule
  await supabase.from('treasury_rules').insert({
    user_id: userId,
    enterprise_id: enterpriseId,
    label: 'Primary Safety Rule',
    is_active: true,
    safety_buffer_multiplier: '1.5',
    obligation_lookahead_days: 30,
    approval_threshold_usd: '100000',
    target_stablecoin: 'USDC',
    target_chain: 'ethereum',
  });

  // Manual obligations — monthly, biweekly, one-time across 90-day window
  const obligations: any[] = [];

  const monthlyItems = [
    { label: 'AWS Infrastructure', amount: '15000', category: 'vendor' },
    { label: 'Office Lease', amount: '25000', category: 'rent' },
    { label: 'Data Center Colocation', amount: '8500', category: 'vendor' },
    { label: 'Cyber Insurance Premium', amount: '12000', category: 'insurance' },
    { label: 'SaaS Subscriptions', amount: '7200', category: 'vendor' },
  ];
  for (const item of monthlyItems) {
    for (let m = 0; m < 3; m++) {
      obligations.push({
        user_id: userId,
        enterprise_id: enterpriseId,
        label: item.label,
        amount_usd: item.amount,
        due_date: dateDaysFromNow(m * 30 + randInt(1, 5)),
        recurrence: 'monthly',
        category: item.category,
        is_active: true,
      });
    }
  }

  for (let i = 0; i < 6; i++) {
    obligations.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      label: 'Biweekly Payroll',
      amount_usd: '180000',
      due_date: dateDaysFromNow(i * 14 + randInt(0, 2)),
      recurrence: 'biweekly',
      category: 'payroll',
      is_active: true,
    });
  }

  const oneTimeItems = [
    { label: 'Annual Audit Fee', amount: '45000' },
    { label: 'Conference Sponsorship', amount: '28000' },
    { label: 'Hardware Refresh', amount: '67000' },
    { label: 'Regulatory Filing', amount: '15000' },
    { label: 'Office Renovation', amount: '120000' },
  ];
  for (let i = 0; i < oneTimeItems.length; i++) {
    obligations.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      label: oneTimeItems[i].label,
      amount_usd: oneTimeItems[i].amount,
      due_date: dateDaysFromNow(randInt(15, 82)),
      is_active: true,
    });
  }

  await supabase.from('manual_obligations').insert(obligations);

  // AI recommendations
  const recommendations = [
    {
      user_id: userId, enterprise_id: enterpriseId,
      total_bank_balance_usd: '1735000', total_crypto_balance_usd: '2150000',
      obligations_in_window_usd: '895000', safety_buffer_target_usd: '1342500',
      obligation_lookahead_days: 30, action: 'onramp', recommended_amount_usd: '500000',
      stablecoin_token: 'USDC', stablecoin_chain: 'ethereum',
      ai_reasoning: 'Projected obligations of $895K in the next 30 days require maintaining a safety buffer of $1.34M (1.5x multiplier). Current crypto balance of $2.15M provides adequate coverage, but an onramp of $500K from bank reserves would optimize the buffer for upcoming payroll cycles.',
      ai_model: 'claude-sonnet-4-6', status: 'executed', executed_at: daysAgo(56), created_at: daysAgo(57),
    },
    {
      user_id: userId, enterprise_id: enterpriseId,
      total_bank_balance_usd: '2235000', total_crypto_balance_usd: '2650000',
      obligations_in_window_usd: '420000', safety_buffer_target_usd: '630000',
      obligation_lookahead_days: 30, action: 'offramp', recommended_amount_usd: '200000',
      stablecoin_token: 'USDC', stablecoin_chain: 'ethereum',
      ai_reasoning: 'Crypto holdings exceed the safety buffer target by $2.02M. Recommend offramping $200K to bank accounts to reduce on-chain exposure while maintaining comfortable coverage.',
      ai_model: 'claude-sonnet-4-6', status: 'executed', executed_at: daysAgo(21), created_at: daysAgo(22),
    },
    {
      user_id: userId, enterprise_id: enterpriseId,
      total_bank_balance_usd: '2035000', total_crypto_balance_usd: '2450000',
      obligations_in_window_usd: '380000', safety_buffer_target_usd: '570000',
      obligation_lookahead_days: 30, action: 'no_action', recommended_amount_usd: '0',
      ai_reasoning: 'Current balances are well-positioned. The safety buffer is maintained at 4.3x the target. No rebalancing needed at this time.',
      ai_model: 'claude-sonnet-4-6', status: 'executed', created_at: daysAgo(7),
    },
    {
      user_id: userId, enterprise_id: enterpriseId,
      total_bank_balance_usd: '1835000', total_crypto_balance_usd: '2250000',
      obligations_in_window_usd: '920000', safety_buffer_target_usd: '1380000',
      obligation_lookahead_days: 30, action: 'onramp', recommended_amount_usd: '350000',
      stablecoin_token: 'USDC', stablecoin_chain: 'ethereum',
      ai_reasoning: 'Upcoming payroll cycle and annual audit fee require $920K in the next 30 days. An onramp of $350K will maintain the 1.5x safety buffer through the high-obligation period.',
      ai_model: 'claude-sonnet-4-6', status: 'pending_approval', requires_approval: true, created_at: daysAgo(1),
    },
    {
      user_id: userId, enterprise_id: enterpriseId,
      total_bank_balance_usd: '2135000', total_crypto_balance_usd: '2450000',
      obligations_in_window_usd: '650000', safety_buffer_target_usd: '975000',
      obligation_lookahead_days: 30, action: 'offramp', recommended_amount_usd: '150000',
      stablecoin_token: 'USDC', stablecoin_chain: 'ethereum',
      ai_reasoning: 'Moderate obligation window. Suggest offramping $150K to optimize bank-to-crypto ratio and reduce smart contract risk exposure.',
      ai_model: 'claude-sonnet-4-6', status: 'rejected', rejected_at: daysAgo(28),
      rejection_reason: 'Prefer to maintain higher on-chain liquidity for upcoming vendor payments', created_at: daysAgo(30),
    },
  ];

  await supabase.from('ai_recommendations').insert(recommendations);

  // Treasury forecast
  const forecastData: any[] = [];
  let runningBalance = 2150000;
  for (let d = 0; d < 90; d++) {
    const dailyChange = rand(-30000, 25000);
    runningBalance += dailyChange;
    forecastData.push({
      day: d, date: dateDaysFromNow(d),
      projected_balance: Math.round(runningBalance),
      obligations_due: d % 14 === 0 ? 180000 : d % 30 < 5 ? rand(5000, 25000) : 0,
    });
  }

  await supabase.from('treasury_forecasts').insert({
    user_id: userId, enterprise_id: enterpriseId,
    lookahead_days: 90, forecast_data: forecastData,
    ai_summary: 'Projected cash flow remains healthy over the 90-day window. Key pressure points: biweekly payroll cycles and the annual audit fee due in ~45 days. Recommend maintaining current onramp cadence. Risk level: LOW.',
    generated_at: new Date().toISOString(),
  });

  // Simulation run
  await supabase.from('simulation_runs').insert({
    user_id: userId, enterprise_id: enterpriseId,
    rule_snapshot: { safety_buffer_multiplier: 1.5, obligation_lookahead_days: 30, target_stablecoin: 'USDC', target_chain: 'ethereum', approval_threshold_usd: 100000 },
    results: [
      { scenario: 'base', end_balance: 2450000, min_balance: 1900000, shortfall_days: 0 },
      { scenario: 'stress_-20%', end_balance: 1960000, min_balance: 1420000, shortfall_days: 0 },
      { scenario: 'stress_-40%', end_balance: 1470000, min_balance: 940000, shortfall_days: 3 },
    ],
    summary: { total_scenarios: 3, scenarios_with_shortfall: 1, worst_case_min_balance: 940000, recommendation: 'Current treasury position is resilient under moderate stress. Consider increasing buffer if 40% drawdown scenario is a concern.' },
  });
}
