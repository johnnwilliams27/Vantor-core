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

  // Stablecoin swaps (USDC ↔ USDT) are not supported by Bridge. Confirmed
  // against their documented endpoint inventory on 2026-04-11 — Bridge is a
  // fiat ↔ crypto orchestration platform, not a DEX, and has no swap or
  // quote primitive. The previous implementation POSTed to /v0/quotes/swap
  // and /v0/swaps, neither of which exist on Bridge's API, which is why
  // production swap requests surfaced as opaque 502s (wrapping a gateway
  // 400 with empty body). A real DEX aggregator (0x / 1inch for EVM,
  // Jupiter for Solana) will be wired up as a separate adapter in a future
  // PR. The /swaps page shows a Coming Soon placeholder and
  // /api/swaps/{quote,execute} POST return 501, so these methods should
  // never actually be invoked in production.
  async getSwapQuote(_params: SwapQuoteParams): Promise<SwapQuote> {
    throw new Error('Stablecoin swaps are temporarily disabled while we integrate a dedicated DEX aggregator.');
  }

  async executeSwap(_params: SwapExecuteParams): Promise<SwapResult> {
    throw new Error('Stablecoin swaps are temporarily disabled while we integrate a dedicated DEX aggregator.');
  }

  // Cross-chain bridging is not supported by Bridge either. Despite the
  // product name, Bridge.xyz does not offer a bridging primitive — cross
  // chain movement is LayerZero / Wormhole / Circle CCTP territory. The
  // previous implementation POSTed to /v0/quotes/bridge and /v0/transfers
  // with a `type: 'bridge'` field, neither of which are documented Bridge
  // endpoints. A real bridging provider will be wired up as a separate
  // adapter in a future PR. The /bridges page shows a Coming Soon
  // placeholder and /api/bridges/{quote,execute} POST return 501, so
  // these methods should never actually be invoked in production.
  async getBridgeQuote(_params: BridgeQuoteParams): Promise<BridgeQuote> {
    throw new Error('Cross-chain bridging is temporarily disabled while we integrate a dedicated bridging provider.');
  }

  async executeBridge(_params: BridgeExecuteParams): Promise<BridgeExecuteResult> {
    throw new Error('Cross-chain bridging is temporarily disabled while we integrate a dedicated bridging provider.');
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
