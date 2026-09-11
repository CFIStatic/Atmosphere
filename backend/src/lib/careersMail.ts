import { config } from '../config.js';
import { sendSystemMail, systemMailConfigured } from './systemMail.js';
import type { CareersApplication } from './validation.js';

/** Careers applications → hiring inbox via sendSystemMail (Resend). */

export function careersMailConfigured(): boolean {
  return systemMailConfigured() && Boolean(config.careers.toEmail);
}

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
