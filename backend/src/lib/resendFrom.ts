/**
 * Resend will not deliver as jack@jettx.ai (or any other from-address) until
 * that domain is verified. Unverified accounts may only send from
 * onboarding@resend.dev, and only to the Resend account owner.
 *
 * Job invites go to crew inboxes, so production must prefer a verified domain
 * when Resend has one, and fall back to the onboarding sender otherwise.
 *
 * The Keys `RESEND_API_KEY` is send-only — listing/creating domains returns
 * 401 restricted_api_key. In that case we cannot see verification status, so
 * we try the configured From (works once Jack verifies jettx.ai in the
 * dashboard) and retry onboarding if Resend rejects it.
 */

export const RESEND_ONBOARDING_FROM = 'onboarding@resend.dev';

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

/**
 * Pick a From address Resend will actually accept.
 * Verifying `send.example.com` does not authorize `user@example.com` — the
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
    verified.find((name) => name === 'jettx.ai') ??
    verified.find((name) => name.endsWith('.jettx.ai')) ??
    verified.find((name) => name === 'atmosphereteam.com') ??
    verified.find((name) => name.endsWith('.atmosphereteam.com')) ??
    verified[0];

  if (preferred) return `invites@${preferred}`;
  return RESEND_ONBOARDING_FROM;
}

/** When the domains API is unusable, try the configured From then onboarding. */
export function pickResendFromAddressForList(
  configuredFrom: string,
  listed: ResendDomainList,
): string {
  if (listed.ok) return pickResendFromAddress(configuredFrom, listed.domains);
  return configuredFrom.trim() || RESEND_ONBOARDING_FROM;
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
          '[system-mail] Resend API key is send-only; cannot list domains. Trying CAREERS_FROM_EMAIL, then onboarding@resend.dev.',
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
