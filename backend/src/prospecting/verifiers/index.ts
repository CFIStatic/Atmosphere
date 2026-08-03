import { config } from '../../config.js';
import { NeverBounceVerifier } from './neverBounce.js';
import { SmtpMailboxVerifier } from './smtp.js';
import { ZeroBounceVerifier } from './zeroBounce.js';
import type { MailboxVerifier } from './ports.js';

export * from './ports.js';
export { lowestMx } from './smtp.js';
export { SmtpMailboxVerifier } from './smtp.js';
export { ZeroBounceVerifier } from './zeroBounce.js';
export { NeverBounceVerifier } from './neverBounce.js';

/**
 * Which verifier answers the mailbox question.
 *
 * Order matters and is not arbitrary. A paid HTTPS verifier is preferred over
 * our own SMTP probe when one is configured, because it works from hosts with
 * port 25 blocked and it does not spend our sending reputation. SMTP is the
 * fallback for deployments that have port 25 and would rather not pay per
 * check.
 *
 * Null means nothing can confirm a mailbox here. That is a legitimate state —
 * it is the default one, before anybody has configured anything — and the
 * ladder above handles it by returning 'unknown' rather than by guessing.
 */
export function buildMailboxVerifier(): MailboxVerifier | null {
  const { verifier, zeroBounceApiKey, neverBounceApiKey, smtpProbeEnabled } = config.prospecting;

  // An explicit choice wins, so an operator can pin one vendor while another
  // key happens to be present in the environment.
  if (verifier === 'zerobounce' && zeroBounceApiKey) return new ZeroBounceVerifier(zeroBounceApiKey);
  if (verifier === 'neverbounce' && neverBounceApiKey) {
    return new NeverBounceVerifier(neverBounceApiKey);
  }
  if (verifier === 'smtp') return smtpProbeEnabled ? new SmtpMailboxVerifier() : null;

  // 'auto': whatever is actually usable, best first.
  if (zeroBounceApiKey) return new ZeroBounceVerifier(zeroBounceApiKey);
  if (neverBounceApiKey) return new NeverBounceVerifier(neverBounceApiKey);
  if (smtpProbeEnabled) return new SmtpMailboxVerifier();
  return null;
}

/** Every verifier with credentials present, for the settings screen to test. */
export function configuredVerifiers(): MailboxVerifier[] {
  const out: MailboxVerifier[] = [];
  if (config.prospecting.zeroBounceApiKey) {
    out.push(new ZeroBounceVerifier(config.prospecting.zeroBounceApiKey));
  }
  if (config.prospecting.neverBounceApiKey) {
    out.push(new NeverBounceVerifier(config.prospecting.neverBounceApiKey));
  }
  if (config.prospecting.smtpProbeEnabled) out.push(new SmtpMailboxVerifier());
  return out;
}
