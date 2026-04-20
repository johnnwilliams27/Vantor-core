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
  OnChainValue,
} from '../interface';
import type { TokenSymbol, ChainType } from '@/types/database';
import { randomUUID } from 'crypto';
import { VENUES } from '@/lib/yield/venues';
import { YIELD_TOKENS } from '../yield-tokens';

// Venue metadata is owned by the discriminated-union registry at
// src/lib/yield/venues. PROTOCOL_META used to live here as a duplicated
// Record<YieldProtocolId, ...>; it's been deleted — all lookups go
// through VENUES via `venueToProtocolInfo()` below.

/** Convert a VenueMetadata entry to the legacy YieldProtocolInfo shape. */
function venueToProtocolInfo(protocol: YieldProtocolId): YieldProtocolInfo {
  const venue = VENUES[protocol];
  return {
    id: venue.id,
    name: venue.displayName,
    chain: venue.chain,
    supportedTokens: venue.supportedTokens,
    description: venue.description,
    riskLevel: venue.riskLevel,
    riskFactors: venue.riskFactors,
    kycRequired: venue.kycRequired,
  };
}

/**
 * Reference APY per protocol. For DeFi protocols this is a mock value
 * used only when the rate cache is empty (e.g. local dev without a cron).
 * For tokenized MMFs, the reference yield comes from the venue registry
 * and matches the value shown on the card ("as of …").
 */
function mmfReferenceYield(id: YieldProtocolId): number {
  const venue = VENUES[id];
  return venue.category === 'tokenized_mmf' ? venue.referenceYield : 0;
}

const MOCK_APYS: Record<YieldProtocolId, { supply: number; reward: number }> = {
  // DeFi protocols — mock values for the cache-empty fallback path
  aave_v3:           { supply: 0.0485, reward: 0.0020 },
  compound_v3:       { supply: 0.0440, reward: 0.0035 },
  morpho_reservoir:  { supply: 0.0700, reward: 0.0000 },
  morpho_steakhouse: { supply: 0.1150, reward: 0.0200 },
  kamino:            { supply: 0.0710, reward: 0.0050 },
  kamino_multiply:   { supply: 0, reward: 0 }, // no public APY feed; venue gated coming_soon
  ondo_usdy:         { supply: 0.0475, reward: 0 },
  sky:               { supply: 0.0625, reward: 0 },
  ethena:            { supply: 0.1720, reward: 0.0380 },
  // Tokenized MMFs — reference yields sourced from the venue registry
  buidl:             { supply: mmfReferenceYield('buidl'),     reward: 0 },
  ousg:              { supply: mmfReferenceYield('ousg'),      reward: 0 },
  ustb:              { supply: mmfReferenceYield('ustb'),      reward: 0 },
  benji:             { supply: mmfReferenceYield('benji'),     reward: 0 },
  usyc:              { supply: mmfReferenceYield('usyc'),      reward: 0 },
  spiko_usd:         { supply: mmfReferenceYield('spiko_usd'), reward: 0 },
};

// In-memory mock positions
const mockPositions = new Map<string, PositionInfo>();

function posKey(protocol: YieldProtocolId, wallet: string, token: TokenSymbol): string {
  return `${protocol}:${wallet}:${token}`;
}

export class MockYieldAdapter implements IYieldProtocol {
  constructor(private protocol: YieldProtocolId) {}

  getInfo(): YieldProtocolInfo {
    return venueToProtocolInfo(this.protocol);
  }

