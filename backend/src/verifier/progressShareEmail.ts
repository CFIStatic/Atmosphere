import { atmosphereWordmarkHtml } from '../lib/brandMark.js';

/**
 * Homeowner (and counsel / bank / adjuster) job-file share email.
 *
 * Opens a progress link on the office host (platform.atmosphereteam.com).
 * After a quick email + password account, they claim the job and land on
 * /job-progress — never Field Capture capture/film copy.
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
}): { subject: string; text: string; html: string } {
  const sharer = input.sharerName?.trim() || null;
  const from = sharer ? `${sharer} at ${input.orgName}` : input.orgName;
  const job = input.jobTitle?.trim() || null;
  const viewLink = absoluteUrl(input.origin, input.path);
  const emailParam = input.recipientEmail
    ? `email=${encodeURIComponent(input.recipientEmail.trim().toLowerCase())}`
    : '';
  const accountLink = absoluteUrl(
    input.origin,
    `/signup?intent=homeowner${emailParam ? `&${emailParam}` : ''}&next=${encodeURIComponent(input.path)}`,
  );

  const lines: string[] = [
    `${from} shared a job file with you so you can view progress on Atmosphere.`,
    '',
  ];
  if (job) lines.push(`Job: ${job}`, '');

  lines.push('View job progress:', '', `  ${viewLink}`, '');
  lines.push(
    'To keep this job in your account, create a quick Atmosphere login',
    '(email and password only — no payment, no Field Capture seat):',
    '',
    `  ${accountLink}`,
    '',
  );

  if (input.expiresAt) {
    lines.push(`The link expires on ${input.expiresAt.slice(0, 10)}.`);
  } else {
    lines.push(`The link stays live until ${input.orgName} revokes it.`);
  }

  lines.push('', '— Atmosphere · atmosphereteam.com');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fffdf8;border:1px solid #e7e0d4;border-radius:16px;padding:28px 28px 24px;">
        <tr><td>
          ${atmosphereWordmarkHtml()}
          <h1 style="margin:16px 0 0;font-size:22px;line-height:1.3;color:#1c1917;">
            ${escapeHtml(from)} shared a job file with you
          </h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.5;color:#3f3a34;">
            ${job ? `Job: <strong>${escapeHtml(job)}</strong>. ` : ''}
            View progress on the job file — brief, do-not lines, scope, and day-by-day recordings.
          </p>
          <p style="margin:24px 0 0;">
            <a href="${escapeAttr(viewLink)}"
               style="display:inline-block;background:#ea580c;color:#1c1917;font-weight:700;font-size:15px;text-decoration:none;padding:12px 18px;border-radius:10px;">
              View job progress
            </a>
          </p>
          <p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#3f3a34;">
            Prefer to keep it in an account? Create a quick login with email and password only
            (no payment).
            <a href="${escapeAttr(accountLink)}" style="color:#b45309;font-weight:600;text-decoration:underline;">
              Create your login
            </a>
          </p>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.4;color:#78716c;">
            ${
              input.expiresAt
                ? `The link expires on ${escapeHtml(input.expiresAt.slice(0, 10))}.`
                : `The link stays live until ${escapeHtml(input.orgName)} revokes it.`
            }
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

  return {
    subject: `${from} shared a job file${job ? ` for ${job}` : ''} — view progress`,
    text: lines.join('\n'),
    html,
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
