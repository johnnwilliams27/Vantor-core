import type { SwapQuoteResponse } from '@/types/api';
import type { TokenSymbol } from '@/types/database';
import { ETH_TOKEN_ADDRESSES } from '@/types/blockchain';
import Big from 'big.js';

const ONEINCH_BASE = 'https://api.1inch.dev/fusion-plus/quoter/v1.0/1'; // chainId=1 (mainnet)

const TOKEN_DECIMALS: Record<TokenSymbol, number> = {
  USDC: 6,
  USDT: 6,
  PYUSD: 6,
};

export async function getOneInchQuote(
  fromToken: TokenSymbol,
  toToken: TokenSymbol,
  humanAmount: string,
  walletAddress: string,
  slippageBps = 50
): Promise<SwapQuoteResponse> {
  const srcToken = ETH_TOKEN_ADDRESSES[fromToken];
  const dstToken = ETH_TOKEN_ADDRESSES[toToken];
  const decimals = TOKEN_DECIMALS[fromToken];
  const amount = new Big(humanAmount).times(new Big(10).pow(decimals)).toFixed(0);

  const apiKey = process.env.ONEINCH_API_KEY;
  if (!apiKey) throw new Error('ONEINCH_API_KEY not set');

  const params = new URLSearchParams({
    fromTokenAddress: srcToken,
    toTokenAddress: dstToken,
    amount,
    walletAddress,
    slippage: String(slippageBps / 100),
  });

  const res = await fetch(`${ONEINCH_BASE}/quote/receive?${params}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) throw new Error(`1inch quote failed: ${res.statusText}`);
  const data = await res.json();

  const outDecimals = TOKEN_DECIMALS[toToken];
  const toAmount = new Big(data.toTokenAmount ?? data.dstAmount ?? '0')
    .div(new Big(10).pow(outDecimals))
    .toFixed(6);

  const rate = new Big(toAmount).div(new Big(humanAmount)).toFixed(8);

  return {
    fromToken,
    toToken,
    fromAmount: humanAmount,
    toAmount,
    rate,
    slippageBps,
    quoteData: data,
  };
}

export async function executeOneInchSwap(
  quoteData: Record<string, unknown>,
  _walletAddress: string
): Promise<{ txHash: string }> {
  const apiKey = process.env.ONEINCH_API_KEY;
  if (!apiKey) throw new Error('ONEINCH_API_KEY not set');

  // Fusion+ creates an order; actual signing happens in the browser
  // Return the order hash as a reference
  const txHash = (quoteData.orderHash as string) ?? `fusion-${Date.now()}`;
  return { txHash };
}
