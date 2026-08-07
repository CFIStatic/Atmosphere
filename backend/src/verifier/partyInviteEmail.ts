/**
 * The Field Capture / subcontractor job invitation email.
 *
 * Sent by Atmosphere (platform SMTP), not from the inviting company's mailbox.
 * The org is named in the body so the recipient knows who the job is for.
 *
 * Two audiences, one address. Someone who already has an Atmosphere account
 * under this inbox needs "sign in — the job is waiting." Someone who does not
 * needs "create a free account with this exact address."
 *
 * The capture link itself still opens without a login — a signup wall in front
 * of the scope is how a subcontractor decides this software is the GC's
 * problem. The account fork is about keeping every job in one place after.
 */

export function partyInviteEmail(input: {
  orgName: string;
  inviterName?: string | null;
  jobTitle?: string | null;
  recipientName?: string | null;
  recipientEmail: string;
  recipientHasAccount: boolean;
  /** The app's public origin, when configured. Without it the path is still the truth. */
  origin?: string | null;
  /** Share path, e.g. /shared/<token> — opens the job without a login. */
  path: string;
  /** Optional signup URL when the recipient has no account yet. */
  signupPath?: string | null;
}): { subject: string; text: string } {
  const org = input.orgName.trim() || 'a contractor';
  const inviter = input.inviterName?.trim() || null;
  const job = input.jobTitle?.trim() || null;
  const who = input.recipientName?.trim() || null;
  const link = input.origin ? `${input.origin}${input.path}` : input.path;
  const signup =
    input.signupPath
      ? input.origin
        ? `${input.origin}${input.signupPath}`
        : input.signupPath
      : null;

  const lines: string[] = [
    `Atmosphere invited you to capture a job for ${org}.`,
    '',
  ];
  if (inviter) lines.push(`Requested by: ${inviter}`, '');
  if (who) lines.push(`For: ${who}`, '');
  if (job) lines.push(`Job: ${job}`, '');

  lines.push('Open your job here (works on your phone, no login required):', '');
  lines.push(`  ${link}`, '');

  if (input.recipientHasAccount) {
    lines.push(
      `You already have an Atmosphere account as ${input.recipientEmail}.`,
      'Sign in with that account — this job will show under My jobs once you open',
      'the link and confirm with that same email.',
    );
  } else {
    lines.push(
      `There is no Atmosphere account under ${input.recipientEmail} yet.`,
      'Create a free one using this exact address, then open the link — an account',
      'under any other address will not keep this job with your others.',
    );
    if (signup) {
      lines.push('', 'Create your account here:', '', `  ${signup}`, '');
    }
  }

  lines.push(
    '',
    'On the job page you will see the scope, accept the brief, and film the day',
    '(video + mic). If you were not expecting this, you can ignore it — nothing',
    'happens until the link is opened.',
  );

  return {
    subject: job
      ? `Atmosphere: invite to capture ${job}`
      : `Atmosphere: invite to capture a job for ${org}`,
    text: lines.join('\n'),
  };
}
