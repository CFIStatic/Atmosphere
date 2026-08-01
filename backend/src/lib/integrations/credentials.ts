/**
 * Sealed credentials for CRM connections.
 *
 * Same AES-256-GCM + scrypt pattern as Web Access: ciphertext in Postgres, key
 * material only in INTEGRATIONS_CREDENTIAL_KEY. A dump of the sources table
 * yields no working login.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../../config.js';
import { HttpError } from '../errors.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface IntegrationSecret {
  apiKey?: string;
  username?: string;
  password?: string;
  /** Salesforce security token appended to the password for login. */
  securityToken?: string;
  accountId?: string;
  baseUrl?: string;
  instanceUrl?: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface SealedIntegrationSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  fingerprint: string;
}

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw =
    config.integrations.credentialKey ||
    (!config.isProduction ? config.webAccess.encryptionKey : '') ||
    '';

  if (!raw) {
    throw new HttpError(
      503,
      'CRM credential storage is not configured (INTEGRATIONS_CREDENTIAL_KEY).',
      'integrations_credential_key_missing',
    );
  }

  cachedKey = scryptSync(raw, 'atmosphere.integrations.v1', KEY_BYTES, {
    maxmem: 64 * 1024 * 1024,
  });
  return cachedKey;
}

export function integrationsVaultConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

function fingerprintOf(secret: IntegrationSecret): string {
  const material = JSON.stringify({
    apiKey: secret.apiKey ? '1' : '',
    username: secret.username ?? '',
    hasPassword: Boolean(secret.password),
    accountId: secret.accountId ?? '',
    baseUrl: secret.baseUrl ?? secret.instanceUrl ?? '',
  });
  return createHash('sha256').update(encryptionKey()).update(material).digest('hex').slice(0, 12);
}

export function sealIntegrationSecret(secret: IntegrationSecret): SealedIntegrationSecret {
  const key = encryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(secret), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    fingerprint: fingerprintOf(secret),
  };
}

export function openIntegrationSecret(sealed: {
  ciphertext: string;
  iv: string;
  authTag: string;
}): IntegrationSecret {
  const key = encryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString('utf8')) as IntegrationSecret;
}

/**
 * Turns a sealed or env credential into a bearer/basic token string for the
 * generic RestConnector, plus the structured secret for named connectors.
 */
export function materializeCredential(options: {
  sealed?: { ciphertext: string; iv: string; authTag: string } | null;
  envCredential: string | null;
}): { token: string | null; secret: IntegrationSecret | null } {
  if (options.sealed?.ciphertext && options.sealed.iv && options.sealed.authTag) {
    const secret = openIntegrationSecret(options.sealed);
    const token =
      secret.accessToken ||
      secret.apiKey ||
      (secret.username && secret.password
        ? Buffer.from(
            `${secret.username}:${secret.password}${secret.securityToken ?? ''}`,
          ).toString('base64')
        : null);
    return { token, secret };
  }

  if (options.envCredential) {
    const raw = options.envCredential.trim();
    if (raw.startsWith('{')) {
      try {
        const secret = JSON.parse(raw) as IntegrationSecret;
        const token =
          secret.accessToken ||
          secret.apiKey ||
          (secret.username && secret.password
            ? Buffer.from(
                `${secret.username}:${secret.password}${secret.securityToken ?? ''}`,
              ).toString('base64')
            : null);
        return { token, secret };
      } catch {
        /* fall through */
      }
    }
    return { token: raw, secret: { apiKey: raw } };
  }

  return { token: null, secret: null };
}
