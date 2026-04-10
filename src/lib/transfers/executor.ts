import type { Transfer } from '@/types/database';

/**
 * Server-side transfer execution — currently NOT IMPLEMENTED.
 *
 * On-chain transfers are driven by the client via the user's connected wallet:
 *   1. POST /api/transfers    → creates a pending transfer row, returns transferId
 *   2. Client signs + submits → useOnChainTransfer / useSolanaTransfer
 *   3. POST /api/transfers/confirm → records the completed transfer with tx hash
 *
 * This file is a placeholder for future unattended execution (scheduled transfers,
 * agent-driven transfers) which will require a server-side signing solution — most
 * likely an HSM/KMS-backed hot wallet with tight guardrails.
 *
 * Until that exists, scheduled transfers are blocked at the API layer and immediate
 * transfers go through the user-signed client flow.
 */
export async function executeTransfer(_transfer: Transfer): Promise<never> {
  throw new Error(
    'Server-side transfer execution is not implemented. ' +
      'Transfers must be signed via the user\'s connected wallet through /api/transfers/confirm.',
  );
}
