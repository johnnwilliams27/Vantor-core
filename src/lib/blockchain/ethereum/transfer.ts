import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  encodeFunctionData,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { ETH_TOKEN_ADDRESSES } from '@/types/blockchain';
import type { TokenSymbol } from '@/types/database';

const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const TOKEN_DECIMALS: Record<TokenSymbol, number> = {
  USDC: 6,
  USDT: 6,
  PYUSD: 6,
};

export async function transferEthereumToken(
  fromPrivateKey: string,
  toAddress: string,
  token: TokenSymbol,
  humanAmount: string
): Promise<string> {
  const account = privateKeyToAccount(fromPrivateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http(process.env.ETHEREUM_RPC_URL),
  });

  const contractAddress = ETH_TOKEN_ADDRESSES[token];
  const decimals = TOKEN_DECIMALS[token];
  const amount = parseUnits(humanAmount, decimals);

  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [toAddress as `0x${string}`, amount],
  });

  return hash;
}
