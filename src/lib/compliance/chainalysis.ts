import type {
  IComplianceAdapter,
  SanctionsScreenResult,
  KytRegisterParams,
  KytTransferResult,
} from './interface';

const CHAIN_MAP: Record<string, string> = {
  ethereum: 'ETH',
  solana: 'SOL',
};

export class ChainalysisAdapter implements IComplianceAdapter {
  private sanctionsBaseUrl: string;
  private kytBaseUrl: string;
  private sanctionsApiKey: string;
  private kytApiKey: string;

  constructor() {
    this.sanctionsBaseUrl =
      process.env.CHAINALYSIS_SANCTIONS_BASE_URL ?? 'https://public.chainalysis.com/api/v1';
    this.kytBaseUrl =
      process.env.CHAINALYSIS_KYT_BASE_URL ?? 'https://api.chainalysis.com/api/kyt/v2';

    this.sanctionsApiKey = process.env.CHAINALYSIS_SANCTIONS_API_KEY ?? '';
    this.kytApiKey = process.env.CHAINALYSIS_KYT_API_KEY ?? '';
  }

  async screenAddress(address: string, chain: string): Promise<SanctionsScreenResult> {
    if (!this.sanctionsApiKey) {
      throw new Error('CHAINALYSIS_SANCTIONS_API_KEY is not configured');
    }

    const res = await fetch(`${this.sanctionsBaseUrl}/address/${address}`, {
      headers: { 'X-API-Key': this.sanctionsApiKey },
    });

    if (!res.ok) {
      return {
        address,
        chain,
        result: 'error',
        riskScore: null,
        identifications: [],
      };
    }

    const data = await res.json();
    const identifications: SanctionsScreenResult['identifications'] =
      (data.identifications ?? []).map((id: Record<string, unknown>) => ({
        category: String(id.category ?? 'unknown'),
        name: String(id.name ?? ''),
        description: String(id.description ?? ''),
        url: id.url ? String(id.url) : null,
      }));

    const isSanctioned = identifications.length > 0;

    return {
      address,
      chain,
      result: isSanctioned ? 'sanctioned' : 'clear',
      riskScore: isSanctioned ? 100 : 0,
      identifications,
    };
  }

  async registerTransfer(params: KytRegisterParams): Promise<KytTransferResult> {
    if (!this.kytApiKey) {
      throw new Error('CHAINALYSIS_KYT_API_KEY is not configured');
    }

    const endpoint =
      params.direction === 'sent' ? 'transfers/sent' : 'transfers/received';

    const body = {
      network: CHAIN_MAP[params.chain] ?? params.chain.toUpperCase(),
      asset: params.asset,
      transferReference: params.externalId,
      tx: params.txHash,
      idx: 0,
      outputAddress: params.toAddress,
      ...(params.direction === 'received' ? { inputAddress: params.fromAddress } : {}),
      amount: params.amount,
      amountUSD: params.amountUsd,
      timestamp: params.timestamp,
    };

    const res = await fetch(`${this.kytBaseUrl}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Token: this.kytApiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`KYT registration failed: ${res.status} ${errText}`);
    }

    const data = await res.json();

    return {
      externalId: params.externalId,
      riskScore: data.rating?.value ?? null,
      clusterName: data.cluster?.name ?? null,
      clusterCategory: data.cluster?.category ?? null,
      alerts: (data.alerts ?? []).map((a: Record<string, unknown>) => ({
        alertId: String(a.alertId ?? ''),
        severity: String(a.severity ?? 'low') as 'low' | 'medium' | 'high' | 'severe',
        category: String(a.category ?? ''),
        description: String(a.description ?? ''),
      })),
      rawResponse: data,
    };
  }

  async getTransferAlerts(externalId: string): Promise<KytTransferResult> {
    if (!this.kytApiKey) {
      throw new Error('CHAINALYSIS_KYT_API_KEY is not configured');
    }

    const res = await fetch(`${this.kytBaseUrl}/transfers/${externalId}`, {
      headers: { Token: this.kytApiKey },
    });

    if (!res.ok) {
      throw new Error(`KYT alert fetch failed: ${res.status}`);
    }

    const data = await res.json();

    return {
      externalId,
      riskScore: data.rating?.value ?? null,
      clusterName: data.cluster?.name ?? null,
      clusterCategory: data.cluster?.category ?? null,
      alerts: (data.alerts ?? []).map((a: Record<string, unknown>) => ({
        alertId: String(a.alertId ?? ''),
        severity: String(a.severity ?? 'low') as 'low' | 'medium' | 'high' | 'severe',
        category: String(a.category ?? ''),
        description: String(a.description ?? ''),
      })),
      rawResponse: data,
    };
  }

}
