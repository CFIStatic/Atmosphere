import { promises as dns } from 'node:dns';
import net from 'node:net';
import { config } from '../config.js';

/**
 * Email verification — the difference between a guess and an address.
 *
 * Every contact-data product lives or dies on this. A vendor match, a pattern
 * guess and a hand-typed address are all just strings until something proves a
 * mail server will accept them, and selling an unverified string is how a
 * customer's domain reputation gets burned sending to dead mailboxes.
 *
 * The ladder, cheapest first, stopping as soon as the answer is known:
 *
 *   1. Syntax        — malformed, or a free-mail/role address we won't sell.
 *   2. MX records    — does the domain accept mail at all?
 *   3. Catch-all     — probe a random local part. If the server accepts THAT,
 *                      it accepts everything, and no per-address answer is
 *                      possible. The result is 'risky', never 'valid'.
 *   4. SMTP probe    — RCPT TO for the real address, then QUIT. No message is
 *                      ever sent; we ask whether the mailbox exists and hang up.
 *
 * That last step is standard practice (it is what Hunter, NeverBounce and
 * ZeroBounce do) but it is a network conversation with a stranger's server, so
 * it is bounded by a short timeout and never retried in a loop.
 *
 * A verdict is deliberately three-valued. 'risky' is not a failure — it is the
 * honest answer for a catch-all domain, and the UI says so rather than
 * pretending to a confidence nobody has.
 */

export type EmailVerdict = 'valid' | 'risky' | 'invalid' | 'unknown';

export interface VerificationResult {
  email: string;
  verdict: EmailVerdict;
  /** 0–1. What we would bet on this address landing. */
  score: number;
  /** Short, human, and safe to show a customer. */
  reason: string;
  /** True when the domain accepts everything, so no address can be confirmed. */
  catchAll: boolean;
  /** True when the domain has no mail exchanger at all. */
  noMx: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/**
 * Addresses that are real but useless to sell: shared mailboxes nobody owns,
 * and consumer domains where a business contact does not belong.
 */
const ROLE_LOCALS = new Set([
  'info', 'sales', 'support', 'admin', 'office', 'contact', 'hello', 'help',
  'billing', 'accounts', 'noreply', 'no-reply', 'postmaster', 'webmaster',
  'abuse', 'marketing', 'jobs', 'careers', 'team',
]);

const FREE_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'me.com', 'live.com', 'msn.com', 'proton.me', 'protonmail.com',
]);

export function splitEmail(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf('@');
  if (at <= 0) return null;
  return { local: email.slice(0, at).toLowerCase(), domain: email.slice(at + 1).toLowerCase() };
}

export function isRoleAddress(email: string): boolean {
  const parts = splitEmail(email);
  return parts ? ROLE_LOCALS.has(parts.local) : false;
}

export function isFreeDomain(email: string): boolean {
  const parts = splitEmail(email);
  return parts ? FREE_DOMAINS.has(parts.domain) : false;
}

/** Lowest MX host for a domain, or null when the domain takes no mail. */
async function lowestMx(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolveMx(domain);
    if (!records.length) return null;
    return records.sort((a, b) => a.priority - b.priority)[0].exchange;
  } catch {
    return null;
  }
}

/**
 * One SMTP conversation, asking about one address, sending nothing.
 *
 * Returns true when the server accepts the recipient, false when it rejects
 * it outright, and null when it declines to say — greylisting, a rate limit,
 * or a timeout. Null is not a rejection and must never be reported as one.
 */
