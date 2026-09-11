import { config } from '../config.js';
import { sendSystemMail, systemMailConfigured } from './systemMail.js';
import type { ContactMessage } from './validation.js';

/** Contact-form messages → sales inbox via sendSystemMail (Resend). */

export function contactMailConfigured(): boolean {
  return systemMailConfigured() && Boolean(config.contact.toEmail);
}

export function renderContactEmail(msg: ContactMessage): string {
  return [
    `Name:     ${msg.name}`,
    `Email:    ${msg.email}`,
    msg.company ? `Company:  ${msg.company}` : null,
    msg.teamSize ? `Team:     ${msg.teamSize}` : null,
    msg.workType ? `Work:     ${msg.workType}` : null,
    '',
    msg.message,
    '',
    '—',
    'Sent from the Atmosphere contact page.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

export async function sendContactEmail(msg: ContactMessage): Promise<void> {
  const result = await sendSystemMail({
    to: config.contact.toEmail,
    subject: `Contact — ${msg.company || msg.name}`,
    text: renderContactEmail(msg),
    replyTo: `"${msg.name.replaceAll('"', "'")}" <${msg.email}>`,
    keepReplyTo: true,
  });
  if (!result.ok) {
    throw new Error(result.why);
  }
}
