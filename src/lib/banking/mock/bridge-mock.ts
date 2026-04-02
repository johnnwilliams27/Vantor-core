/**
 * Bridge.xyz (Stripe) unified mock adapter.
 * Handles ramps (fiat ↔ crypto), swaps (token → token), and bridges (cross-chain).
 *
 * In production, all three capabilities route through Bridge.xyz's Orchestration API:
 * - POST /v0/transfers (ramps)
 * - POST /v0/swaps (token swaps)
 * - POST /v0/transfers (cross-chain with auto bridge selection)
 *
 * https://apidocs.bridge.xyz
 */
import type {
  IBankingAdapter,
  RampQuoteParams, RampQuote, RampExecuteParams, RampResult,
  SwapQuoteParams, SwapQuote, SwapExecuteParams, SwapResult,
  BridgeQuoteParams, BridgeQuote, BridgeExecuteParams, BridgeExecuteResult,
  FiatPaymentParams, FiatPaymentResult, FiatPaymentStatusResult,
} from '../interface';
import { getFxRate, type FiatCurrency } from '@/lib/fx/rates';

const STABLECOIN_RATE = 0.9985; // $0.9985 USD per stablecoin token
const FEE_PCT = 0.0015;         // 0.15% fee
const SWAP_FEE_PCT = 0.001;     // 0.10% swap fee

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class BridgeMockAdapter implements IBankingAdapter {

  // ---- Ramps ----

  async getRampQuote(params: RampQuoteParams): Promise<RampQuote> {
    await delay(300);

    const fiatCurrency = (params.fiatCurrency ?? 'USD') as FiatCurrency;
    const fxRate = getFxRate('USD', fiatCurrency);
    const effectiveRate = STABLECOIN_RATE * fxRate;

    let cryptoAmount: number;
    let fiatAmount: number;

    if (params.direction === 'offramp') {
      cryptoAmount = params.cryptoAmount ?? (params.fiatAmount! / effectiveRate);
      fiatAmount = params.fiatAmount ?? (cryptoAmount * effectiveRate);
    } else {
      fiatAmount = params.fiatAmount ?? (params.cryptoAmount! * effectiveRate);
      cryptoAmount = params.cryptoAmount ?? (fiatAmount / effectiveRate);
    }

    const feeAmount = parseFloat((fiatAmount * FEE_PCT).toFixed(2));

    return {
      cryptoAmount: parseFloat(cryptoAmount.toFixed(6)),
      fiatAmount: parseFloat(fiatAmount.toFixed(2)),
      exchangeRate: parseFloat(effectiveRate.toFixed(6)),
      feeAmount,
      fiatCurrency,
      fxRate: fxRate !== 1 ? parseFloat(fxRate.toFixed(6)) : undefined,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
  }

  async executeRamp(params: RampExecuteParams): Promise<RampResult> {
    await delay(400);

    return {
      providerTransactionId: genId('brg_ramp'),
      status: 'completed',
      settledAt: new Date().toISOString(),
    };
  }

  // ---- Swaps (same chain, different token) ----

  async getSwapQuote(params: SwapQuoteParams): Promise<SwapQuote> {
    await delay(250);

    const fromAmount = params.amount;
    const fee = parseFloat(fromAmount) * SWAP_FEE_PCT;
    const toAmount = (parseFloat(fromAmount) - fee).toFixed(6);
    // Stablecoin-to-stablecoin: ~1:1 rate
    const rate = (parseFloat(toAmount) / parseFloat(fromAmount)).toFixed(8);

    return {
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount,
      toAmount,
      rate,
      slippageBps: params.slippageBps ?? 50,
      priceImpact: '0.01',
      feeAmount: fee.toFixed(6),
      quoteData: {
        provider: 'bridge',
        chain: params.chain,
        mock: true,
      },
    };
  }

  async executeSwap(params: SwapExecuteParams): Promise<SwapResult> {
    await delay(400);

    const fakeTxHash = params.chain === 'ethereum'
      ? `0xbrg_swap_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`
      : `brg_swap_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;

    return {
      txHash: fakeTxHash,
      providerRef: genId('brg_swap'),
      status: 'completed',
    };
  }

  // ---- Bridges (cross-chain, same token) ----

  async getBridgeQuote(params: BridgeQuoteParams): Promise<BridgeQuote> {
    await delay(300);

    const amount = parseFloat(params.amount);
    // Bridge.xyz handles protocol selection internally
    // USDC → CCTP under the hood, USDT → their liquidity network
    const isUsdc = params.token === 'USDC';
    const fee = isUsdc ? 0 : 1.50; // CCTP is fee-free, others have relay fees
    const toAmount = Math.max(0, amount - fee);

    const routeKey = `${params.fromChain}_${params.toChain}`;
    const estimatedTimes: Record<string, number> = {
      ethereum_solana: isUsdc ? 15 : 10,
      solana_ethereum: isUsdc ? 20 : 15,
    };

    return {
      token: params.token,
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromAmount: params.amount,
      toAmount: toAmount.toFixed(6),
      bridgeFee: fee.toFixed(6),
      estimatedTimeMinutes: estimatedTimes[routeKey] ?? 15,
      provider: 'bridge',
      quoteData: {
        provider: 'bridge',
        route: routeKey,
        internalProtocol: isUsdc ? 'cctp' : 'liquidity_network',
        mock: true,
      },
    };
  }

  async executeBridge(params: BridgeExecuteParams): Promise<BridgeExecuteResult> {
    await delay(500);

    const routeKey = `${params.fromChain}_${params.toChain}`;
    const isUsdc = params.token === 'USDC';
    const estimatedTimes: Record<string, number> = {
      ethereum_solana: isUsdc ? 15 : 10,
      solana_ethereum: isUsdc ? 20 : 15,
    };

    const fakeTxHash = params.fromChain === 'ethereum'
      ? `0xbrg_bridge_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`
      : `brg_bridge_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;

    return {
      txHash: fakeTxHash,
      providerRef: genId('brg_bridge'),
      status: 'pending', // Bridge transfers are async
      estimatedArrivalMinutes: estimatedTimes[routeKey] ?? 15,
    };
  }

  // ---- Fiat Payments (bank-to-bank) ----

  async createFiatPayment(params: FiatPaymentParams): Promise<FiatPaymentResult> {
    await delay(400);
    const now = new Date();
    let settleDays = 2;
    const dayOfWeek = now.getDay();
    if (dayOfWeek === 5) settleDays = 4;
    if (dayOfWeek === 6) settleDays = 3;
    if (dayOfWeek === 0) settleDays = 2;
    const estimated = new Date(now.getTime() + settleDays * 24 * 60 * 60 * 1000);
    return {
      providerPaymentId: genId('mock_fp'),
      status: 'pending',
      estimatedSettlement: estimated.toISOString(),
    };
  }

  async getFiatPaymentStatus(providerPaymentId: string): Promise<FiatPaymentStatusResult> {
    await delay(200);
    return { status: 'completed', settledAt: new Date().toISOString() };
  }
}
