import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export class TierGateError extends Error {
  constructor(message = 'This action requires a paid plan') {
    super(message);
    this.name = 'TierGateError';
  }
}

/**
 * Throws TierGateError if the user is on the Lite (free) tier AND not
 * in test mode. Lite users in test mode are allowed through so they
 * can try the full flow against mock adapters.
 */
export function requirePaidTier(subscriptionTier: string): void {
  if (subscriptionTier === 'lite') {
    const isTestMode = cookies().get('vantor_test_mode')?.value === '1';
    if (!isTestMode) throw new TierGateError();
  }
}

/**
 * Returns a 403 response for Lite tier users attempting gated actions.
 */
export function tierGateResponse(feature?: string) {
  return NextResponse.json(
    {
      error: 'upgrade_required',
      message: feature
        ? `Upgrade to a paid plan to ${feature}`
        : 'This action requires a paid plan',
    },
    { status: 403 },
  );
}
