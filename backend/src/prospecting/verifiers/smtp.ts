import net from 'node:net';
import { promises as dns } from 'node:dns';
import { config } from '../../config.js';
import type { MailboxVerdict, MailboxVerifier } from './ports.js';

/**
 * Verification by talking to the recipient's mail server ourselves.
 *
 * This is what the vendors do; doing it directly is free and exact. The cost
 * is operational rather than financial:
 *
 *   - It needs outbound port 25. Most cloud hosts block it and will not open
 *     it without a support case, so on a typical PaaS every probe times out
 *     and every answer is `null`.
 *   - It spends your IP's reputation. A forged envelope sender, or a host
 *     whose reputation nobody has thought about, is a fast way onto a
 *     blocklist. `config.smtpProbeEnabled` therefore requires a real sending
 *     domain before it will turn on at all.
 *
 * Where port 25 is open and the sending domain is genuinely ours, this is the
 * best verifier available and it costs nothing per check.
 */

/** Lowest-priority MX host for a domain, or null when it takes no mail. */
export async function lowestMx(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolveMx(domain);
    if (!records.length) return null;
    return records.sort((a, b) => a.priority - b.priority)[0].exchange;
  } catch {
    return null;
  }
}

/** A local part no real person owns, used to ask "do you accept everything?". */
function catchAllProbeAddress(domain: string): string {
  const nonce = Math.random().toString(36).slice(2, 14);
  return `atm-verify-${nonce}@${domain}`;
}

/**
 * One SMTP conversation, asking about one address, sending nothing.
 *
 * Returns true when the server accepts the recipient, false when it rejects it
 * outright, and null when it declines to say — greylisting, a rate limit, or a
 * timeout. Null is not a rejection and must never be reported as one.
 */
export function probeRecipient(
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

export class SmtpMailboxVerifier implements MailboxVerifier {
  readonly name = 'SMTP';
  readonly metered = false;

  async verify(): Promise<void> {
    if (!config.prospecting.smtpProbeEnabled) {
      throw new Error(
        'SMTP probing is off. Set PROSPECTING_SMTP_PROBE=true and PROSPECTING_VERIFY_FROM to an address at a domain you control.',
      );
    }
  }

  async check(email: string, domain: string): Promise<MailboxVerdict> {
    const mx = await lowestMx(domain);
    if (!mx) return { exists: false, catchAll: null, detail: 'No MX records.' };

    const timeout = config.prospecting.verifyTimeoutMs;

    // Ask about a made-up address first. A server that accepts it accepts
    // anything, and every per-address answer from it would be a lie.
    const catchAll = await probeRecipient(mx, catchAllProbeAddress(domain), timeout);
    if (catchAll === true) {
      return { exists: null, catchAll: true, detail: 'Domain accepts all recipients.' };
    }

    const accepted = await probeRecipient(mx, email, timeout);
    return {
      exists: accepted,
      catchAll: false,
      detail:
        accepted === true
          ? 'Mail server accepted the recipient.'
          : accepted === false
            ? 'Mail server rejected the recipient.'
            : 'Mail server would not say.',
    };
  }
}
