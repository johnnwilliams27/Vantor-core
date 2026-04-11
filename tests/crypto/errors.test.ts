import { describe, it, expect } from 'vitest';
import {
  CryptoError,
  cryptoMissingKey,
  cryptoBadKeyFormat,
  cryptoBadEnvelope,
  cryptoBadVersion,
  cryptoUnknownKeyId,
  cryptoAuthTagMismatch,
  cryptoJsonParseFail,
  cryptoProviderUnavailable,
} from '@/lib/crypto/errors';

describe('CryptoError factory', () => {
  it('cryptoMissingKey sets code, explanation, and next_step', () => {
    const err = cryptoMissingKey();
    expect(err).toBeInstanceOf(CryptoError);
    expect(err.code).toBe('CRYPTO_MISSING_KEY');
    expect(err.next_step).toMatch(/npm run crypto:gen/);
    expect(err.fields.trace_id).toBeDefined();
  });

  it('cryptoBadKeyFormat carries the offending key_id', () => {
    const err = cryptoBadKeyFormat({ key_id: 'legacy-v0' });
    expect(err.code).toBe('CRYPTO_BAD_KEY_FORMAT');
    expect(err.fields.key_id).toBe('legacy-v0');
  });

  it('cryptoBadEnvelope is throwable', () => {
    const err = cryptoBadEnvelope({ row_locator: 'erp_configurations/id=x' });
    expect(err.code).toBe('CRYPTO_BAD_ENVELOPE');
    expect(err.fields.row_locator).toBe('erp_configurations/id=x');
  });

  it('cryptoBadVersion carries the offending version', () => {
    const err = cryptoBadVersion({ version: 'v2' });
    expect(err.code).toBe('CRYPTO_BAD_VERSION');
    expect(err.fields.version).toBe('v2');
  });

  it('cryptoUnknownKeyId carries the unknown key_id', () => {
    const err = cryptoUnknownKeyId({ key_id: 'not-in-registry', row_locator: 'slack_integrations/user=42' });
    expect(err.code).toBe('CRYPTO_UNKNOWN_KEY_ID');
    expect(err.fields.key_id).toBe('not-in-registry');
    expect(err.fields.row_locator).toBe('slack_integrations/user=42');
  });

  it('cryptoAuthTagMismatch carries key_id and row_locator', () => {
    const err = cryptoAuthTagMismatch({ key_id: 'v1', row_locator: 'erp_configurations/id=abc' });
    expect(err.code).toBe('CRYPTO_AUTH_TAG_MISMATCH');
    expect(err.fields.key_id).toBe('v1');
  });

  it('cryptoJsonParseFail is constructible', () => {
    const err = cryptoJsonParseFail({ row_locator: 'x' });
    expect(err.code).toBe('CRYPTO_JSON_PARSE_FAIL');
  });

  it('cryptoProviderUnavailable is constructible', () => {
    const err = cryptoProviderUnavailable({ cause: 'kms timeout' });
    expect(err.code).toBe('CRYPTO_PROVIDER_UNAVAILABLE');
    expect(err.fields.cause).toBe('kms timeout');
  });

  it('toUserFacing exposes only code, next_step, trace_id', () => {
    const err = cryptoAuthTagMismatch({ key_id: 'v1', row_locator: 'erp_configurations/id=abc' });
    const user = err.toUserFacing();
    expect(user).toEqual({
      code: 'CRYPTO_AUTH_TAG_MISMATCH',
      next_step: err.next_step,
      trace_id: err.fields.trace_id,
    });
    expect((user as Record<string, unknown>).key_id).toBeUndefined();
    expect((user as Record<string, unknown>).row_locator).toBeUndefined();
  });
});
