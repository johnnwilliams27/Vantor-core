import type { TokenSymbol } from '@/types/database';

const ETHERSCAN_API = 'https://api.etherscan.io/api';

export interface EtherscanTx {
  hash: string;
  blockNumber: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  gasUsed: string;
  gasPrice: string;
  timeStamp: string;
  contractAddress?: string;
}

export async function fetchEthereumHistory(
  address: string,
  token: TokenSymbol,
  page = 1,
  limit = 25
): Promise<EtherscanTx[]> {
  const contractAddress = {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    PYUSD: '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8',
  }[token];

  const params = new URLSearchParams({
    module: 'account',
    action: 'tokentx',
    contractaddress: contractAddress,
    address,
    page: String(page),
    offset: String(limit),
    sort: 'desc',
    apikey: process.env.ETHERSCAN_API_KEY ?? '',
  });

  const res = await fetch(`${ETHERSCAN_API}?${params}`);
  const data = await res.json();
  if (data.status !== '1') return [];
  return data.result as EtherscanTx[];
}
