import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';

/**
 * Storage for organisation Anthropic API keys.
 *
 * The design goal is the one the product promises: connect a key once and
 * computer use works — including after a restart — without anyone provisioning
 * a database table first.
 *
 * The key is a bearer credential for someone's Anthropic account, so it is
 * never written in the clear and never sent back to the browser. What the UI
 * gets is a masked hint ("sk-ant-…4f2a") that is enough to recognise which key
 * is installed and useless to anyone who intercepts it.
 *
 * Encryption is AES-256-GCM under a key derived from `AI_CREDENTIALS_KEY`.
 * GCM is authenticated, so a tampered file fails to decrypt rather than
 * yielding attacker-chosen plaintext.
 */

interface StoredCredential {
  iv: string;
  tag: string;
  ciphertext: string;
  /** Masked form, safe to show in the UI. */
  hint: string;
  updatedAt: string;
  updatedBy: string;
}

type StoreFile = Record<string, StoredCredential>;

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits — the size GCM is specified for.
const KEY_BYTES = 32;
/**
 * A fixed salt is acceptable here and only here: the input is a
 * high-entropy server secret from the environment, not a user password, so
 * there is no dictionary to precompute and nothing a per-record salt would buy.
 */
const KEY_SALT = 'atmosphere/ai-credentials/v1';

let derivedKey: Buffer | null = null;
function encryptionKey(): Buffer {
  // An unset AI_CREDENTIALS_KEY derives a fixed, publicly reproducible key
  // from the empty string — anyone holding the file could read every stored
  // credential. Refuse rather than write ciphertext that is decoration.
  // Reads still fail closed through decrypt()'s catch, so a store written
  // under a real secret simply reports "no key installed" until it is set.
  if (!config.computerUse.credentialKey) {
    throw new Error('AI_CREDENTIALS_KEY is not set; refusing to store a model key.');
  }
  if (!derivedKey) {
    derivedKey = scryptSync(config.computerUse.credentialKey, KEY_SALT, KEY_BYTES);
  }
  return derivedKey;
}

function storePath(): string {
  return resolve(process.cwd(), config.computerUse.credentialStorePath);
}

/** In-process cache so the common path (every run) does not hit the disk. */
let cache: StoreFile | null = null;

async function readStore(): Promise<StoreFile> {
  if (cache) return cache;
  try {
    const raw = await readFile(storePath(), 'utf8');
    cache = JSON.parse(raw) as StoreFile;
  } catch {
    // A missing or unreadable store is simply "no keys yet" — the product must
    // still start and tell the operator to connect one.
    cache = {};
  }
  return cache;
}

async function writeStore(store: StoreFile): Promise<void> {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Write-then-rename: a crash mid-write must not leave a truncated file that
  // would silently drop every organisation's key.
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, path);
  cache = store;
}

function encrypt(plaintext: string): Omit<StoredCredential, 'updatedAt' | 'updatedBy'> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    hint: maskKey(plaintext),
  };
}

function decrypt(record: StoredCredential): string | null {
  try {
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Wrong or rotated `AI_CREDENTIALS_KEY`, or a tampered file. Treat it as
    // "no key installed" so the operator is prompted to re-enter one.
    return null;
  }
}

/** `sk-ant-api03-…9f2a` — enough to recognise, not enough to use. */
function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return '…';
  return `${trimmed.slice(0, 11)}…${trimmed.slice(-4)}`;
}

export interface CredentialStatus {
  /** Whether a run can start at all. */
  connected: boolean;
  /** 'organization' — set in the UI; 'server' — the ANTHROPIC_API_KEY env var. */
  source: 'organization' | 'server' | null;
  hint: string | null;
  updatedAt: string | null;
}

export async function getCredentialStatus(orgId: string): Promise<CredentialStatus> {
  const record = (await readStore())[orgId];
  if (record && decrypt(record)) {
    return { connected: true, source: 'organization', hint: record.hint, updatedAt: record.updatedAt };
  }
  if (config.computerUse.fallbackApiKey) {
    return {
      connected: true,
      source: 'server',
      hint: maskKey(config.computerUse.fallbackApiKey),
      updatedAt: null,
    };
  }
  return { connected: false, source: null, hint: null, updatedAt: null };
}

/**
 * The key to call Anthropic with, or null if none is installed. The
 * organisation's own key wins over the server-wide fallback so that a team can
 * put their spend on their own account.
 */
export async function getApiKey(orgId: string): Promise<string | null> {
  const record = (await readStore())[orgId];
  if (record) {
    const plaintext = decrypt(record);
    if (plaintext) return plaintext;
  }
  return config.computerUse.fallbackApiKey || null;
}

export async function setApiKey(orgId: string, apiKey: string, userId: string): Promise<CredentialStatus> {
  const store = { ...(await readStore()) };
  store[orgId] = {
    ...encrypt(apiKey.trim()),
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };
  await writeStore(store);
  return getCredentialStatus(orgId);
}

export async function clearApiKey(orgId: string): Promise<CredentialStatus> {
  const store = { ...(await readStore()) };
  delete store[orgId];
  await writeStore(store);
  return getCredentialStatus(orgId);
}

/**
 * Shape check only — we do not call Anthropic to validate. A syntactically
 * plausible key that turns out to be revoked surfaces as a clear API error on
 * the first run, which is a better trade than making key entry depend on an
 * outbound request succeeding.
 */
export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim());
}

/** Constant-time comparison for anywhere a caller-supplied secret is checked. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
