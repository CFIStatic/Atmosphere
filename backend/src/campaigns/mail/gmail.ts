import { config } from '../../config.js';
import { buildRfc822, toBase64Url, type MailSender, type OutgoingMessage, type SendResult, type SenderIdentity } from './ports.js';

/**
 * Gmail, sending as the customer.
 *
 * The scope requested is `gmail.send` and nothing else. That is deliberate and
 * it is worth being precise about: `gmail.send` permits creating and sending
 * messages and grants no ability to read a single one. A customer clicking
 * through the consent screen sees "Send email on your behalf" rather than
 * "Read, compose, send and permanently delete all your email", which is what
 * the broader scopes say — and which is a reasonable thing to refuse.
 *
 * Practical consequence worth knowing before you ship: `gmail.send` requires
 * Google app verification once the app serves more than a hundred users, and
 * that hundred is a lifetime cap rather than a concurrent one. Sources
 * disagree on whether it is classed "sensitive" (verification only, free) or
 * "restricted" (verification plus an annual paid third-party security
 * assessment) — it is absent from Google's published restricted-Gmail-scope
 * list, which suggests sensitive, but this should be confirmed against the
 * OAuth API Verification FAQ before anyone commits a budget or a date.
 *
 * The part that is not ambiguous, and that decides the schedule: while the
 * consent screen sits in Testing, Google force-expires every refresh token
 * after seven days. A campaign that fires next month has nothing left to
 * refresh with, so verification is a launch blocker for scheduled sending
 * rather than post-launch cleanup.
 *
 * The message lands in the customer's own Sent folder and threads normally,
 * because it genuinely is their mail. That is the whole reason to do it this
 * way rather than through a sending service: a reply goes back to them, not
 * to a webhook.
 */

interface GmailSendResponse {
  id?: string;
  threadId?: string;
  error?: { message?: string; code?: number };
}

export class GmailSender implements MailSender {
  readonly name = 'Gmail';
  /**
   * A consumer Gmail account is limited to roughly 500 recipients a day and a
   * Workspace account to about 2,000. The lower figure is used because
   * exceeding it gets the mailbox temporarily locked, and being conservative
   * costs a campaign a day while being wrong costs the customer their email.
   */
  readonly dailyCeiling = 450;

  private readonly accessToken: string;
  private readonly knownAddress: string | null;
  private readonly knownName: string | null;
  private cached: SenderIdentity | null = null;

  constructor(accessToken: string, knownAddress: string | null = null, knownName: string | null = null) {
    this.accessToken = accessToken;
    this.knownAddress = knownAddress;
    this.knownName = knownName;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' };
  }

  /**
   * Who mail will come from.
   *
   * Read from the OpenID userinfo endpoint rather than Gmail's own profile
   * endpoint. `gmail.send` grants no read access at all, so asking Gmail
   * about the mailbox is at best undefined and at worst a 403 that kills the
   * whole flow — and userinfo additionally returns a display name, without
   * which every message goes out with a bare address in From:.
   */
  async identity(): Promise<SenderIdentity> {
    if (this.cached) return this.cached;

    // Captured at connect time, when the token was fresh. Avoids a network
    // call per send and works even if userinfo is briefly unreachable.
    if (this.knownAddress) {
      this.cached = { address: this.knownAddress, displayName: this.knownName, provider: this.name };
      return this.cached;
    }

    const res = await fetch(`${config.campaigns.googleUserinfoUrl}`, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(
        res.status === 401
          ? 'The Gmail connection has expired. Reconnect it in Settings.'
          : `Google returned ${res.status} when asked which account this is.`,
      );
    }
    const body = (await res.json()) as { email?: string; name?: string };
    if (!body.email) throw new Error('Google did not report an address for this account.');

    this.cached = { address: body.email, displayName: body.name ?? null, provider: this.name };
    return this.cached;
  }

  async verify(): Promise<void> {
    await this.identity();
  }

  async send(message: OutgoingMessage): Promise<SendResult> {
    let from: SenderIdentity;
    try {
      from = await this.identity();
    } catch (err) {
      return { ok: false, messageId: null, error: err instanceof Error ? err.message : 'No identity', retryable: false };
    }

    const raw = toBase64Url(buildRfc822(message, from));

    try {
      const res = await fetch(`${config.campaigns.gmailBaseUrl}/gmail/v1/users/me/messages/send`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ raw }),
      });

      const body = (await res.json().catch(() => ({}))) as GmailSendResponse;

      if (res.ok && body.id) return { ok: true, messageId: body.id };

      // 429 and 5xx are worth another go later; 4xx generally is not, and
      // retrying a rejected recipient is how one bad address turns into a
      // reputation problem.
      const retryable = res.status === 429 || res.status >= 500;
      return {
        ok: false,
        messageId: null,
        error: body.error?.message ?? `Gmail returned ${res.status}.`,
        retryable,
      };
    } catch {
      return { ok: false, messageId: null, error: 'Gmail did not respond.', retryable: true };
    }
  }
}
