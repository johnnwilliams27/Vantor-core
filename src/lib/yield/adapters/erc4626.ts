import { ethereumClient } from '../rates/client';
import { ERC4626_ABI, MORPHO_STEAKHOUSE_VAULT, SKY_SUSDS, ETHENA_SUSDE } from './constants';
import type { OnChainValue, YieldProtocolId } from '../interface';
import type { TokenSymbol } from '@/types/database';

interface VaultConfig { address: `0x${string}`; shareDecimals: number; assetDecimals: number; }

const VAULT_MAP: Partial<Record<YieldProtocolId, VaultConfig>> = {
  morpho_steakhouse: { address: MORPHO_STEAKHOUSE_VAULT, shareDecimals: 18, assetDecimals: 6 },
  sky: { address: SKY_SUSDS, shareDecimals: 18, assetDecimals: 18 },
  ethena: { address: ETHENA_SUSDE, shareDecimals: 18, assetDecimals: 18 },
};

export async function getErc4626OnChainValue(protocol: YieldProtocolId, walletAddress: string, _token: TokenSymbol): Promise<OnChainValue> {
  const config = VAULT_MAP[protocol];
  if (!config) return { currentValueUsd: 0, yieldTokenBalance: 0 };

  const shares = await ethereumClient.readContract({
    address: config.address, abi: ERC4626_ABI, functionName: 'balanceOf',
    args: [walletAddress as `0x${string}`],
  });

  if (Number(shares) === 0) return { currentValueUsd: 0, yieldTokenBalance: 0 };

  const assets = await ethereumClient.readContract({
    address: config.address, abi: ERC4626_ABI, functionName: 'convertToAssets',
    args: [shares],
  });

  return {
    currentValueUsd: Number(assets) / 10 ** config.assetDecimals,
    yieldTokenBalance: Number(shares) / 10 ** config.shareDecimals,
  };
}
