import { config } from '../../config.js';
import type { LineType, PhoneVerdict, PhoneVerifier } from './ports.js';

/**
 * NumVerify, over HTTPS.
 *
 * The cheaper alternative, here so a deployment is never one vendor's outage
 * away from having no phone verification at all. It answers the same two
 * questions with less precision — its line type comes from carrier records
 * rather than live routing — which is a reasonable trade at its price.
 *
 * Note the shape of its failures: like NeverBounce, it reports errors in a
 * 200 body. Reading only the HTTP status makes a rejected API key look like a
 * clean "no opinion", which would quietly disable verification while the
 * settings screen showed everything as fine.
 */

interface NumverifyResponse {
  valid?: boolean;
  number?: string;
  country_code?: string;
  carrier?: string;
  line_type?: string;
  success?: boolean;
  error?: { code?: number; info?: string };
}

function toLineType(value: string | undefined): LineType {
  switch ((value ?? '').toLowerCase()) {
    case 'landline':
      return 'landline';
    case 'mobile':
      return 'mobile';
    case 'voip':
      return 'voip';
    case 'toll_free':
    case 'tollfree':
      return 'tollfree';
    case '':
      return null;
    default:
      return 'other';
  }
}

export class NumverifyVerifier implements PhoneVerifier {
  readonly name = 'NumVerify';
  readonly metered = true;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = config.prospecting.numverifyBaseUrl;
  }

  private async call(e164: string): Promise<NumverifyResponse> {
    const url = new URL('/validate', this.baseUrl);
    url.searchParams.set('access_key', this.apiKey);
    url.searchParams.set('number', e164);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.prospecting.phoneTimeoutMs);
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!res.ok) throw new Error(`NumVerify returned ${res.status}.`);
      const body = (await res.json()) as NumverifyResponse;
      // Their failures arrive as HTTP 200 with success:false.
      if (body.success === false) {
        throw new Error(body.error?.info ?? 'NumVerify rejected the request.');
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  async verify(): Promise<void> {
    await this.call('+15125550110');
  }

  async check(e164: string): Promise<PhoneVerdict> {
    try {
      const body = await this.call(e164);
      return {
        valid: typeof body.valid === 'boolean' ? body.valid : null,
        lineType: toLineType(body.line_type),
        carrier: body.carrier || null,
        country: body.country_code ?? null,
        detail: body.line_type ?? undefined,
      };
    } catch {
      return { valid: null, lineType: null, carrier: null, country: null, detail: 'Lookup did not respond.' };
    }
  }
}
