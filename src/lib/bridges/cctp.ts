/**
 * Circle CCTP (Cross-Chain Transfer Protocol) adapter for USDC.
 *
 * CCTP enables native USDC burns on the source chain and mints on the
 * destination chain. No wrapped tokens — native USDC on both sides.
 *
 * Production:
 * - Ethereum → Solana: ~15 minutes (finality + attestation)
 * - Solana → Ethereum: ~20 minutes
 * - Fee: Gas only (no protocol fee)
 *
 * Contracts:
 * - Ethereum TokenMessenger: 0xBd3fa81B58Ba92a82136038B25aDec7066af3155
 * - Solana TokenMessenger: CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd
 */

import type { IBridgeAdapter, BridgeQuoteParams, BridgeQuoteResponse, BridgeExecuteParams, BridgeExecuteResult } from './interface';

const CCTP_FEES: Record<string, number> = {
  'ethereum_solana': 0, // Gas-only, no protocol fee
  'solana_ethereum': 0,
};

const CCTP_TIMES: Record<string, number> = {
  'ethereum_solana': 15,
  'solana_ethereum': 20,
};

export class CctpAdapter implements IBridgeAdapter {
  async getQuote(params: BridgeQuoteParams): Promise<BridgeQuoteResponse> {
    await new Promise((r) => setTimeout(r, 300)); // Simulate network

    const routeKey = `${params.fromChain}_${params.toChain}`;
    const fee = CCTP_FEES[routeKey] ?? 0;
    const amount = parseFloat(params.amount);
    const toAmount = amount - fee;

    return {
      token: params.token,
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromAmount: params.amount,
      toAmount: toAmount.toFixed(6),
      bridgeFee: fee.toFixed(6),
      estimatedTimeMinutes: CCTP_TIMES[routeKey] ?? 15,
      provider: 'cctp',
      quoteData: {
        mock: true,
        protocol: 'cctp',
        route: routeKey,
        attestationService: 'https://iris-api.circle.com',
      },
    };
  }

  async execute(params: BridgeExecuteParams): Promise<BridgeExecuteResult> {
    await new Promise((r) => setTimeout(r, 500)); // Simulate execution

    const routeKey = `${params.fromChain}_${params.toChain}`;
    const fakeTxHash = params.fromChain === 'ethereum'
      ? `0xcctp${Buffer.from(Date.now().toString()).toString('hex').slice(0, 58)}`
      : `cctp${Buffer.from(Date.now().toString()).toString('hex').slice(0, 60)}`;

    return {
      txHash: fakeTxHash,
      provider: 'cctp',
      status: 'pending', // CCTP transfers are async (burn → attest → mint)
      estimatedArrivalMinutes: CCTP_TIMES[routeKey] ?? 15,
    };
  }
}
