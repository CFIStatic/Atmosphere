import { config } from '../../config.js';
import type { MailboxVerdict, MailboxVerifier } from './ports.js';

/**
 * ZeroBounce, over plain HTTPS.
 *
 * Same conversation the SMTP verifier has, run from mail infrastructure they
 * own and keep warm, and answered over a normal API call. That is the whole
 * reason to pay for it: it works from a host with port 25 blocked, which is
 * every mainstream cloud provider by default, and it does not spend our IP's
 * reputation to get an answer.
 *
 * Their statuses map onto our three-valued verdict as follows, and the mapping
 * is the only opinionated part of this file:
 *
 *   valid                       → exists
 *   invalid                     → does not exist
 *   catch-all                   → no per-address answer is possible
 *   spamtrap / abuse / toxic    → treated as "do not mail" — reported as
 *                                 rejected, because sending there is worse
 *                                 than not having the address at all
 *   do_not_mail                 → same
 *   unknown                     → no opinion, which we pass through honestly
 *                                 rather than rounding to a verdict
 */

interface ZeroBounceResponse {
  address?: string;
  status?: string;
  sub_status?: string;
  error?: string;
}

/** Statuses where the address may exist but must never be mailed. */
const DO_NOT_MAIL = new Set(['spamtrap', 'abuse', 'do_not_mail', 'toxic']);

export class ZeroBounceVerifier implements MailboxVerifier {
  readonly name = 'ZeroBounce';
  readonly metered = true;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = config.prospecting.zeroBounceBaseUrl;
  }

  private async call(path: string, params: Record<string, string>): Promise<ZeroBounceResponse> {
    const url = new URL(path, this.baseUrl);
    url.searchParams.set('api_key', this.apiKey);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.prospecting.verifyTimeoutMs);
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`ZeroBounce returned ${res.status}.`);
      return (await res.json()) as ZeroBounceResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  async verify(): Promise<void> {
    // Their credits endpoint is free and tells us the key works AND whether
    // there is any balance behind it — a valid key with zero credits would
    // otherwise fail silently on the first real check.
    const body = (await this.call('/v2/getcredits', {})) as { Credits?: string };
    const credits = Number(body?.Credits ?? -1);
    if (credits < 0) throw new Error('ZeroBounce rejected the API key.');
    if (credits === 0) throw new Error('ZeroBounce key is valid but has no credits left.');
  }

  async check(email: string): Promise<MailboxVerdict> {
    let body: ZeroBounceResponse;
    try {
      body = await this.call('/v2/validate', { email, ip_address: '' });
    } catch {
      // A verifier we cannot reach has no opinion. It must not read as a
      // rejection, or an outage at ZeroBounce would quietly delete real
      // people from customers' lists.
      return { exists: null, catchAll: null, detail: 'ZeroBounce did not respond.' };
    }

    const status = String(body.status ?? '').toLowerCase();
    const detail = body.sub_status ? `${status}/${body.sub_status}` : status;

    if (status === 'valid') return { exists: true, catchAll: false, detail };
    if (status === 'invalid') return { exists: false, catchAll: false, detail };
    if (status === 'catch-all' || status === 'catchall') {
      return { exists: null, catchAll: true, detail };
    }
    if (DO_NOT_MAIL.has(status)) return { exists: false, catchAll: false, detail };
    if (status === 'do_not_mail' && body.sub_status === 'disposable') {
      return { exists: false, catchAll: false, disposable: true, detail };
    }
    return { exists: null, catchAll: null, detail: detail || 'unknown' };
  }
}
