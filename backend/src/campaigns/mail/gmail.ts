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
 * Practical consequence worth knowing before you ship: Google treats
 * `gmail.send` as a restricted scope. An app serving more than a hundred
 * users needs verification, and restricted scopes additionally require an
 * annual third-party security assessment. That is a real cost and a real
 * calendar delay, and it is a business decision rather than a technical one.
 * Until it clears, the app works fine for test users added in the console.
 *
 * The message lands in the customer's own Sent folder and threads normally,
 * because it genuinely is their mail. That is the whole reason to do it this
 * way rather than through a sending service: a reply goes back to them, not
 * to a webhook.
 */

interface GmailProfile {
  emailAddress?: string;
}

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
  private cached: SenderIdentity | null = null;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' };
  }

  async identity(): Promise<SenderIdentity> {
    if (this.cached) return this.cached;

    const res = await fetch(`${config.campaigns.gmailBaseUrl}/gmail/v1/users/me/profile`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(
        res.status === 401
          ? 'The Gmail connection has expired. Reconnect it in Settings.'
          : `Gmail returned ${res.status}.`,
      );
    }
    const body = (await res.json()) as GmailProfile;
    if (!body.emailAddress) throw new Error('Gmail did not report an address for this account.');

    this.cached = { address: body.emailAddress, displayName: null, provider: this.name };
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
