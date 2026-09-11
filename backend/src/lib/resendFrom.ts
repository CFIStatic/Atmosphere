/**
 * Resend From for Atmosphere transactional mail.
 *
 * Production sends as hello@invites.atmosphereteam.com (verified subdomain with
 * DKIM + SES return-path). Reply-To defaults to hello@atmosphereteam.com (same
 * org) — set in systemMail, not here. invites.jettx.ai remains an accepted
 * legacy sending domain during migration. onboarding@resend.dev is a non-prod
 * last resort only.
 */

export const RESEND_ONBOARDING_FROM = 'onboarding@resend.dev';
export const RESEND_VERIFIED_DOMAIN = 'invites.atmosphereteam.com';
export const RESEND_VERIFIED_FROM = 'hello@invites.atmosphereteam.com';
/** Legacy Jettx Resend subdomain — still accepted via RESEND_FROM_EMAIL. */
export const RESEND_LEGACY_DOMAIN = 'invites.jettx.ai';
export const RESEND_LEGACY_FROM = 'hello@invites.jettx.ai';

const ALLOWED_SENDING_DOMAINS = new Set([RESEND_VERIFIED_DOMAIN, RESEND_LEGACY_DOMAIN]);

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

function isAllowedSendingDomain(domain: string): boolean {
  return ALLOWED_SENDING_DOMAINS.has(domain);
}

/**
 * Pin RESEND_FROM_EMAIL when it is on invites.atmosphereteam.com or legacy
 * invites.jettx.ai; else the primary Atmosphere verified From.
 */
export function resendFromAddress(configuredFrom?: string | null): string {
  const envFrom = (process.env.RESEND_FROM_EMAIL ?? '').trim();
  if (isAllowedSendingDomain(emailDomain(envFrom))) return envFrom;
  const configured = (configuredFrom ?? '').trim();
  if (isAllowedSendingDomain(emailDomain(configured))) return configured;
  return RESEND_VERIFIED_FROM;
}

/**
 * From addresses to try. Always Atmosphere (or an explicit RESEND_FROM_EMAIL
 * pin). Do NOT fall back to invites.jettx.ai — that mixed From/footer and
 * landed invites in junk. onboarding@resend.dev only when
 * allowOnboardingFallback (non-production).
 */
export function resendFromCandidates(input: {
  configuredFrom?: string | null;
  allowOnboardingFallback: boolean;
}): string[] {
  const primary = resendFromAddress(input.configuredFrom);
  const out: string[] = [primary];
  if (input.allowOnboardingFallback) {
    if (!out.some((a) => a.toLowerCase() === RESEND_ONBOARDING_FROM)) {
      out.push(RESEND_ONBOARDING_FROM);
    }
  }
  return out;
}

export function isResendOnboardingFrom(address: string): boolean {
  return address.trim().toLowerCase() === RESEND_ONBOARDING_FROM;
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

/** Domains list for /api/ready only — send path does not need it. */
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
