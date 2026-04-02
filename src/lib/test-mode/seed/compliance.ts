// src/lib/test-mode/seed/compliance.ts
import { SeedContext, daysAgo, rand, randInt, pick, ethHash } from './helpers';
import type { WalletIds } from './wallets';
import type { TransactionIds } from './transactions';

export async function seedCompliance(ctx: SeedContext, walletIds: WalletIds, txIds: TransactionIds): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;
  if (!walletIds.ethWallets.length || !walletIds.solWallets.length) return;

  // Sanctions screenings
  const allAddresses = [
    ...walletIds.ethWallets.map(w => ({ address: w.address, chain: 'ethereum' })),
    ...walletIds.solWallets.map(w => ({ address: w.address, chain: 'solana' })),
    { address: '0xEXTsuspect1111111111111111111111111111', chain: 'ethereum' },
    { address: '0xEXTclean2222222222222222222222222222222', chain: 'ethereum' },
    { address: '0xEXTpartial333333333333333333333333333', chain: 'ethereum' },
    { address: 'EXTso1cleanAddr111111111111111111111111111', chain: 'solana' },
  ];

  const screeningRows = allAddresses.map((addr, i) => {
    let result: string;
    let riskScore: number;
    let matchDetails = null;

    if (i < 5) {
      result = 'clear'; riskScore = rand(0, 5);
    } else if (i === allAddresses.length - 3) {
      result = 'sanctioned'; riskScore = 95;
      matchDetails = { matched_list: 'OFAC SDN', matched_entity: 'Test Sanctioned Entity', confidence: 0.98 };
    } else if (i === allAddresses.length - 1) {
      result = 'partial_match'; riskScore = rand(35, 65);
      matchDetails = { matched_list: 'EU Sanctions', matched_entity: 'Similar Name Corp', confidence: 0.42 };
    } else {
      result = 'clear'; riskScore = rand(0, 15);
    }

    return {
      user_id: userId, enterprise_id: enterpriseId,
      address: addr.address, chain: addr.chain,
      result, risk_score: riskScore, match_details: matchDetails,
      provider: 'chainalysis', screened_at: daysAgo(randInt(0, 60)),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  });

  await supabase.from('sanctions_screenings').insert(screeningRows);

  // KYT transfers
  const kytRows: any[] = [];
  for (let i = 0; i < 12; i++) {
    const isSent = Math.random() > 0.4;
    const isEth = Math.random() > 0.35;
    const wallet = isEth ? pick(walletIds.ethWallets) : pick(walletIds.solWallets);
    const riskScore = i < 8 ? rand(0.1, 15) : rand(25, 75);
    const categories = ['exchange', 'defi', 'unknown', 'mining', 'gambling', 'mixer'];
    const txId = txIds.transactionIds.length > i ? txIds.transactionIds[i] : null;

    kytRows.push({
      user_id: userId, enterprise_id: enterpriseId,
      external_id: `kyt-test-${String(i + 1).padStart(3, '0')}`,
      chain: isEth ? 'ethereum' : 'solana',
      direction: isSent ? 'sent' : 'received',
      tx_hash: ethHash(),
      from_address: isSent ? wallet.address : `0xEXT${ethHash().slice(4)}`,
      to_address: isSent ? `0xEXT${ethHash().slice(4)}` : wallet.address,
      token: pick(['USDC', 'USDT']),
      amount: rand(5000, 200000).toFixed(2),
      asset_amount_usd: rand(5000, 200000).toFixed(2),
      risk_score: parseFloat(riskScore.toFixed(1)),
      cluster_name: riskScore > 20 ? pick(['Suspicious Exchange', 'High Risk Pool']) : pick(['Coinbase', 'Uniswap V3', 'Circle', 'Binance']),
      cluster_category: riskScore > 20 ? pick(['gambling', 'mixer', 'unknown']) : pick(categories.slice(0, 4)),
      transaction_id: txId,
      registered_at: daysAgo(randInt(1, 80)),
    });
  }

  const { data: kytTransfers } = await supabase.from('kyt_transfers').insert(kytRows).select('id, risk_score');

  // KYT alerts for high-risk transfers
  const highRiskTransfers = kytTransfers?.filter(t => t.risk_score > 20) || [];
  const alertStatuses = ['open', 'under_review', 'escalated', 'resolved', 'dismissed'];
  const alertRows = highRiskTransfers.map((t, i) => ({
    user_id: userId, enterprise_id: enterpriseId,
    kyt_transfer_id: t.id,
    external_alert_id: `alert-test-${String(i + 1).padStart(3, '0')}`,
    severity: t.risk_score > 60 ? 'severe' : t.risk_score > 40 ? 'high' : 'medium',
    status: alertStatuses[i % alertStatuses.length],
    category: 'suspicious_activity',
    description: t.risk_score > 60
      ? 'Transfer involves address associated with known mixer service'
      : 'Transfer counterparty flagged for unusual activity patterns',
    reviewed_by: i % 3 === 0 ? userId : null,
    reviewed_at: i % 3 === 0 ? daysAgo(randInt(0, 5)) : null,
    review_notes: i % 3 === 0 ? 'Reviewed — counterparty is a known OTC desk, false positive' : null,
  }));

  if (alertRows.length) {
    await supabase.from('kyt_alerts').insert(alertRows);
  }

  // Travel rule transfers
  const travelRuleStatuses = ['accepted', 'sent', 'received', 'rejected', 'pending', 'accepted'];
  const travelRuleRows = travelRuleStatuses.map((status, i) => {
    const isOutgoing = i % 2 === 0;
    const transferId = txIds.transferIds.length > i ? txIds.transferIds[i] : null;

    return {
      user_id: userId, enterprise_id: enterpriseId,
      transfer_id: transferId,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      amount_usd: rand(15000, 300000).toFixed(2),
      originator_name: isOutgoing ? 'Test Enterprise LLC' : `External Corp ${i}`,
      originator_address: isOutgoing ? '123 Test St, New York, NY' : `${randInt(1, 999)} External Ave, London, UK`,
      originator_wallet: isOutgoing ? pick(walletIds.ethWallets).address : `0xEXT${ethHash().slice(4)}`,
      originator_chain: 'ethereum',
      originator_vasp: isOutgoing ? 'vantor' : pick(['fireblocks', 'circle', 'coinbase']),
      beneficiary_name: isOutgoing ? `Vendor ${i + 1} GmbH` : 'Test Enterprise LLC',
      beneficiary_address: isOutgoing ? `${randInt(1, 999)} Vendor Str, Berlin, DE` : '123 Test St, New York, NY',
      beneficiary_wallet: isOutgoing ? `0xEXT${ethHash().slice(4)}` : pick(walletIds.ethWallets).address,
      beneficiary_chain: 'ethereum',
      beneficiary_vasp: isOutgoing ? pick(['fireblocks', 'circle', 'binance']) : 'vantor',
      status,
      provider_ref: `tr-test-${String(i + 1).padStart(3, '0')}`,
      error_message: status === 'rejected' ? 'Beneficiary VASP rejected — incomplete originator data' : null,
      sent_at: ['sent', 'accepted', 'received'].includes(status) ? daysAgo(randInt(1, 60)) : null,
      received_at: ['accepted', 'received'].includes(status) ? daysAgo(randInt(0, 55)) : null,
    };
  });

  await supabase.from('travel_rule_transfers').insert(travelRuleRows);
}
