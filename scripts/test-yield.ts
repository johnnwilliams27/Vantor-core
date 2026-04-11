/**
 * CLI test script for yield protocol deposit/withdraw on mainnet.
 *
 * Usage:
 *   EVM:
 *     TEST_WALLET_PRIVATE_KEY=0x... npx tsx scripts/test-yield.ts aave_v3 deposit 5
 *
 *   Solana:
 *     TEST_SOLANA_PRIVATE_KEY=<base58> npx tsx scripts/test-yield.ts kamino deposit 5
 *
 * Actions:
 *   status, deposit <amount>, withdraw <amount>
 *
 * Supported protocols:
 *   EVM:    aave_v3, compound_v3, morpho_steakhouse, morpho_reservoir
 *   Solana: kamino, kamino_multiply
 *
 * SAFETY:
 *   - Uses real mainnet — real money, real gas
 *   - Start with small amounts ($5 USDC)
 *   - Test wallet should have minimal funds
 */

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { buildDepositTx } from '../src/lib/yield/contracts/deposit';
import { buildWithdrawTx } from '../src/lib/yield/contracts/withdraw';
import { buildApproveArgs, needsApproval } from '../src/lib/yield/contracts/allowance';
import { PROTOCOL_ADDRESSES, TOKEN_ADDRESSES, TOKEN_DECIMALS } from '../src/lib/yield/contracts/addresses';
import { getAaveOnChainValue } from '../src/lib/yield/adapters/aave-v3';
import { getCompoundOnChainValue } from '../src/lib/yield/adapters/compound-v3';
import { getErc4626OnChainValue } from '../src/lib/yield/adapters/erc4626';
import {
  buildKaminoDepositTx,
  buildKaminoWithdrawTx,
  getKaminoPosition,
} from '../src/lib/yield/contracts/solana/kamino';
import { ERC20_ABI } from '../src/lib/yield/contracts/abis';
import type { YieldProtocolId } from '../src/lib/yield/interface';

const EVM_PROTOCOLS = new Set<YieldProtocolId>([
  'aave_v3',
  'compound_v3',
  'morpho_steakhouse',
  'morpho_reservoir',
]);

const SOLANA_PROTOCOLS = new Set<YieldProtocolId>(['kamino', 'kamino_multiply']);

const ETH_RPC = process.env.ETHEREUM_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';
const SOL_RPC = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

const [, , protocolArg, action, amountArg] = process.argv;

if (!protocolArg || !action) {
  console.error('❌ Missing arguments');
  console.error('   Usage: npx tsx scripts/test-yield.ts <protocol> <action> [amount]');
  console.error('   Actions: deposit, withdraw, status');
  console.error('   EVM protocols: aave_v3, compound_v3, morpho_steakhouse, morpho_reservoir');
  console.error('   Solana protocols: kamino, kamino_multiply');
  process.exit(1);
}

const protocol = protocolArg as YieldProtocolId;
const token = 'USDC';
const amount = amountArg ?? '0';
const isEvm = EVM_PROTOCOLS.has(protocol);
const isSolana = SOLANA_PROTOCOLS.has(protocol);

if (!isEvm && !isSolana) {
  console.error(`❌ Unknown protocol: ${protocol}`);
  process.exit(1);
}

function log(step: string, msg: string) {
  const time = new Date().toISOString().split('T')[1].slice(0, 8);
  console.log(`[${time}] ${step.padEnd(12)} ${msg}`);
}

// ─── EVM helpers ──────────────────────────────────────────────────────

function getEvmAccount() {
  const PK = process.env.TEST_WALLET_PRIVATE_KEY;
  if (!PK) {
    console.error('❌ TEST_WALLET_PRIVATE_KEY not set (required for EVM protocols)');
    process.exit(1);
  }
  return privateKeyToAccount(PK as `0x${string}`);
}

