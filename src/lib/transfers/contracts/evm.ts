import { parseUnits, isAddress } from 'viem';
import { ERC20_ABI } from '@/lib/yield/contracts/abis';
import { TOKEN_ADDRESSES, TOKEN_DECIMALS } from '@/lib/yield/contracts/addresses';

export type SupportedEvmToken = 'USDC' | 'USDT';

export interface Erc20TransferArgs {
  address: `0x${string}`;
  abi: typeof ERC20_ABI;
  functionName: 'transfer';
  args: readonly [`0x${string}`, bigint];
}

/**
 * Builds wagmi writeContract args for an ERC20.transfer(to, amount) call.
 * Throws on invalid inputs so the hook can surface a clean error to the user
 * before asking them to sign anything.
 */
export function buildErc20TransferArgs(
  token: SupportedEvmToken,
  to: string,
  amountDecimal: string,
): Erc20TransferArgs {
  const tokenAddress = TOKEN_ADDRESSES[token];
  if (!tokenAddress) {
    throw new Error(`Unsupported token: ${token}`);
  }
  if (!isAddress(to)) {
    throw new Error(`Invalid recipient address: ${to}`);
  }

  const decimals = TOKEN_DECIMALS[token] ?? 6;
  let amountWei: bigint;
  try {
    amountWei = parseUnits(amountDecimal, decimals);
  } catch {
    throw new Error(`Invalid amount: ${amountDecimal}`);
  }

  if (amountWei <= BigInt(0)) {
    throw new Error('Amount must be greater than zero');
  }

  return {
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [to as `0x${string}`, amountWei] as const,
  };
}