function probeRecipient(
  mx: string,
  address: string,
  timeoutMs: number,
): Promise<boolean | null> {
  return new Promise((resolve) => {
    const from = config.prospecting.verifyFromAddress;
    const helo = config.prospecting.verifyHeloDomain;

    const socket = net.createConnection({ host: mx, port: 25 });
    let settled = false;
    let stage = 0;
    let buffer = '';

    const done = (value: boolean | null) => {
      if (settled) return;
      settled = true;
      try {
        socket.write('QUIT\r\n');
      } catch {
        /* the server may already be gone */
      }
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs, () => done(null));
    socket.on('error', () => done(null));
    socket.on('close', () => done(null));

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (!buffer.endsWith('\n')) return;
      const line = buffer.trim().split('\n').pop() ?? '';
      const code = Number(line.slice(0, 3));
      buffer = '';

      // Any 4xx here is "come back later", not "no such person".
      if (code >= 400 && stage < 3) return done(null);

      if (stage === 0) {
        if (code !== 220) return done(null);
        socket.write(`EHLO ${helo}\r\n`);
        stage = 1;
        return;
      }
      if (stage === 1) {
        if (code !== 250) return done(null);
        socket.write(`MAIL FROM:<${from}>\r\n`);
        stage = 2;
        return;
      }
      if (stage === 2) {
        if (code !== 250) return done(null);
        socket.write(`RCPT TO:<${address}>\r\n`);
        stage = 3;
        return;
      }
      if (stage === 3) {
        if (code === 250 || code === 251) return done(true);
        // 550/551/553 — no such mailbox. 5xx generally means refused.
        if (code >= 500) return done(false);
        return done(null);
      }
    });
  });
}

/** A local part no real person owns, used to ask "do you accept everything?". */
function catchAllProbeAddress(domain: string): string {
  const nonce = Math.random().toString(36).slice(2, 14);
  return `atm-verify-${nonce}@${domain}`;
}

export interface VerifyOptions {
  /** Skip the SMTP conversation — DNS-only, for bulk pre-filtering. */
  dnsOnly?: boolean;
}

/**
 * Verify one address. Never throws: an unreachable server is 'unknown', which
 * is a legitimate answer, and callers price it accordingly.
 */
export async function verifyEmail(
  email: string,
  options: VerifyOptions = {},
): Promise<VerificationResult> {
  const address = email.trim().toLowerCase();
  const base = { email: address, catchAll: false, noMx: false };

  if (!EMAIL_RE.test(address)) {
    return { ...base, verdict: 'invalid', score: 0, reason: 'Not a valid address.' };
  }

  const parts = splitEmail(address);
  if (!parts) {
    return { ...base, verdict: 'invalid', score: 0, reason: 'Not a valid address.' };
  }

  if (FREE_DOMAINS.has(parts.domain)) {
    // Deliverable, but a personal mailbox is not a business contact and we do
    // not sell it as one.
    return {
      ...base,
      verdict: 'risky',
      score: 0.4,
      reason: 'Personal mailbox, not a company address.',
    };
  }

  const mx = await lowestMx(parts.domain);
  if (!mx) {
    return {
      ...base,
      noMx: true,
      verdict: 'invalid',
      score: 0,
      reason: 'That domain does not accept email.',
    };
  }

  if (options.dnsOnly || !config.prospecting.smtpProbeEnabled) {
    return {
      ...base,
      verdict: 'unknown',
      score: 0.5,
      reason: 'The domain accepts mail; the mailbox was not probed.',
    };
  }

  const timeout = config.prospecting.verifyTimeoutMs;

  // Ask about a made-up address first. A server that accepts it accepts
  // anything, and every per-address answer from it would be a lie.
  const catchAll = await probeRecipient(mx, catchAllProbeAddress(parts.domain), timeout);
  if (catchAll === true) {
    return {
      ...base,
      catchAll: true,
      verdict: 'risky',
      score: 0.55,
      reason: 'The domain accepts all mail, so the mailbox cannot be confirmed.',
    };
  }

  const accepted = await probeRecipient(mx, address, timeout);

  if (accepted === true) {
    const role = ROLE_LOCALS.has(parts.local);
    return {
      ...base,
      verdict: role ? 'risky' : 'valid',
      score: role ? 0.6 : 0.92,
      reason: role
        ? 'A shared mailbox — real, but nobody in particular reads it.'
        : 'The mail server accepted this mailbox.',
    };
  }

  if (accepted === false) {
    return {
      ...base,
      verdict: 'invalid',
      score: 0.05,
      reason: 'The mail server rejected this mailbox.',
    };
  }

  return {
    ...base,
    verdict: 'unknown',
    score: 0.5,
    reason: 'The mail server would not confirm either way.',
  };
}
