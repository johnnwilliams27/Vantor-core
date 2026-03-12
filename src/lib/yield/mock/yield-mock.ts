import type {
  IYieldProtocol,
  YieldProtocolId,
  YieldProtocolInfo,
  YieldRate,
  DepositParams,
  DepositResult,
  WithdrawParams,
  WithdrawResult,
  PositionInfo,
} from '../interface';
import type { TokenSymbol, ChainType } from '@/types/database';
import { randomUUID } from 'crypto';

const PROTOCOL_META: Record<YieldProtocolId, Omit<YieldProtocolInfo, 'id'>> = {
  aave_v3: {
    name: 'Aave V3',
    chain: 'ethereum',
    supportedTokens: ['USDC', 'USDT'],
    description: 'Leading decentralized lending protocol. Supply stablecoins to earn yield from borrowers.',
    riskLevel: 'low',
    riskFactors: { smartContract: 1, counterparty: 1, liquidity: 1, regulatory: 2 },
    kycRequired: false,
  },
  morpho: {
    name: 'Morpho Blue',
    chain: 'ethereum',
    supportedTokens: ['USDC', 'USDT'],
    description: 'Permissionless lending markets with isolated risk. Supply to curated vaults for optimized yield.',
    riskLevel: 'medium',
    riskFactors: { smartContract: 2, counterparty: 1, liquidity: 2, regulatory: 2 },
    kycRequired: false,
  },
  morpho_steakhouse: {
    name: 'Morpho Steakhouse USDC',
    chain: 'ethereum',
    supportedTokens: ['USDC'],
    description: 'Steakhouse-curated Morpho vault. Concentrated exposure to high-yield markets with active risk management.',
    riskLevel: 'high',
    riskFactors: { smartContract: 2, counterparty: 2, liquidity: 3, regulatory: 2 },
    kycRequired: false,
  },
  kamino: {
    name: 'Kamino Lend',
    chain: 'solana',
    supportedTokens: ['USDC', 'USDT'],
    description: 'Largest Solana lending protocol. Supply stablecoins to earn yield from Solana borrowers.',
    riskLevel: 'medium',
    riskFactors: { smartContract: 2, counterparty: 1, liquidity: 2, regulatory: 3 },
    kycRequired: false,
  },
  kamino_multiply: {
    name: 'Kamino Multiply',
    chain: 'solana',
    supportedTokens: ['USDC'],
    description: 'Leveraged yield strategy on Solana. Automated looping for amplified stablecoin returns with liquidation risk.',
    riskLevel: 'high',
    riskFactors: { smartContract: 2, counterparty: 2, liquidity: 3, regulatory: 3 },
    kycRequired: false,
  },
  ondo: {
    name: 'Ondo USDY',
    chain: 'ethereum',
    supportedTokens: ['USDC'],
    description: 'Tokenized US Treasury yield. Mint USDY backed by short-term T-bills. KYC required.',
    riskLevel: 'low',
    riskFactors: { smartContract: 1, counterparty: 2, liquidity: 2, regulatory: 1 },
    kycRequired: true,
  },
  sky: {
    name: 'Sky sUSDS',
    chain: 'ethereum',
    supportedTokens: ['USDC', 'USDT'],
    description: 'Savings rate from Sky (formerly MakerDAO). Deposit stablecoins to earn the Sky Savings Rate backed by RWA revenue.',
    riskLevel: 'low',
    riskFactors: { smartContract: 1, counterparty: 1, liquidity: 1, regulatory: 2 },
    kycRequired: false,
  },
  ethena: {
    name: 'Ethena sUSDe',
    chain: 'ethereum',
    supportedTokens: ['USDC', 'USDT'],
    description: 'Synthetic dollar protocol. Stake USDe for yield derived from delta-neutral ETH positions and funding rate arbitrage.',
    riskLevel: 'high',
    riskFactors: { smartContract: 2, counterparty: 3, liquidity: 2, regulatory: 3 },
    kycRequired: false,
  },
  maple: {
    name: 'Maple Finance',
    chain: 'ethereum',
    supportedTokens: ['USDC'],
    description: 'Institutional lending marketplace. Earn yield from undercollateralized loans to vetted crypto institutions.',
    riskLevel: 'medium',
    riskFactors: { smartContract: 2, counterparty: 3, liquidity: 2, regulatory: 1 },
    kycRequired: true,
  },
  drift: {
    name: 'Drift Earn',
    chain: 'solana',
    supportedTokens: ['USDC'],
    description: 'Lending vaults on Solana\'s largest perps DEX. Earn yield from margin traders and liquidations.',
    riskLevel: 'high',
    riskFactors: { smartContract: 2, counterparty: 2, liquidity: 3, regulatory: 3 },
    kycRequired: false,
  },
};

