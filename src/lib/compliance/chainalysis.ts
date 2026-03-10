import type {
  IComplianceAdapter,
  SanctionsScreenResult,
  KytRegisterParams,
  KytTransferResult,
  TravelRuleCreateParams,
  TravelRuleResult,
} from './interface';

const CHAIN_MAP: Record<string, string> = {
  ethereum: 'ETH',
  solana: 'SOL',
};

export class ChainalysisAdapter implements IComplianceAdapter {
  private sanctionsBaseUrl: string;
  private kytBaseUrl: string;
  private travelRuleBaseUrl: string;
  private sanctionsApiKey: string;
  private kytApiKey: string;
  private travelRuleApiKey: string;

  constructor() {
    this.sanctionsBaseUrl =
      process.env.CHAINALYSIS_SANCTIONS_BASE_URL ?? 'https://public.chainalysis.com/api/v1';
    this.kytBaseUrl =
      process.env.CHAINALYSIS_KYT_BASE_URL ?? 'https://api.chainalysis.com/api/kyt/v2';
    this.travelRuleBaseUrl =
      process.env.CHAINALYSIS_TRAVEL_RULE_BASE_URL ?? 'https://api.chainalysis.com/api/travel-rule/v1';

    this.sanctionsApiKey = process.env.CHAINALYSIS_SANCTIONS_API_KEY ?? '';
    this.kytApiKey = process.env.CHAINALYSIS_KYT_API_KEY ?? '';
    this.travelRuleApiKey = process.env.CHAINALYSIS_TRAVEL_RULE_API_KEY ?? '';
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

  async submitTravelRule(params: TravelRuleCreateParams): Promise<TravelRuleResult> {
    if (!this.travelRuleApiKey) {
      throw new Error('CHAINALYSIS_TRAVEL_RULE_API_KEY is not configured');
    }

    const body = {
      direction: params.direction,
      assetAmountUSD: params.amountUsd,
      originator: {
        name: params.originatorName,
        address: params.originatorAddress ?? null,
        walletAddress: params.originatorWallet,
        chain: CHAIN_MAP[params.originatorChain] ?? params.originatorChain.toUpperCase(),
        vaspName: params.originatorVasp ?? process.env.TRAVEL_RULE_VASP_NAME ?? 'Vantor Treasury',
      },
      beneficiary: {
        name: params.beneficiaryName,
        address: params.beneficiaryAddress ?? null,
        walletAddress: params.beneficiaryWallet,
        chain: CHAIN_MAP[params.beneficiaryChain] ?? params.beneficiaryChain.toUpperCase(),
        vaspName: params.beneficiaryVasp ?? null,
      },
      txHash: params.txHash ?? null,
    };

    const res = await fetch(`${this.travelRuleBaseUrl}/transfers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Token: this.travelRuleApiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Travel Rule submission failed: ${res.status} ${errText}`);
    }

    const data = await res.json();

    return {
      providerRef: data.id ?? data.transferReference ?? '',
      status: mapTravelRuleStatus(data.status),
      rawResponse: data,
    };
  }

  async getTravelRuleStatus(providerRef: string): Promise<TravelRuleResult> {
    if (!this.travelRuleApiKey) {
      throw new Error('CHAINALYSIS_TRAVEL_RULE_API_KEY is not configured');
    }

    const res = await fetch(`${this.travelRuleBaseUrl}/transfers/${providerRef}`, {
      headers: { Token: this.travelRuleApiKey },
    });

    if (!res.ok) {
      throw new Error(`Travel Rule status fetch failed: ${res.status}`);
    }

    const data = await res.json();

    return {
      providerRef,
      status: mapTravelRuleStatus(data.status),
      rawResponse: data,
    };
  }
}

function mapTravelRuleStatus(
  status: string
): 'pending' | 'sent' | 'received' | 'accepted' | 'rejected' | 'failed' {
  const map: Record<string, 'pending' | 'sent' | 'received' | 'accepted' | 'rejected' | 'failed'> = {
    PENDING: 'pending',
    SENT: 'sent',
    RECEIVED: 'received',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    FAILED: 'failed',
  };
  return map[status?.toUpperCase()] ?? 'pending';
}
