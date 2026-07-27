import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Enrolment for computers.
 *
 * A person sitting at the machine gets a short pairing code from the console
 * and types it into the agent once. The code buys a long-lived agent token; the
 * token is what every later reconnect presents.
 *
 * Tokens are HMAC-signed rather than stored, which keeps enrolment free of a
 * database migration — the whole point of "connect a key and it works". The
 * trade-off is that an individual token cannot be revoked from a list; rotating
 * `AGENT_TOKEN_SECRET` unpairs everything at once, which is the right blunt
 * instrument for a suspected leak. If per-agent revocation is needed later,
 * this is the seam to add it behind.
 */

export interface AgentIdentity {
  agentId: string;
  orgId: string;
  name: string;
  /** Issued-at, epoch milliseconds. */
  iat: number;
}

/**
 * Deliberately excludes characters that get misread aloud or across fonts —
 * O/0, I/1, S/5 — because this code is normally read off one screen and typed
 * into another machine's terminal.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
const CODE_LENGTH = 8;
const CODE_TTL_MS = 10 * 60 * 1000;
/** Bound the map so a script hitting the endpoint cannot exhaust memory. */
const MAX_PENDING_CODES = 500;

interface PendingCode {
  orgId: string;
  createdBy: string;
  expiresAt: number;
}

const pendingCodes = new Map<string, PendingCode>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [code, entry] of pendingCodes) {
    if (entry.expiresAt <= now) pendingCodes.delete(code);
  }
}

/** Mint a single-use pairing code for an organisation. */
export function createPairingCode(orgId: string, createdBy: string): { code: string; expiresAt: string } {
  sweepExpired();
  if (pendingCodes.size >= MAX_PENDING_CODES) {
    throw new Error('Too many pairing codes are outstanding. Try again in a few minutes.');
  }

  const bytes = randomBytes(CODE_LENGTH);
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    raw += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  const expiresAt = Date.now() + CODE_TTL_MS;
  pendingCodes.set(code, { orgId, createdBy, expiresAt });
  return { code, expiresAt: new Date(expiresAt).toISOString() };
}

/** Redeem a pairing code. Single use: a redeemed code is gone immediately. */
export function redeemPairingCode(code: string): { orgId: string; createdBy: string } | null {
  sweepExpired();
  const normalised = normaliseCode(code);
  const entry = pendingCodes.get(normalised);
  if (!entry) return null;
  pendingCodes.delete(normalised);
  return { orgId: entry.orgId, createdBy: entry.createdBy };
}

/** Accept "abcd efgh", "abcdefgh", or "ABCD-EFGH" — all the same code. */
function normaliseCode(code: string): string {
  const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== CODE_LENGTH) return code.toUpperCase();
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

/* ------------------------------ tokens ------------------------------ */

function sign(payload: string): string {
  return createHmac('sha256', config.computerUse.agentTokenSecret).update(payload).digest('base64url');
}

export function mintAgentToken(identity: Omit<AgentIdentity, 'agentId' | 'iat'> & { agentId?: string }): {
  token: string;
  identity: AgentIdentity;
} {
  const full: AgentIdentity = {
    agentId: identity.agentId ?? randomUUID(),
    orgId: identity.orgId,
    name: identity.name,
    iat: Date.now(),
  };
  const payload = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  return { token: `${payload}.${sign(payload)}`, identity: full };
}

/** Verify and decode an agent token. Returns null for anything unconvincing. */
export function verifyAgentToken(token: string | undefined): AgentIdentity | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = Buffer.from(sign(payload), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  try {
    const identity = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AgentIdentity;
    if (!identity.agentId || !identity.orgId) return null;
    return identity;
  } catch {
    return null;
  }
}

/** Pull a bearer token out of an `Authorization` header. */
export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}
