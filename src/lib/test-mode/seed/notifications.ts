import type { SeedContext } from './helpers';

export async function seedNotifications(ctx: SeedContext): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString();
  const daysAgoStr = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

  const rows = [
    // 5 UNREAD (newest first)
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'insight_critical', category: 'treasury',
      title: 'Liquidity buffer at risk', body: 'Buffer drops below 1.5× on day 7. Review recommended action.',
      metadata: {}, link: '/treasury', read: false, created_at: hoursAgo(2) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'approval_needed', category: 'approvals',
      title: 'Approval needed: $750K off-ramp', body: '2 approvers required per policy v3.',
      metadata: {}, link: '/approvals', read: false, created_at: hoursAgo(4) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'approval_needed', category: 'approvals',
      title: 'Approval needed: $600K yield deposit', body: 'Aave deposit pending approver action.',
      metadata: {}, link: '/approvals', read: false, created_at: daysAgoStr(1) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'policy_triggered', category: 'policy',
      title: 'Policy v3 activated', body: 'New rule: SoD required on yield deposits >$500K.',
      metadata: {}, link: '/policy', read: false, created_at: daysAgoStr(1) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'compliance_alert', category: 'compliance',
      title: 'KYT alert: unusual counterparty pattern', body: 'Review transfer to new counterparty.',
      metadata: {}, link: '/compliance', read: false, created_at: daysAgoStr(2) },
    // 5 READ
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'insight_critical', category: 'treasury',
      title: 'USDC concentration breach', body: '73% exceeds 60% limit.',
      metadata: {}, link: '/treasury', read: true, created_at: daysAgoStr(3) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'system', category: 'system',
      title: 'Xero ERP connected', body: 'Demo Company sync complete. 47 invoices imported.',
      metadata: {}, link: '/settings/erp', read: true, created_at: daysAgoStr(5) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'policy_triggered', category: 'policy',
      title: 'Policy v2 activated', body: 'Daily outflow cap $2M added.',
      metadata: {}, link: '/policy', read: true, created_at: daysAgoStr(7) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'approval_needed', category: 'approvals',
      title: 'Approval resolved: $300K vendor wire', body: 'Q1 audit firm payment approved.',
      metadata: {}, link: '/approvals', read: true, created_at: daysAgoStr(10) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'system', category: 'system',
      title: 'Welcome to Vantor', body: 'Your test enterprise is ready. Explore the demo data.',
      metadata: {}, link: '/', read: true, created_at: daysAgoStr(14) },
  ];

  const { error } = await supabase.from('notifications').insert(rows);
  if (error) console.error('[seed:notifications] insert failed', error);
  else console.log('[seed:notifications] ✓ 10 notifications (5 unread, 5 read)');
}
