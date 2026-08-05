/**
 * The share notification email.
 *
 * Pure, like the invite email it is modelled on, and for the same reason: the
 * words are the part that can read wrong in ways a type checker cannot see,
 * so they are built where a test can read them.
 *
 * Two things the wording has to carry. First, the pin: the link opens only
 * for an Atmosphere account signed in as the address this email went to —
 * said plainly, because the recipient's first instinct will be to forward it,
 * and a forwarded link that silently refuses is a support call. Second, the
 * fork: a recipient who already has an account needs one instruction (sign
 * in), a recipient who does not needs a different one (create the account,
 * with this exact address) — and telling both people both things reads like
 * boilerplate, which is how instructions stop being followed.
 *
 * Plain text, no unsubscribe footer, no postal block: this is a named person
 * handing another named person a case file, not commercial mail.
 */
export function shareEmail(input: {
  orgName: string;
  /** Whoever created the share, when known. The org's name stands in otherwise. */
  sharerName?: string | null;
  jobTitle?: string | null;
  recipientEmail: string;
  recipientHasAccount: boolean;
  /** The app's public origin, when configured. Without it the path is still the truth. */
  origin?: string | null;
  /** The share path, e.g. /verifier/shared/<token>. */
  path: string;
  expiresAt?: string | null;
}): { subject: string; text: string } {
  const sharer = input.sharerName?.trim() || null;
  const from = sharer ? `${sharer} at ${input.orgName}` : input.orgName;
  const job = input.jobTitle?.trim() || null;
  const link = input.origin ? `${input.origin}${input.path}` : input.path;

  const lines: string[] = [
    `${from} shared job evidence with you on Atmosphere.`,
    '',
  ];
  if (job) lines.push(`Job: ${job}`, '');

  lines.push('Open it here:', '');
  // Its own line, indented: it will be read on a phone and opened on a
  // laptop, and a link buried mid-sentence is a link mistyped.
  lines.push(`  ${link}`, '');

  lines.push(
    `The link opens only when you are signed in to Atmosphere as ${input.recipientEmail}.`,
  );
  if (input.recipientHasAccount) {
    lines.push('Sign in with that account and the evidence is there.');
  } else {
    lines.push(
      'There is no Atmosphere account under this address yet. Create a free one',
      'using this exact address, then open the link — an account under any other',
      'address will not open it.',
    );
  }
  lines.push('');

  if (input.expiresAt) {
    lines.push(`The link expires on ${input.expiresAt.slice(0, 10)}.`);
  } else {
    lines.push(`The link stays live until ${input.orgName} revokes it.`);
  }
  lines.push(
    '',
    'Viewing is free, and every view is entered in the chain of custody under',
    'your name. If you were not expecting this, you can ignore it — nothing',
    'happens until the link is opened.',
  );

  return {
    subject: `${from} shared evidence${job ? ` for ${job}` : ''} on Atmosphere`,
    text: lines.join('\n'),
  };
}
