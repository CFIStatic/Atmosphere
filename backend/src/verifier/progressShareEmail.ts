import { atmosphereWordmarkHtml } from '../lib/brandMark.js';

/**
 * Homeowner (and counsel / bank / adjuster) job-file share email.
 *
 * Unlike evidence shares, this link opens without an Atmosphere account —
 * the recipient should not need to sign up to see the job file and every
 * recording. The email says that plainly.
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
  const link = absoluteUrl(input.origin, input.path);

  const lines: string[] = [
    `${from} shared a job file with you on Atmosphere.`,
    '',
  ];
  if (job) lines.push(`Job: ${job}`, '');

  lines.push('Open the job file here:', '', `  ${link}`, '');

  lines.push(
    'No account is required — the link opens the job file and every recording',
    'on it: the brief, do-not lines, scope, and the day-by-day films.',
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

  const html = `<!DOCTYPE html>
<html lang="en">
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
            No account is required — open the link to see the job file and every recording.
          </p>
          <p style="margin:24px 0 0;">
            <a href="${escapeAttr(link)}"
               style="display:inline-block;background:#ea580c;color:#1c1917;font-weight:700;font-size:15px;text-decoration:none;padding:12px 18px;border-radius:10px;">
              Open job file
            </a>
          </p>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.4;color:#78716c;">
            ${
              input.expiresAt
                ? `The link expires on ${escapeHtml(input.expiresAt.slice(0, 10))}.`
                : `The link stays live until ${escapeHtml(input.orgName)} revokes it.`
            }
            If you were not expecting this, ignore it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    subject: `${from} shared a job file${job ? ` for ${job}` : ''} on Atmosphere`,
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
