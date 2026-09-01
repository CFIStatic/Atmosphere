import { config } from '../config.js';
import { sendSystemMail, systemMailConfigured } from './systemMail.js';
import type { CareersApplication } from './validation.js';

/**
 * Delivery for careers applications: one email per application to the hiring
 * inbox (CAREERS_TO_EMAIL), sent through the same authenticated Atmosphere
 * mail path as invites (Resend first, SMTP only when it can sign jettx.ai).
 */

export { getTransporter, smtpConfigured } from './smtpTransport.js';

export function careersMailConfigured(): boolean {
  return systemMailConfigured() && Boolean(config.careers.toEmail);
}

/** Render the application as a plain-text email body. */
export function renderApplicationEmail(app: CareersApplication): string {
  return [
    `Role:  ${app.role}`,
    `Name:  ${app.name}`,
    `Email: ${app.email}`,
    app.links ? `Links: ${app.links}` : null,
    '',
    app.message,
    '',
    '—',
    'Sent from the Atmosphere careers page.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/** Send one application to the hiring inbox. Throws on transport failure. */
export async function sendApplicationEmail(app: CareersApplication): Promise<void> {
  const result = await sendSystemMail({
    to: config.careers.toEmail,
    subject: `Careers application — ${app.role} — ${app.name}`,
    text: renderApplicationEmail(app),
    replyTo: `"${app.name.replaceAll('"', "'")}" <${app.email}>`,
    keepReplyTo: true,
  });
  if (!result.ok) {
    throw new Error(result.why);
  }
}
