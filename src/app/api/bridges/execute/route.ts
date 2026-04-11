import { NextRequest, NextResponse } from 'next/server';

// POST is intentionally disabled. See /api/bridges/quote for the full
// explanation — Bridge.xyz has no cross-chain bridging primitive, and
// the replacement architecture routes signing client-side through the
// user's connected wallet via a real bridging protocol (CCTP / LayerZero
// / Wormhole), so a server-side execute endpoint will look very different
// when it returns (if at all). The /bridges page shows a Coming Soon
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
