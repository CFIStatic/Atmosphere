/**
 * The job progress share notification email.
 *
 * Unlike evidence shares, progress links open without an Atmosphere account —
 * homeowners, attorneys, banks and adjusters should not need to sign up to see
 * how work is advancing. The email says that plainly, because "create an
 * account first" is the wrong instruction for this audience.
 */
export function progressShareEmail(input: {
  orgName: string;
  sharerName?: string | null;
  jobTitle?: string | null;
  recipientEmail?: string | null;
  origin?: string | null;
  /** The share path, e.g. /progress/<token>. */
  path: string;
  expiresAt?: string | null;
}): { subject: string; text: string } {
  const sharer = input.sharerName?.trim() || null;
  const from = sharer ? `${sharer} at ${input.orgName}` : input.orgName;
  const job = input.jobTitle?.trim() || null;
  const link = input.origin ? `${input.origin}${input.path}` : input.path;

  const lines: string[] = [
    `${from} shared job progress with you on Atmosphere.`,
    '',
  ];
  if (job) lines.push(`Job: ${job}`, '');

  lines.push('Open it here:', '', `  ${link}`, '');

  lines.push(
    'No account is required — the link opens a read-only view of scope completion,',
    'verified field days, and the day-by-day work history.',
  );
  lines.push('');

  if (input.expiresAt) {
    lines.push(`The link expires on ${input.expiresAt.slice(0, 10)}.`);
  } else {
    lines.push(`The link stays live until ${input.orgName} revokes it.`);
  }

  lines.push(
    '',
    'If you were not expecting this, you can ignore it — nothing happens until the link is opened.',
  );

  return {
    subject: `${from} shared job progress${job ? ` for ${job}` : ''} on Atmosphere`,
    text: lines.join('\n'),
  };
}
