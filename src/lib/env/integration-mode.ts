import { cookies } from 'next/headers';

export type IntegrationMode = 'mock' | 'sandbox' | 'live';

/**
 * Determines the integration mode for the current request.
 * - Lite tier → mock (dummy data, no API calls)
 * - Paid tier + test mode → sandbox (sandbox API calls)
 * - Paid tier + live mode → live (live API calls)
 * - FORCE_MOCK=true → mock (offline/CI escape hatch)
 */
export function getIntegrationMode(subscriptionTier: string): IntegrationMode {
  if (process.env.FORCE_MOCK === 'true') return 'mock';
  if (subscriptionTier === 'lite') return 'mock';

  const cookieStore = cookies();
  const isTestMode = cookieStore.get('vantor_test_mode')?.value === '1';
  return isTestMode ? 'sandbox' : 'live';
}

/**
 * Selects the correct credentials based on integration mode.
 */
export function getCredential(mode: IntegrationMode, sandboxKey: string | undefined, liveKey: string | undefined): string {
  if (mode === 'mock') return sandboxKey || '';
  return (mode === 'sandbox' ? sandboxKey : liveKey) || '';
}
