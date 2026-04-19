import { cookies } from 'next/headers';

export type IntegrationMode = 'mock' | 'sandbox' | 'live';

/**
 * Determines the integration mode for the current request.
 * - FORCE_MOCK=true → mock (offline/CI escape hatch)
 * - Lite tier → mock (dummy data, no API calls — even in test mode)
 * - Paid tier + test mode → sandbox (sandbox API calls)
 * - Paid tier + live mode → live (live API calls)
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
 *
 * For sandbox and live modes, throws an Error naming the exact environment
 * variable the operator needs to set if the corresponding key is missing
 * or empty. This is deliberately fail-loud — the previous silent-empty-string
 * behavior caused a 90+ minute production debug on 2026-04-11 when a missing
 * BRIDGE_API_KEY_LIVE surfaced as an opaque Bridge.xyz 401 instead of a
 * clear "your env var is not set" at the integration boundary.
 *
 * Mock mode keeps the empty-string fallback because mock adapters must not
 * hit real APIs — an empty credential in mock mode is harmless, and throwing
 * would break offline development and CI flows that deliberately leave
 * provider keys unset.
 *
 * @param mode current integration mode
 * @param credentialName the env-var prefix for this credential, e.g.
 *   'BRIDGE_API_KEY' or 'BELVO_SECRET_KEY_ID'. The runtime variable is
 *   expected to be `${credentialName}_SANDBOX` or `${credentialName}_LIVE`.
 * @param sandboxKey the sandbox-mode value (typically `process.env.${credentialName}_SANDBOX`)
 * @param liveKey the live-mode value (typically `process.env.${credentialName}_LIVE`)
 */
export function getCredential(
  mode: IntegrationMode,
  credentialName: string,
  sandboxKey: string | undefined,
  liveKey: string | undefined,
): string {
  if (mode === 'mock') return sandboxKey || '';
  const key = mode === 'sandbox' ? sandboxKey : liveKey;
  if (!key) {
    const envVar = `${credentialName}_${mode.toUpperCase()}`;
    throw new Error(
      `Missing ${envVar} in environment — required for mode=${mode}. ` +
      `Set ${envVar} in your .env.local (local dev) or in the Vercel ` +
      `environment variables dashboard (production). If you intended to ` +
      `run without live credentials, set FORCE_MOCK=true to route through ` +
      `the mock adapter.`,
    );
  }
  return key;
}
