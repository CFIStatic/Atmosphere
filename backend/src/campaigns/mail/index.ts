import { config } from '../../config.js';
import { loadGrant } from '../../lib/integrations/oauthVault.js';
import { GmailSender } from './gmail.js';
import { MicrosoftSender } from './microsoft.js';
import type { MailSender } from './ports.js';

export * from './ports.js';
export * from './guards.js';
export { GmailSender } from './gmail.js';
export { MicrosoftSender } from './microsoft.js';

/**
 * Turning a stored grant into something that can send.
 *
 * Access tokens are short-lived and deliberately never stored — one is
 * exchanged per send run and discarded with it. Only the refresh token is
 * kept, sealed, in the same vault the CRM grants use.
 */

export type MailSystem = 'google_mail' | 'microsoft_mail';

interface Refreshed {
  accessToken: string;
}

async function refresh(system: MailSystem, refreshToken: string): Promise<Refreshed> {
  const google = system === 'google_mail';
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: google ? config.campaigns.googleClientId : config.campaigns.microsoftClientId,
    client_secret: google
      ? config.campaigns.googleClientSecret
      : config.campaigns.microsoftClientSecret,
  });
  // Microsoft wants the scope repeated on refresh; Google does not.
  // User.Read is not optional here: identity() reads /v1.0/me, which Mail.Send
  // does not authorize. Without it the OAuth callback and every subsequent
  // send return 403 — the connection appears to succeed and nothing ever goes.
  if (!google) {
    body.set('scope', 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access');
  }

  const res = await fetch(google ? config.campaigns.googleTokenUrl : config.campaigns.microsoftTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    // A revoked grant is the ordinary case, not a bug: the customer turned us
    // off in their own account settings, which is exactly what they should be
    // able to do. Say so rather than reporting a generic failure.
    throw new Error(
      json.error === 'invalid_grant'
        ? 'The mailbox connection was revoked or expired. Reconnect it in Settings.'
        : (json.error_description ?? `Token refresh returned ${res.status}.`),
    );
  }
  return { accessToken: json.access_token };
}

/**
 * The sender for this org, or null when no mailbox is connected.
 *
 * `preferred` exists because taking whichever grant was found first meant an
 * org with both connected sent from Google forever, with nothing in the UI
 * saying so and no way to change it. Which mailbox mail comes from is the
 * customer's decision, not an artifact of loop order.
 */
export async function buildMailSender(
  orgId: string,
  preferred?: MailSystem | null,
): Promise<MailSender | null> {
  const order: MailSystem[] = preferred
    ? [preferred, ...(['google_mail', 'microsoft_mail'] as const).filter((s) => s !== preferred)]
    : ['google_mail', 'microsoft_mail'];

  for (const system of order) {
    const grant = await loadGrant(orgId, system);
    if (!grant) continue;
    const { accessToken } = await refresh(system, grant.refreshToken);
    return system === 'google_mail'
      ? new GmailSender(accessToken, grant.instanceUrl || null)
      : new MicrosoftSender(accessToken);
  }
  return null;
}

/**
 * Where to send somebody to connect their mailbox.
 *
 * Both scopes are send-only. That is the whole argument for doing it this way
 * rather than asking for a password: the consent screen says "send email on
 * your behalf", and there is no version of this grant that can read a single
 * message in their inbox.
 */
export function mailAuthorizeUrl(system: MailSystem, state: string, redirectUri: string): string {
  if (system === 'google_mail') {
    const url = new URL(config.campaigns.googleAuthUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.campaigns.googleClientId);
    url.searchParams.set('redirect_uri', redirectUri);
    // gmail.send grants no read access whatsoever, so the Gmail profile
    // endpoint is not a reliable way to learn the sending address. openid,
    // email and profile are non-sensitive, add nothing to the verification
    // burden, and additionally supply a display name — without which every
    // message goes out with a bare address in From:, undercutting the entire
    // "a person typed this" premise.
    url.searchParams.set(
      'scope',
      'https://www.googleapis.com/auth/gmail.send openid email profile',
    );
    // Without both of these Google returns a refresh token once and never
    // again, and a campaign that fires next month has nothing to refresh with.
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    return url.toString();
  }

  const url = new URL(config.campaigns.microsoftAuthUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.campaigns.microsoftClientId);
  url.searchParams.set('redirect_uri', redirectUri);
  // offline_access is what yields a refresh token at all.
  url.searchParams.set(
    'scope',
    'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access',
  );
  url.searchParams.set('state', state);
  return url.toString();
}

/** Finish the flow: authorization code in, refresh token out. */
export async function exchangeMailCode(
  system: MailSystem,
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string }> {
  const google = system === 'google_mail';
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: google ? config.campaigns.googleClientId : config.campaigns.microsoftClientId,
    client_secret: google
      ? config.campaigns.googleClientSecret
      : config.campaigns.microsoftClientSecret,
  });

  const res = await fetch(google ? config.campaigns.googleTokenUrl : config.campaigns.microsoftTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error_description?: string;
  };

  if (!res.ok || !json.refresh_token || !json.access_token) {
    throw new Error(
      json.error_description ??
        'That mailbox did not return a lasting connection. Try again and make sure you approve offline access.',
    );
  }
  return { refreshToken: json.refresh_token, accessToken: json.access_token };
}

/** What a deployment could offer, and whether it is configured. */
export const MAIL_PROVIDERS = [
  {
    id: 'google_mail' as const,
    name: 'Gmail / Google Workspace',
    available: Boolean(config.campaigns.googleClientId),
    note: 'Sends from your own address, lands in your Sent folder, and replies come straight back to you. We ask only for permission to send — never to read your mail.',
  },
  {
    id: 'microsoft_mail' as const,
    name: 'Microsoft 365 / Outlook',
    available: Boolean(config.campaigns.microsoftClientId),
    note: 'Same arrangement. Some organizations require an administrator to approve it rather than you.',
  },
];
