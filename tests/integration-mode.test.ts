import { describe, it, expect } from 'vitest';
import { getCredential } from '@/lib/env/integration-mode';

/**
 * getCredential is the shared credential resolver used by every external
 * integration adapter (Bridge, Belvo, etc.). Its behavior is load-bearing:
 * if it silently returns an empty string for a missing key, adapters will
 * dispatch unauthenticated requests to live APIs and the provider will
 * respond with an opaque 401 that's very hard to trace back to "the env
 * var was never set".
 *
 * These tests pin the fail-loud contract:
 *  - mock mode: never throws (adapters in mock mode must not hit real APIs)
 *  - sandbox/live mode with key present: returns the key verbatim
 *  - sandbox/live mode with key missing: throws an Error whose message
 *    names the exact environment variable the operator needs to set
 *
 * See the 2026-04-11 Vantor production swap debug for the incident this
 * contract exists to prevent.
 */

describe('getCredential', () => {
  describe('mock mode', () => {
    it('returns the sandbox value when both keys are present', () => {
      expect(getCredential('mock', 'BRIDGE_API_KEY', 'sb-key', 'live-key')).toBe('sb-key');
    });

    it('returns an empty string when the sandbox key is missing (mock adapters do not hit real APIs)', () => {
      expect(getCredential('mock', 'BRIDGE_API_KEY', undefined, 'live-key')).toBe('');
    });

    it('does not throw even when both keys are missing', () => {
      expect(() => getCredential('mock', 'BRIDGE_API_KEY', undefined, undefined)).not.toThrow();
    });
  });

  describe('sandbox mode', () => {
    it('returns the sandbox key when present', () => {
      expect(getCredential('sandbox', 'BRIDGE_API_KEY', 'sb-key', 'live-key')).toBe('sb-key');
    });

    it('returns the sandbox key even when the live key is missing', () => {
      expect(getCredential('sandbox', 'BRIDGE_API_KEY', 'sb-key', undefined)).toBe('sb-key');
    });

    it('throws with the exact env var name when the sandbox key is missing', () => {
      expect(() => getCredential('sandbox', 'BRIDGE_API_KEY', undefined, 'live-key'))
        .toThrow(/BRIDGE_API_KEY_SANDBOX/);
    });

    it('throws with a message that mentions the mode', () => {
      expect(() => getCredential('sandbox', 'BRIDGE_API_KEY', undefined, undefined))
        .toThrow(/mode=sandbox/);
    });

    it('treats empty string as missing', () => {
      expect(() => getCredential('sandbox', 'BRIDGE_API_KEY', '', 'live-key'))
        .toThrow(/BRIDGE_API_KEY_SANDBOX/);
    });
  });

  describe('live mode', () => {
    it('returns the live key when present', () => {
      expect(getCredential('live', 'BRIDGE_API_KEY', 'sb-key', 'live-key')).toBe('live-key');
    });

    it('returns the live key even when the sandbox key is missing', () => {
      expect(getCredential('live', 'BRIDGE_API_KEY', undefined, 'live-key')).toBe('live-key');
    });

    it('throws with the exact env var name when the live key is missing', () => {
      expect(() => getCredential('live', 'BRIDGE_API_KEY', 'sb-key', undefined))
        .toThrow(/BRIDGE_API_KEY_LIVE/);
    });

    it('throws with a message that mentions the mode', () => {
      expect(() => getCredential('live', 'BRIDGE_API_KEY', undefined, undefined))
        .toThrow(/mode=live/);
    });

    it('treats empty string as missing', () => {
      expect(() => getCredential('live', 'BRIDGE_API_KEY', 'sb-key', ''))
        .toThrow(/BRIDGE_API_KEY_LIVE/);
    });
  });

  describe('credentialName propagation', () => {
    it('names BELVO_SECRET_KEY_ID_LIVE correctly when that credential is missing', () => {
      expect(() => getCredential('live', 'BELVO_SECRET_KEY_ID', 'sb', undefined))
        .toThrow(/BELVO_SECRET_KEY_ID_LIVE/);
    });

    it('names BELVO_SECRET_KEY_PASSWORD_SANDBOX correctly when that credential is missing', () => {
      expect(() => getCredential('sandbox', 'BELVO_SECRET_KEY_PASSWORD', undefined, 'live'))
        .toThrow(/BELVO_SECRET_KEY_PASSWORD_SANDBOX/);
    });
  });
});
