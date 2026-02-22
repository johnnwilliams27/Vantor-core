import type { SwapQuoteResponse } from '@/types/api';
import type { TokenSymbol } from '@/types/database';
import { SOL_TOKEN_ADDRESSES } from '@/types/blockchain';
import Big from 'big.js';

const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6';

const TOKEN_DECIMALS: Record<TokenSymbol, number> = {
  USDC: 6,
  USDT: 6,
  PYUSD: 6,
};

export async function getJupiterQuote(
  fromToken: TokenSymbol,
  toToken: TokenSymbol,
  humanAmount: string,
  slippageBps = 50
): Promise<SwapQuoteResponse> {
  const inputMint = SOL_TOKEN_ADDRESSES[fromToken];
  const outputMint = SOL_TOKEN_ADDRESSES[toToken];
  const decimals = TOKEN_DECIMALS[fromToken];
  const amount = new Big(humanAmount).times(new Big(10).pow(decimals)).toFixed(0);

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: String(slippageBps),
    swapMode: 'ExactIn',
  });

  const res = await fetch(`${JUPITER_QUOTE_API}/quote?${params}`);
  if (!res.ok) throw new Error(`Jupiter quote failed: ${res.statusText}`);
  const data = await res.json();

  const outDecimals = TOKEN_DECIMALS[toToken];
  const toAmount = new Big(data.outAmount)
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
    priceImpact: data.priceImpactPct?.toString(),
    quoteData: data,
  };
}

export async function executeJupiterSwap(
  quoteData: Record<string, unknown>,
  walletPublicKey: string
): Promise<{ txHash: string }> {
  // Get serialized transaction from Jupiter
  const swapRes = await fetch(`${JUPITER_QUOTE_API}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quoteData,
      userPublicKey: walletPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });

  if (!swapRes.ok) throw new Error(`Jupiter swap tx failed: ${swapRes.statusText}`);
  const swapData = await swapRes.json();

  // Note: in practice the browser wallet signs + sends this tx
  // Server-side execution would require private key
  return { txHash: swapData.swapTransaction };
}
