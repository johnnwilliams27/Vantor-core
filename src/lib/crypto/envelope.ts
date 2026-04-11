import { getCipherProvider, type CipherProvider } from './provider';
import {
  cryptoBadEnvelope,
  cryptoBadVersion,
  cryptoJsonParseFail,
  CryptoError,
} from './errors';

const VERSION = 'v1';

export interface DecryptOptions {
  row_locator?: string;
  provider?: CipherProvider;
}

export async function encryptJson<T>(obj: T, provider?: CipherProvider): Promise<string> {
  const p = provider ?? getCipherProvider();
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf-8');
  const { keyId, inner } = await p.encrypt(plaintext);
  return `${VERSION}:${keyId}:${inner.toString('base64url')}`;
}

export async function decryptJson<T>(envelope: string, opts: DecryptOptions = {}): Promise<T> {
  const { row_locator, provider } = opts;
  const p = provider ?? getCipherProvider();

  // Parse envelope: must have exactly three non-empty parts.
  const parts = envelope.split(':');
  if (parts.length !== 3 || parts[0].length === 0 || parts[1].length === 0 || parts[2].length === 0) {
    throw cryptoBadEnvelope({ row_locator, cause: 'envelope must be of the form v1:<keyId>:<base64url>' });
  }
  const [version, keyId, data] = parts;

  if (version !== VERSION) {
    throw cryptoBadVersion({ version, row_locator });
  }

  let inner: Buffer;
  try {
    inner = Buffer.from(data, 'base64url');
    // Buffer.from with base64url silently drops invalid chars rather than throwing.
    // Round-trip to detect: if encoding back produces a different string, input was invalid.
    if (inner.toString('base64url') !== data) {
      throw new Error('invalid base64url');
    }
  } catch {
    throw cryptoBadEnvelope({ row_locator, cause: 'data part is not valid base64url' });
  }

  // Length validation is the provider's responsibility — the envelope layer
  // is algorithm-agnostic. The env provider enforces IV + tag minimums; a
  // future KMS provider would enforce its own bounds.

  let plaintext: Buffer;
  try {
    plaintext = await p.decrypt(keyId, inner);
  } catch (err) {
    // If provider.decrypt threw a CryptoError and the caller gave us a
    // row_locator, return a fresh CryptoError with the locator attached.
    // Never mutate the error's fields — withRowLocator() returns a new
    // instance so outer layers can't accidentally observe half-written state.
    if (err instanceof CryptoError) {
      throw row_locator ? err.withRowLocator(row_locator) : err;
    }
    throw err;
  }

  try {
    return JSON.parse(plaintext.toString('utf-8')) as T;
  } catch {
    throw cryptoJsonParseFail({ row_locator });
  }
}
