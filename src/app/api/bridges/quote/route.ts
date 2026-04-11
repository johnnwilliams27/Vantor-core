import { NextRequest, NextResponse } from 'next/server';

// POST is intentionally disabled. Bridge.xyz does not offer a cross-chain
// bridging primitive — that's LayerZero / Wormhole / Circle CCTP territory,
// confirmed against their documented endpoint inventory on 2026-04-11. The
// speculative /v0/quotes/bridge path returns a generic 400 from Bridge's
// API gateway because the route does not exist. A real bridging provider
// will be wired up in a future PR. The /bridges page shows a Coming Soon
// placeholder until then.
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error: 'bridges_disabled',
      message: 'Cross-chain bridging is temporarily disabled while we integrate a dedicated bridging provider.',
    },
    { status: 501 },
  );
}
