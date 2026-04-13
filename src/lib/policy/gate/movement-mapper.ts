// src/lib/policy/gate/movement-mapper.ts
//
// Pure, sync mappers from route-level input to canonical ProposedMovement.
// One per MovementKind. Each:
//   1. Generates a fresh UUID as movement.id (= row PK + approval.movement_id)
//   2. Populates source/destination endpoints with the right VenueId/AssetCode
//   3. Stashes ctx.enterpriseId in metadata (the gate enforces this is present)
//   4. Passes counterparty + memo through when present
//
// Gate never sees raw route bodies — everything flows through here.

import { randomUUID } from 'crypto';
import type { ProposedMovement, MovementEndpoint, Initiator } from '../types/movement';
import type { AssetCode, VenueId } from '../types/assets';

/**
 * Input shape accepted by `mapTransferToMovement`. Mirrors the zod-validated
 * body of POST /api/transfers. Chain and token are narrowed to the same
 * enum values as the route-level schema.
 */
export interface TransferMovementInput {
  fromWalletId: string;
  toAddress: string;
  chain: 'ethereum' | 'solana';
  token: 'USDC' | 'USDT';
  amount: string;
  memo?: string;
  counterpartyId?: string;
}

export interface MapperContext {
  userId: string;
  enterpriseId: string;
  fromAddress: string; // resolved from the wallet lookup
}

/**
 * Pure mapper: transfer request body + context → ProposedMovement.
 * Generates a fresh UUID as the movement.id, which will also serve as
 * transfers.id (PK) and policy_approval_requests.movement_id.
 */
export function mapTransferToMovement(
  input: TransferMovementInput,
  ctx: MapperContext,
): ProposedMovement {
  const id = randomUUID();

  const source: MovementEndpoint = {
    venue: input.chain as VenueId,
    asset: input.token as AssetCode,
    address: ctx.fromAddress,
  };

  const destination: MovementEndpoint = {
    venue: input.chain as VenueId,
    asset: input.token as AssetCode,
    address: input.toAddress,
  };

  const initiator: Initiator = {
    type: 'human',
    user_id: ctx.userId,
  };

  // Stash enterprise_id in metadata so the gate's defensive isolation
  // check has something to compare against.
  const metadata: Record<string, unknown> = {
    enterprise_id: ctx.enterpriseId,
    ...(input.memo ? { memo: input.memo } : {}),
  };

  return {
    id,
    kind: 'crypto_transfer',
    source,
    destination,
    amount: {
      amount: input.amount,
      asset: input.token as AssetCode,
    },
    initiator,
    requested_at: new Date().toISOString(),
    metadata,
    ...(input.counterpartyId
      ? { counterparty: { id: input.counterpartyId, type: 'known' as const } }
      : {}),
  };
}

// ─── Yield deposit ──────────────────────────────────────────────────────

export interface YieldDepositMovementInput {
  protocol: string;
  token: 'USDC' | 'USDT';
  amount: string;
  walletAddress: string;
  chain: 'ethereum' | 'solana';
  vaultAddress?: string;
}

export function mapYieldDepositToMovement(
  input: YieldDepositMovementInput,
  ctx: MapperContext,
): ProposedMovement {
  const id = randomUUID();

  const source: MovementEndpoint = {
    venue: input.chain as VenueId,
    asset: input.token as AssetCode,
    address: input.walletAddress,
  };

  // Yield destination uses the protocol id as the venue label so rules
  // can filter on destination.venue (e.g., block deposits into a
  // specific protocol). Address is the vault contract when known.
  const destination: MovementEndpoint = {
    venue: input.protocol as VenueId,
    asset: input.token as AssetCode,
    ...(input.vaultAddress ? { address: input.vaultAddress } : {}),
    label: input.protocol,
  };

  const initiator: Initiator = { type: 'human', user_id: ctx.userId };

  return {
    id,
    kind: 'yield_deposit',
    source,
    destination,
    amount: { amount: input.amount, asset: input.token as AssetCode },
    initiator,
    requested_at: new Date().toISOString(),
    metadata: { enterprise_id: ctx.enterpriseId, protocol: input.protocol },
  };
}

// ─── Yield withdraw ─────────────────────────────────────────────────────

