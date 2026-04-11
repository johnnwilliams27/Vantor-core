import { NextRequest, NextResponse } from 'next/server';

// POST is intentionally disabled. See /api/swaps/quote for the full
// explanation — Bridge.xyz has no swap primitive, and the replacement
// architecture routes signing client-side through the user's connected
// wallet via a DEX aggregator, so a server-side execute endpoint will
// look very different when it returns (if at all). The /swaps page
// shows a Coming Soon placeholder until then.
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error: 'swaps_disabled',
      message: 'Stablecoin swaps are temporarily disabled while we integrate a dedicated DEX aggregator.',
    },
    { status: 501 },
  );
}
