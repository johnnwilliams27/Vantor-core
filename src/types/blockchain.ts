import type { ChainType, TokenSymbol } from './database';
export type { ChainType, TokenSymbol };

export interface TokenBalance {
  token: TokenSymbol;
  balance: string;   // raw string, use big.js for arithmetic
  decimals: number;
  usdValue?: string;
}

export interface TransferInput {
  fromPrivateKey?: string;  // server-side only
  toAddress: string;
  token: TokenSymbol;
  amount: string;           // human-readable
  chain: ChainType;
}

export interface TransferResult {
  txHash: string;
  fee?: string;
}

export const ETH_TOKEN_ADDRESSES: Record<TokenSymbol, `0x${string}`> = {
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
};

export const SOL_TOKEN_ADDRESSES: Record<TokenSymbol, string> = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};
