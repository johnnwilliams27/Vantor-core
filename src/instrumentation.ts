import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
    // Fail loud on bad crypto config BEFORE handling requests.
    // This exercises the full provider + envelope path with a throwaway plaintext.
    const { encryptJson } = await import('./lib/crypto/envelope');
    await encryptJson({ startup_check: true });
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
