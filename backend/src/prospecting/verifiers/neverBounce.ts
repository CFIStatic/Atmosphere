import { config } from '../../config.js';
import type { MailboxVerdict, MailboxVerifier } from './ports.js';

/**
 * NeverBounce, over plain HTTPS.
 *
 * The second HTTPS verifier, present so a deployment is never one vendor's
 * outage away from having no verification at all. Same contract as
 * ZeroBounce, different result vocabulary:
 *
 *   valid       → exists
 *   invalid     → does not exist
 *   catchall    → no per-address answer is possible
 *   disposable  → a throwaway inbox; real today, gone next week, so it is
 *                 refused rather than sold
 *   unknown     → no opinion, passed through as such
 *
 * Their `/account/info` endpoint is free, which is what the settings screen
 * uses to tell an operator the key works before anyone spends a credit on it.
 */

interface NeverBounceResponse {
  status?: string;
  result?: string;
  flags?: string[];
  message?: string;
}

export class NeverBounceVerifier implements MailboxVerifier {
  readonly name = 'NeverBounce';
  readonly metered = true;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = config.prospecting.neverBounceBaseUrl;
  }

  private async call(path: string, params: Record<string, string>): Promise<NeverBounceResponse> {
    const url = new URL(path, this.baseUrl);
    url.searchParams.set('key', this.apiKey);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.prospecting.verifyTimeoutMs);
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`NeverBounce returned ${res.status}.`);
      const body = (await res.json()) as NeverBounceResponse;
      // NeverBounce reports its own failures in a 200 body, so the HTTP status
      // alone is not enough to know the call worked.
      if (body.status && body.status !== 'success') {
        throw new Error(body.message ?? `NeverBounce: ${body.status}`);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  async verify(): Promise<void> {
    await this.call('/v4/account/info', {});
  }

  async check(email: string): Promise<MailboxVerdict> {
    let body: NeverBounceResponse;
    try {
      body = await this.call('/v4/single/check', { email });
    } catch {
      return { exists: null, catchAll: null, detail: 'NeverBounce did not respond.' };
    }

    const result = String(body.result ?? '').toLowerCase();
    const disposable = (body.flags ?? []).includes('disposable_email');

    if (result === 'valid') return { exists: true, catchAll: false, detail: result };
    if (result === 'invalid') return { exists: false, catchAll: false, detail: result };
    if (result === 'catchall') return { exists: null, catchAll: true, detail: result };
    if (result === 'disposable') {
      return { exists: false, catchAll: false, disposable: true, detail: result };
    }
    return { exists: null, catchAll: null, disposable, detail: result || 'unknown' };
  }
}
