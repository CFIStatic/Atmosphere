/**
 * The Field Capture / subcontractor job invitation email.
 *
 * Pure, like shareEmail and inviteEmail: the words are the part that can read
 * wrong in ways a type checker cannot see, so they are built where a test can
 * read them.
 *
 * Two audiences, one address. Someone who already has an Atmosphere account
 * under this inbox needs "sign in — the job is waiting." Someone who does not
 * needs "create a free account with this exact address." Telling both people
 * both things reads as boilerplate, which is how instructions stop being
 * followed.
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
  const inviter = input.inviterName?.trim() || null;
  const from = inviter ? `${inviter} at ${input.orgName}` : input.orgName;
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
    `${from} invited you to capture a job on Atmosphere.`,
    '',
  ];
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
    subject: `${from} invited you to capture${job ? ` ${job}` : ' a job'} on Atmosphere`,
    text: lines.join('\n'),
  };
}
