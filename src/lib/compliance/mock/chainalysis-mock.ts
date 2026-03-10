import type {
  IComplianceAdapter,
  SanctionsScreenResult,
  KytRegisterParams,
  KytTransferResult,
  TravelRuleCreateParams,
  TravelRuleResult,
} from '../interface';

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Known sanctioned addresses for testing */
const SANCTIONED_PREFIXES = ['0xdead', '0xbad0'];

export class ChainalysisMockAdapter implements IComplianceAdapter {
  async screenAddress(address: string, chain: string): Promise<SanctionsScreenResult> {
    await delay(200);

    const lower = address.toLowerCase();
    const isSanctioned = SANCTIONED_PREFIXES.some((p) => lower.startsWith(p));
    const isPartial = lower.includes('suspicious');

    if (isSanctioned) {
      return {
        address,
        chain,
        result: 'sanctioned',
        riskScore: 100,
        identifications: [
          {
            category: 'sanctions',
            name: 'OFAC SDN List',
            description: 'Address appears on OFAC Specially Designated Nationals list',
            url: null,
          },
        ],
      };
    }

    if (isPartial) {
      return {
        address,
        chain,
        result: 'partial_match',
        riskScore: 65,
        identifications: [
          {
            category: 'sanctions',
            name: 'Partial Match',
            description: 'Address partially matches a sanctioned entity',
            url: null,
          },
        ],
      };
    }

    return {
      address,
      chain,
      result: 'clear',
      riskScore: 0,
      identifications: [],
    };
  }

  async registerTransfer(params: KytRegisterParams): Promise<KytTransferResult> {
    await delay(300);

    const isHighValue = params.amountUsd > 50_000;
    const riskScore = isHighValue ? 55 + Math.random() * 30 : Math.random() * 20;

    const alerts: KytTransferResult['alerts'] = [];
    if (isHighValue) {
      alerts.push({
        alertId: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        severity: riskScore > 70 ? 'high' : 'medium',
        category: 'large_transaction',
        description: `High-value transfer of $${params.amountUsd.toLocaleString()} detected`,
      });
    }

    return {
      externalId: params.externalId,
      riskScore: parseFloat(riskScore.toFixed(2)),
      clusterName: isHighValue ? 'Unknown Cluster' : null,
      clusterCategory: isHighValue ? 'unhosted_wallet' : null,
      alerts,
      rawResponse: { mock: true, registeredAt: new Date().toISOString() },
    };
  }

  async getTransferAlerts(externalId: string): Promise<KytTransferResult> {
    await delay(150);

    return {
      externalId,
      riskScore: parseFloat((Math.random() * 15).toFixed(2)),
      clusterName: null,
      clusterCategory: null,
      alerts: [],
      rawResponse: { mock: true },
    };
  }

  async submitTravelRule(params: TravelRuleCreateParams): Promise<TravelRuleResult> {
    await delay(350);

    return {
      providerRef: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'sent',
      rawResponse: {
        mock: true,
        direction: params.direction,
        amountUsd: params.amountUsd,
        submittedAt: new Date().toISOString(),
      },
    };
  }

  async getTravelRuleStatus(providerRef: string): Promise<TravelRuleResult> {
    await delay(150);

    return {
      providerRef,
      status: 'accepted',
      rawResponse: { mock: true },
    };
  }
}
