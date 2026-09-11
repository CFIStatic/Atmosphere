import { atmosphereWordmarkHtml } from '../lib/brandMark.js';

/**
 * Field Capture / subcontractor job invitation.
 *
 * Sent by Atmosphere (Resend), not from the inviting company's mailbox.
 * The org is named in the body so the recipient knows who the job is for.
 *
 * Primary open is Field Capture (app.atmosphereteam.com): existing accounts
 * sign in there; new recipients get a create-account prompt. The office
 * /shared link stays a secondary "job file on the web" fallback.
 */

export function partyInviteEmail(input: {
  orgName: string;
  inviterName?: string | null;
  jobTitle?: string | null;
  siteAddress?: string | null;
  recipientName?: string | null;
  recipientEmail: string;
  recipientHasAccount: boolean;
  /** Platform / office origin for signup + optional web job-file link. */
  origin?: string | null;
  /** Office share path, e.g. /shared/<token>?email=… (secondary). */
  path: string;
  /** Signup URL when the recipient has no account yet. */
  signupPath?: string | null;
  /** Field Capture web / phone app link for the same job token (primary). */
  fieldCaptureUrl?: string | null;
}): { subject: string; text: string; html: string } {
  const org = input.orgName.trim() || 'a contractor';
  const inviter = input.inviterName?.trim() || null;
  const job = input.jobTitle?.trim() || null;
  const site = input.siteAddress?.trim() || null;
  const who = input.recipientName?.trim() || null;
  const officeLink = absoluteUrl(input.origin, input.path);
  const fieldCapture = input.fieldCaptureUrl?.trim() || null;
  const signup = fieldCapture || (input.signupPath ? absoluteUrl(input.origin, input.signupPath) : null);
  const primary = fieldCapture || officeLink;
  const primaryIsFieldCapture = Boolean(fieldCapture);

  const subject = job
    ? `Capture on Atmosphere · ${job}`
    : 'You are invited to capture on Atmosphere';

  const textLines: string[] = [
    who ? `Hi ${who},` : 'Hi,',
    '',
    'You are invited to capture work on Atmosphere.',
    `From: ${org}`,
  ];
  if (inviter) textLines.push(`Requested by: ${inviter}`);
  if (job) textLines.push(`Job: ${job}`);
  if (site) textLines.push(`Site: ${site}`);
  textLines.push(
    '',
    primaryIsFieldCapture
      ? 'Open in Field Capture (sign in if you have an account, or create one):'
      : 'Open your job on your phone:',
    '',
    `  ${primary}`,
    '',
  );
  if (primaryIsFieldCapture && officeLink !== primary) {
    textLines.push('Job file on the web:', '', `  ${officeLink}`, '');
  }

  if (!input.recipientHasAccount) {
    textLines.push(
      `There is no Atmosphere account for ${input.recipientEmail} yet.`,
      'Create a free account with that exact address so this job stays with your others.',
    );
    if (signup) {
      textLines.push('', 'Create your account:', '', `  ${signup}`);
    }
  }

  textLines.push(
    '',
    'On the job you will:',
    '  1. Open the job file (scope, do-nots, brief, recordings)',
    '  2. Film the day in Field Capture',
    '',
    'Opening the invite (and filing a recording) records that you have seen the current scope.',
    '',
    'If you were not expecting this, you can ignore it — nothing happens until the link is opened.',
    '',
    '— Atmosphere · atmosphereteam.com',
  );

  const metaRows = [
    row('From', escapeHtml(org)),
    inviter ? row('Requested by', escapeHtml(inviter)) : '',
    job ? row('Job', escapeHtml(job)) : '',
    site ? row('Site', escapeHtml(site)) : '',
  ]
    .filter(Boolean)
    .join('');

  const accountBlock = input.recipientHasAccount
    ? ''
    : `<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#3f3a34;">
         There is no Atmosphere account for
         <strong>${escapeHtml(input.recipientEmail)}</strong> yet.
         Create a free one with that exact address so this job stays with your others.
       </p>
       ${
         signup
           ? `<p style="margin:12px 0 0;">
                <a href="${escapeAttr(signup)}"
                   style="color:#b45309;font-weight:600;text-decoration:underline;">
                  Create your account
                </a>
              </p>`
           : ''
       }`;

  const primaryLabel = primaryIsFieldCapture ? 'Open in Field Capture' : 'Open job on phone';
  const secondaryBlock =
    primaryIsFieldCapture && officeLink !== primary
      ? `<p style="margin:12px 0 0;">
            <a href="${escapeAttr(officeLink)}"
               style="color:#b45309;font-weight:600;text-decoration:underline;">
              Job file on the web
            </a>
          </p>`
      : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fffdf8;border:1px solid #e7e0d4;border-radius:16px;padding:28px 28px 24px;">
        <tr><td>
          ${atmosphereWordmarkHtml()}
          <h1 style="margin:16px 0 0;font-size:22px;line-height:1.3;color:#1c1917;">
            Capture a job on Atmosphere
          </h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.5;color:#3f3a34;">
            ${who ? `Hi ${escapeHtml(who)},` : 'Hi,'}
            open Field Capture to review the job file and film the day.
            From ${escapeHtml(org)}.
          </p>
          ${metaRows ? `<table role="presentation" style="margin:20px 0 0;width:100%;">${metaRows}</table>` : ''}
          <p style="margin:24px 0 0;">
            <a href="${escapeAttr(primary)}"
               style="display:inline-block;background:#ea580c;color:#1c1917;font-weight:700;font-size:15px;text-decoration:none;padding:12px 18px;border-radius:10px;">
              ${primaryLabel}
            </a>
          </p>
          ${secondaryBlock}
          ${accountBlock ? `
          ${accountBlock}` : ''}
          <p style="margin:24px 0 0;font-size:12px;line-height:1.4;color:#78716c;">
            If you were not expecting this, ignore it — nothing happens until the link is opened.
          </p>
          <p style="margin:16px 0 0;font-size:11px;line-height:1.4;color:#78716c;">
            Sent by Atmosphere · atmosphereteam.com
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text: textLines.join('\n'), html };
}

function absoluteUrl(origin: string | null | undefined, path: string): string {
  if (!origin) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `${origin.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
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

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:4px 12px 4px 0;font-size:13px;color:#78716c;white-space:nowrap;vertical-align:top;">${label}</td>
    <td style="padding:4px 0;font-size:13px;color:#1c1917;font-weight:600;">${value}</td>
  </tr>`;
}
