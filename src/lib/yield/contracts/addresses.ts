import type { YieldProtocolId } from '../interface';

export const TOKEN_ADDRESSES: Record<string, `0x${string}`> = {
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
};

export const TOKEN_DECIMALS: Record<string, number> = { USDC: 6, USDT: 6 };

export interface ProtocolAddresses {
  router: `0x${string}`;
  spender: `0x${string}`;
  type: 'aave' | 'compound' | 'erc4626' | 'ondo_usdy';
}

export const PROTOCOL_ADDRESSES: Partial<Record<YieldProtocolId, ProtocolAddresses>> = {
  aave_v3: {
    router: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    spender: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    type: 'aave',
  },
  compound_v3: {
    router: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
    spender: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
    type: 'compound',
  },
  morpho_steakhouse: {
    router: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB',
    spender: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB',
    type: 'erc4626',
  },
  sky: {
    router: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
    spender: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
    type: 'erc4626',
  },
  ethena: {
    router: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497',
    spender: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497',
    type: 'erc4626',
  },
  ondo_usdy: {
    router: '0x96F6eF951840721AdBF46Ac996b59E0235CB985C',
    spender: '0x96F6eF951840721AdBF46Ac996b59E0235CB985C',
    type: 'ondo_usdy',
  },
  morpho_reservoir: {
    router: '0xbeEF346d7099865208Ff331e4f648f4154DDAa05',
    spender: '0xbeEF346d7099865208Ff331e4f648f4154DDAa05',
    type: 'erc4626',
  },
};

export const COMPOUND_COMET_BY_TOKEN: Record<string, `0x${string}`> = {
  USDC: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
  USDT: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840',
};
