export const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
export const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const;
export const AAVE_AUSDC = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c' as const;
export const AAVE_AUSDT = '0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a' as const;
export const COMPOUND_COMET_USDC = '0xc3d688B66703497DAA19211EEdff47f25384cdc3' as const;
export const COMPOUND_COMET_USDT = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840' as const;
export const MORPHO_STEAKHOUSE_VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB' as const;
export const SKY_SUSDS = '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD' as const;
export const ETHENA_SUSDE = '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497' as const;
export const ONDO_USDY = '0x96F6eF951840721AdBF46Ac996b59E0235CB985C' as const;

export const ERC20_BALANCE_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;

export const ERC4626_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'convertToAssets', type: 'function', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;

export const COMPOUND_COMET_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;
