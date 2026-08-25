/**
 * Atmosphere password-reset email.
 *
 * Platform mail (SMTP / Resend) — never Supabase Auth. The From line is
 * Atmosphere, the body uses the same five-bar mark and paper/terracotta
 * surfaces as the office app, and the link is a token_hash on /reset-password
 * so the click never depends on Supabase Site URL.
 */

const INK = '#1C1917';
const INK_SOFT = '#57534E';
const INK_FAINT = '#78716C';
const PAPER = '#FBFAF7';
const CARD = '#FFFFFF';
const LINE = '#E3DED4';
const ACCENT = '#D2500A';
const ACCENT_INK = '#FFFFFF';

/** Four ink bars + terracotta base — the only Atmosphere mark. */
const MARK_BARS = ['#A8A29E', '#78716C', '#57534E', '#292524', '#F2670C'] as const;

export function passwordResetEmail(input: { url: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const url = input.url.trim();
  const signIn = signInUrl(url);
  const subject = 'Choose a new Atmosphere password';
  const textLines = [
    'Atmosphere',
    '',
    'Choose a new password.',
    '',
    'Someone asked to reset the Atmosphere password on this address.',
    'Open this link to pick a new one. It expires in one hour and can only be used once:',
    '',
    `  ${url}`,
    '',
  ];
  if (signIn) {
    textLines.push(`Back to sign in: ${signIn}`, '');
  }
  textLines.push(
    'If you did not ask for this, ignore it — your password stays the same.',
    '',
    '— Atmosphere',
  );
  const text = textLines.join('\n');

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
    Choose a new Atmosphere password. This link expires in one hour.
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${PAPER};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
        <tr><td style="padding:0 4px 18px;">
          ${wordmark()}
        </td></tr>
        <tr><td>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${CARD};border:1px solid ${LINE};border-radius:16px;">
            <tr><td style="padding:28px 28px 24px;">
              <p style="margin:0;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${ACCENT};">
                Password reset
              </p>
              <h1 style="margin:10px 0 0;font-size:24px;line-height:1.25;letter-spacing:-0.02em;color:${INK};font-weight:700;">
                Choose a new password
              </h1>
              <p style="margin:12px 0 0;font-size:15px;line-height:1.55;color:${INK_SOFT};">
                Someone asked to reset the Atmosphere password on this address.
                Open the button to pick a new one. You will be signed in once it is saved.
              </p>
              <p style="margin:24px 0 0;">
                <a href="${escapeAttr(url)}"
                   style="display:inline-block;background:${ACCENT};color:${ACCENT_INK};font-weight:700;font-size:15px;text-decoration:none;padding:12px 20px;border-radius:10px;">
                  Choose a new password
                </a>
              </p>
              <p style="margin:18px 0 0;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:12px;line-height:1.4;color:${INK_FAINT};">
                Expires in 1 hour · one use
              </p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 4px 0;font-size:12px;line-height:1.5;color:${INK_FAINT};">
          If you did not ask for this, ignore it — your password stays the same.
          ${
            signIn
              ? `<br><a href="${escapeAttr(signIn)}" style="color:${ACCENT};font-weight:600;text-decoration:none;">Back to sign in</a>`
              : ''
          }
          <br><br>
          Sent by Atmosphere · Work Verification
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

function wordmark(): string {
  const bars = MARK_BARS.map((color, i) => {
    const gap =
      i === 0
        ? ''
        : `<tr><td height="2" style="height:2px;line-height:2px;font-size:2px;">&nbsp;</td></tr>`;
    const bar = `<tr><td height="4" style="height:4px;line-height:4px;font-size:4px;background:${color};">&nbsp;</td></tr>`;
    return `${gap}${bar}`;
  }).join('');
  return `<table role="presentation" cellspacing="0" cellpadding="0">
    <tr>
      <td valign="middle" width="22" style="width:22px;">
        <table role="presentation" width="22" cellspacing="0" cellpadding="0" style="width:22px;">
          ${bars}
        </table>
      </td>
      <td valign="middle" style="padding-left:10px;font-size:18px;font-weight:700;letter-spacing:-0.02em;color:${INK};line-height:1;">
        Atmosphere
      </td>
    </tr>
  </table>`;
}

function signInUrl(resetUrl: string): string | null {
  try {
    return `${new URL(resetUrl).origin}/login`;
  } catch {
    return null;
  }
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
