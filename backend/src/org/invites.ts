/**
 * Invitations: the words, and the bookkeeping.
 *
 * Pure, in the pattern everything else here follows: the email somebody
 * receives and the rule that marks an invite as answered are both things worth
 * testing without a database, because both are things that read wrong in ways
 * a type checker cannot see.
 */

export interface InviteRow {
  id: string;
  email: string;
  status: 'pending' | 'joined' | 'revoked';
}

/**
 * Which pending invites have been answered by somebody actually joining.
 *
 * Joining happens through the code, not through the invite — the join flow
 * has no idea an invite row exists. So the two are reconciled after the fact,
 * by address: a pending invite whose email now belongs to a member is done.
 *
 * Only pending rows move. A revoked invite followed by the person joining
 * anyway (they still had the code — revoking is bookkeeping, not access
 * control) stays revoked, because "we withdrew the invitation and they came in
 * regardless" is exactly the sequence worth being able to see.
 */
export function invitesAnsweredBy(invites: InviteRow[], memberEmails: string[]): string[] {
  const members = new Set(memberEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  return invites
    .filter((invite) => invite.status === 'pending' && members.has(invite.email.trim().toLowerCase()))
    .map((invite) => invite.id);
}

/**
 * The invitation email.
 *
 * Sent by Atmosphere (platform SMTP). The org and requester are named in the
 * body so the recipient knows who asked — but the mail does not come from
 * their inbox.
 *
 * Plain text, short, built around sign up + join code. The code appears on its
 * own line because it will be read off a phone and typed into a laptop.
 */
export function inviteEmail(input: {
  orgName: string;
  inviterName: string | null;
  joinCode: string;
  /** The app's public origin, when configured. Without it the steps still work. */
  origin?: string | null;
  /** Field Capture web host — same join code, phone-sized app. */
  fieldCaptureOrigin?: string | null;
  note?: string | null;
}): { subject: string; text: string; html: string } {
  const inviter = input.inviterName?.trim() || null;
  const org = input.orgName.trim() || 'a team';
  const lines: string[] = [
    `Atmosphere invited you to join ${org}.`,
    '',
  ];

  if (inviter) lines.push(`Requested by: ${inviter}`, '');

  if (input.note?.trim()) {
    lines.push(`"${input.note.trim()}"`, '');
  }

  lines.push('To join this office:', '');
  if (input.origin) {
    lines.push(
      `  1. Open ${input.origin}/signup?intent=join and create an account with this email address.`,
    );
  } else {
    lines.push('  1. Open Atmosphere and create an account with this email address.');
  }
  if (input.fieldCaptureOrigin) {
    lines.push(
      `     Or open Field Capture on the web: ${input.fieldCaptureOrigin}`,
    );
  }
  lines.push('  2. Enter this join code:', '');
  lines.push(`      ${input.joinCode}`, '');
  lines.push(
    'On the Field Capture iPhone app, sign in (or create the account there),',
    'then enter the same join code when asked to connect to the office.',
    '',
  );
  lines.push(
    'The code is the same for everyone joining this company, so there is nothing',
    'personal in this link to lose. If you were not expecting this, you can ignore it.',
  );

  const signup = input.origin
    ? `${input.origin.replace(/\/$/, '')}/signup?intent=join`
    : null;
  const fieldCapture = input.fieldCaptureOrigin?.replace(/\/$/, '') || null;
  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fffdf8;border:1px solid #e7e0d4;border-radius:16px;padding:28px 28px 24px;">
        <tr><td>
          <h1 style="margin:0;font-size:22px;line-height:1.3;color:#1c1917;">
            Join ${escapeHtml(org)} on Atmosphere
          </h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.5;color:#3f3a34;">
            Atmosphere invited you to this office.${inviter ? ` Requested by ${escapeHtml(inviter)}.` : ''}
          </p>
          ${
            input.note?.trim()
              ? `<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#3f3a34;">
            "${escapeHtml(input.note.trim())}"
          </p>`
              : ''
          }
          <p style="margin:20px 0 0;font-size:13px;color:#78716c;">Join code</p>
          <p style="margin:4px 0 0;font-size:22px;font-weight:700;letter-spacing:0.04em;color:#1c1917;">
            ${escapeHtml(input.joinCode)}
          </p>
          ${
            signup
              ? `<p style="margin:24px 0 0;">
            <a href="${escapeAttr(signup)}"
               style="display:inline-block;background:#ea580c;color:#1c1917;font-weight:700;font-size:15px;text-decoration:none;padding:12px 18px;border-radius:10px;">
              Create your account
            </a>
          </p>`
              : ''
          }
          ${
            fieldCapture
              ? `<p style="margin:12px 0 0;">
            <a href="${escapeAttr(fieldCapture)}"
               style="color:#b45309;font-weight:600;text-decoration:underline;">
              Open Field Capture
            </a>
          </p>`
              : ''
          }
          <p style="margin:24px 0 0;font-size:12px;line-height:1.4;color:#78716c;">
            The same join code works on the web office, Field Capture on the web, and the iPhone app.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    subject: `Atmosphere: invite to join ${org}`,
    text: lines.join('\n'),
    html,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", '&#39;');
}
