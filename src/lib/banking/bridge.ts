import type {
  IBankingAdapter,
  RampQuoteParams, RampQuote, RampExecuteParams, RampResult,
  SwapQuoteParams, SwapQuote, SwapExecuteParams, SwapResult,
  BridgeQuoteParams, BridgeQuote, BridgeExecuteParams, BridgeExecuteResult,
  FiatPaymentParams, FiatPaymentResult, FiatPaymentStatusResult,
} from './interface';
import { getCredential, type IntegrationMode } from '@/lib/env/integration-mode';
import { VANTOR_FEE_RATE } from '@/lib/billing/tiers';

const BRIDGE_API_URL_SANDBOX = 'https://api.sandbox.bridge.xyz';
const BRIDGE_API_URL_LIVE = 'https://api.bridge.xyz';

function getBaseUrl(mode: IntegrationMode): string {
  return mode === 'live' ? BRIDGE_API_URL_LIVE : BRIDGE_API_URL_SANDBOX;
}

// Bridge supports a developer fee that's auto-deducted at the rail and routed
// to the payout destination configured in the Bridge dashboard.
// VANTOR_FEE_RATE is 0.0025 (25 BPS); Bridge expects a percentage as a string.
const VANTOR_DEVELOPER_FEE_PCT = (VANTOR_FEE_RATE * 100).toFixed(4); // "0.2500"

function getApiKey(mode: IntegrationMode): string {
  return getCredential(
    mode,
    process.env.BRIDGE_API_KEY_SANDBOX,
    process.env.BRIDGE_API_KEY_LIVE,
  );
}

async function bridgeFetch(
  mode: IntegrationMode,
  path: string,
  options: RequestInit = {},
): Promise<any> {
  const apiKey = getApiKey(mode);
  const baseUrl = getBaseUrl(mode);
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': apiKey,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Bridge API error (${res.status}): ${err}`);
  }

  return res.json();
}

export class BridgeAdapter implements IBankingAdapter {
  constructor(private mode: IntegrationMode) {}

