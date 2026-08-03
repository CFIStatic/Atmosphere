/**
 * The send-on-behalf port.
 *
 * The product needs to send email as the customer — from their address, so a
 * reply lands in their inbox and the message reads like a person wrote it.
 * There are two ways to do that and they are not equivalent:
 *
 *   Their own mailbox, over OAuth (Gmail, Microsoft 365). The message really
 *   is from them: it appears in their Sent folder, threads correctly, and
 *   inherits their domain's existing reputation. For modest volumes of
 *   one-to-one-feeling B2B email — which is exactly what a "hope you're well,
 *   storm's coming" note is — this is the right answer and it needs no DNS
 *   work from the customer.
 *
 *   A sending service (SendGrid, Postmark, SES) with their domain
 *   authenticated. Necessary past a few hundred a day, and it needs the
 *   customer to add SPF and DKIM records before anything lands. Better for
 *   volume, worse for looking human, and it puts our shared reputation at
 *   risk when one customer behaves badly.
 *
 * So the mailbox providers are primary and the service is the escape hatch,
 * which is the reverse of how most marketing tools are built — and it is the
 * right way round for this trade, where the whole pitch is that a person you
 * have met is checking in before a storm.
 *
 * Whichever answers, it goes through the same gate in guards.ts. No sender
 * implementation is permitted to be the place a suppression check lives.
 */

export interface OutgoingMessage {
  to: string;
  /** The person's name, when known, so the header reads "Tomas Bergeron <…>". */
  toName?: string | null;
  subject: string;
  /** Plain text. Deliberately not HTML — see guards.ts. */
  text: string;
  /**
   * Where replies go, when it differs from the sending mailbox. Rarely set:
   * the point of sending from their account is that replies come back to it.
   */
  replyTo?: string | null;
  /**
   * Threading headers. Set when a campaign follows up on an earlier message so
   * it lands in the same conversation rather than as a fresh cold email.
   */
  inReplyTo?: string | null;
  references?: string | null;
}

export interface SendResult {
  ok: boolean;
  /** The provider's id for the message, kept so a bounce can be traced back. */
  messageId: string | null;
  /** Set when ok is false. Safe to show an operator. */
  error?: string;
  /**
   * True when the failure is worth retrying — a rate limit or a blip — and
   * false when retrying would just fail again, like a rejected recipient.
   * Retrying a permanent failure is how one bad address becomes a reputation
   * problem.
   */
  retryable?: boolean;
}

export interface SenderIdentity {
  /** The address mail will actually come from. */
  address: string;
  displayName: string | null;
  /** 'Gmail', 'Microsoft 365', 'SMTP'. */
  provider: string;
}

export interface MailSender {
  readonly name: string;
  /**
   * Roughly how many this provider will accept in a day. Advisory — it feeds
   * the send planner so a campaign of 900 into a 500/day mailbox is caught
   * before it starts rather than half way through.
   */
  readonly dailyCeiling: number;
  /** Who mail will appear to be from. Throws when the grant is dead. */
  identity(): Promise<SenderIdentity>;
  /** Cheap credential check for the settings screen. */
  verify(): Promise<void>;
  /** Send one. Must never throw — a failure is a result, not an exception. */
  send(message: OutgoingMessage): Promise<SendResult>;
}

/**
 * RFC 822 for a plain-text message.
 *
 * Hand-built rather than pulled from a library because the requirements are
 * small and the failure modes are specific: header injection through a name or
 * subject, and non-ASCII silently mangled. Both are handled here, once, rather
 * than in each provider.
 */
export function buildRfc822(message: OutgoingMessage, from: SenderIdentity): string {
  // A newline in a header value lets a caller append arbitrary headers — Bcc
  // being the interesting one. Every value that reaches a header is stripped.
  const clean = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();

  // Anything outside ASCII has to be encoded or it arrives as mojibake.
  const encodeHeader = (value: string): string => {
    const safe = clean(value);
    if (/^[\x20-\x7E]*$/.test(safe)) return safe;
    return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
  };

  const address = (email: string, name?: string | null): string =>
    name ? `${encodeHeader(name)} <${clean(email)}>` : clean(email);

  const headers = [
    `From: ${address(from.address, from.displayName)}`,
    `To: ${address(message.to, message.toName)}`,
    `Subject: ${encodeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];

  if (message.replyTo) headers.push(`Reply-To: ${clean(message.replyTo)}`);
  if (message.inReplyTo) headers.push(`In-Reply-To: ${clean(message.inReplyTo)}`);
  if (message.references) headers.push(`References: ${clean(message.references)}`);

  // Base64 the body so long lines and non-ASCII survive intact. Wrapped at 76
  // characters, which is what the encoding specifies.
  const body = Buffer.from(message.text, 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');

  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

/** Gmail wants the raw message base64url-encoded rather than plain base64. */
export function toBase64Url(raw: string): string {
  return Buffer.from(raw, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
