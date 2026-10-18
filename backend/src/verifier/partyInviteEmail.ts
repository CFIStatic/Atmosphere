import { ATMOSPHERE_EMAIL_LOGO_STYLE, atmosphereWordmarkHtml } from '../lib/brandMark.js';
import { viaAtmosphereFromName } from '../lib/mailDeliverability.js';

/**
 * Subcontractor / crew job invitation (Share > Subcontractor or crew).
 *
 * The same email as the homeowner share (progressShareEmail): same layout,
 * same sender line, one primary "View the job" link to the office host. The
 * link opens the job in the same app as the contractor, behind a real
 * account (sign in, or create one). Recording stays in Field Capture, offered
 * as a quiet second link.
 */

export function partyInviteEmail(input: {
  orgName: string;
  inviterName?: string | null;
  jobTitle?: string | null;
  siteAddress?: string | null;
  recipientName?: string | null;
  recipientEmail: string;
  recipientHasAccount: boolean;
  /** Platform / office origin. */
  origin?: string | null;
  /** The invite path on the office host, e.g. /invite/<token>?email=… */
  path: string;
  /** Signup URL when the recipient has no account yet. */
  signupPath?: string | null;
  /** Field Capture link for the same job token (record the day). */
  fieldCaptureUrl?: string | null;
}): { subject: string; text: string; html: string; fromName: string } {
  const org = input.orgName.trim() || 'a contractor';
  const sharer = input.inviterName?.trim() || null;
  const job = input.jobTitle?.trim() || null;
  const from = sharer ? `${sharer} at ${org}` : org;
  const viewLink = absoluteUrl(input.origin, input.path);
  const record = input.fieldCaptureUrl?.trim() || null;
  const signup =
    !input.recipientHasAccount && input.signupPath ? absoluteUrl(input.origin, input.signupPath) : null;

  const intro = job
    ? `${from} shared the job file for ${job} with you on Atmosphere.`
    : `${from} shared a job file with you on Atmosphere.`;
  const accountLine = input.recipientHasAccount
    ? `Sign in with ${input.recipientEmail} and the job shows up on your Dashboard, next to your own jobs.`
    : `Create a free account with ${input.recipientEmail} and the job stays on your Dashboard.`;
  const why = `You are getting this email because ${org} added ${input.recipientEmail} to this job. If you were not expecting it, you can ignore it.`;

  const lines: string[] = ['Hello,', '', intro, accountLine, '', 'View the job:', '', `  ${viewLink}`, ''];
  if (signup) lines.push('Create your account:', '', `  ${signup}`, '');
  if (record) lines.push('Record on site with Field Capture:', '', `  ${record}`, '');
  lines.push(`Questions about the work? Contact ${org} directly.`);
  lines.push('', why, '', 'Atmosphere · atmosphereteam.com');

  const quiet = (href: string, label: string, tail: string) =>
    `<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#78716c;">
            <a href="${escapeAttr(href)}" style="color:#b45309;font-weight:600;text-decoration:underline;">${label}</a>
            ${tail}
          </p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" />${ATMOSPHERE_EMAIL_LOGO_STYLE}</head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#fffdf8;border:1px solid #e7e0d4;border-radius:16px;padding:28px 28px 24px;">
        <tr><td>
          ${atmosphereWordmarkHtml()}
          <h1 style="margin:16px 0 0;font-size:20px;line-height:1.3;color:#1c1917;">
            ${job ? `Job file for ${escapeHtml(job)}` : 'A job file for you'}
          </h1>
          <p style="margin:10px 0 0;font-size:15px;line-height:1.5;color:#3f3a34;">
            ${escapeHtml(intro)} ${escapeHtml(accountLine)}
          </p>
          <p style="margin:24px 0 0;">
            <a href="${escapeAttr(viewLink)}"
               style="display:inline-block;background:#ea580c;color:#1c1917;font-weight:700;font-size:15px;text-decoration:none;padding:12px 18px;border-radius:10px;">
              View the job
            </a>
          </p>
          ${signup ? quiet(signup, 'Create your account', 'with this email.') : ''}
          ${record ? quiet(record, 'Record in Field Capture', 'when you are on site.') : ''}
          <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#57534e;">
            Questions about the work? Contact ${escapeHtml(org)} directly.
          </p>
          <p style="margin:16px 0 0;font-size:11px;line-height:1.4;color:#78716c;">
            ${escapeHtml(why)}<br />
            Atmosphere · atmosphereteam.com
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    subject: job ? `${org} shared the job file for ${job}` : `${org} shared a job file with you`,
    text: lines.join('\n'),
    html,
    fromName: viaAtmosphereFromName(input.orgName),
  };
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