  async getAPY(token: TokenSymbol): Promise<YieldRate> {
    const apys = MOCK_APYS[this.protocol];
    return {
      protocol: this.protocol,
      token,
      chain: VENUES[this.protocol].chain,
      supplyAPY: apys.supply,
      rewardAPY: apys.reward,
      totalAPY: apys.supply + apys.reward,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getPosition(walletAddress: string, token: TokenSymbol): Promise<PositionInfo | null> {
    return mockPositions.get(posKey(this.protocol, walletAddress, token)) ?? null;
  }

  async getOnChainValue(walletAddress: string, token: TokenSymbol, _yieldToken: string): Promise<OnChainValue> {
    const key = posKey(this.protocol, walletAddress, token);
    const existing = mockPositions.get(key);

    if (!existing) {
      return { currentValueUsd: 0, yieldTokenBalance: 0 };
    }

    // Simulate tiny yield accrual each time on-chain value is checked
    const updatedValue = existing.currentValueUsd * 1.0001;
    const existingTokenBalance = (existing.metadata.tokenBalance as number | undefined) ?? existing.currentValueUsd;
    const updatedTokenBalance = existingTokenBalance * 1.0001;

    mockPositions.set(key, {
      ...existing,
      currentValueUsd: updatedValue,
      accruedYieldUsd: existing.accruedYieldUsd + (updatedValue - existing.currentValueUsd),
      metadata: {
        ...existing.metadata,
        tokenBalance: updatedTokenBalance,
      },
    });

    return {
      currentValueUsd: updatedValue,
      yieldTokenBalance: updatedTokenBalance,
    };
  }

  async deposit(params: DepositParams): Promise<DepositResult> {
    await new Promise((r) => setTimeout(r, 300));
    const apys = MOCK_APYS[this.protocol];
    const yieldToken = YIELD_TOKENS[this.protocol];
    const amount = parseFloat(params.amount);

    const key = posKey(this.protocol, params.walletAddress, params.token);
    const existing = mockPositions.get(key);
    const newDeposited = (existing ? parseFloat(existing.depositedAmount) : 0) + amount;
    const newCurrentValue = existing ? existing.currentValueUsd + amount : amount;
    const existingTokenBalance = (existing?.metadata.tokenBalance as number | undefined) ?? 0;
    const newTokenBalance = existingTokenBalance + amount;

    mockPositions.set(key, {
      protocol: this.protocol,
      chain: params.chain,
      underlyingToken: params.token,
      yieldToken,
      depositedAmount: newDeposited.toString(),
      currentValueUsd: newCurrentValue,
      accruedYieldUsd: existing?.accruedYieldUsd ?? 0,
      currentAPY: apys.supply + apys.reward,
      metadata: { tokenBalance: newTokenBalance },
    });

    const needsProviderRef = this.protocol === 'ondo_usdy';
    return {
      txHash: needsProviderRef ? null : `0xmock_${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      providerRef: needsProviderRef ? `${this.protocol.toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}` : undefined,
      yieldToken,
      yieldTokenAmount: params.amount,
      tokensReceived: amount,
      estimatedAPY: apys.supply + apys.reward,
    };
  }

  async withdraw(params: WithdrawParams): Promise<WithdrawResult> {
    await new Promise((r) => setTimeout(r, 300));
    const amount = parseFloat(params.amount);

    const key = posKey(this.protocol, params.walletAddress, params.token);
    const existing = mockPositions.get(key);

    let tokensRedeemed = amount;

    if (existing) {
      const currentValue = existing.currentValueUsd;
      const withdrawFraction = amount / currentValue;

      if (withdrawFraction >= 1) {
        // Full withdrawal
        tokensRedeemed = (existing.metadata.tokenBalance as number | undefined) ?? amount;
        mockPositions.delete(key);
      } else {
        // Partial withdrawal — adjust cost basis and token balance proportionally
        const deposited = parseFloat(existing.depositedAmount);
        const newDeposited = deposited * (1 - withdrawFraction);
        const newCurrentValue = currentValue - amount;
        const existingTokenBalance = (existing.metadata.tokenBalance as number | undefined) ?? currentValue;
        tokensRedeemed = existingTokenBalance * withdrawFraction;
        const newTokenBalance = existingTokenBalance * (1 - withdrawFraction);

        mockPositions.set(key, {
          ...existing,
          depositedAmount: newDeposited.toString(),
          currentValueUsd: newCurrentValue,
          metadata: {
            ...existing.metadata,
            tokenBalance: newTokenBalance,
          },
        });
      }
    }

    const needsProviderRef = this.protocol === 'ondo_usdy';
    return {
      txHash: needsProviderRef ? null : `0xmock_${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      providerRef: needsProviderRef ? `${this.protocol.toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}` : undefined,
      receivedAmount: params.amount,
      tokensRedeemed,
    };
  }
}
