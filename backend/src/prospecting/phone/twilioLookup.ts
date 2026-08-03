import { config } from '../../config.js';
import type { LineType, PhoneVerdict, PhoneVerifier } from './ports.js';

/**
 * Twilio Lookup v2, over HTTPS.
 *
 * Twilio is the reference implementation of this because they own carrier
 * infrastructure: the line-type answer comes from the same routing data they
 * use to actually place calls, rather than from a database of prefixes that
 * stopped being accurate when number portability arrived.
 *
 * That last point is the whole reason to pay for a lookup instead of using a
 * free prefix table. Since portability, an area code and exchange tell you
 * where a number was issued and nothing about whether it rings a desk or a
 * pocket. A prefix table will confidently call a ported mobile a landline.
 */

interface TwilioLookupResponse {
  valid?: boolean;
  phone_number?: string;
  country_code?: string;
  line_type_intelligence?: {
    type?: string;
    carrier_name?: string;
    error_code?: number | null;
  };
  validation_errors?: string[];
}

/** Twilio's vocabulary → ours. */
function toLineType(value: string | undefined): LineType {
  switch ((value ?? '').toLowerCase()) {
    case 'landline':
    case 'fixedVoip'.toLowerCase():
      return 'landline';
    case 'mobile':
      return 'mobile';
    case 'voip':
    case 'nonfixedvoip':
      return 'voip';
    case 'tollfree':
      return 'tollfree';
    case '':
      return null;
    default:
      return 'other';
  }
}

export class TwilioLookupVerifier implements PhoneVerifier {
  readonly name = 'Twilio Lookup';
  readonly metered = true;

  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly baseUrl: string;

  constructor(accountSid: string, authToken: string) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.baseUrl = config.prospecting.twilioLookupBaseUrl;
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`;
  }

  async verify(): Promise<void> {
    // Look up Twilio's own published number: a real request that proves the
    // credentials work, against a number that will not surprise anyone.
    const res = await fetch(`${this.baseUrl}/v2/PhoneNumbers/+15558675310`, {
      headers: { Authorization: this.authHeader(), Accept: 'application/json' },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error('Twilio rejected the account SID or auth token.');
    }
    // 404 means the credentials were accepted and the number is simply not
    // routable, which is a perfectly good outcome for a credential check.
    if (!res.ok && res.status !== 404) {
      throw new Error(`Twilio Lookup returned ${res.status}.`);
    }
  }

  async check(e164: string): Promise<PhoneVerdict> {
    const url = new URL(`${this.baseUrl}/v2/PhoneNumbers/${encodeURIComponent(e164)}`);
    // Line type is a separately-billed add-on and must be asked for by name.
    url.searchParams.set('Fields', 'line_type_intelligence');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.prospecting.phoneTimeoutMs);
    try {
      const res = await fetch(url, {
        headers: { Authorization: this.authHeader(), Accept: 'application/json' },
        signal: controller.signal,
      });

      // 404 is Twilio for "no such number", which is an answer.
      if (res.status === 404) {
        return { valid: false, lineType: null, carrier: null, country: null, detail: 'Not a routable number.' };
      }
      if (!res.ok) {
        return { valid: null, lineType: null, carrier: null, country: null, detail: `HTTP ${res.status}` };
      }

      const body = (await res.json()) as TwilioLookupResponse;
      const lti = body.line_type_intelligence;

      return {
        valid: typeof body.valid === 'boolean' ? body.valid : null,
        lineType: toLineType(lti?.type),
        carrier: lti?.carrier_name ?? null,
        country: body.country_code ?? null,
        detail: lti?.type ?? undefined,
      };
    } catch {
      // Unreachable is not invalid. A Twilio outage must not have the product
      // telling customers their real numbers are dead.
      return { valid: null, lineType: null, carrier: null, country: null, detail: 'Lookup did not respond.' };
    } finally {
      clearTimeout(timer);
    }
  }
}
