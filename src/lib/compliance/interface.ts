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

export interface IComplianceAdapter {
  screenAddress(address: string, chain: string): Promise<SanctionsScreenResult>;
  registerTransfer(params: KytRegisterParams): Promise<KytTransferResult>;
  getTransferAlerts(externalId: string): Promise<KytTransferResult>;
}
