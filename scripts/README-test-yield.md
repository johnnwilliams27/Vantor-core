# Yield Protocol CLI Test Script

Test real on-chain yield deposit/withdraw flows from the command line without going through the browser UI.

## Setup

1. Create a fresh test wallet (or use an existing one with minimal funds).
2. Get its private key (64-char hex, starts with `0x`).
3. Fund it with:
   - A small amount of USDC (e.g. $10) on Ethereum mainnet
   - A small amount of ETH for gas (e.g. 0.005 ETH)

## Usage

```bash
# Check wallet balance and current position in a protocol
TEST_WALLET_PRIVATE_KEY=0x... npx tsx scripts/test-yield.ts <protocol> status

# Deposit N USDC into a protocol
TEST_WALLET_PRIVATE_KEY=0x... npx tsx scripts/test-yield.ts <protocol> deposit 5

# Withdraw N USDC from a protocol
TEST_WALLET_PRIVATE_KEY=0x... npx tsx scripts/test-yield.ts <protocol> withdraw 5
```

## Supported Protocols

- `aave_v3`
- `compound_v3`
- `morpho_steakhouse`
- `morpho_reservoir`

## Example: Full deposit/withdraw cycle for Aave V3

```bash
# 1. Check current state
TEST_WALLET_PRIVATE_KEY=0xYOUR_KEY npx tsx scripts/test-yield.ts aave_v3 status

# 2. Deposit $5 USDC
TEST_WALLET_PRIVATE_KEY=0xYOUR_KEY npx tsx scripts/test-yield.ts aave_v3 deposit 5

# 3. Verify position exists
TEST_WALLET_PRIVATE_KEY=0xYOUR_KEY npx tsx scripts/test-yield.ts aave_v3 status

# 4. Withdraw it back
TEST_WALLET_PRIVATE_KEY=0xYOUR_KEY npx tsx scripts/test-yield.ts aave_v3 withdraw 5

# 5. Confirm withdrawn
TEST_WALLET_PRIVATE_KEY=0xYOUR_KEY npx tsx scripts/test-yield.ts aave_v3 status
```

## What it exercises

The same production code path as the web app:
- `buildDepositTx` / `buildWithdrawTx` (contract ABI + args)
- `needsApproval` / `buildApproveArgs` (ERC-20 allowance)
- `getAaveOnChainValue` / `getCompoundOnChainValue` / `getErc4626OnChainValue` (position reads)
- Real contract addresses from `PROTOCOL_ADDRESSES`

If this works end-to-end, the web UI flow should work too since it uses the same building blocks via wagmi.

## Safety

- This is **mainnet** — transactions cost real money
- Start small ($5 per protocol) to verify the flow
- Keep the test wallet isolated — don't use your main wallet
- ETH gas per test is ~$1-3 depending on network conditions
- Total cost to validate all 4 EVM protocols: ~$20-40 (gas) + whatever you leave deposited

## Troubleshooting

- **`Insufficient USDC balance`** — Send more USDC to the test wallet
- **`Transaction reverted on-chain`** — The contract rejected the call; check protocol liquidity/state or contract address
- **`Insufficient funds for gas`** — Send more ETH to the test wallet
- **RPC errors** — Set `ETHEREUM_RPC_URL` to your Infura/Alchemy URL: `ETHEREUM_RPC_URL=https://...`
