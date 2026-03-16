/**
 * Bridge (Stripe) mock adapter.
 * Shaped after Bridge's real API: POST /v0/transfers
 * https://apidocs.bridge.xyz
 *
 * Supports multi-currency off-ramps (USD, EUR, GBP).
 * For non-USD currencies, applies FX conversion on top of the stablecoin rate.
 */
import type { IBankingAdapter, RampQuoteParams, RampQuote, RampExecuteParams, RampResult } from '../interface';
import { getFxRate, type FiatCurrency } from '@/lib/fx/rates';

const STABLECOIN_RATE = 0.9985; // $0.9985 USD per stablecoin token
const FEE_PCT = 0.0015;         // 0.15% fee

export class BridgeMockAdapter implements IBankingAdapter {
  async getRampQuote(params: RampQuoteParams): Promise<RampQuote> {
    await delay(300);

    const supportedTokens = ['USDC', 'USDT', 'PYUSD'];
    if (!supportedTokens.includes(params.cryptoToken)) {
      throw new Error(`Unsupported token: ${params.cryptoToken}`);
    }

    const fiatCurrency = (params.fiatCurrency ?? 'USD') as FiatCurrency;
    // FX rate: USD → target fiat currency
    const fxRate = getFxRate('USD', fiatCurrency);
    // Effective rate: stablecoin → target fiat
    const effectiveRate = STABLECOIN_RATE * fxRate;

    let cryptoAmount: number;
    let fiatAmount: number;

    if (params.direction === 'offramp') {
      // Selling crypto → fiat
      cryptoAmount = params.cryptoAmount ?? (params.fiatAmount! / effectiveRate);
      fiatAmount = params.fiatAmount ?? (cryptoAmount * effectiveRate);
    } else {
      // Buying crypto with fiat (onramp)
      fiatAmount = params.fiatAmount ?? (params.cryptoAmount! * effectiveRate);
      cryptoAmount = params.cryptoAmount ?? (fiatAmount / effectiveRate);
    }

    const feeAmount = parseFloat((fiatAmount * FEE_PCT).toFixed(2));

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    return {
      cryptoAmount: parseFloat(cryptoAmount.toFixed(6)),
      fiatAmount: parseFloat(fiatAmount.toFixed(2)),
      exchangeRate: parseFloat(effectiveRate.toFixed(6)),
      feeAmount,
      fiatCurrency,
      fxRate: fxRate !== 1 ? parseFloat(fxRate.toFixed(6)) : undefined,
      expiresAt,
    };
  }

  async executeRamp(params: RampExecuteParams): Promise<RampResult> {
    await delay(400);

    const bridgeTransferId = `brg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const source = params.direction === 'offramp'
      ? { currency: params.cryptoToken, payment_rail: 'ethereum' }
      : { currency: params.fiatCurrency, payment_rail: 'ach' };

    const destination = params.direction === 'offramp'
      ? { currency: params.fiatCurrency, payment_rail: params.fiatCurrency === 'USD' ? 'ach' : 'sepa', bank_account: params.bankAccountRef }
      : { currency: params.cryptoToken, payment_rail: 'ethereum' };

    const _bridgeResponse = {
      id: bridgeTransferId,
      status: 'payment_submitted',
      source,
      destination,
      amount: params.direction === 'offramp' ? params.cryptoAmount : params.fiatAmount,
      created_at: new Date().toISOString(),
    };

    return {
      providerTransactionId: bridgeTransferId,
      status: 'completed',
      settledAt: new Date().toISOString(),
    };
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
