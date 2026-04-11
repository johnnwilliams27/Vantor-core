import { NextRequest, NextResponse } from 'next/server';

// POST is intentionally disabled. Bridge.xyz does not offer a stablecoin
// swap endpoint — confirmed against their documented endpoint inventory
// on 2026-04-11. The speculative /v0/quotes/swap path returns a generic
// 400 from Bridge's API gateway because the route does not exist. A real
// DEX aggregator (0x / 1inch for EVM, Jupiter for Solana) will be wired
// up in a future PR. The /swaps page shows a Coming Soon placeholder
// until then.
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error: 'swaps_disabled',
      message: 'Stablecoin swaps are temporarily disabled while we integrate a dedicated DEX aggregator.',
    },
    { status: 501 },
  );
}
