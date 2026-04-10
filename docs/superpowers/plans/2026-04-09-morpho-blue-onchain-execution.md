# Morpho Blue On-Chain Execution — Plan C

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable real on-chain deposits and withdrawals for Morpho Blue direct lending markets, with market selection UI and position tracking via the Morpho GraphQL API.

**Architecture:** Same two-phase model as Plan A (frontend signs → backend records). Morpho Blue uses a singleton contract where users supply to specific markets identified by a MarketParams struct. The frontend builds the supply/withdraw calldata with the correct market parameters, user signs via wagmi, backend records the confirmed transaction.

**Tech Stack:** wagmi v2, viem, Morpho Blue GraphQL API (`blue-api.morpho.org/graphql`), existing RainbowKit wallet connection.

**Prerequisite:** Plan A must be completed first — this plan reuses the allowance module, confirm endpoints, and hook patterns from Plan A.

---

## Morpho Blue Contract Architecture

Morpho Blue has a single immutable contract at `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`.

Each market is identified by a `MarketParams` struct:
```solidity
struct MarketParams {
    address loanToken;      // e.g. USDC
    address collateralToken;
    address oracle;
    address irm;           // interest rate model
    uint256 lltv;          // liquidation LTV
}
```

The market ID is the keccak256 hash of the packed MarketParams.

**Supply:** `Morpho.supply(MarketParams, assets, shares, onBehalfOf, data)`
- Set `assets` to the deposit amount, `shares` to 0 (let contract calculate)
- `onBehalfOf` = user's wallet address
- `data` = empty bytes

**Withdraw:** `Morpho.withdraw(MarketParams, assets, shares, onBehalfOf, receiver)`
- Set `assets` to withdrawal amount (or 0 + shares for full withdrawal)
- `receiver` = user's wallet address

**ERC-20 approval** goes to the Morpho contract address, NOT the market.

---

## File Structure

### New files
- `src/lib/yield/contracts/morpho-blue.ts` — Morpho Blue ABI, market params, supply/withdraw builders
- `src/lib/yield/adapters/morpho-blue.ts` — Position query via GraphQL (enhance existing stub)

### Modified files
- `src/lib/yield/contracts/addresses.ts` — Add Morpho Blue contract address
- `src/lib/yield/contracts/deposit.ts` — Add morpho case
- `src/lib/yield/contracts/withdraw.ts` — Add morpho case
- `src/lib/yield/factory.ts` — Update morpho position query to use GraphQL
- `src/components/yield/YieldRatesTable.tsx` — Morpho market selector in deposit form

---

### Task 1: Morpho Blue Contract Module

**Files:**
- Create: `src/lib/yield/contracts/morpho-blue.ts`

- [ ] **Step 1: Create Morpho Blue contract module**

```typescript
// src/lib/yield/contracts/morpho-blue.ts
import { encodeAbiParameters, keccak256, parseUnits } from 'viem';
import { TOKEN_ADDRESSES, TOKEN_DECIMALS } from './addresses';

export const MORPHO_BLUE_ADDRESS = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb' as `0x${string}`;

// Minimal ABI for supply and withdraw
export const MORPHO_BLUE_ABI = [
  {
    name: 'supply',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'marketParams',
        type: 'tuple',
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
      },
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
      {
        name: 'marketParams',
        type: 'tuple',
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
      },
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

/**
 * Curated Morpho Blue markets for USDC/USDT supply.
 * These are high-liquidity, whitelisted markets.
 * Market IDs fetched from Morpho Blue API.
 */
export const CURATED_MARKETS: {
  id: string;
  label: string;
  token: string;
  params: MorphoMarketParams;
}[] = [
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

export function buildMorphoSupplyArgs(
  marketParams: MorphoMarketParams,
  token: string,
  amount: string,
  walletAddress: `0x${string}`,
) {
  const decimals = TOKEN_DECIMALS[token] ?? 6;
  const amountWei = parseUnits(amount, decimals);

  return {
    address: MORPHO_BLUE_ADDRESS,
    abi: MORPHO_BLUE_ABI,
    functionName: 'supply' as const,
    args: [
      marketParams,
      amountWei,
      BigInt(0), // shares = 0, let contract calculate
      walletAddress,
      '0x' as `0x${string}`, // empty callback data
    ] as const,
  };
}

export function buildMorphoWithdrawArgs(
  marketParams: MorphoMarketParams,
  token: string,
  amount: string,
  walletAddress: `0x${string}`,
  isFullWithdrawal: boolean,
) {
  const decimals = TOKEN_DECIMALS[token] ?? 6;
  const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

  return {
    address: MORPHO_BLUE_ADDRESS,
    abi: MORPHO_BLUE_ABI,
    functionName: 'withdraw' as const,
    args: [
      marketParams,
      isFullWithdrawal ? BigInt(0) : parseUnits(amount, decimals), // assets
      isFullWithdrawal ? MAX_UINT256 : BigInt(0), // shares (max for full withdrawal)
      walletAddress,
      walletAddress,
    ] as const,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/yield/contracts/morpho-blue.ts
git commit -m "feat: add Morpho Blue contract module with curated markets"
```

