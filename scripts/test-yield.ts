/**
 * CLI test script for yield protocol deposit/withdraw on mainnet.
 *
 * Usage:
 *   TEST_WALLET_PRIVATE_KEY=0x... npx tsx scripts/test-yield.ts <protocol> <action> <amount>
 *
 * Examples:
 *   TEST_WALLET_PRIVATE_KEY=0x... npx tsx scripts/test-yield.ts aave_v3 deposit 5
 *   TEST_WALLET_PRIVATE_KEY=0x... npx tsx scripts/test-yield.ts aave_v3 withdraw 5
 *   TEST_WALLET_PRIVATE_KEY=0x... npx tsx scripts/test-yield.ts aave_v3 status
 *
 * Supported protocols (EVM):
 *   aave_v3, compound_v3, morpho_steakhouse, morpho_reservoir
 *
 * SAFETY:
 *   - Uses real mainnet — real money, real gas
 *   - Start with small amounts ($5 USDC)
 *   - Test wallet should have minimal funds
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { buildDepositTx } from '../src/lib/yield/contracts/deposit';
import { buildWithdrawTx } from '../src/lib/yield/contracts/withdraw';
import { buildApproveArgs, needsApproval } from '../src/lib/yield/contracts/allowance';
import { PROTOCOL_ADDRESSES, TOKEN_ADDRESSES, TOKEN_DECIMALS } from '../src/lib/yield/contracts/addresses';
import { getAaveOnChainValue } from '../src/lib/yield/adapters/aave-v3';
import { getCompoundOnChainValue } from '../src/lib/yield/adapters/compound-v3';
import { getErc4626OnChainValue } from '../src/lib/yield/adapters/erc4626';
import { ERC20_ABI } from '../src/lib/yield/contracts/abis';
import type { YieldProtocolId } from '../src/lib/yield/interface';

const RPC_URL = process.env.ETHEREUM_RPC_URL ?? 'https://eth.llamarpc.com';
const PK = process.env.TEST_WALLET_PRIVATE_KEY;

if (!PK) {
  console.error('❌ TEST_WALLET_PRIVATE_KEY not set');
  console.error('   Usage: TEST_WALLET_PRIVATE_KEY=0x... npx tsx scripts/test-yield.ts <protocol> <action> <amount>');
  process.exit(1);
}

const [, , protocolArg, action, amountArg] = process.argv;

if (!protocolArg || !action) {
  console.error('❌ Missing arguments');
  console.error('   Usage: npx tsx scripts/test-yield.ts <protocol> <action> [amount]');
  console.error('   Actions: deposit, withdraw, status, balance');
  process.exit(1);
}

const protocol = protocolArg as YieldProtocolId;
const token = 'USDC';
const amount = amountArg ?? '0';

const account = privateKeyToAccount(PK as `0x${string}`);
const publicClient = createPublicClient({ chain: mainnet, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: mainnet, transport: http(RPC_URL) });

function log(step: string, msg: string) {
  const time = new Date().toISOString().split('T')[1].slice(0, 8);
  console.log(`[${time}] ${step.padEnd(12)} ${msg}`);
}

async function getUsdcBalance(): Promise<number> {
  const balance = await publicClient.readContract({
    address: TOKEN_ADDRESSES.USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  return Number(balance) / 10 ** TOKEN_DECIMALS.USDC;
}

async function getPosition() {
  switch (protocol) {
    case 'aave_v3':
      return await getAaveOnChainValue(account.address, token);
    case 'compound_v3':
      return await getCompoundOnChainValue(account.address, token);
    case 'morpho_steakhouse':
    case 'morpho_reservoir':
      return await getErc4626OnChainValue(protocol, account.address, token);
    default:
      throw new Error(`Protocol ${protocol} not supported by this script`);
  }
}

async function status() {
  log('WALLET', account.address);
  log('USDC', `${(await getUsdcBalance()).toFixed(6)} USDC`);
  const pos = await getPosition();
  log('POSITION', `${pos.currentValueUsd.toFixed(6)} USD, ${pos.yieldTokenBalance.toFixed(6)} yield tokens`);
}

async function deposit() {
  const config = PROTOCOL_ADDRESSES[protocol];
  if (!config) throw new Error(`No config for ${protocol}`);

  log('DEPOSIT', `${amount} USDC into ${protocol}`);
  const balBefore = await getUsdcBalance();
  log('BALANCE', `Before: ${balBefore.toFixed(6)} USDC`);
  if (balBefore < parseFloat(amount)) {
    throw new Error(`Insufficient USDC balance: ${balBefore} < ${amount}`);
  }

  // 1. Check allowance
  log('STEP 1/4', 'Checking ERC-20 allowance...');
  const needs = await needsApproval(publicClient, token, account.address, config.spender, amount);
  log('ALLOWANCE', needs ? 'Approval needed' : 'Sufficient allowance');

  // 2. Approve if needed
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

  // 3. Deposit
  log('STEP 3/4', 'Building deposit transaction...');
  const depositArgs = buildDepositTx(protocol, token, amount, account.address);
  log('TX TARGET', `${depositArgs.functionName}() on ${depositArgs.address}`);
  log('STEP 3/4', 'Sending deposit transaction...');
  const depositHash = await walletClient.writeContract(depositArgs as any);
  log('DEPOSIT TX', depositHash);
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  if (depositReceipt.status === 'reverted') {
    throw new Error('Deposit transaction reverted on-chain');
  }
  log('CONFIRMED', `Block ${depositReceipt.blockNumber}, gas ${depositReceipt.gasUsed}`);

  // 4. Verify
  log('STEP 4/4', 'Verifying position...');
  const balAfter = await getUsdcBalance();
  const pos = await getPosition();
  log('BALANCE', `After: ${balAfter.toFixed(6)} USDC (Δ ${(balAfter - balBefore).toFixed(6)})`);
  log('POSITION', `${pos.currentValueUsd.toFixed(6)} USD, ${pos.yieldTokenBalance.toFixed(6)} yield tokens`);
  log('SUCCESS', `✓ Deposit of ${amount} USDC confirmed`);
}

async function withdraw() {
  log('WITHDRAW', `${amount} USDC from ${protocol}`);
  const posBefore = await getPosition();
  log('POSITION', `Before: ${posBefore.currentValueUsd.toFixed(6)} USD`);
  if (posBefore.currentValueUsd < parseFloat(amount)) {
    throw new Error(`Insufficient position value: ${posBefore.currentValueUsd} < ${amount}`);
  }

  const balBefore = await getUsdcBalance();
  const isFullWithdrawal = parseFloat(amount) >= posBefore.currentValueUsd * 0.99;

  log('STEP 1/3', 'Building withdraw transaction...');
  const withdrawArgs = buildWithdrawTx(protocol, token, amount, account.address, isFullWithdrawal);
  log('TX TARGET', `${withdrawArgs.functionName}() on ${withdrawArgs.address}`);
  log('STEP 2/3', 'Sending withdraw transaction...');
  const withdrawHash = await walletClient.writeContract(withdrawArgs as any);
  log('WITHDRAW TX', withdrawHash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
  if (receipt.status === 'reverted') {
    throw new Error('Withdraw transaction reverted on-chain');
  }
  log('CONFIRMED', `Block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);

  log('STEP 3/3', 'Verifying...');
  const balAfter = await getUsdcBalance();
  const posAfter = await getPosition();
  log('BALANCE', `After: ${balAfter.toFixed(6)} USDC (Δ +${(balAfter - balBefore).toFixed(6)})`);
  log('POSITION', `After: ${posAfter.currentValueUsd.toFixed(6)} USD`);
  log('SUCCESS', `✓ Withdrawal confirmed`);
}

async function main() {
  log('START', `protocol=${protocol} action=${action} amount=${amount}`);
  log('NETWORK', 'Ethereum mainnet');

  try {
    switch (action) {
      case 'status':
      case 'balance':
        await status();
        break;
      case 'deposit':
        if (!amount || parseFloat(amount) <= 0) throw new Error('Amount required for deposit');
        await deposit();
        break;
      case 'withdraw':
        if (!amount || parseFloat(amount) <= 0) throw new Error('Amount required for withdraw');
        await withdraw();
        break;
      default:
        throw new Error(`Unknown action: ${action}. Use deposit, withdraw, or status.`);
    }
  } catch (err: any) {
    log('ERROR', err?.shortMessage ?? err?.message ?? String(err));
    if (err?.cause) log('CAUSE', String(err.cause));
    process.exit(1);
  }
}

main();
