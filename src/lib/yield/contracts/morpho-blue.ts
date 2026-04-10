import { parseUnits } from 'viem';
import { TOKEN_DECIMALS } from './addresses';

export const MORPHO_BLUE_ADDRESS = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb' as `0x${string}`;

export const MORPHO_BLUE_ABI = [
  {
    name: 'supply',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketParams', type: 'tuple', components: [
        { name: 'loanToken', type: 'address' },
        { name: 'collateralToken', type: 'address' },
        { name: 'oracle', type: 'address' },
        { name: 'irm', type: 'address' },
        { name: 'lltv', type: 'uint256' },
      ]},
      { name: 'assets', type: 'uint256' },
      { name: 'shares', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [
      { name: 'assetsSupplied', type: 'uint256' },
      { name: 'sharesSupplied', type: 'uint256' },
    ],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketParams', type: 'tuple', components: [
        { name: 'loanToken', type: 'address' },
        { name: 'collateralToken', type: 'address' },
        { name: 'oracle', type: 'address' },
        { name: 'irm', type: 'address' },
        { name: 'lltv', type: 'uint256' },
      ]},
      { name: 'assets', type: 'uint256' },
      { name: 'shares', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [
      { name: 'assetsWithdrawn', type: 'uint256' },
      { name: 'sharesWithdrawn', type: 'uint256' },
    ],
  },
] as const;

export interface MorphoMarketParams {
  loanToken: `0x${string}`;
  collateralToken: `0x${string}`;
  oracle: `0x${string}`;
  irm: `0x${string}`;
  lltv: bigint;
}

export const CURATED_MARKETS: { id: string; label: string; token: string; params: MorphoMarketParams }[] = [
  {
    id: '0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc',
    label: 'USDC/WETH (86% LLTV)',
    token: 'USDC',
    params: {
      loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      collateralToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      oracle: '0x48F7E36EB6B826B2dF4B2E630B62Cd25e89E40e2',
      irm: '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC',
      lltv: BigInt('860000000000000000'),
    },
  },
  {
    id: '0x54efdee08e272e929034a8f26f7ca34b1ebe364b275391169b28c6d7db24dbc8',
    label: 'USDC/wstETH (86% LLTV)',
    token: 'USDC',
    params: {
      loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      collateralToken: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
      oracle: '0x2a01EB9496094dA03c4E364Def50f5aD1280AD72',
      irm: '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC',
      lltv: BigInt('860000000000000000'),
    },
  },
];

export function buildMorphoSupplyArgs(marketParams: MorphoMarketParams, token: string, amount: string, walletAddress: `0x${string}`) {
  const decimals = TOKEN_DECIMALS[token] ?? 6;
  return {
    address: MORPHO_BLUE_ADDRESS,
    abi: MORPHO_BLUE_ABI,
    functionName: 'supply' as const,
    args: [marketParams, parseUnits(amount, decimals), BigInt(0), walletAddress, '0x' as `0x${string}`] as const,
  };
}

export function buildMorphoWithdrawArgs(marketParams: MorphoMarketParams, token: string, amount: string, walletAddress: `0x${string}`, isFullWithdrawal: boolean) {
  const decimals = TOKEN_DECIMALS[token] ?? 6;
  const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  return {
    address: MORPHO_BLUE_ADDRESS,
    abi: MORPHO_BLUE_ABI,
    functionName: 'withdraw' as const,
    args: [
      marketParams,
      isFullWithdrawal ? BigInt(0) : parseUnits(amount, decimals),
      isFullWithdrawal ? MAX_UINT256 : BigInt(0),
      walletAddress,
      walletAddress,
    ] as const,
  };
}