---

### Task 2: Wire Morpho Blue into Deposit/Withdraw Builders

**Files:**
- Modify: `src/lib/yield/contracts/addresses.ts`
- Modify: `src/lib/yield/contracts/deposit.ts`
- Modify: `src/lib/yield/contracts/withdraw.ts`

- [ ] **Step 1: Add Morpho Blue to addresses**

In `src/lib/yield/contracts/addresses.ts`, add to PROTOCOL_ADDRESSES:

```typescript
morpho: {
  router: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
  spender: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
  type: 'morpho_blue' as any,
},
```

Update the ProtocolAddresses type to include `'morpho_blue'`:
```typescript
type: 'aave' | 'compound' | 'erc4626' | 'ondo' | 'morpho_blue';
```

- [ ] **Step 2: Add morpho_blue case to deposit builder**

In `src/lib/yield/contracts/deposit.ts`, add import:
```typescript
import { buildMorphoSupplyArgs, CURATED_MARKETS } from './morpho-blue';
```

Add case in the switch:
```typescript
case 'morpho_blue': {
  // Default to first curated market matching the token
  const market = CURATED_MARKETS.find(m => m.token === token);
  if (!market) throw new Error(`No curated Morpho Blue market for ${token}`);
  return buildMorphoSupplyArgs(market.params, token, amount, walletAddress);
}
```

- [ ] **Step 3: Add morpho_blue case to withdraw builder**

In `src/lib/yield/contracts/withdraw.ts`, add import:
```typescript
import { buildMorphoWithdrawArgs, CURATED_MARKETS } from './morpho-blue';
```

Add case in the switch:
```typescript
case 'morpho_blue': {
  const market = CURATED_MARKETS.find(m => m.token === token);
  if (!market) throw new Error(`No curated Morpho Blue market for ${token}`);
  return buildMorphoWithdrawArgs(market.params, token, amount, walletAddress, isFullWithdrawal);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/yield/contracts/addresses.ts src/lib/yield/contracts/deposit.ts src/lib/yield/contracts/withdraw.ts
git commit -m "feat: wire Morpho Blue into deposit/withdraw transaction builders"
```

---

### Task 3: Morpho Blue Position Query via GraphQL

**Files:**
- Create: `src/lib/yield/adapters/morpho-blue.ts`
- Modify: `src/lib/yield/factory.ts`

- [ ] **Step 1: Create Morpho Blue position adapter**

```typescript
// src/lib/yield/adapters/morpho-blue.ts
import type { OnChainValue } from '../interface';
import type { TokenSymbol } from '@/types/database';

const GRAPHQL_URL = 'https://blue-api.morpho.org/graphql';

const USER_POSITIONS_QUERY = `
  query UserPositions($address: String!) {
    userByAddress(address: $address) {
      positions {
        market {
          uniqueKey
          loanAsset { address symbol decimals }
        }
        supplyAssets
        supplyShares
      }
    }
  }
