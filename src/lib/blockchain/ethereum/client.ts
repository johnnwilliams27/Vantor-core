import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

export function getEthereumClient() {
  return createPublicClient({
    chain: mainnet,
    transport: http(process.env.ETHEREUM_RPC_URL),
  });
}