  async getRampQuote(params: RampQuoteParams): Promise<RampQuote> {
    const body: Record<string, unknown> = {
      type: params.direction === 'onramp' ? 'buy' : 'sell',
      currency: params.fiatCurrency || 'USD',
      crypto_currency: params.cryptoToken,
    };
    if (params.fiatAmount) body.amount = params.fiatAmount;
    if (params.cryptoAmount) body.crypto_amount = params.cryptoAmount;

    const data = await bridgeFetch(this.mode, '/v0/quotes', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      cryptoAmount: data.crypto_amount ?? data.destination_amount ?? 0,
      fiatAmount: data.fiat_amount ?? data.source_amount ?? 0,
      exchangeRate: data.exchange_rate ?? data.rate ?? 1,
      feeAmount: data.fee ?? data.total_fee ?? 0,
      fiatCurrency: data.currency ?? params.fiatCurrency,
      fxRate: data.fx_rate,
      expiresAt: data.expires_at ?? new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }

  async executeRamp(params: RampExecuteParams): Promise<RampResult> {
    const data = await bridgeFetch(this.mode, '/v0/transfers', {
      method: 'POST',
      body: JSON.stringify({
        type: params.direction === 'onramp' ? 'buy' : 'sell',
        currency: params.fiatCurrency,
        crypto_currency: params.cryptoToken,
        amount: params.fiatAmount,
        crypto_amount: params.cryptoAmount,
        source_payment_rail: params.bankAccountRef,
        developer_fee_percent: VANTOR_DEVELOPER_FEE_PCT,
      }),
    });

    return {
      providerTransactionId: data.id ?? data.transfer_id,
      status: data.status ?? 'pending',
      settledAt: data.settled_at ?? null,
    };
  }

  async getSwapQuote(params: SwapQuoteParams): Promise<SwapQuote> {
    const data = await bridgeFetch(this.mode, '/v0/quotes/swap', {
      method: 'POST',
      body: JSON.stringify({
        chain: params.chain,
        from_currency: params.fromToken,
        to_currency: params.toToken,
        amount: params.amount,
        slippage_bps: params.slippageBps ?? 50,
        wallet_address: params.walletAddress,
      }),
    });

    return {
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: params.amount,
      toAmount: String(data.to_amount ?? data.destination_amount ?? '0'),
      rate: String(data.rate ?? data.exchange_rate ?? '1'),
      slippageBps: data.slippage_bps ?? params.slippageBps ?? 50,
      priceImpact: data.price_impact ? String(data.price_impact) : undefined,
      feeAmount: data.fee ? String(data.fee) : undefined,
      quoteData: { quoteId: data.id, ...data },
    };
  }

  async executeSwap(params: SwapExecuteParams): Promise<SwapResult> {
    const data = await bridgeFetch(this.mode, '/v0/swaps', {
      method: 'POST',
      body: JSON.stringify({
        chain: params.chain,
        from_currency: params.fromToken,
        to_currency: params.toToken,
        amount: params.fromAmount,
        wallet_address: params.walletAddress,
        quote_id: params.quoteData.quoteId,
        developer_fee_percent: VANTOR_DEVELOPER_FEE_PCT,
      }),
    });

    return {
      txHash: data.tx_hash ?? data.transaction_hash ?? null,
      providerRef: data.id ?? data.swap_id,
      status: data.status === 'completed' ? 'completed' : 'pending',
    };
  }

  async getBridgeQuote(params: BridgeQuoteParams): Promise<BridgeQuote> {
    const data = await bridgeFetch(this.mode, '/v0/quotes/bridge', {
      method: 'POST',
      body: JSON.stringify({
        currency: params.token,
        amount: params.amount,
        source_chain: params.fromChain,
        destination_chain: params.toChain,
        wallet_address: params.walletAddress,
      }),
    });

    return {
      token: params.token,
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromAmount: params.amount,
      toAmount: String(data.destination_amount ?? data.to_amount ?? params.amount),
      bridgeFee: String(data.fee ?? data.bridge_fee ?? '0'),
      estimatedTimeMinutes: data.estimated_time_minutes ?? data.eta_minutes ?? 15,
      provider: 'bridge',
      quoteData: { quoteId: data.id, ...data },
    };
  }

  async executeBridge(params: BridgeExecuteParams): Promise<BridgeExecuteResult> {
    const data = await bridgeFetch(this.mode, '/v0/transfers', {
      method: 'POST',
      body: JSON.stringify({
        type: 'bridge',
        currency: params.token,
        amount: params.amount,
        source_chain: params.fromChain,
        destination_chain: params.toChain,
        wallet_address: params.walletAddress,
        quote_id: params.quoteData.quoteId,
        developer_fee_percent: VANTOR_DEVELOPER_FEE_PCT,
      }),
    });

    return {
      txHash: data.tx_hash ?? data.transaction_hash ?? null,
      providerRef: data.id ?? data.transfer_id,
      status: data.status === 'completed' ? 'completed' : 'pending',
      estimatedArrivalMinutes: data.estimated_time_minutes ?? 15,
    };
  }

  async createFiatPayment(_params: FiatPaymentParams): Promise<FiatPaymentResult> {
    // Bank-to-bank fiat payments are not supported by Bridge. Probing the
    // /v0/transfers endpoint with every fiat-to-fiat rail combination returned
    // "route from source -> destination not currently supported" — Bridge only
    // supports fiat<->crypto routes (used by ramps and the yield flow). A
    // dedicated bank payment provider (Modern Treasury / Column / Increase)
    // will handle bank-to-bank in a future PR. The /payments page shows a
    // Coming Soon placeholder and /api/payments POST returns 501, so this
    // method should never actually be invoked in production.
    throw new Error('Bank payments are temporarily disabled while we integrate a new payment provider.');
  }

  async getFiatPaymentStatus(_providerPaymentId: string): Promise<FiatPaymentStatusResult> {
    throw new Error('Bank payments are temporarily disabled while we integrate a new payment provider.');
  }
}
