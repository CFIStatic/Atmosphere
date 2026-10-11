import { atmosphereWordmarkHtml } from '../lib/brandMark.js';

/**
 * Email-only sign-in for a homeowner / invitee on a shared job file.
 *
 * Platform mail (SMTP / Resend) — never Supabase Auth's default template. Just
 * the one-time code they type on the page that sent it. The one-tap link is
 * only a fallback for when Supabase returns no code.
 */

const INK = '#1C1917';
const INK_SOFT = '#57534E';
const INK_FAINT = '#78716C';
const PAPER = '#FBFAF7';
const CARD = '#FFFFFF';
const LINE = '#E3DED4';
const ACCENT = '#D2500A';
const ACCENT_INK = '#FFFFFF';
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";

export function progressSignInEmail(input: {
  url: string;
  code?: string | null;
  orgName?: string | null;
}): { subject: string; text: string; html: string } {
  const url = input.url.trim();
  const code = (input.code ?? '').trim() || null;
  const org = (input.orgName ?? '').trim() || null;
  const subject = code ? 'Your Atmosphere sign-in code' : 'Your Atmosphere sign-in link';
  const preheader = code
    ? `Your sign-in code is ${code}`
    : org
      ? `Sign in to the job file ${org} shared with you.`
      : 'Sign in to the job file shared with you.';

  const text = [
    'Atmosphere',
    '',
    ...(code ? ['Your sign-in code:', '', `  ${code}`] : ['Sign in with this link:', '', `  ${url}`]),
    '',
    'Expires in 1 hour · one use',
    '',
    'If you did not ask for this, ignore this email.',
  ].join('\n');

  const body = code
    ? `
              <p style="margin:0;font-size:14px;line-height:1.5;color:${INK_SOFT};">
                Your sign-in code
              </p>
              <p style="margin:8px 0 0;font-family:${MONO};font-size:32px;font-weight:700;letter-spacing:0.18em;color:${INK};">
                ${escapeHtml(code)}
              </p>`
    : `
              <p style="margin:0;">
                <a href="${escapeAttr(url)}"
                   style="display:inline-block;background:${ACCENT};color:${ACCENT_INK};font-weight:700;font-size:15px;text-decoration:none;padding:12px 20px;border-radius:10px;">
                  Sign in
                </a>
              </p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${PAPER};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
        <tr><td style="padding:0 4px 18px;">
          ${atmosphereWordmarkHtml()}
        </td></tr>
        <tr><td>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${CARD};border:1px solid ${LINE};border-radius:16px;">
            <tr><td style="padding:28px 28px 24px;">${body}
              <p style="margin:18px 0 0;font-family:${MONO};font-size:12px;line-height:1.4;color:${INK_FAINT};">
                Expires in 1 hour · one use
              </p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 4px 0;font-size:12px;line-height:1.5;color:${INK_FAINT};">
          If you did not ask for this, ignore this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
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
