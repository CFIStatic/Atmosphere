import { atmosphereWordmarkHtml } from '../lib/brandMark.js';

/**
 * Field Capture / subcontractor job invitation.
 *
 * Sent by Atmosphere (platform SMTP), not from the inviting company's mailbox.
 * The org is named in the body so the recipient knows who the job is for.
 *
 * Recipients without an Atmosphere account are asked to create one
 * with this exact address so the job stays with their others.
 *
 * The capture link opens the invited job (scope, accept, film) without a
 * login. It must not dump a signed-in office user onto their jobs dashboard.
 */

export function partyInviteEmail(input: {
  orgName: string;
  inviterName?: string | null;
  jobTitle?: string | null;
  siteAddress?: string | null;
  recipientName?: string | null;
  recipientEmail: string;
  recipientHasAccount: boolean;
  /** The app's public origin, when configured. */
  origin?: string | null;
  /** Share path, e.g. /shared/<token>?email=… */
  path: string;
  /** Signup URL when the recipient has no account yet. */
  signupPath?: string | null;
  /** Field Capture web / phone app link for the same job token. */
  fieldCaptureUrl?: string | null;
}): { subject: string; text: string; html: string } {
  const org = input.orgName.trim() || 'a contractor';
  const inviter = input.inviterName?.trim() || null;
  const job = input.jobTitle?.trim() || null;
  const site = input.siteAddress?.trim() || null;
  const who = input.recipientName?.trim() || null;
  const link = absoluteUrl(input.origin, input.path);
  const signup = input.signupPath ? absoluteUrl(input.origin, input.signupPath) : null;
  const fieldCapture = input.fieldCaptureUrl?.trim() || null;

  const subject = job
    ? `${org} invited you to capture: ${job}`
    : `${org} invited you to capture a job on Atmosphere`;

  const textLines: string[] = [
    who ? `Hi ${who},` : 'Hi,',
    '',
    `${org} invited you to capture work on Atmosphere.`,
  ];
  if (inviter) textLines.push(`Requested by: ${inviter}`);
  if (job) textLines.push(`Job: ${job}`);
  if (site) textLines.push(`Site: ${site}`);
  textLines.push(
    '',
    'Open your job on your phone (no login required to start):',
    '',
    `  ${link}`,
    '',
  );
  if (fieldCapture) {
    textLines.push('Or open it in Field Capture (web or the iPhone app):', '', `  ${fieldCapture}`, '');
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
    'On the job page you will:',
    '  1. Review the scope and “do not” lines',
    '  2. Accept the brief',
    '  3. Film the day (video + microphone)',
    '',
    'If you were not expecting this, you can ignore it — nothing happens until the link is opened.',
    '',
    '— Atmosphere · jettx.ai',
  );

  const metaRows = [
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

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fffdf8;border:1px solid #e7e0d4;border-radius:16px;padding:28px 28px 24px;">
        <tr><td>
          ${atmosphereWordmarkHtml()}
          <h1 style="margin:16px 0 0;font-size:22px;line-height:1.3;color:#1c1917;">
            ${escapeHtml(org)} invited you to capture a job
          </h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.5;color:#3f3a34;">
            ${who ? `Hi ${escapeHtml(who)},` : 'Hi,'}
            open the link on your phone to review the scope, accept the brief, and film the day.
          </p>
          ${metaRows ? `<table role="presentation" style="margin:20px 0 0;width:100%;">${metaRows}</table>` : ''}
          <p style="margin:24px 0 0;">
            <a href="${escapeAttr(link)}"
               style="display:inline-block;background:#ea580c;color:#1c1917;font-weight:700;font-size:15px;text-decoration:none;padding:12px 18px;border-radius:10px;">
              Open job on phone
            </a>
          </p>
          ${
            fieldCapture
              ? `<p style="margin:12px 0 0;">
            <a href="${escapeAttr(fieldCapture)}"
               style="color:#b45309;font-weight:600;text-decoration:underline;">
              Open in Field Capture
            </a>
          </p>`
              : ''
          }
          ${accountBlock ? `\n          ${accountBlock}` : ''}
          <p style="margin:24px 0 0;font-size:12px;line-height:1.4;color:#78716c;">
            If you were not expecting this, ignore it — nothing happens until the link is opened.
          </p>
          <p style="margin:16px 0 0;font-size:11px;line-height:1.4;color:#78716c;">
            Sent by Atmosphere · jettx.ai
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
