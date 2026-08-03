import { config } from '../../config.js';
import type { MailSender, OutgoingMessage, SendResult, SenderIdentity } from './ports.js';

/**
 * Microsoft 365, sending as the customer, over Graph.
 *
 * The delegated permission is `Mail.Send` alone — permission to send, and no
 * permission to read anything. Worth noting for anyone selling this into a
 * business: many organisations require an administrator to consent on behalf
 * of the tenant, so an individual user clicking "allow" may not be enough and
 * the first attempt can fail with a consent error rather than a bug.
 *
 * Graph takes structured JSON rather than a raw RFC 822 message, which is why
 * this does not share the builder the other senders use. `saveToSentItems` is
 * set so the message appears in the customer's own Sent folder — the same
 * reasoning as Gmail: it should be indistinguishable from mail they typed,
 * because it is from them.
 */

interface GraphError {
  error?: { code?: string; message?: string };
}

interface GraphMe {
  mail?: string;
  userPrincipalName?: string;
  displayName?: string;
}

export class MicrosoftSender implements MailSender {
  readonly name = 'Microsoft 365';
  /**
   * Exchange Online throttles at roughly 10,000 recipients a day, but a new
   * tenant sending thousands of cold emails attracts attention regardless of
   * the documented limit. This is a deliberately conservative working figure.
   */
  readonly dailyCeiling = 1_000;

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

    const res = await fetch(`${config.campaigns.graphBaseUrl}/v1.0/me`, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(
        res.status === 401
          ? 'The Microsoft connection has expired. Reconnect it in Settings.'
          : `Microsoft Graph returned ${res.status}.`,
      );
    }
    const body = (await res.json()) as GraphMe;
    // `mail` is the real mailbox; userPrincipalName is a sign-in name that is
    // usually but not always the same thing.
    const address = body.mail ?? body.userPrincipalName;
    if (!address) throw new Error('Microsoft did not report a mailbox for this account.');

    this.cached = { address, displayName: body.displayName ?? null, provider: this.name };
    return this.cached;
  }

  async verify(): Promise<void> {
    await this.identity();
  }

  async send(message: OutgoingMessage): Promise<SendResult> {
    const payload = {
      message: {
        subject: message.subject,
        body: { contentType: 'Text', content: message.text },
        toRecipients: [
          {
            emailAddress: message.toName
              ? { address: message.to, name: message.toName }
              : { address: message.to },
          },
        ],
        ...(message.replyTo
          ? { replyTo: [{ emailAddress: { address: message.replyTo } }] }
          : {}),
        // Graph restricts custom headers to x-prefixed names and a small
        // count. List-Unsubscribe is a standard header and Graph accepts it
        // here; the send id is ours, and it is the only way to correlate a
        // bounce on this path since sendMail returns no message id.
        ...(message.unsubscribe || message.sendId
          ? {
              internetMessageHeaders: [
                ...(message.unsubscribe
                  ? [
                      { name: 'List-Unsubscribe', value: `<${message.unsubscribe.url}>` },
                      { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
                    ]
                  : []),
                ...(message.sendId
                  ? [{ name: 'x-atmosphere-send-id', value: message.sendId }]
                  : []),
              ],
            }
          : {}),
      },
      saveToSentItems: true,
    };

    try {
      const res = await fetch(`${config.campaigns.graphBaseUrl}/v1.0/me/sendMail`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
      });

      // Graph answers a successful sendMail with 202 Accepted and no body, so
      // there is no provider message id to record here.
      if (res.status === 202) return { ok: true, messageId: null };

      const body = (await res.json().catch(() => ({}))) as GraphError;
      const retryable = res.status === 429 || res.status >= 500;
      return {
        ok: false,
        messageId: null,
        error: body.error?.message ?? `Microsoft Graph returned ${res.status}.`,
        retryable,
      };
    } catch {
      return { ok: false, messageId: null, error: 'Microsoft Graph did not respond.', retryable: true };
    }
  }
}