`;

interface MorphoPosition {
  market: {
    uniqueKey: string;
    loanAsset: { address: string; symbol: string; decimals: number };
  };
  supplyAssets: string;
  supplyShares: string;
}

/**
 * Query Morpho Blue positions for a wallet via the GraphQL API.
 * Aggregates all USDC or USDT supply positions across markets.
 */
export async function getMorphoBlueOnChainValue(
  walletAddress: string,
  token: TokenSymbol,
): Promise<OnChainValue> {
  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: USER_POSITIONS_QUERY,
        variables: { address: walletAddress.toLowerCase() },
      }),
    });

    if (!res.ok) {
      console.error(`[morpho-blue] GraphQL error: ${res.status}`);
      return { currentValueUsd: 0, yieldTokenBalance: 0 };
    }

    const data = await res.json();
    const positions: MorphoPosition[] = data?.data?.userByAddress?.positions ?? [];

    // Filter to positions where loanAsset matches requested token
    const matching = positions.filter(
      (p) => p.market.loanAsset.symbol.toUpperCase() === token,
    );

    if (matching.length === 0) {
      return { currentValueUsd: 0, yieldTokenBalance: 0 };
    }

    // Aggregate across all markets for this token
    let totalAssets = 0;
    let totalShares = 0;
    for (const pos of matching) {
      const decimals = pos.market.loanAsset.decimals ?? 6;
      totalAssets += parseFloat(pos.supplyAssets) / 10 ** decimals;
      totalShares += parseFloat(pos.supplyShares) / 1e18;
    }

    return {
      currentValueUsd: totalAssets, // stablecoin ≈ $1
      yieldTokenBalance: totalShares,
    };
  } catch (err) {
    console.error('[morpho-blue] Position query failed:', err);
    return { currentValueUsd: 0, yieldTokenBalance: 0 };
  }
}
```

- [ ] **Step 2: Update factory to use the new adapter**

In `src/lib/yield/factory.ts`, replace the `morpho` case:

```typescript
import { getMorphoBlueOnChainValue } from './adapters/morpho-blue';

// In the switch:
case 'morpho':
  return await getMorphoBlueOnChainValue(walletAddress, token);
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/yield/adapters/morpho-blue.ts src/lib/yield/factory.ts
git commit -m "feat: Morpho Blue position tracking via GraphQL API"
```

---

### Task 4: Market Selector in Deposit UI

**Files:**
- Modify: `src/components/yield/YieldRatesTable.tsx`

- [ ] **Step 1: Add market selector for Morpho Blue deposits**

In `InlineDepositForm`, when the protocol is `morpho`, show a dropdown to select which market to supply to.

Add import:
```typescript
import { CURATED_MARKETS } from '@/lib/yield/contracts/morpho-blue';
```

Add state for selected market:
```typescript
const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
const isMorphoBlue = protocol.id === 'morpho';
const morphoMarkets = isMorphoBlue ? CURATED_MARKETS.filter(m => m.token === token) : [];
```

Add a market selector dropdown after the token selector (only shown for Morpho Blue):
```tsx
{isMorphoBlue && morphoMarkets.length > 0 && (
  <div className="space-y-1.5">
    <label className="text-xs text-muted-foreground font-medium">Market</label>
    <select
      value={selectedMarketId ?? ''}
      onChange={(e) => setSelectedMarketId(e.target.value)}
      className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
    >
      <option value="">Select a market...</option>
      {morphoMarkets.map((m) => (
        <option key={m.id} value={m.id}>{m.label}</option>
      ))}
    </select>
  </div>
)}
```

Pass the selected market to the deposit flow via metadata (the confirm-deposit endpoint records it in position metadata).

- [ ] **Step 2: Commit**

```bash
git add src/components/yield/YieldRatesTable.tsx
git commit -m "feat: add Morpho Blue market selector in deposit form"
```

---

### Task 5: Build Verification

- [ ] **Step 1: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Build**

```bash
npx next build
```

- [ ] **Step 3: Commit and push**

```bash
git add -A
git commit -m "feat: Morpho Blue direct lending — on-chain execution and market selection"
git push origin master
git push origin master:dev
```

---

## Notes

- Curated market list should be updated periodically as Morpho markets evolve. Consider fetching dynamically from the GraphQL API in a future iteration.
- Morpho Blue shares are not ERC-20 tokens — they're tracked internally by the Morpho contract. Position value must always be queried via the GraphQL API or on-chain `position()` view function.
