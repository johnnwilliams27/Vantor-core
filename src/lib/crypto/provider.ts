import { cryptoMissingKey, cryptoBadKeyFormat } from './errors';

const HEX64_RE = /^[0-9a-fA-F]{64}$/;
const KEY_ID_RE = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_KEY_ID = 'v1';

export interface EnvKeyConfig {
  primary: { id: string; key: Buffer };
  legacy: Map<string, Buffer>;
}

function validateKeyId(id: string): void {
  if (!KEY_ID_RE.test(id)) {
    throw cryptoBadKeyFormat({ key_id: id, cause: 'key_id must match [A-Za-z0-9_-]+' });
  }
}

function validateAndDecodeHex(hex: string, id: string): Buffer {
  const trimmed = hex.trim();
  if (!HEX64_RE.test(trimmed)) {
    throw cryptoBadKeyFormat({ key_id: id, cause: 'key must be exactly 64 hexadecimal characters' });
  }
  return Buffer.from(trimmed, 'hex');
}

export function loadEnvKeyConfigFromProcessEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): EnvKeyConfig {
  const primaryHex = env.CREDENTIALS_ENCRYPTION_KEY;
  if (primaryHex === undefined || primaryHex === '') {
    throw cryptoMissingKey();
  }

  const primaryId = (env.CREDENTIALS_ENCRYPTION_KEY_ID ?? DEFAULT_KEY_ID).trim();
  validateKeyId(primaryId);

  const primaryKey = validateAndDecodeHex(primaryHex, primaryId);

  const legacy = new Map<string, Buffer>();
  const legacyRaw = env.CREDENTIALS_ENCRYPTION_KEY_LEGACY;
  if (legacyRaw !== undefined && legacyRaw.trim() !== '') {
    const entries = legacyRaw.split(',').map((e) => e.trim()).filter((e) => e.length > 0);
    for (const entry of entries) {
      const colonIdx = entry.indexOf(':');
      if (colonIdx <= 0 || colonIdx === entry.length - 1) {
        throw cryptoBadKeyFormat({
          key_id: entry.slice(0, 12),
          cause: `legacy entry "${entry.slice(0, 20)}..." must be of the form <id>:<hex>`,
        });
      }
      const id = entry.slice(0, colonIdx).trim();
      const hex = entry.slice(colonIdx + 1);
      validateKeyId(id);
      if (id === primaryId) {
        throw cryptoBadKeyFormat({
          key_id: id,
          cause: 'legacy entry duplicates the primary key id',
        });
      }
      if (legacy.has(id)) {
        throw cryptoBadKeyFormat({
          key_id: id,
          cause: 'duplicate legacy key id',
        });
      }
      legacy.set(id, validateAndDecodeHex(hex, id));
    }
  }

  return { primary: { id: primaryId, key: primaryKey }, legacy };
}
