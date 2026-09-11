import { atmosphereWordmarkHtml } from '../lib/brandMark.js';

/**
 * Homeowner (and counsel / bank / adjuster) job-file share email.
 *
 * Opens a progress link on the office host (platform.atmosphereteam.com).
 * One primary CTA. Optional quiet line to save the job with email + password.
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
  const org = input.orgName.trim() || 'a contractor';
  const from = sharer ? `${sharer} at ${org}` : org;
  const job = input.jobTitle?.trim() || null;
  const viewLink = absoluteUrl(input.origin, input.path);
  const emailParam = input.recipientEmail
    ? `email=${encodeURIComponent(input.recipientEmail.trim().toLowerCase())}`
    : '';
  const accountLink = absoluteUrl(
    input.origin,
    `/signup?intent=homeowner${emailParam ? `&${emailParam}` : ''}&next=${encodeURIComponent(input.path)}`,
  );

  const lines: string[] = ['There is a job file for you on Atmosphere.', '', `From: ${from}`];
  if (job) lines.push(`Job: ${job}`);
  lines.push('', 'View progress:', '', `  ${viewLink}`, '');
  lines.push('To save this job for later (email + password):', '', `  ${accountLink}`, '');

  if (input.expiresAt) {
    lines.push(`Link expires ${input.expiresAt.slice(0, 10)}.`);
  }

  lines.push('', '— Atmosphere');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#fffdf8;border:1px solid #e7e0d4;border-radius:16px;padding:28px 28px 24px;">
        <tr><td>
          ${atmosphereWordmarkHtml()}
          <h1 style="margin:16px 0 0;font-size:20px;line-height:1.3;color:#1c1917;">
            A job file on Atmosphere
          </h1>
          <p style="margin:10px 0 0;font-size:15px;line-height:1.5;color:#3f3a34;">
            From ${escapeHtml(from)}
          </p>
          ${
            job
              ? `<p style="margin:10px 0 0;font-size:15px;line-height:1.5;color:#3f3a34;">Job: <strong>${escapeHtml(job)}</strong></p>`
              : ''
          }
          <p style="margin:24px 0 0;">
            <a href="${escapeAttr(viewLink)}"
               style="display:inline-block;background:#ea580c;color:#1c1917;font-weight:700;font-size:15px;text-decoration:none;padding:12px 18px;border-radius:10px;">
              View progress
            </a>
          </p>
          <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#78716c;">
            <a href="${escapeAttr(accountLink)}" style="color:#b45309;font-weight:600;text-decoration:underline;">
              Save this job
            </a>
            with email and password.
          </p>
          ${
            input.expiresAt
              ? `<p style="margin:20px 0 0;font-size:12px;line-height:1.4;color:#78716c;">Link expires ${escapeHtml(input.expiresAt.slice(0, 10))}.</p>`
              : ''
          }
          <p style="margin:16px 0 0;font-size:11px;line-height:1.4;color:#78716c;">
            Atmosphere · atmosphereteam.com
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    subject: job ? `Job file on Atmosphere · ${job}` : 'A job file on Atmosphere',
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
