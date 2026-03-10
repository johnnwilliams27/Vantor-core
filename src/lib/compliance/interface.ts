// ---- Chainalysis Compliance Adapter Interface ----

export interface SanctionsScreenResult {
  address: string;
  chain: string;
  result: 'clear' | 'sanctioned' | 'partial_match' | 'error';
  riskScore: number | null;
  identifications: Array<{
    category: string;
    name: string;
    description: string;
    url: string | null;
  }>;
}

export interface KytRegisterParams {
  externalId: string;
  chain: string;
  direction: 'sent' | 'received';
  txHash: string;
  fromAddress: string;
  toAddress: string;
  asset: string;
  amount: number;
  amountUsd: number;
  timestamp: string;
}

export interface KytTransferResult {
  externalId: string;
  riskScore: number | null;
  clusterName: string | null;
  clusterCategory: string | null;
  alerts: Array<{
    alertId: string;
    severity: 'low' | 'medium' | 'high' | 'severe';
    category: string;
    description: string;
  }>;
  rawResponse: Record<string, unknown>;
}

export interface TravelRuleCreateParams {
  direction: 'outgoing' | 'incoming';
  amountUsd: number;
  originatorName: string;
  originatorAddress?: string;
  originatorWallet: string;
  originatorChain: string;
  originatorVasp?: string;
  beneficiaryName: string;
  beneficiaryAddress?: string;
  beneficiaryWallet: string;
  beneficiaryChain: string;
  beneficiaryVasp?: string;
  txHash?: string;
}

export interface TravelRuleResult {
  providerRef: string;
  status: 'pending' | 'sent' | 'received' | 'accepted' | 'rejected' | 'failed';
  rawResponse: Record<string, unknown>;
}

export interface IComplianceAdapter {
  screenAddress(address: string, chain: string): Promise<SanctionsScreenResult>;
  registerTransfer(params: KytRegisterParams): Promise<KytTransferResult>;
  getTransferAlerts(externalId: string): Promise<KytTransferResult>;
  submitTravelRule(params: TravelRuleCreateParams): Promise<TravelRuleResult>;
  getTravelRuleStatus(providerRef: string): Promise<TravelRuleResult>;
}