export interface YieldWithdrawMovementInput {
  positionId: string;
  protocol: string;
  token: 'USDC' | 'USDT';
  amount: string;
  walletAddress: string;
  chain: 'ethereum' | 'solana';
}

export function mapYieldWithdrawToMovement(
  input: YieldWithdrawMovementInput,
  ctx: MapperContext,
): ProposedMovement {
  const id = randomUUID();

  const source: MovementEndpoint = {
    venue: input.protocol as VenueId,
    asset: input.token as AssetCode,
    label: input.protocol,
  };

  const destination: MovementEndpoint = {
    venue: input.chain as VenueId,
    asset: input.token as AssetCode,
    address: input.walletAddress,
  };

  const initiator: Initiator = { type: 'human', user_id: ctx.userId };

  return {
    id,
    kind: 'yield_withdraw',
    source,
    destination,
    amount: { amount: input.amount, asset: input.token as AssetCode },
    initiator,
    requested_at: new Date().toISOString(),
    metadata: {
      enterprise_id: ctx.enterpriseId,
      protocol: input.protocol,
      position_id: input.positionId,
    },
  };
}

// ─── Ramp (fiat onramp/offramp) ─────────────────────────────────────────

export interface RampMovementInput {
  direction: 'onramp' | 'offramp';
  cryptoToken: 'USDC' | 'USDT';
  cryptoAmount: string;
  fiatCurrency: string;
  fiatAmount?: string;
  bankAccountId: string;
  walletAddress?: string;
  memo?: string;
}

/**
 * Ramp mapper. Direction determines which endpoint is the bank vs chain.
 *   - offramp: crypto → fiat (source = wallet, destination = bank)
 *   - onramp:  fiat → crypto (source = bank, destination = wallet)
 * Amount is recorded in the crypto leg (consistent with transfers).
 */
export function mapRampToMovement(
  input: RampMovementInput,
  ctx: MapperContext,
): ProposedMovement {
  const id = randomUUID();

  const chainEndpoint: MovementEndpoint = {
    venue: 'ethereum' as VenueId, // Rail inferred at execution; gate treats venue at asset level
    asset: input.cryptoToken as AssetCode,
    ...(input.walletAddress ? { address: input.walletAddress } : {}),
  };

  const bankEndpoint: MovementEndpoint = {
    venue: 'bank' as VenueId,
    asset: input.fiatCurrency as AssetCode,
    account_id: input.bankAccountId,
  };

  const source = input.direction === 'offramp' ? chainEndpoint : bankEndpoint;
  const destination = input.direction === 'offramp' ? bankEndpoint : chainEndpoint;

  const initiator: Initiator = { type: 'human', user_id: ctx.userId };

  return {
    id,
    kind: 'fiat_ramp',
    source,
    destination,
    amount: { amount: input.cryptoAmount, asset: input.cryptoToken as AssetCode },
    initiator,
    requested_at: new Date().toISOString(),
    metadata: {
      enterprise_id: ctx.enterpriseId,
      direction: input.direction,
      fiat_currency: input.fiatCurrency,
      ...(input.fiatAmount ? { fiat_amount: input.fiatAmount } : {}),
      ...(input.memo ? { memo: input.memo } : {}),
    },
  };
}

// ─── Fiat payment (bank-to-bank) ────────────────────────────────────────

export interface FiatPaymentMovementInput {
  fromBankAccountId: string;
  toBankName: string;
  toAccountNumber: string;
  toRoutingNumber: string;
  toAccountHolder: string;
  amount: string;
  currency: string;
  memo?: string;
  invoiceId?: string;
}

export function mapFiatPaymentToMovement(
  input: FiatPaymentMovementInput,
  ctx: MapperContext,
): ProposedMovement {
  const id = randomUUID();

  const source: MovementEndpoint = {
    venue: 'bank' as VenueId,
    asset: input.currency as AssetCode,
    account_id: input.fromBankAccountId,
  };

  // Destination bank is an external unlinked account; we only have
  // routing+account details, no stored bank_account_id. Use a synthetic
  // label derived from the routing/account so rules can at least pattern
  // match on counterparty banks.
  const destination: MovementEndpoint = {
    venue: 'bank' as VenueId,
    asset: input.currency as AssetCode,
    label: `${input.toBankName} ****${input.toAccountNumber.slice(-4)}`,
  };

  const initiator: Initiator = { type: 'human', user_id: ctx.userId };

  return {
    id,
    kind: 'payment',
    source,
    destination,
    amount: { amount: input.amount, asset: input.currency as AssetCode },
    initiator,
    requested_at: new Date().toISOString(),
    metadata: {
      enterprise_id: ctx.enterpriseId,
      currency: input.currency,
      to_bank_name: input.toBankName,
      to_routing_number: input.toRoutingNumber,
      to_account_last4: input.toAccountNumber.slice(-4),
      ...(input.memo ? { memo: input.memo } : {}),
      ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}),
    },
  };
}

