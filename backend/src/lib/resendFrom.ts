/**
 * Resend will not deliver as jack@jettx.ai until that apex domain is verified.
 * The live Resend account has `invites.jettx.ai` verified, so job invites send
 * as hello@invites.jettx.ai (Reply-To stays jack@jettx.ai).
 *
 * The Keys `RESEND_API_KEY` is send-only — listing/creating domains returns
 * 401 restricted_api_key. We therefore keep the verified subdomain as a known
 * From, and only fall back to onboarding@resend.dev if Resend still rejects it.
 */

export const RESEND_ONBOARDING_FROM = 'onboarding@resend.dev';
export const RESEND_VERIFIED_DOMAIN = 'invites.jettx.ai';
export const RESEND_VERIFIED_FROM = 'hello@invites.jettx.ai';

export type ResendDomain = {
  id?: string;
  name: string;
  status: string;
};

export type ResendDomainList = {
  ok: boolean;
  restricted: boolean;
  domains: ResendDomain[];
};

const DOMAIN_CACHE_MS = 60_000;
let domainCache: ({ at: number } & ResendDomainList) | null = null;

export function resetResendDomainCache(): void {
  domainCache = null;
}

export function emailDomain(address: string): string {
  const trimmed = address.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return '';
  return trimmed.slice(at + 1);
}

function isVerified(status: string): boolean {
  return String(status).trim().toLowerCase() === 'verified';
}

/** Map an apex/workspace address onto the verified Resend sending domain. */
export function remapToVerifiedSendingDomain(configuredFrom: string): string {
  const envFrom = (process.env.RESEND_FROM_EMAIL ?? '').trim();
  if (envFrom && emailDomain(envFrom) === RESEND_VERIFIED_DOMAIN) return envFrom;
  const configured = configuredFrom.trim();
  if (emailDomain(configured) === RESEND_VERIFIED_DOMAIN) return configured;
  return RESEND_VERIFIED_FROM;
}

function fromForVerifiedDomain(name: string, configuredFrom: string): string {
  if (name === RESEND_VERIFIED_DOMAIN) {
    return remapToVerifiedSendingDomain(configuredFrom);
  }
  return `invites@${name}`;
}

/**
 * Pick a From address Resend will actually accept.
 * Verifying `invites.jettx.ai` does not authorize `jack@jettx.ai` — the
 * local-part domain has to match the verified name.
 */
export function pickResendFromAddress(
  configuredFrom: string,
  domains: ResendDomain[],
): string {
  const verified = domains
    .filter((d) => d.name && isVerified(d.status))
    .map((d) => d.name.trim().toLowerCase());

  const configured = configuredFrom.trim();
  const configuredDomain = emailDomain(configured);
  if (configured && configuredDomain && verified.includes(configuredDomain)) {
    return configured;
  }

  const preferred =
    verified.find((name) => name === RESEND_VERIFIED_DOMAIN) ??
    verified.find((name) => name === 'jettx.ai') ??
    verified.find((name) => name.endsWith('.jettx.ai')) ??
    verified.find((name) => name === 'atmosphereteam.com') ??
    verified.find((name) => name.endsWith('.atmosphereteam.com')) ??
    verified[0];

  if (preferred) return fromForVerifiedDomain(preferred, configured);
  return remapToVerifiedSendingDomain(configured);
}

/** Send-only API keys cannot list domains; still use the verified subdomain. */
export function pickResendFromAddressForList(
  configuredFrom: string,
  listed: ResendDomainList,
): string {
  if (listed.ok) return pickResendFromAddress(configuredFrom, listed.domains);
  return remapToVerifiedSendingDomain(configuredFrom);
}

export function uniqueResendFroms(...addresses: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of addresses) {
    const address = raw.trim();
    const key = address.toLowerCase();
    if (!address || seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}

export function isResendSenderRestriction(status: number, body: string): boolean {
  const text = body.toLowerCase();
  const looksLikeSender =
    text.includes('not verified') ||
    text.includes('testing emails') ||
    text.includes('own email address') ||
    text.includes('verify a domain') ||
    text.includes('domain is not') ||
    text.includes('invalid `from`') ||
    text.includes('invalid from');
  if (status === 403 || status === 422 || status === 400) return looksLikeSender;
  return looksLikeSender;
}

export async function fetchResendDomains(apiKey: string): Promise<ResendDomainList> {
  if (domainCache && Date.now() - domainCache.at < DOMAIN_CACHE_MS) {
    return domainCache;
  }
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      const restricted = res.status === 401 && /restricted/i.test(errText);
      if (restricted) {
        console.warn(
          `[system-mail] Resend API key is send-only; sending as ${RESEND_VERIFIED_FROM}.`,
        );
      } else {
        console.error('[system-mail] Resend domains list failed:', errText.slice(0, 300));
      }
      const listed: ResendDomainList = { ok: false, restricted, domains: [] };
      domainCache = { at: Date.now(), ...listed };
      return listed;
    }
    const body = (await res.json()) as { data?: ResendDomain[] };
    const domains = Array.isArray(body.data) ? body.data : [];
    const listed: ResendDomainList = { ok: true, restricted: false, domains };
    domainCache = { at: Date.now(), ...listed };
    return listed;
  } catch (err) {
    console.error('[system-mail] Resend domains list failed:', (err as Error)?.message ?? err);
    return { ok: false, restricted: false, domains: [] };
  }
}