const MOCK_APYS: Record<YieldProtocolId, { supply: number; reward: number }> = {
  aave_v3:           { supply: 0.0485, reward: 0.0020 },
  morpho:            { supply: 0.0620, reward: 0.0080 },
  morpho_steakhouse: { supply: 0.1150, reward: 0.0200 },
  kamino:            { supply: 0.0710, reward: 0.0050 },
  kamino_multiply:   { supply: 0.1480, reward: 0.0120 },
  ondo:              { supply: 0.0475, reward: 0 },
  sky:               { supply: 0.0625, reward: 0 },
  ethena:            { supply: 0.1720, reward: 0.0380 },
  maple:             { supply: 0.0890, reward: 0 },
  drift:             { supply: 0.1250, reward: 0.0150 },
};

const YIELD_TOKENS: Record<YieldProtocolId, string> = {
  aave_v3: 'aUSDC',
  morpho: 'mUSDC',
  morpho_steakhouse: 'mshUSDC',
  kamino: 'kUSDC',
  kamino_multiply: 'kmUSDC',
  ondo: 'USDY',
  sky: 'sUSDS',
  ethena: 'sUSDe',
  maple: 'mpUSDC',
  drift: 'dUSDC',
};

// In-memory mock positions
const mockPositions = new Map<string, PositionInfo>();

function posKey(protocol: YieldProtocolId, wallet: string, token: TokenSymbol): string {
  return `${protocol}:${wallet}:${token}`;
}

export class MockYieldAdapter implements IYieldProtocol {
  constructor(private protocol: YieldProtocolId) {}

  getInfo(): YieldProtocolInfo {
    return { id: this.protocol, ...PROTOCOL_META[this.protocol] };
  }

  async getAPY(token: TokenSymbol): Promise<YieldRate> {
    const apys = MOCK_APYS[this.protocol];
    return {
      protocol: this.protocol,
      token,
      chain: PROTOCOL_META[this.protocol].chain,
      supplyAPY: apys.supply,
      rewardAPY: apys.reward,
      totalAPY: apys.supply + apys.reward,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getPosition(walletAddress: string, token: TokenSymbol): Promise<PositionInfo | null> {
    return mockPositions.get(posKey(this.protocol, walletAddress, token)) ?? null;
  }

  async deposit(params: DepositParams): Promise<DepositResult> {
    await new Promise((r) => setTimeout(r, 300));
    const apys = MOCK_APYS[this.protocol];
    const yieldToken = YIELD_TOKENS[this.protocol];
    const amount = parseFloat(params.amount);

    const key = posKey(this.protocol, params.walletAddress, params.token);
    const existing = mockPositions.get(key);
    const newDeposited = (existing ? parseFloat(existing.depositedAmount) : 0) + amount;

    mockPositions.set(key, {
      protocol: this.protocol,
      chain: params.chain,
      underlyingToken: params.token,
      yieldToken,
      depositedAmount: newDeposited.toString(),
      currentValueUsd: newDeposited,
      accruedYieldUsd: existing?.accruedYieldUsd ?? 0,
      currentAPY: apys.supply + apys.reward,
      metadata: {},
    });

    const needsProviderRef = ['ondo', 'maple'].includes(this.protocol);
    return {
      txHash: needsProviderRef ? null : `0xmock_${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      providerRef: needsProviderRef ? `${this.protocol.toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}` : undefined,
      yieldToken,
      yieldTokenAmount: params.amount,
      estimatedAPY: apys.supply + apys.reward,
    };
  }

  async withdraw(params: WithdrawParams): Promise<WithdrawResult> {
    await new Promise((r) => setTimeout(r, 300));
    const amount = parseFloat(params.amount);

    const key = posKey(this.protocol, params.walletAddress, params.token);
    const existing = mockPositions.get(key);
    if (existing) {
      const remaining = parseFloat(existing.depositedAmount) - amount;
      if (remaining <= 0) {
        mockPositions.delete(key);
      } else {
        mockPositions.set(key, {
          ...existing,
          depositedAmount: remaining.toString(),
          currentValueUsd: remaining,
        });
      }
    }

    const needsProviderRef = ['ondo', 'maple'].includes(this.protocol);
    return {
      txHash: needsProviderRef ? null : `0xmock_${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      providerRef: needsProviderRef ? `${this.protocol.toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}` : undefined,
      receivedAmount: params.amount,
    };
  }
}
