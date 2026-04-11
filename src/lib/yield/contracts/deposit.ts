import { parseUnits } from 'viem';
import type { YieldProtocolId } from '../interface';
import { AAVE_V3_POOL_ABI, COMPOUND_V3_COMET_ABI, ERC4626_VAULT_ABI } from './abis';
import {
  TOKEN_ADDRESSES,
  TOKEN_DECIMALS,
  PROTOCOL_ADDRESSES,
  COMPOUND_COMET_BY_TOKEN,
} from './addresses';

// Minimal ABI for Ondo's requestSubscription
const ONDO_ABI = [
  {
    name: 'requestSubscription',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
] as const;

export interface DepositTxArgs {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}

/**
 * Builds the wagmi writeContract arguments for a deposit/supply into the given yield protocol.
 *
 * @param protocol   - The YieldProtocolId to deposit into.
 * @param token      - Token symbol (e.g. "USDC").
 * @param amount     - Human-readable amount string (e.g. "1000.00").
 * @param walletAddress - The depositor's wallet address.
 */
export function buildDepositTx(
  protocol: YieldProtocolId,
  token: string,
  amount: string,
  walletAddress: `0x${string}`,
): DepositTxArgs {
  const protocolConfig = PROTOCOL_ADDRESSES[protocol];
  if (!protocolConfig) throw new Error(`No contract config for protocol: ${protocol}`);

  const tokenAddress = TOKEN_ADDRESSES[token];
  if (!tokenAddress) throw new Error(`Unknown token: ${token}`);

  const decimals = TOKEN_DECIMALS[token];
  if (decimals === undefined) throw new Error(`Unknown token decimals for: ${token}`);

  const amountBigInt = parseUnits(amount, decimals);

  switch (protocolConfig.type) {
    case 'aave': {
      return {
        address: protocolConfig.router,
        abi: AAVE_V3_POOL_ABI,
        functionName: 'supply',
        args: [tokenAddress, amountBigInt, walletAddress, 0],
      };
    }

    case 'compound': {
      const cometAddress = COMPOUND_COMET_BY_TOKEN[token];
      if (!cometAddress) throw new Error(`No Compound Comet for token: ${token}`);
      return {
        address: cometAddress,
        abi: COMPOUND_V3_COMET_ABI,
        functionName: 'supply',
        args: [tokenAddress, amountBigInt],
      };
    }

    case 'erc4626': {
      return {
        address: protocolConfig.router,
        abi: ERC4626_VAULT_ABI,
        functionName: 'deposit',
        args: [amountBigInt, walletAddress],
      };
    }

    case 'ondo_usdy': {
      return {
        address: protocolConfig.router,
        abi: ONDO_ABI,
        functionName: 'requestSubscription',
        args: [amountBigInt],
      };
    }

    default: {
      const _exhaustive: never = protocolConfig.type;
      throw new Error(`Unhandled protocol type: ${_exhaustive}`);
    }
  }
}
