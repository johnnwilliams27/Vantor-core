/**
 * Bridge (Stripe) mock adapter.
 * Shaped after Bridge's real API: POST /v0/transfers
 * https://apidocs.bridge.xyz
 */
import type { IBankingAdapter, RampQuoteParams, RampQuote, RampExecuteParams, RampResult } from '../interface';

const RATE = 0.9985;   // $0.9985 per stablecoin token
const FEE_PCT = 0.0015; // 0.15%

export class BridgeMockAdapter implements IBankingAdapter {
  async getRampQuote(params: RampQuoteParams): Promise<RampQuote> {
    await delay(300);

    const supportedTokens = ['USDC', 'USDT', 'PYUSD'];
    if (!supportedTokens.includes(params.cryptoToken)) {
      throw new Error(`Unsupported token: ${params.cryptoToken}`);
    }

    let cryptoAmount: number;
    let fiatAmount: number;

    if (params.direction === 'offramp') {
      // Selling crypto → fiat
      cryptoAmount = params.cryptoAmount ?? (params.fiatAmount! / RATE);
      fiatAmount = params.fiatAmount ?? (cryptoAmount * RATE);
    } else {
      // Buying crypto with fiat (onramp)
      fiatAmount = params.fiatAmount ?? (params.cryptoAmount! * RATE);
      cryptoAmount = params.cryptoAmount ?? (fiatAmount / RATE);
    }

    const feeAmount = parseFloat((fiatAmount * FEE_PCT).toFixed(2));

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

    return {
      cryptoAmount: parseFloat(cryptoAmount.toFixed(6)),
      fiatAmount: parseFloat(fiatAmount.toFixed(2)),
      exchangeRate: RATE,
      feeAmount,
      expiresAt,
    };
  }

  async executeRamp(params: RampExecuteParams): Promise<RampResult> {
    await delay(400);

    // Mock Bridge transfer response shape
    const bridgeTransferId = `brg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const source = params.direction === 'offramp'
      ? { currency: params.cryptoToken, payment_rail: 'ethereum' }
      : { currency: params.fiatCurrency, payment_rail: 'ach' };

    const destination = params.direction === 'offramp'
      ? { currency: params.fiatCurrency, payment_rail: 'ach', bank_account: params.bankAccountRef }
      : { currency: params.cryptoToken, payment_rail: 'ethereum' };

    // Simulate Bridge transfer shape
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
