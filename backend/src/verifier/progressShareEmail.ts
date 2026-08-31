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
  const viewLink = absoluteUrl(input.origin, input.path);
  const askLink = withAsk(viewLink);

  const lines: string[] = [
    `${from} shared a job file with you on Atmosphere.`,
    '',
  ];
  if (job) lines.push(`Job: ${job}`, '');

  lines.push('View the job file:', '', `  ${viewLink}`, '');
  lines.push('Ask a question about this job:', '', `  ${askLink}`, '');

  lines.push(
    'No account is required — View opens the job file and every recording',
    '(brief, do-not lines, scope, and the day-by-day films). Ask answers from',
    'that same file.',
  );
  lines.push('');

  if (input.expiresAt) {
    lines.push(`The links expire on ${input.expiresAt.slice(0, 10)}.`);
  } else {
    lines.push(`The links stay live until ${input.orgName} revokes them.`);
  }

  lines.push(
    '',
    'If you were not expecting this, you can ignore it — nothing happens until a link is opened.',
  );

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
            No account is required — View the job file and every recording, or Ask a question from the file.
          </p>
          <p style="margin:24px 0 0;">
            <a href="${escapeAttr(viewLink)}"
               style="display:inline-block;background:#ea580c;color:#1c1917;font-weight:700;font-size:15px;text-decoration:none;padding:12px 18px;border-radius:10px;">
              View job file
            </a>
            <a href="${escapeAttr(askLink)}"
               style="display:inline-block;margin-left:10px;background:#1c1917;color:#fffdf8;font-weight:700;font-size:15px;text-decoration:none;padding:12px 18px;border-radius:10px;">
              Ask this job
            </a>
          </p>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.4;color:#78716c;">
            ${
              input.expiresAt
                ? `The links expire on ${escapeHtml(input.expiresAt.slice(0, 10))}.`
                : `The links stay live until ${escapeHtml(input.orgName)} revokes them.`
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

function withAsk(viewLink: string): string {
  if (/[?&]ask=/.test(viewLink)) return viewLink;
  return viewLink.includes('?') ? `${viewLink}&ask=1` : `${viewLink}?ask=1`;
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
