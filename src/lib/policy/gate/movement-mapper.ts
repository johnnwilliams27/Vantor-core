// src/lib/policy/gate/movement-mapper.ts

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
