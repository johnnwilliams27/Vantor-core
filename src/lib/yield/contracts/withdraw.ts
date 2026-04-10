import { parseUnits, maxUint256 } from 'viem';
import type { YieldProtocolId } from '../interface';
import { AAVE_V3_POOL_ABI, COMPOUND_V3_COMET_ABI, ERC4626_VAULT_ABI } from './abis';
import { buildMorphoWithdrawArgs, CURATED_MARKETS } from './morpho-blue';
import {
  TOKEN_ADDRESSES,
  TOKEN_DECIMALS,
  PROTOCOL_ADDRESSES,
  COMPOUND_COMET_BY_TOKEN,
} from './addresses';

// Minimal ABI for Ondo's requestRedemption
const ONDO_ABI = [
  {
    name: 'requestRedemption',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
] as const;

export interface WithdrawTxArgs {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}

/**
 * Builds the wagmi writeContract arguments for a withdrawal from the given yield protocol.
 *
 * @param protocol        - The YieldProtocolId to withdraw from.
 * @param token           - Token symbol (e.g. "USDC").
 * @param amount          - Human-readable amount string (e.g. "500.00"). Ignored when isFullWithdrawal is true for protocols that support it.
 * @param walletAddress   - The withdrawer's wallet address.
 * @param isFullWithdrawal - When true, uses MAX_UINT256 to redeem the entire position (Aave, ERC-4626).
 */
export function buildWithdrawTx(
  protocol: YieldProtocolId,
  token: string,
  amount: string,
  walletAddress: `0x${string}`,
  isFullWithdrawal: boolean = false,
): WithdrawTxArgs {
  const protocolConfig = PROTOCOL_ADDRESSES[protocol];
  if (!protocolConfig) throw new Error(`No contract config for protocol: ${protocol}`);

  const tokenAddress = TOKEN_ADDRESSES[token];
  if (!tokenAddress) throw new Error(`Unknown token: ${token}`);

  const decimals = TOKEN_DECIMALS[token];
  if (decimals === undefined) throw new Error(`Unknown token decimals for: ${token}`);

  const amountBigInt = isFullWithdrawal ? maxUint256 : parseUnits(amount, decimals);

  switch (protocolConfig.type) {
    case 'aave': {
      // Aave uses MAX_UINT256 to signal full position withdrawal
      return {
        address: protocolConfig.router,
        abi: AAVE_V3_POOL_ABI,
        functionName: 'withdraw',
        args: [tokenAddress, amountBigInt, walletAddress],
      };
    }

    case 'compound': {
      // Compound Comet does not support MAX_UINT256; always use the exact amount
      const cometAddress = COMPOUND_COMET_BY_TOKEN[token];
      if (!cometAddress) throw new Error(`No Compound Comet for token: ${token}`);
      const compoundAmount = isFullWithdrawal ? parseUnits(amount, decimals) : amountBigInt;
      return {
        address: cometAddress,
        abi: COMPOUND_V3_COMET_ABI,
        functionName: 'withdraw',
        args: [tokenAddress, compoundAmount],
      };
    }

    case 'erc4626': {
      // ERC-4626 withdraw(assets, receiver, owner) — MAX_UINT256 triggers full withdrawal
      return {
        address: protocolConfig.router,
        abi: ERC4626_VAULT_ABI,
        functionName: 'withdraw',
        args: [amountBigInt, walletAddress, walletAddress],
      };
    }

    case 'ondo': {
      // Ondo uses a request-based redemption flow; amount is always explicit
      const ondoAmount = isFullWithdrawal ? parseUnits(amount, decimals) : amountBigInt;
      return {
        address: protocolConfig.router,
        abi: ONDO_ABI,
        functionName: 'requestRedemption',
        args: [ondoAmount],
      };
    }

    case 'morpho_blue': {
      const market = CURATED_MARKETS.find(m => m.token === token);
      if (!market) throw new Error(`No curated Morpho Blue market for ${token}`);
      return buildMorphoWithdrawArgs(market.params, token, amount, walletAddress, isFullWithdrawal);
    }

    default: {
      const _exhaustive: never = protocolConfig.type;
      throw new Error(`Unhandled protocol type: ${_exhaustive}`);
    }
  }
}