// ─── Swap ──────────────────────────────────────────────────────────────

export interface SwapMovementInput {
  walletAddress: string;
  chain: 'ethereum' | 'solana';
  fromToken: 'USDC' | 'USDT';
  toToken: 'USDC' | 'USDT';
  fromAmount: string;
}

export function mapSwapToMovement(
  input: SwapMovementInput,
  ctx: MapperContext,
): ProposedMovement {
  const id = randomUUID();

  const source: MovementEndpoint = {
    venue: input.chain as VenueId,
    asset: input.fromToken as AssetCode,
    address: input.walletAddress,
  };

  const destination: MovementEndpoint = {
    venue: input.chain as VenueId,
    asset: input.toToken as AssetCode,
    address: input.walletAddress,
  };

  const initiator: Initiator = { type: 'human', user_id: ctx.userId };

  return {
    id,
    kind: 'swap',
    source,
    destination,
    amount: { amount: input.fromAmount, asset: input.fromToken as AssetCode },
    initiator,
    requested_at: new Date().toISOString(),
    metadata: {
      enterprise_id: ctx.enterpriseId,
      chain: input.chain,
      from_token: input.fromToken,
      to_token: input.toToken,
    },
  };
}

// ─── Bridge (cross-chain same token) ────────────────────────────────────

export interface BridgeMovementInput {
  fromWalletAddress: string;
  toWalletAddress: string;
  fromChain: 'ethereum' | 'solana';
  toChain: 'ethereum' | 'solana';
  token: 'USDC' | 'USDT';
  amount: string;
}

export function mapBridgeToMovement(
  input: BridgeMovementInput,
  ctx: MapperContext,
): ProposedMovement {
  const id = randomUUID();

  const source: MovementEndpoint = {
    venue: input.fromChain as VenueId,
    asset: input.token as AssetCode,
    address: input.fromWalletAddress,
  };

  const destination: MovementEndpoint = {
    venue: input.toChain as VenueId,
    asset: input.token as AssetCode,
    address: input.toWalletAddress,
  };

  const initiator: Initiator = { type: 'human', user_id: ctx.userId };

  return {
    id,
    kind: 'bridge',
    source,
    destination,
    amount: { amount: input.amount, asset: input.token as AssetCode },
    initiator,
    requested_at: new Date().toISOString(),
    metadata: {
      enterprise_id: ctx.enterpriseId,
      from_chain: input.fromChain,
      to_chain: input.toChain,
    },
  };
}

// ─── Scheduled operation ────────────────────────────────────────────────

export interface ScheduledOperationMovementInput {
  scheduledOpId: string;
  type: 'swap' | 'bridge' | 'ramp';
  /** Inner movement built by the matching per-kind mapper. */
  inner: ProposedMovement;
}

/**
 * Scheduled-op mapper reuses the inner per-kind mapper's source/destination
 * and overrides initiator to 'schedule'. This lets policy rules key on the
 * same fields as the synchronous flow but distinguish the execution mode.
 *
 * movement.id IS the scheduled_operations.id. Keeping them identical
 * preserves the cross-domain invariant that approval_request.movement_id
 * can be used directly to look up the held domain row — no metadata
 * detour required.
 */
export function mapScheduledOperationToMovement(
  input: ScheduledOperationMovementInput,
  ctx: MapperContext,
): ProposedMovement {
  return {
    ...input.inner,
    id: input.scheduledOpId,
    initiator: { type: 'schedule', scheduled_op_id: input.scheduledOpId },
    metadata: {
      ...(input.inner.metadata ?? {}),
      enterprise_id: ctx.enterpriseId,
      scheduled_op_id: input.scheduledOpId,
      scheduled_op_type: input.type,
    },
  };
}
