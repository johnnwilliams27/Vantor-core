import type { PublicClient } from 'viem';
import { parseUnits } from 'viem';
import { ERC20_ABI } from './abis';
import { TOKEN_ADDRESSES, TOKEN_DECIMALS } from './addresses';

/**
 * Reads the current ERC-20 allowance granted by `owner` to `spender` for the given token symbol.
 */
export async function checkAllowance(
  publicClient: PublicClient,
  token: string,
  owner: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  const tokenAddress = TOKEN_ADDRESSES[token];
  if (!tokenAddress) throw new Error(`Unknown token: ${token}`);

  return publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, spender],
  });
}

/**
 * Returns true if the current allowance is less than the required `amount` (human-readable string).
 */
export async function needsApproval(
  publicClient: PublicClient,
  token: string,
  owner: `0x${string}`,
  spender: `0x${string}`,
  amount: string,
): Promise<boolean> {
  const decimals = TOKEN_DECIMALS[token];
  if (decimals === undefined) throw new Error(`Unknown token decimals for: ${token}`);

  const required = parseUnits(amount, decimals);
  const current = await checkAllowance(publicClient, token, owner, spender);
  return current < required;
}

/**
 * Builds the args object for wagmi's `writeContract` to approve an exact amount.
 * No infinite approvals — only the exact amount needed is approved.
 */
export function buildApproveArgs(
  token: string,
  spender: `0x${string}`,
  amount: string,
): {
  address: `0x${string}`;
  abi: typeof ERC20_ABI;
  functionName: 'approve';
  args: [`0x${string}`, bigint];
} {
  const tokenAddress = TOKEN_ADDRESSES[token];
  if (!tokenAddress) throw new Error(`Unknown token: ${token}`);

  const decimals = TOKEN_DECIMALS[token];
  if (decimals === undefined) throw new Error(`Unknown token decimals for: ${token}`);

  const amountBigInt = parseUnits(amount, decimals);

  return {
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, amountBigInt],
  };
}
