import { Connection } from '@solana/web3.js';

let _connection: Connection | null = null;

export function getSolanaConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(
      process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
  }
  return _connection;
}
