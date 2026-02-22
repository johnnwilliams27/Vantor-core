import type { TokenSymbol } from '@/types/database';

const HELIUS_API = 'https://api.helius.xyz/v0';

export interface HeliusTx {
  signature: string;
  slot: number;
  timestamp: number;
  feePayer: string;
  fee: number;
  nativeTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    mint: string;
    tokenAmount: number;
    tokenStandard: string;
  }>;
  type: string;
  source: string;
}

export async function fetchSolanaHistory(
  address: string,
  _token: TokenSymbol,
  limit = 25
): Promise<HeliusTx[]> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('HELIUS_API_KEY not set');

  const res = await fetch(
    `${HELIUS_API}/addresses/${address}/transactions?api-key=${apiKey}&limit=${limit}`,
    { method: 'GET' }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}
