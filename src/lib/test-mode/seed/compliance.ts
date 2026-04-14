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

  const ssErr = (await supabase.from('sanctions_screenings').insert(screeningRows)).error;
  if (ssErr) throw new Error(`seedCompliance: sanctions_screenings insert failed: ${ssErr.message}`);

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

  const kytRes = await supabase.from('kyt_transfers').insert(kytRows).select('id, risk_score');
  if (kytRes.error) throw new Error(`seedCompliance: kyt_transfers insert failed: ${kytRes.error.message}`);
  const kytTransfers = kytRes.data;

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
    const { error } = await supabase.from('kyt_alerts').insert(alertRows);
    if (error) throw new Error(`seedCompliance: kyt_alerts insert failed: ${error.message}`);
  }

}
