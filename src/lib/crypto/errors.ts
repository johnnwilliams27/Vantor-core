import { randomUUID } from 'node:crypto';

export type CryptoErrorCode =
  | 'CRYPTO_MISSING_KEY'
  | 'CRYPTO_BAD_KEY_FORMAT'
  | 'CRYPTO_BAD_ENVELOPE'
  | 'CRYPTO_BAD_VERSION'
  | 'CRYPTO_UNKNOWN_KEY_ID'
  | 'CRYPTO_AUTH_TAG_MISMATCH'
  | 'CRYPTO_JSON_PARSE_FAIL'
  | 'CRYPTO_PROVIDER_UNAVAILABLE';

export interface CryptoErrorFields {
  trace_id: string;
  row_locator?: string;
  key_id?: string;
  version?: string;
  cause?: string;
  [key: string]: unknown;
}

export interface CryptoUserFacing {
  code: CryptoErrorCode;
  next_step: string;
  trace_id: string;
}

export class CryptoError extends Error {
  readonly code: CryptoErrorCode;
  readonly explanation: string;
  readonly next_step: string;
  readonly fields: CryptoErrorFields;

  constructor(code: CryptoErrorCode, explanation: string, next_step: string, fields: CryptoErrorFields) {
    super(`[${code}] ${explanation}`);
    this.name = 'CryptoError';
    this.code = code;
    this.explanation = explanation;
    this.next_step = next_step;
    this.fields = fields;
  }

  /** Shape safe to return to the UI — no tokens, no row identity, no key ids. */
  toUserFacing(): CryptoUserFacing {
    return {
      code: this.code,
      next_step: this.next_step,
      trace_id: this.fields.trace_id,
    };
  }
}

function withTrace(fields: Omit<CryptoErrorFields, 'trace_id'> = {}): CryptoErrorFields {
  return { trace_id: randomUUID(), ...fields };
}

export function cryptoMissingKey(extra: Partial<CryptoErrorFields> = {}): CryptoError {
  return new CryptoError(
    'CRYPTO_MISSING_KEY',
    'CREDENTIALS_ENCRYPTION_KEY environment variable is not set.',
    'Run `npm run crypto:gen` to create a key and paste it into your .env.local (or your deployment env).',
    withTrace(extra),
  );
}

export function cryptoBadKeyFormat(extra: { key_id?: string; cause?: string } & Partial<CryptoErrorFields>): CryptoError {
  return new CryptoError(
    'CRYPTO_BAD_KEY_FORMAT',
    'A credential encryption key is malformed.',
    'Check that every key is exactly 64 hexadecimal characters and that key IDs contain only [A-Za-z0-9_-].',
    withTrace(extra),
  );
}

export function cryptoBadEnvelope(extra: Partial<CryptoErrorFields> = {}): CryptoError {
  return new CryptoError(
    'CRYPTO_BAD_ENVELOPE',
    'An encrypted row is corrupted or malformed.',
    'Mark this integration as unusable and prompt the user to reconnect it. Do not retry.',
    withTrace(extra),
  );
}

export function cryptoBadVersion(extra: { version?: string } & Partial<CryptoErrorFields>): CryptoError {
  return new CryptoError(
    'CRYPTO_BAD_VERSION',
    'An encrypted row references an unknown envelope version.',
    'The deployed code does not understand this envelope version. Upgrade the deploy to the latest version.',
    withTrace(extra),
  );
}

export function cryptoUnknownKeyId(extra: { key_id: string } & Partial<CryptoErrorFields>): CryptoError {
  return new CryptoError(
    'CRYPTO_UNKNOWN_KEY_ID',
    'An encrypted row references a key ID that is not loaded in the current key registry.',
    'Add the missing legacy key to CREDENTIALS_ENCRYPTION_KEY_LEGACY, or accept that the row is unreadable and prompt the user to reconnect.',
    withTrace(extra),
  );
}

export function cryptoAuthTagMismatch(extra: { key_id?: string } & Partial<CryptoErrorFields>): CryptoError {
  return new CryptoError(
    'CRYPTO_AUTH_TAG_MISMATCH',
    'An encrypted row failed its authentication tag check — either wrong key, tampered ciphertext, or silent data corruption.',
    'Investigate immediately. Mark the integration as corrupted and prompt the user to reconnect.',
    withTrace(extra),
  );
}

export function cryptoJsonParseFail(extra: Partial<CryptoErrorFields> = {}): CryptoError {
  return new CryptoError(
    'CRYPTO_JSON_PARSE_FAIL',
    'Decryption succeeded but the decrypted bytes are not valid JSON.',
    'Mark the integration as corrupted and prompt the user to reconnect. Investigate the writer that produced this row.',
    withTrace(extra),
  );
}

export function cryptoProviderUnavailable(extra: { cause?: string } & Partial<CryptoErrorFields>): CryptoError {
  return new CryptoError(
    'CRYPTO_PROVIDER_UNAVAILABLE',
    'The credential encryption provider is unreachable.',
    'Retry with backoff. If persistent, the upstream key service is down.',
    withTrace(extra),
  );
}
