import type { ChainType, TokenSymbol } from '@/types/database';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type { PoolLiquidity, ILiquidityProvider } from './interface';

/**
 * Mock liquidity provider that returns simulated pool data.
 * In production, replace with on-chain reads via viem:
 * - Aave: read utilization rate from LendingPool.getReserveData()
 * - Kamino: read vault TVL from vault account
 * - Uniswap v3: read liquidity + sqrtPriceX96 from pool contract
 * - Ondo: read USDY total supply and backing reserves
 */

// Simulated liquidity depths per protocol (in USD)
const MOCK_POOL_DATA: Record<YieldProtocolId, { tvl: number; utilization: number; poolType: 'stablecoin' | 'volatile' }> = {
  aave_v3:            { tvl: 2_500_000_000, utilization: 0.82, poolType: 'stablecoin' },
  compound_v3:        { tvl: 1_800_000_000, utilization: 0.80, poolType: 'stablecoin' },
  morpho:             { tvl: 450_000_000,   utilization: 0.75, poolType: 'stablecoin' },
  morpho_steakhouse:  { tvl: 85_000_000,    utilization: 0.88, poolType: 'stablecoin' },
  kamino:             { tvl: 320_000_000,   utilization: 0.70, poolType: 'stablecoin' },
  kamino_multiply:    { tvl: 45_000_000,    utilization: 0.65, poolType: 'volatile' },
  ondo:               { tvl: 600_000_000,   utilization: 0.55, poolType: 'stablecoin' },
  sky:                { tvl: 1_200_000_000, utilization: 0.60, poolType: 'stablecoin' },
  ethena:             { tvl: 3_800_000_000, utilization: 0.78, poolType: 'volatile' },
  maple:              { tvl: 180_000_000,   utilization: 0.85, poolType: 'stablecoin' },
  drift:              { tvl: 95_000_000,    utilization: 0.72, poolType: 'volatile' },
};

export class MockLiquidityProvider implements ILiquidityProvider {
  async getPoolLiquidity(
    protocol: YieldProtocolId,
    chain: ChainType,
    token: TokenSymbol,
  ): Promise<PoolLiquidity> {
    // Simulate network delay
    await new Promise((r) => setTimeout(r, 200));

    const pool = MOCK_POOL_DATA[protocol] ?? { tvl: 100_000_000, utilization: 0.75, poolType: 'stablecoin' as const };

    const totalLiquidityUsd = pool.tvl;
    const availableLiquidityUsd = totalLiquidityUsd * (1 - pool.utilization);

    return {
      protocol,
      chain,
      token,
      totalLiquidityUsd,
      availableLiquidityUsd,
      utilizationRate: pool.utilization,
      poolType: pool.poolType,
      metadata: {
        source: 'mock',
        tvl: totalLiquidityUsd,
      },
      fetchedAt: new Date().toISOString(),
    };
  }
}

/**
 * Production liquidity provider using viem for on-chain reads.
 * Implementation sketch — uncomment and fill in contract addresses when ready.
 *
 * import { createPublicClient, http } from 'viem';
 * import { mainnet } from 'viem/chains';
 *
 * export class OnChainLiquidityProvider implements ILiquidityProvider {
 *   private client = createPublicClient({ chain: mainnet, transport: http() });
 *
 *   async getPoolLiquidity(protocol, chain, token): Promise<PoolLiquidity> {
 *     switch (protocol) {
 *       case 'aave_v3': {
 *         // Read from Aave V3 Pool Data Provider
 *         // const data = await this.client.readContract({
 *         //   address: AAVE_POOL_DATA_PROVIDER,
 *         //   abi: aaveDataProviderAbi,
 *         //   functionName: 'getReserveData',
 *         //   args: [tokenAddress],
 *         // });
 *         // return { totalLiquidityUsd: data.totalLiquidity, ... };
 *       }
 *       case 'kamino': {
 *         // Read from Kamino vault account via @solana/web3.js
 *         // const vaultData = await connection.getAccountInfo(vaultPubkey);
 *         // return { totalLiquidityUsd: parsedVault.tvl, ... };
 *       }
 *       // ... other protocols
 *     }
 *   }
 * }
 */

// Factory
export function getLiquidityProvider(): ILiquidityProvider {
  // TODO: swap to OnChainLiquidityProvider when real adapters are implemented
  return new MockLiquidityProvider();
}
