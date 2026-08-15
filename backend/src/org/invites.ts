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
  note?: string | null;
}): { subject: string; text: string } {
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

  lines.push('To link your account to this office:', '');
  if (input.origin) {
    lines.push(
      `  1. Open ${input.origin}/signup?intent=join and create an account with this email address.`,
    );
  } else {
    lines.push('  1. Open Atmosphere and create an account with this email address.');
  }
  lines.push('  2. Choose "Link to office account" and enter this code:', '');
  lines.push(`      ${input.joinCode}`, '');
  lines.push(
    'On the Field Capture iPhone app, sign in (or create the account there),',
    'then choose "Link to office account" and enter the same code.',
    '',
  );
  lines.push(
    'The code is the same for everyone joining this company, so there is nothing',
    'personal in this link to lose. If you were not expecting this, you can ignore it.',
  );

  return {
    subject: `Atmosphere: invite to join ${org}`,
    text: lines.join('\n'),
  };
}