async function evmStatus() {
  const account = getEvmAccount();
  const publicClient = createPublicClient({ chain: mainnet, transport: http(ETH_RPC) });

  const balance = await publicClient.readContract({
    address: TOKEN_ADDRESSES.USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  const usdc = Number(balance) / 10 ** TOKEN_DECIMALS.USDC;

  let pos;
  switch (protocol) {
    case 'aave_v3':
      pos = await getAaveOnChainValue(account.address, token);
      break;
    case 'compound_v3':
      pos = await getCompoundOnChainValue(account.address, token);
      break;
    case 'morpho_steakhouse':
    case 'morpho_reservoir':
      pos = await getErc4626OnChainValue(protocol, account.address, token);
      break;
    default:
      throw new Error(`Protocol ${protocol} not supported`);
  }

  log('WALLET', account.address);
  log('USDC', `${usdc.toFixed(6)} USDC`);
  log('POSITION', `${pos.currentValueUsd.toFixed(6)} USD, ${pos.yieldTokenBalance.toFixed(6)} yield tokens`);
}

async function evmDeposit() {
  const account = getEvmAccount();
  const publicClient = createPublicClient({ chain: mainnet, transport: http(ETH_RPC) });
  const walletClient = createWalletClient({ account, chain: mainnet, transport: http(ETH_RPC) });

  const config = PROTOCOL_ADDRESSES[protocol];
  if (!config) throw new Error(`No config for ${protocol}`);

  log('DEPOSIT', `${amount} USDC into ${protocol}`);
  const balance = await publicClient.readContract({
    address: TOKEN_ADDRESSES.USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  const balBefore = Number(balance) / 10 ** TOKEN_DECIMALS.USDC;
  log('BALANCE', `Before: ${balBefore.toFixed(6)} USDC`);
  if (balBefore < parseFloat(amount)) {
    throw new Error(`Insufficient USDC balance: ${balBefore} < ${amount}`);
  }

  log('STEP 1/4', 'Checking ERC-20 allowance...');
  const needs = await needsApproval(publicClient, token, account.address, config.spender, amount);
  log('ALLOWANCE', needs ? 'Approval needed' : 'Sufficient allowance');

  if (needs) {
    log('STEP 2/4', 'Sending approve transaction...');
    const approveArgs = buildApproveArgs(token, config.spender, amount);
    const approveHash = await walletClient.writeContract(approveArgs as any);
    log('APPROVE TX', approveHash);
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    log('APPROVED', `Block ${approveReceipt.blockNumber}, gas ${approveReceipt.gasUsed}`);
  } else {
    log('STEP 2/4', 'Skipping approve (already approved)');
  }

  log('STEP 3/4', 'Building deposit transaction...');
  const depositArgs = buildDepositTx(protocol, token, amount, account.address);
  log('TX TARGET', `${depositArgs.functionName}() on ${depositArgs.address}`);
  log('STEP 3/4', 'Sending deposit transaction...');
  const depositHash = await walletClient.writeContract(depositArgs as any);
  log('DEPOSIT TX', depositHash);
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  if (depositReceipt.status === 'reverted') throw new Error('Deposit transaction reverted on-chain');
  log('CONFIRMED', `Block ${depositReceipt.blockNumber}, gas ${depositReceipt.gasUsed}`);

  log('STEP 4/4', 'Verifying position...');
  const balAfterRaw = await publicClient.readContract({
    address: TOKEN_ADDRESSES.USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  const balAfter = Number(balAfterRaw) / 10 ** TOKEN_DECIMALS.USDC;

  let pos;
  switch (protocol) {
    case 'aave_v3':
      pos = await getAaveOnChainValue(account.address, token);
      break;
    case 'compound_v3':
      pos = await getCompoundOnChainValue(account.address, token);
      break;
    case 'morpho_steakhouse':
    case 'morpho_reservoir':
      pos = await getErc4626OnChainValue(protocol, account.address, token);
      break;
    default:
      throw new Error(`Protocol ${protocol} not supported`);
  }

  log('BALANCE', `After: ${balAfter.toFixed(6)} USDC (Δ ${(balAfter - balBefore).toFixed(6)})`);
  log('POSITION', `${pos.currentValueUsd.toFixed(6)} USD, ${pos.yieldTokenBalance.toFixed(6)} yield tokens`);
  log('SUCCESS', `✓ Deposit of ${amount} USDC confirmed`);
}

async function evmWithdraw() {
  const account = getEvmAccount();
  const publicClient = createPublicClient({ chain: mainnet, transport: http(ETH_RPC) });
  const walletClient = createWalletClient({ account, chain: mainnet, transport: http(ETH_RPC) });

  log('WITHDRAW', `${amount} USDC from ${protocol}`);

  let posBefore;
  switch (protocol) {
    case 'aave_v3':
      posBefore = await getAaveOnChainValue(account.address, token);
      break;
    case 'compound_v3':
      posBefore = await getCompoundOnChainValue(account.address, token);
      break;
    case 'morpho_steakhouse':
    case 'morpho_reservoir':
      posBefore = await getErc4626OnChainValue(protocol, account.address, token);
      break;
    default:
      throw new Error(`Protocol ${protocol} not supported`);
  }
  log('POSITION', `Before: ${posBefore.currentValueUsd.toFixed(6)} USD`);
  if (posBefore.currentValueUsd < parseFloat(amount)) {
    throw new Error(`Insufficient position value: ${posBefore.currentValueUsd} < ${amount}`);
  }

  const balanceBefore = await publicClient.readContract({
    address: TOKEN_ADDRESSES.USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  const balBefore = Number(balanceBefore) / 10 ** TOKEN_DECIMALS.USDC;

  const isFullWithdrawal = parseFloat(amount) >= posBefore.currentValueUsd * 0.99;

  log('STEP 1/3', 'Building withdraw transaction...');
  const withdrawArgs = buildWithdrawTx(protocol, token, amount, account.address, isFullWithdrawal);
  log('TX TARGET', `${withdrawArgs.functionName}() on ${withdrawArgs.address}`);
  log('STEP 2/3', 'Sending withdraw transaction...');
  const withdrawHash = await walletClient.writeContract(withdrawArgs as any);
  log('WITHDRAW TX', withdrawHash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
  if (receipt.status === 'reverted') throw new Error('Withdraw transaction reverted on-chain');
  log('CONFIRMED', `Block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);

  log('STEP 3/3', 'Verifying...');
  const balanceAfter = await publicClient.readContract({
    address: TOKEN_ADDRESSES.USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  const balAfter = Number(balanceAfter) / 10 ** TOKEN_DECIMALS.USDC;
  log('BALANCE', `After: ${balAfter.toFixed(6)} USDC (Δ +${(balAfter - balBefore).toFixed(6)})`);
  log('SUCCESS', `✓ Withdrawal confirmed`);
}

// ─── Solana helpers ───────────────────────────────────────────────────

function getSolanaKeypair(): Keypair {
  const PK = process.env.TEST_SOLANA_PRIVATE_KEY;
  if (!PK) {
    console.error('❌ TEST_SOLANA_PRIVATE_KEY not set (required for Solana protocols)');
    console.error('   Expected: base58-encoded 64-byte keypair (same format Phantom exports)');
    process.exit(1);
  }
  try {
    const secret = bs58.decode(PK.trim());
    return Keypair.fromSecretKey(secret);
  } catch (e: any) {
    console.error('❌ Failed to decode Solana private key:', e.message);
    process.exit(1);
  }
}

async function getSolanaUsdcBalance(connection: Connection, owner: PublicKey): Promise<number> {
  const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, { mint: USDC_MINT });
  if (tokenAccounts.value.length === 0) return 0;
  const info = tokenAccounts.value[0].account.data.parsed.info;
  return info.tokenAmount.uiAmount ?? 0;
}

async function solanaStatus() {
  const keypair = getSolanaKeypair();
  const connection = new Connection(SOL_RPC, 'confirmed');

  const usdc = await getSolanaUsdcBalance(connection, keypair.publicKey);
  const solLamports = await connection.getBalance(keypair.publicKey);
  const sol = solLamports / 1e9;

  let pos;
  if (protocol === 'kamino' || protocol === 'kamino_multiply') {
    pos = await getKaminoPosition(connection, keypair.publicKey, token, 'mainnet-beta');
  } else {
    throw new Error(`Protocol ${protocol} not supported`);
  }

  log('WALLET', keypair.publicKey.toBase58());
  log('SOL', `${sol.toFixed(6)} SOL`);
  log('USDC', `${usdc.toFixed(6)} USDC`);
  log('POSITION', `${pos.currentValueUsd.toFixed(6)} USD, ${pos.yieldTokenBalance.toFixed(6)} yield tokens`);
}

async function solanaDeposit() {
  const keypair = getSolanaKeypair();
  const connection = new Connection(SOL_RPC, 'confirmed');

  log('DEPOSIT', `${amount} USDC into ${protocol}`);
  const usdcBefore = await getSolanaUsdcBalance(connection, keypair.publicKey);
  log('BALANCE', `Before: ${usdcBefore.toFixed(6)} USDC`);
  if (usdcBefore < parseFloat(amount)) {
    throw new Error(`Insufficient USDC: ${usdcBefore} < ${amount}`);
  }

  log('STEP 1/4', 'Building deposit transaction...');
  let tx: Transaction;
  if (protocol === 'kamino' || protocol === 'kamino_multiply') {
    tx = await buildKaminoDepositTx(connection, keypair.publicKey, token, parseFloat(amount), 'mainnet-beta');
  } else {
    throw new Error(`Protocol ${protocol} not supported`);
  }

  if (tx.instructions.length === 0) {
    throw new Error('Builder returned empty transaction — protocol likely needs an existing obligation/account');
  }

  log('STEP 2/4', `Signing transaction (${tx.instructions.length} instructions)...`);
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;
  tx.sign(keypair);

  log('STEP 3/4', 'Sending transaction...');
  const signature = await connection.sendRawTransaction(tx.serialize());
  log('TX HASH', signature);

  log('STEP 4/4', 'Confirming...');
  const confirmation = await connection.confirmTransaction(signature, 'confirmed');
  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  log('CONFIRMED', 'Transaction landed on-chain');

  const usdcAfter = await getSolanaUsdcBalance(connection, keypair.publicKey);
  log('BALANCE', `After: ${usdcAfter.toFixed(6)} USDC (Δ ${(usdcAfter - usdcBefore).toFixed(6)})`);
  log('SUCCESS', `✓ Deposit of ${amount} USDC confirmed`);
}

async function solanaWithdraw() {
  const keypair = getSolanaKeypair();
  const connection = new Connection(SOL_RPC, 'confirmed');

  log('WITHDRAW', `${amount} USDC from ${protocol}`);
  const usdcBefore = await getSolanaUsdcBalance(connection, keypair.publicKey);

  const isFullWithdrawal = false; // partial for safety

  log('STEP 1/4', 'Building withdraw transaction...');
  let tx: Transaction;
  if (protocol === 'kamino' || protocol === 'kamino_multiply') {
    tx = await buildKaminoWithdrawTx(connection, keypair.publicKey, token, parseFloat(amount), isFullWithdrawal, 'mainnet-beta');
  } else {
    throw new Error(`Protocol ${protocol} not supported`);
  }

  if (tx.instructions.length === 0) {
    throw new Error('Builder returned empty transaction');
  }

  log('STEP 2/4', `Signing transaction (${tx.instructions.length} instructions)...`);
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;
  tx.sign(keypair);

  log('STEP 3/4', 'Sending transaction...');
  const signature = await connection.sendRawTransaction(tx.serialize());
  log('TX HASH', signature);

  log('STEP 4/4', 'Confirming...');
  const confirmation = await connection.confirmTransaction(signature, 'confirmed');
  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  log('CONFIRMED', 'Transaction landed on-chain');

  const usdcAfter = await getSolanaUsdcBalance(connection, keypair.publicKey);
  log('BALANCE', `After: ${usdcAfter.toFixed(6)} USDC (Δ +${(usdcAfter - usdcBefore).toFixed(6)})`);
  log('SUCCESS', `✓ Withdrawal confirmed`);
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  log('START', `protocol=${protocol} action=${action} amount=${amount}`);
  log('NETWORK', isEvm ? 'Ethereum mainnet' : 'Solana mainnet-beta');

  try {
    if (isEvm) {
      switch (action) {
        case 'status':
        case 'balance':
          await evmStatus();
          break;
        case 'deposit':
          if (!amount || parseFloat(amount) <= 0) throw new Error('Amount required for deposit');
          await evmDeposit();
          break;
        case 'withdraw':
          if (!amount || parseFloat(amount) <= 0) throw new Error('Amount required for withdraw');
          await evmWithdraw();
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } else if (isSolana) {
      switch (action) {
        case 'status':
        case 'balance':
          await solanaStatus();
          break;
        case 'deposit':
          if (!amount || parseFloat(amount) <= 0) throw new Error('Amount required for deposit');
          await solanaDeposit();
          break;
        case 'withdraw':
          if (!amount || parseFloat(amount) <= 0) throw new Error('Amount required for withdraw');
          await solanaWithdraw();
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    }
  } catch (err: any) {
    log('ERROR', err?.shortMessage ?? err?.message ?? String(err));
    if (err?.cause) log('CAUSE', String(err.cause));
    process.exit(1);
  }
}

main();
