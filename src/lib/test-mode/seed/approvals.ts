import type { SeedContext } from './helpers';
import { daysAgo, daysFromNow } from './helpers';

export async function seedApprovals(
  ctx: SeedContext,
  v3Id: string,
  chainId: string,
): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  const slotShape = (filled: boolean, index: number, role: string, justification?: string) => ({
    slot_index: index,
    minimum_role: role,
    filled_by: filled ? userId : null,
    filled_at: filled ? daysAgo(1) : null,
    justification: filled ? (justification ?? 'Approved in line with policy') : null,
  });

  // ProposedMovement shape (from src/lib/policy/types/movement.ts):
  //   { id, kind, source:{venue,asset}, destination:{venue,asset,address?},
  //     amount:{amount:string, asset}, initiator, requested_at }
  // Valid kind values: crypto_transfer | fiat_ramp | yield_deposit |
  // yield_withdraw | swap | bridge | payment.
  const shortEnt = enterpriseId.slice(0, 8);
  const humanInitiator = { type: 'human' as const, user_id: userId };

  const rows = [
    // 1. Pending — $750K off-ramp (fiat_ramp), 1 day old
    {
      enterprise_id: enterpriseId, version_id: v3Id, chain_id: chainId,
      movement_id: `seed-approval-pending-1-${shortEnt}`,
      proposed_movement: {
        id: `seed-mov-pending-1-${shortEnt}`,
        kind: 'fiat_ramp',
        source: { venue: 'ethereum', asset: 'USDC' },
        destination: { venue: 'bank_jpmorgan', asset: 'USD', label: 'JPMorgan Operating' },
        amount: { amount: '750000', asset: 'USDC' },
        initiator: humanInitiator,
        metadata: { direction: 'offramp' },
        requested_at: daysAgo(1),
      },
      triggered_rule_ids: [],
      slot_assignments: [slotShape(false, 0, 'treasury_manager'), slotShape(false, 1, 'executive')],
      status: 'pending', expires_at: daysFromNow(2), created_by: userId, created_at: daysAgo(1),
    },
    // 2. Pending — $600K yield deposit on Aave, 3 hours old
    {
      enterprise_id: enterpriseId, version_id: v3Id, chain_id: chainId,
      movement_id: `seed-approval-pending-2-${shortEnt}`,
      proposed_movement: {
        id: `seed-mov-pending-2-${shortEnt}`,
        kind: 'yield_deposit',
        source: { venue: 'ethereum', asset: 'USDC' },
        destination: { venue: 'aave_v3', asset: 'aUSDC', label: 'Aave v3 (Ethereum)' },
        amount: { amount: '600000', asset: 'USDC' },
        initiator: humanInitiator,
        requested_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      },
      triggered_rule_ids: [],
      slot_assignments: [slotShape(false, 0, 'treasury_manager'), slotShape(false, 1, 'executive')],
      status: 'pending', expires_at: daysFromNow(2), created_by: userId,
      created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    },
    // 3. Approved — $300K vendor wire (payment), approved 2d ago
    {
      enterprise_id: enterpriseId, version_id: v3Id, chain_id: chainId,
      movement_id: `seed-approval-approved-1-${shortEnt}`,
      proposed_movement: {
        id: `seed-mov-approved-1-${shortEnt}`,
        kind: 'payment',
        source: { venue: 'bank_jpmorgan', asset: 'USD', label: 'JPMorgan Operating' },
        destination: { venue: 'external_wire', asset: 'USD', label: 'Q1 audit firm wire' },
        amount: { amount: '300000', asset: 'USD' },
        initiator: humanInitiator,
        requested_at: daysAgo(2),
      },
      triggered_rule_ids: [],
      slot_assignments: [
        slotShape(true, 0, 'treasury_manager', 'Vendor verified'),
        slotShape(true, 1, 'executive', 'Q1 audit — approved per board pre-auth'),
      ],
      status: 'approved', expires_at: daysFromNow(2), created_by: userId,
      created_at: daysAgo(2), approved_at: daysAgo(2), resolved_at: daysAgo(2),
      resolution_notes: { note: 'Vendor payment — Q1 audit firm' },
    },
    // 4. Approved — $1.2M intra-wallet rebalance (crypto_transfer), approved 5d ago
    {
      enterprise_id: enterpriseId, version_id: v3Id, chain_id: chainId,
      movement_id: `seed-approval-approved-2-${shortEnt}`,
      proposed_movement: {
        id: `seed-mov-approved-2-${shortEnt}`,
        kind: 'crypto_transfer',
        source: { venue: 'ethereum', asset: 'USDC', label: 'Hot wallet' },
        destination: { venue: 'ethereum', asset: 'USDC', address: '0x0000000000000000000000000000000000000000', label: 'Cold wallet' },
        amount: { amount: '1200000', asset: 'USDC' },
        initiator: humanInitiator,
        requested_at: daysAgo(5),
      },
      triggered_rule_ids: [],
      slot_assignments: [
        slotShape(true, 0, 'treasury_manager', 'Rebalance per monthly policy'),
        slotShape(true, 1, 'executive', 'Approved'),
      ],
      status: 'approved', expires_at: daysFromNow(2), created_by: userId,
      created_at: daysAgo(5), approved_at: daysAgo(5), resolved_at: daysAgo(5),
      resolution_notes: { note: 'Routine monthly rebalance' },
    },
    // 5. Denied — $450K yield withdraw, denied 1d ago
    {
      enterprise_id: enterpriseId, version_id: v3Id, chain_id: chainId,
      movement_id: `seed-approval-denied-1-${shortEnt}`,
      proposed_movement: {
        id: `seed-mov-denied-1-${shortEnt}`,
        kind: 'yield_withdraw',
        source: { venue: 'morpho_reservoir', asset: 'bbqUSDCreservoir', label: 'Morpho Reservoir' },
        destination: { venue: 'ethereum', asset: 'USDC', label: 'Operating wallet' },
        amount: { amount: '450000', asset: 'USDC' },
        initiator: humanInitiator,
        requested_at: daysAgo(1),
      },
      triggered_rule_ids: [],
      slot_assignments: [
        slotShape(true, 0, 'treasury_manager', 'Denying — better rates expected'),
        slotShape(false, 1, 'executive'),
      ],
      status: 'denied', denial_reason: 'manual', expires_at: daysFromNow(2), created_by: userId,
      created_at: daysAgo(1), resolved_at: daysAgo(1),
      resolution_notes: { note: 'Better rates expected next week per treasury-ai insight' },
    },
    // 6. Denied — $2.1M cross-chain bridge, denied 6d ago
    {
      enterprise_id: enterpriseId, version_id: v3Id, chain_id: chainId,
      movement_id: `seed-approval-denied-2-${shortEnt}`,
      proposed_movement: {
        id: `seed-mov-denied-2-${shortEnt}`,
        kind: 'bridge',
        source: { venue: 'ethereum', asset: 'USDC', label: 'Ethereum hot wallet' },
        destination: { venue: 'solana', asset: 'USDC', label: 'Solana hot wallet' },
        amount: { amount: '2100000', asset: 'USDC' },
        initiator: humanInitiator,
        requested_at: daysAgo(6),
      },
      triggered_rule_ids: [],
      slot_assignments: [
        slotShape(true, 0, 'treasury_manager', 'Exceeds hard limit'),
        slotShape(false, 1, 'executive'),
      ],
      status: 'denied', denial_reason: 'manual', expires_at: daysFromNow(2), created_by: userId,
      created_at: daysAgo(6), resolved_at: daysAgo(6),
      resolution_notes: { note: 'Exceeds daily outflow hard limit ($2M)' },
    },
  ];

  const { error } = await supabase.from('policy_approval_requests').insert(rows);
  if (error) console.error('[seed:approvals] insert failed', error);
  else console.log('[seed:approvals] ✓ 6 approval requests (2 pending, 2 approved, 2 denied)');
}
