/**
 * Password-recovery email.
 *
 * Sent by Atmosphere (platform SMTP / Resend), not by Supabase's built-in
 * mailer. The link goes straight to the office app with a token_hash so the
 * click never depends on Supabase Site URL — which defaults to localhost:3000
 * and is how recovery emails have been landing in Safari.
 */

export function passwordResetEmail(input: { url: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const url = input.url.trim();
  const subject = 'Reset your Atmosphere password';
  const text = [
    'Reset your Atmosphere password.',
    '',
    'Open this link to choose a new one. It expires in one hour and can only be used once:',
    '',
    `  ${url}`,
    '',
    'If you did not ask for this, you can ignore it — your password stays the same.',
    '',
    '— Atmosphere',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fffdf8;border:1px solid #e7e0d4;border-radius:16px;padding:28px 28px 24px;">
        <tr><td>
          <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#b45309;">Atmosphere</p>
          <h1 style="margin:10px 0 0;font-size:22px;line-height:1.3;color:#1c1917;">
            Choose a new password
          </h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.5;color:#3f3a34;">
            Open this link to set a new password. It expires in one hour and can only be used once.
          </p>
          <p style="margin:24px 0 0;">
            <a href="${escapeAttr(url)}"
               style="display:inline-block;background:#ea580c;color:#1c1917;font-weight:700;font-size:15px;text-decoration:none;padding:12px 18px;border-radius:10px;">
              Reset password
            </a>
          </p>
          <p style="margin:14px 0 0;font-size:12px;line-height:1.4;color:#78716c;word-break:break-all;">
            Or paste this link:<br>${escapeHtml(url)}
          </p>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.4;color:#78716c;">
            If you did not ask for this, ignore it — your password stays the same.
          </p>
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
